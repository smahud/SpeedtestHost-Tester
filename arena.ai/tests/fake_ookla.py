#!/usr/bin/env python3
"""A configurable fake OoklaServer used by the regression tests.

The fake speaks the subset of the real daemon's protocol that the host tester
exercises, and it can be told to misbehave so that the negative paths of the
client can be tested deterministically:

    netgauge_reply   what the raw TCP `HI` handshake answers
    ws_accept_ok     answer the WebSocket handshake correctly
    ws_hello         payload of the WebSocket HELLO frame
    upload_mode      "legacy" (PHP size formula) or "native" (raw length)
    http_mode        "normal", "garbage", "truncate", "reset"
    image_sizes      {dimension: bytes} served from /speedtest/randomNxN.jpg
    crossdomain      the /crossdomain.xml body
    latency_body     the /speedtest/latency.txt body
    close_after_first  close the socket after the first HTTP response

It is a TEST DOUBLE -- never used to produce a "real" protocol result.
"""
from __future__ import annotations

import base64
import hashlib
import socket
import socketserver
import threading
from urllib.parse import parse_qsl, urlsplit

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


class FakeConfig:
    def __init__(self, **kw):
        self.netgauge_reply = kw.get("netgauge_reply", "HELLO 2.11 (2.11.5) 2026-06-04.1737.7d0993d")
        self.ws_accept_ok = kw.get("ws_accept_ok", True)
        self.ws_hello = kw.get("ws_hello", "HELLO 2.11 (2.11.5) 2026-06-04.1737.7d0993d")
        self.upload_mode = kw.get("upload_mode", "legacy")
        self.http_mode = kw.get("http_mode", "normal")
        self.image_sizes = kw.get("image_sizes", {})
        self.crossdomain = kw.get(
            "crossdomain",
            '<?xml version="1.0"?>\n<cross-domain-policy>\n'
            '<allow-access-from domain="*" to-ports="*"/>\n</cross-domain-policy>\n',
        )
        self.latency_body = kw.get("latency_body", "test=test")
        self.close_after_first = kw.get("close_after_first", False)
        # seconds every HTTP response is delayed (used for deadline tests)
        self.delay = kw.get("delay", 0.0)


def _ws_accept(key: str) -> str:
    return base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()


def _serve_one(conn, cfg, first_line: bytes, headers: dict, body: bytes):
    """Serve one HTTP request.  Returns True when the connection may be reused."""
    method = first_line.decode("latin1").split(" ", 1)[0].upper()
    target = first_line.decode("latin1").split(" ")[1] if b" " in first_line else "/"
    path = urlsplit(target).path

    if cfg.http_mode == "garbage":
        conn.sendall(b"this is not http\r\n\r\n")
        return False
    if cfg.http_mode == "reset":
        conn.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER,
                        b"\x01\x00\x00\x00\x00\x00\x00\x00")
        conn.close()
        return False

    keep_alive = headers.get("connection", "").lower() != "close"
    if cfg.delay:
        import time as _time
        _time.sleep(cfg.delay)

    if path == "/ws" and headers.get("upgrade", "").lower() == "websocket":
        key = headers.get("sec-websocket-key", "")
        accept = _ws_accept(key) if cfg.ws_accept_ok else "AAAAAAAAAAAAAAAAAAAAAAAAAAA="
        conn.sendall(
            b"HTTP/1.1 101 Switching Protocols\r\n"
            b"Upgrade: websocket\r\n"
            b"Connection: Upgrade\r\n"
            b"Sec-WebSocket-Accept: " + accept.encode() + b"\r\n\r\n"
        )
        try:
            head = conn.recv(2)
            if len(head) == 2:
                length = head[1] & 0x7F
                masked = bool(head[1] & 0x80)
                mask = conn.recv(4) if masked else b""
                payload = conn.recv(length) if length else b""
                if mask and payload:
                    payload = bytes(c ^ mask[i % 4] for i, c in enumerate(payload))
                reply = cfg.ws_hello.encode()
                conn.sendall(bytes([0x81, len(reply)]) + reply)
        except OSError:
            pass
        conn.close()
        return False

    length = int(headers.get("content-length", "0") or 0)

    if method == "POST" and path.endswith("/upload.php"):
        size = length
        if cfg.upload_mode == "legacy":
            size = 500
            for key, value in parse_qsl(body.decode("utf-8", "replace"), keep_blank_values=True):
                size += len(key) + len(value) + 3
        payload = f"size={size}".encode()
        status = b"200 OK"
    elif path == "/hi":
        payload = b"hello 2.11 (2.11.5) 2026-06-04.1737.7d0993d"
        status = b"200 OK"
    elif path == "/crossdomain.xml":
        payload = cfg.crossdomain.encode()
        status = b"200 OK"
    elif path == "/speedtest/latency.txt":
        payload = cfg.latency_body.encode()
        status = b"200 OK"
    elif path.startswith("/speedtest/random") and path.endswith(".jpg"):
        dim = path[len("/speedtest/random"):-len(".jpg")]
        # the official file names are random{W}x{H}.jpg
        width = dim.split("x")[0]
        want = cfg.image_sizes.get(int(width)) if width.isdigit() else None
        if want is None:
            payload = b""
            status = b"404 Not Found"
        else:
            payload = b"\xff\xd8" + b"\x00" * max(0, want - 2)
            status = b"200 OK"
    else:
        payload = b"Not Found"
        status = b"404 Not Found"

    ctype = b"text/plain; charset=UTF-8"
    if path.endswith(".jpg"):
        ctype = b"image/jpeg"
    elif path.endswith(".xml"):
        ctype = b"text/xml"

    head = (b"HTTP/1.1 " + status + b"\r\n"
            b"Content-Type: " + ctype + b"\r\n"
            b"Content-Length: " + str(len(payload)).encode() + b"\r\n"
            b"Connection: " + (b"keep-alive" if keep_alive else b"close") + b"\r\n\r\n")
    conn.sendall(head)
    if cfg.http_mode == "truncate":
        conn.sendall(payload[: max(0, len(payload) // 2)])
        conn.close()
        return False
    conn.sendall(payload)
    return keep_alive and not cfg.close_after_first


class _Handler(socketserver.BaseRequestHandler):
    def handle(self):
        cfg = self.server.cfg
        conn = self.request
        conn.settimeout(20.0)
        try:
            peek = conn.recv(4, socket.MSG_PEEK)
        except OSError:
            return
        if not (peek.startswith(b"GET ") or peek.startswith(b"POST")
                or peek.startswith(b"HEAD")):
            self._netgauge(conn, cfg)
            return
        self._http(conn, cfg)

    def _netgauge(self, conn, cfg):
        data = b""
        while b"\n" not in data and len(data) < 512:
            chunk = conn.recv(512)
            if not chunk:
                break
            data += chunk
        if data.strip().upper().startswith(b"HI"):
            conn.sendall(cfg.netgauge_reply.encode() + b"\n")
        try:
            conn.recv(64)
        except OSError:
            pass
        conn.close()

    def _http(self, conn, cfg):
        buf = b""
        while b"\r\n\r\n" not in buf:
            try:
                chunk = conn.recv(4096)
            except OSError:
                return
            if not chunk:
                return
            buf += chunk
            if len(buf) > 65536:
                return
        head_text, _, rest = buf.partition(b"\r\n\r\n")
        lines = head_text.decode("latin1").split("\r\n")
        first_line = lines[0].encode("latin1")
        headers = {}
        for line in lines[1:]:
            if ":" in line:
                k, _, v = line.partition(":")
                headers[k.strip().lower()] = v.strip()
        content_length = int(headers.get("content-length", "0") or 0)
        body = rest
        need = content_length - len(body)
        while need > 0:
            try:
                chunk = conn.recv(min(65536, need))
            except OSError:
                break
            if not chunk:
                break
            body += chunk
            need -= len(chunk)
        try:
            keep = _serve_one(conn, cfg, first_line, headers, body)
            while keep:
                buf = b""
                while b"\r\n\r\n" not in buf:
                    chunk = conn.recv(4096)
                    if not chunk:
                        return
                    buf += chunk
                head_text, _, rest = buf.partition(b"\r\n\r\n")
                lines = head_text.decode("latin1").split("\r\n")
                first_line = lines[0].encode("latin1")
                headers = {}
                for line in lines[1:]:
                    if ":" in line:
                        k, _, v = line.partition(":")
                        headers[k.strip().lower()] = v.strip()
                content_length = int(headers.get("content-length", "0") or 0)
                body = rest
                need = content_length - len(body)
                while need > 0:
                    chunk = conn.recv(min(65536, need))
                    if not chunk:
                        break
                    body += chunk
                    need -= len(chunk)
                keep = _serve_one(conn, cfg, first_line, headers, body)
        except OSError:
            pass
        finally:
            try:
                conn.close()
            except OSError:
                pass


class FakeServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, cfg: FakeConfig, host="127.0.0.1", port=0):
        self.cfg = cfg
        super().__init__((host, port), _Handler)

    @property
    def port(self):
        return self.server_address[1]


def start(cfg: FakeConfig, host="127.0.0.1", port=0):
    """Start a fake daemon in a background thread; return (server, thread)."""
    server = FakeServer(cfg, host, port)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread


def stop(server):
    try:
        server.shutdown()
        server.server_close()
    except Exception:
        pass
