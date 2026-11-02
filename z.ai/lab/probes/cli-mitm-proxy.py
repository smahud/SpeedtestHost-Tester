#!/usr/bin/env python3
"""MITM proxy: implements the "domain -> localhost" trick for the Ookla CLI.

The sandbox cannot write /etc/hosts (no root), so the redirect happens at the
configuration level - functionally identical to pointing the real server
domain at localhost:

  1. The CLI fetches its engine config + server list from
     https://cli.speedtest.net/api/cli/config (single JSON document).
  2. We MITM exactly that host (client must run with
     --ca-certificate=mitm/ca.pem) and serve the REAL config, byte for byte,
     with ONE change: the chosen server entry's host
     1010.hkspeedtest.com:8080 -> localhost:8080 (our lab OoklaServer).
  3. Everything else (engine parameters, license, other servers) stays
     genuine; any other host is transparently tunneled.

Result: the official client runs a genuine test flow against the official
OoklaServer daemon on localhost.
"""
import json
import os
import select
import socket
import socketserver
import ssl
import sys
import threading
import urllib.request

BASE = "/home/z/my-project/ookla-cli"
REAL_SERVER_ID = "43356"          # 1010 Hong Kong - the CLI's top pick
REAL_HOST = "1010.hkspeedtest.com:8080"
LOCAL_HOST = "localhost:8080"     # the lab OoklaServer (official binary)
LOG = open(os.path.join(BASE, "mitm-proxy.log"), "a", buffering=1)
LOCK = threading.Lock()


def log(msg):
    with LOCK:
        LOG.write(msg + "\n")


def build_config(query: str, ua: str):
    """Fetch the live config with the CLI's OWN query string (license is
    bound to deviceId/sid/hid/uname) and redirect ONE server entry."""
    url = "https://cli.speedtest.net/api/cli/config" + ("?" + query if query else "")
    req = urllib.request.Request(url, headers={"User-Agent": ua or
        "ookla-cli/1.2.0.84-1.ea6b6773cf (speedtest-cli-linux-x86_64)",
        "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        raw = r.read()
    cfg = json.loads(raw)
    changed = False
    for s in cfg.get("servers", []):
        if s.get("id") == REAL_SERVER_ID:
            s["host"] = LOCAL_HOST
            s["name"] = "1010 -> LOCALHOST (lab official binary)"
            changed = True
    if not changed:
        raise RuntimeError(f"server id {REAL_SERVER_ID} not found in live config")
    body = json.dumps(cfg).encode()
    log(f"[config] fetched with CLI's own query ({len(raw)} B); server {REAL_SERVER_ID} "
        f"host {REAL_HOST} -> {LOCAL_HOST}")
    return body


class MitmHandler(socketserver.BaseRequestHandler):
    def handle(self):
        try:
            self._handle()
        except Exception as e:
            log(f"!! error: {e!r}")

    def _handle(self):
        f = self.request.makefile("rb")
        first = f.readline()
        if not first:
            return
        method, target, _ = first.decode("latin1").split(" ", 2)
        headers = []
        while True:
            line = f.readline()
            if not line or line in (b"\r\n", b"\n"):
                break
            headers.append(line)

        if method == "CONNECT":
            host, port = target.rsplit(":", 1)
            if host == "cli.speedtest.net":
                log(f"[mitm] CONNECT {target} -> TLS-terminating with lab cert")
                self.request.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                ctx.load_cert_chain(os.path.join(BASE, "mitm/srv.pem"),
                                    os.path.join(BASE, "mitm/srv.key"))
                try:
                    tls = ctx.wrap_socket(self.request, server_side=True)
                except Exception as e:
                    log(f"[mitm] TLS handshake failed: {e!r}")
                    return
                self.serve_config(tls)
            else:
                log(f"[tunnel] CONNECT {target}")
                try:
                    upstream = socket.create_connection((host, int(port)), timeout=10)
                except Exception as e:
                    log(f"[tunnel] FAILED {e!r}")
                    self.request.sendall(b"HTTP/1.1 502 Bad Gateway\r\n\r\n")
                    return
                self.request.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                socks = [self.request, upstream]
                while True:
                    readable, _, _ = select.select(socks, [], [], 60)
                    if not readable:
                        break
                    for s in readable:
                        data = s.recv(65536)
                        if not data:
                            return
                        (upstream if s is self.request else self.request).sendall(data)
        else:
            log(f"[plain] {method} {target}")
            # relay upstream untouched
            from urllib.parse import urlsplit
            p = urlsplit(target)
            up = socket.create_connection((p.hostname, p.port or 80), timeout=15)
            up.sendall(f"{method} {p.path}?{p.query} HTTP/1.1\r\nHost: {p.netloc}\r\n".encode())
            for h in headers:
                if not h.lower().startswith(b"proxy-"):
                    up.sendall(h)
            up.sendall(b"Connection: close\r\n\r\n")
            while True:
                data = up.recv(65536)
                if not data:
                    break
                self.request.sendall(data)
            up.close()

    def serve_config(self, tls):
        tf = tls.makefile("rb")
        first = tf.readline().decode("latin1")
        log(f"[mitm] {first.strip()}")
        path = first.split(" ")[1]
        query = path.split("?", 1)[1] if "?" in path else ""
        ua = ""
        while True:
            line = tf.readline()
            if not line or line in (b"\r\n", b"\n"):
                break
            hs = line.decode("latin1").strip()
            if hs.lower().startswith("user-agent:"):
                ua = hs.split(":", 1)[1].strip()
        body = build_config(query, ua)
        resp = (b"HTTP/1.1 200 OK\r\n"
                b"Content-Type: application/json\r\n"
                b"Content-Length: " + str(len(body)).encode() + b"\r\n"
                b"Connection: close\r\n\r\n" + body)
        tls.sendall(resp)
        log(f"[mitm] served crafted config ({len(body)} B)")
        tls.close()


class ThreadedProxy(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8888
    with ThreadedProxy(("127.0.0.1", port), MitmHandler) as srv:
        log(f"=== MITM proxy on 127.0.0.1:{port} (cli.speedtest.net -> crafted config) ===")
        srv.serve_forever()
