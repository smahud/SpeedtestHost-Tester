#!/usr/bin/env python3
"""Raw protocol probe against a running laboratory OoklaServer.

This script talks to the daemon directly (no clone code involved) so that the
evidence it produces is an independent observation of the official server.

Usage:
    probe-daemon.py [--host 127.0.0.1] [--port 8080] [--tls] [--ca FILE]
                    [--json OUT.json] [--text OUT.txt]

Every probe prints a PASS/FAIL/INFO marker so that the raw log can be read
without a JSON parser.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import http.client
import json
import os
import socket
import ssl
import struct
import sys
import time
from pathlib import Path

IMAGE_SIZES = [
    (350, 245388), (500, 505544), (750, 1118012), (1000, 1986284),
    (1500, 4468241), (2000, 7907740), (2500, 12407926), (3000, 17816816),
    (3500, 24262167), (4000, 31625365),
]


def marker(ok):
    return "PASS" if ok else "FAIL"


def recv_exact(sock, n):
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise EOFError("closed")
        buf += chunk
    return buf


def recv_until(sock, marker_bytes, limit=16384):
    buf = b""
    while marker_bytes not in buf and len(buf) < limit:
        chunk = sock.recv(1024)
        if not chunk:
            break
        buf += chunk
    return buf


def tcp_connect(host, port, timeout=8.0):
    s = socket.create_connection((host, port), timeout=timeout)
    s.settimeout(timeout)
    return s


def make_tls(host, port, ca=None, timeout=8.0):
    ctx = ssl.create_default_context(cafile=ca) if ca else ssl.create_default_context()
    raw = socket.create_connection((host, port), timeout=timeout)
    raw.settimeout(timeout)
    return ctx.wrap_socket(raw, server_hostname=host)


def probe_netgauge(host, port, tls, ca, out):
    label = "netgauge-tls" if tls else "netgauge-tcp"
    try:
        s = make_tls(host, port, ca) if tls else tcp_connect(host, port)
        s.sendall(b"HI\n")
        data = b""
        while b"\n" not in data and len(data) < 512:
            chunk = s.recv(512)
            if not chunk:
                break
            data += chunk
        line = data.decode("utf-8", "replace").strip()
        s.sendall(b"QUIT\n")
        s.close()
        ok = line.upper().startswith("HELLO")
        out.append({"probe": label, "status": marker(ok), "response": line})
    except Exception as exc:
        out.append({"probe": label, "status": "ERROR", "error": str(exc)})


def http_req(host, port, path, method="GET", body=None, tls=False, ca=None,
             headers=None, timeout=20.0, keep_alive=False):
    if tls:
        s = make_tls(host, port, ca, timeout)
    else:
        s = tcp_connect(host, port, timeout)
    hdr = {
        "Host": f"{host}:{port}",
        "User-Agent": "OoklaLabProbe/1.0",
        "Accept": "*/*",
        "Connection": "keep-alive" if keep_alive else "close",
    }
    if headers:
        hdr.update(headers)
    if body is not None:
        hdr["Content-Length"] = str(len(body))
    req = f"{method} {path} HTTP/1.1\r\n" + "".join(f"{k}: {v}\r\n" for k, v in hdr.items())
    s.sendall(req.encode() + b"\r\n")
    if body is not None:
        s.sendall(body)
    resp = http.client.HTTPResponse(s, method=method)
    resp.begin()
    data = resp.read()
    res = {
        "status": resp.status,
        "reason": resp.reason,
        "headers": dict(resp.getheaders()),
        "body": data,
        "sock": s,
    }
    if not keep_alive:
        s.close()
        res["sock"] = None
    return res


def probe_http_paths(host, port, tls, ca, out):
    tag = "tls" if tls else "http"
    for path in ("/hi", "/", "/crossdomain.xml", "/speedtest/latency.txt",
                 "/speedtest/upload.php", "/nonexistent-path-xyz"):
        try:
            r = http_req(host, port, path, tls=tls, ca=ca)
            body = r["body"][:200].decode("utf-8", "replace")
            out.append({
                "probe": f"GET {path} [{tag}]",
                "status": "INFO",
                "http_status": r["status"],
                "content_type": r["headers"].get("Content-Type"),
                "content_length": r["headers"].get("Content-Length"),
                "body": body,
            })
        except Exception as exc:
            out.append({"probe": f"GET {path} [{tag}]", "status": "ERROR", "error": str(exc)})


def probe_upload(host, port, tls, ca, out):
    """POST /speedtest/upload.php with several body sizes.

    Establishes empirically which size= algorithm the endpoint implements.
    """
    tag = "tls" if tls else "http"
    for label, total in (("tiny", 10), ("legacy-516300", 515798),
                         ("legacy-1981500", 1981498), ("round-516300", 516300)):
        body = b"content1=" + b"a" * max(0, total - len("content1="))
        try:
            r = http_req(host, port, "/speedtest/upload.php", method="POST", body=body,
                         tls=tls, ca=ca,
                         headers={"Content-Type": "application/x-www-form-urlencoded"},
                         timeout=30.0)
            text = r["body"].decode("utf-8", "replace").strip()
            out.append({
                "probe": f"POST /speedtest/upload.php body={len(body)} [{tag}]",
                "status": "INFO",
                "http_status": r["status"],
                "response": text,
                "content_length_sent": len(body),
            })
        except Exception as exc:
            out.append({"probe": f"POST /speedtest/upload.php body={len(body)} [{tag}]",
                        "status": "ERROR", "error": str(exc)})


def probe_images(host, port, tls, ca, out):
    tag = "tls" if tls else "http"
    for dim, expected in IMAGE_SIZES:
        path = f"/speedtest/random{dim}x{dim}.jpg"
        try:
            r = http_req(host, port, path, tls=tls, ca=ca, timeout=30.0)
            actual = len(r["body"])
            ctype = r["headers"].get("Content-Type", "")
            jpeg = r["body"][:2] == b"\xff\xd8"
            out.append({
                "probe": f"GET {path} [{tag}]",
                "status": marker(actual == expected and jpeg),
                "expected_bytes": expected,
                "actual_bytes": actual,
                "content_type": ctype,
                "jpeg_magic": jpeg,
            })
        except Exception as exc:
            out.append({"probe": f"GET {path} [{tag}]", "status": "ERROR", "error": str(exc)})


def probe_websocket(host, port, tls, ca, out):
    label = "wss" if tls else "ws"
    try:
        s = make_tls(host, port, ca) if tls else tcp_connect(host, port)
        key = base64.b64encode(os.urandom(16)).decode()
        guid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
        expect = base64.b64encode(hashlib.sha1((key + guid).encode()).digest()).decode()
        req = (f"GET /ws HTTP/1.1\r\nHost: {host}:{port}\r\n"
               f"User-Agent: OoklaLabProbe/1.0\r\nAccept: */*\r\n"
               f"Connection: Upgrade\r\nUpgrade: websocket\r\n"
               f"Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: {key}\r\n"
               f"Origin: https://www.speedtest.net\r\n\r\n")
        s.sendall(req.encode())
        head = recv_until(s, b"\r\n\r\n").decode("latin1", "replace")
        upgraded = "101 Switching Protocols" in head
        accept_ok = expect in head
        payload = b""
        if upgraded and accept_ok:
            mask = os.urandom(4)
            body = b"HI\n"
            masked = bytes(c ^ mask[i % 4] for i, c in enumerate(body))
            s.sendall(bytes([0x81, 0x80 | len(body)]) + mask + masked)
            b1, b2 = recv_exact(s, 2)
            ln = b2 & 0x7F
            if ln == 126:
                ln = struct.unpack(">H", recv_exact(s, 2))[0]
            elif ln == 127:
                ln = struct.unpack(">Q", recv_exact(s, 8))[0]
            payload = recv_exact(s, ln) if ln else b""
        s.close()
        out.append({
            "probe": f"websocket-upgrade [{label}]",
            "status": marker(upgraded and accept_ok and payload.upper().startswith(b"HELLO")),
            "upgraded": upgraded,
            "sec_websocket_accept_ok": accept_ok,
            "frame_payload": payload.decode("utf-8", "replace"),
            "response_head": head.split("\r\n\r\n")[0][:400],
        })
    except Exception as exc:
        out.append({"probe": f"websocket-upgrade [{label}]", "status": "ERROR", "error": str(exc)})


def probe_keepalive(host, port, tls, ca, out):
    """Two sequential requests on ONE socket: does the daemon reuse the connection?"""
    tag = "tls" if tls else "http"
    try:
        s = make_tls(host, port, ca) if tls else tcp_connect(host, port)
        req = (f"GET /speedtest/latency.txt HTTP/1.1\r\nHost: {host}:{port}\r\n"
               f"User-Agent: OoklaLabProbe/1.0\r\nAccept: */*\r\nConnection: keep-alive\r\n\r\n")
        s.sendall(req.encode())
        r1 = http.client.HTTPResponse(s, method="GET")
        r1.begin()
        b1 = r1.read()
        t0 = time.perf_counter()
        s.sendall(req.encode())
        r2 = http.client.HTTPResponse(s, method="GET")
        r2.begin()
        b2 = r2.read()
        ms = (time.perf_counter() - t0) * 1000
        h2 = dict(r2.getheaders())
        s.close()
        out.append({
            "probe": f"keepalive-two-requests-one-socket [{tag}]",
            "status": marker(b1 == b2 and ms < 2000),
            "first_body": b1.decode("utf-8", "replace").strip(),
            "second_body": b2.decode("utf-8", "replace").strip(),
            "second_ms": round(ms, 2),
            "connection_header_2": h2.get("Connection"),
        })
    except Exception as exc:
        out.append({"probe": f"keepalive-two-requests-one-socket [{tag}]",
                    "status": "ERROR", "error": str(exc)})


def probe_udp(host, port, out):
    """Does the daemon answer a NetGauge-style HI on the UDP socket?"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(5.0)
        s.sendto(b"HI\n", (host, port))
        try:
            data, _ = s.recvfrom(2048)
            out.append({"probe": "udp-netgauge-hi", "status": marker(data.upper().startswith(b"HELLO")),
                        "response": data.decode("utf-8", "replace").strip()})
        except socket.timeout:
            out.append({"probe": "udp-netgauge-hi", "status": "TIMEOUT",
                        "response": "(no UDP reply within 5s)"})
        s.close()
    except Exception as exc:
        out.append({"probe": "udp-netgauge-hi", "status": "ERROR", "error": str(exc)})


def probe_tls_negative(host, port, ca, out):
    """Negative TLS cases: untrusted chain, hostname mismatch, expired leaf."""
    cases = [
        ("untrusted-self-signed", None, "untrusted.crt"),
        ("hostname-mismatch", "ca.crt", "wronghost.crt"),
        ("expired-leaf", "ca.crt", "expired.crt"),
    ]
    for label, cafile, certfile in cases:
        certdir = Path(__file__).resolve().parent.parent / "certs"
        bundle = str(certdir / cafile) if cafile else None
        try:
            s = socket.create_connection((host, port), timeout=8)
            ctx = ssl.create_default_context(cafile=bundle)
            ctx.load_cert_chain(str(certdir / certfile),
                                str(certdir / Path(certfile).with_suffix(".key").name))
            w = ctx.wrap_socket(s, server_hostname=host)
            w.sendall(f"GET /hi HTTP/1.1\r\nHost: {host}:{port}\r\n\r\n".encode())
            w.recv(256)
            w.close()
            out.append({"probe": f"tls-negative-{label}", "status": "UNEXPECTED_SUCCESS",
                        "note": "server accepted a certificate that should have been rejected"})
        except ssl.SSLError as exc:
            out.append({"probe": f"tls-negative-{label}", "status": "INFO",
                        "rejected": True, "error": str(exc)})
        except Exception as exc:
            out.append({"probe": f"tls-negative-{label}", "status": "ERROR", "error": str(exc)})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--tls", action="store_true")
    ap.add_argument("--ca", default=None)
    ap.add_argument("--json", default=None)
    ap.add_argument("--text", default=None)
    args = ap.parse_args()

    out = []
    probe_netgauge(args.host, args.port, args.tls, args.ca, out)
    probe_http_paths(args.host, args.port, args.tls, args.ca, out)
    probe_websocket(args.host, args.port, args.tls, args.ca, out)
    probe_upload(args.host, args.port, args.tls, args.ca, out)
    probe_images(args.host, args.port, args.tls, args.ca, out)
    probe_keepalive(args.host, args.port, args.tls, args.ca, out)
    probe_udp(args.host, args.port, out)
    if args.tls:
        probe_tls_negative(args.host, args.port, args.ca, out)

    text_lines = []
    for item in out:
        head = f"{item['status']:<6} {item['probe']}"
        text_lines.append(head)
        for k, v in item.items():
            if k in ("probe", "status"):
                continue
            text_lines.append(f"         {k}: {v}")
    text = "\n".join(text_lines) + "\n"

    if args.text:
        Path(args.text).write_text(text, encoding="utf-8")
    if args.json:
        Path(args.json).write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
