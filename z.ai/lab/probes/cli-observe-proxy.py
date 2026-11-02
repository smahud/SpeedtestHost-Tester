#!/usr/bin/env python3
"""Logging HTTP proxy for observing Ookla CLI API traffic.

- Plain-HTTP absolute-URI requests: logged fully (method, path, headers, body)
  and optionally answered locally from a handler table.
- CONNECT (HTTPS): tunneled transparently, target logged, payload untouched.
"""
import socket
import ssl
import socketserver
import sys
import threading

LOG = open("/home/z/my-project/ookla-cli/proxy.log", "a", buffering=1)
LOCK = threading.Lock()


def log(msg):
    with LOCK:
        LOG.write(msg + "\n")


def read_headers(sockfile):
    lines = []
    while True:
        line = sockfile.readline()
        if not line or line in (b"\r\n", b"\n"):
            break
        lines.append(line)
    return lines


class ProxyHandler(socketserver.BaseRequestHandler):
    def handle(self):
        try:
            self._handle()
        except Exception as e:
            log(f"!! handler error: {e!r}")

    def _handle(self):
        req = self.request
        f = req.makefile("rb")
        first = f.readline()
        if not first:
            return
        log(f">> {first.decode('latin1').strip()}")
        headers = read_headers(f)
        for h in headers:
            hs = h.decode("latin1").strip()
            if hs.lower().startswith(("host:", "user-agent:", "accept", "content-")):
                log(f"   {hs}")
        method, target, _ = first.decode("latin1").split(" ", 2)

        if method == "CONNECT":
            host, port = target.rsplit(":", 1)
            log(f"   [tunnel] -> {host}:{port}")
            try:
                upstream = socket.create_connection((host, int(port)), timeout=10)
            except Exception as e:
                log(f"   [tunnel] FAILED {e!r}")
                req.sendall(b"HTTP/1.1 502 Bad Gateway\r\n\r\n")
                return
            req.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            # bidirectional splice with select
            import select
            socks = [req, upstream]
            while True:
                readable, _, _ = select.select(socks, [], [], 30)
                if not readable:
                    break
                for s in readable:
                    data = s.recv(65536)
                    if not data:
                        return
                    (upstream if s is req else req).sendall(data)
            upstream.close()
        else:
            # plain HTTP through proxy: absolute URI
            log(f"   [plain-http] {target}")
            self.serve_plain_http(req, f, method, target, headers)

    def serve_plain_http(self, req, f, method, target, headers):
        # default: fetch upstream and relay, logging everything
        from urllib.parse import urlsplit
        p = urlsplit(target)
        upstream_host = p.hostname
        upstream_port = p.port or 80
        try:
            up = socket.create_connection((upstream_host, upstream_port), timeout=15)
        except Exception as e:
            log(f"   [upstream] FAILED {e!r}")
            req.sendall(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
            return
        up.sendall(f"{method} {p.path}?{p.query} HTTP/1.1\r\nHost: {p.netloc}\r\n".encode())
        for h in headers:
            if h.lower().startswith(b"proxy-"):
                continue
            up.sendall(h)
        up.sendall(b"Connection: close\r\n\r\n")
        # relay response, capturing it
        chunks = []
        while True:
            data = up.recv(65536)
            if not data:
                break
            chunks.append(data)
            req.sendall(data)
        body = b"".join(chunks)
        log(f"   [upstream response] {len(body)} bytes")
        # save first responses for analysis
        with LOCK:
            n = sum(1 for _ in open("/home/z/my-project/ookla-cli/proxy.log"))
        with open(f"/home/z/my-project/ookla-cli/upstream-{int(threading.current().ident) & 0xffff}.bin", "wb") as fh:
            fh.write(body)
        up.close()


class ThreadedProxy(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8888
    with ThreadedProxy(("127.0.0.1", port), ProxyHandler) as srv:
        log(f"=== proxy listening on 127.0.0.1:{port} ===")
        srv.serve_forever()
