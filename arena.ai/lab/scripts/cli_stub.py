#!/usr/bin/env python3
"""Local HTTPS stand-in for the Ookla CLI control plane.

The official Speedtest CLI needs two Ookla services:

  https://cli.speedtest.net/api/cli/config   -- the server list
  https://results.speedtest.net/reports       -- result submission

Running the CLI inside a network namespace that has nothing but loopback
means both names have to resolve locally.  This stub provides them:

  * /api/cli/config  answers with the REAL configuration document that was
    captured from cli.speedtest.net, but with the server list reduced to the
    single laboratory server (this mirrors what the real API does when it is
    called with &serverhost=<fqdn>).
  * /reports         records every submission attempt and answers 503, so the
    CLI reports "not persisted".  Nothing a laboratory measurement produces
    can ever reach Ookla's public result store.

Both names are served by the same listener on 127.0.0.1:443 with a
certificate for cli.speedtest.net / results.speedtest.net signed by the
laboratory CA.
"""
from __future__ import annotations

import argparse
import json
import os
import signal
import ssl
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

LAB = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG = LAB / "results" / "cli-config-device.json"
DEFAULT_SERVER = "myspeed.gorge.net:8080"

STATE = {
    "submissions": [],       # every body posted to /reports
    "config_requests": [],   # every query string seen on /api/cli/config
}


def build_config(config_path: Path, server: str) -> dict:
    """Return the real configuration with only the laboratory server listed."""
    try:
        doc = json.loads(config_path.read_text(encoding="utf-8"))
    except Exception:
        doc = {"suite": {}, "app": {}, "servers": []}
    servers = [s for s in doc.get("servers", []) if s.get("host") == server]
    if not servers:
        servers = [{
            "id": "4063",
            "host": server,
            "name": "Laboratory",
            "country": "United States",
            "sponsor": "ArenaLab",
            "sponsored": False,
            "host_functional": "1",
        }]
    doc["servers"] = servers
    return doc


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "OoklaLabCLIStub/1.0"

    def log_message(self, fmt, *args):
        print("cli-stub", fmt % args, flush=True)
        _flush_state(self.server.state_path)

    def _send(self, body: bytes, status=200, ctype="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/api/cli/config"):
            STATE["config_requests"].append(self.path)
            doc = build_config(self.server.config_path, self.server.lab_server)
            payload = json.dumps(doc).encode()
            self._send(payload)
            return
        self._send(b'{"error":"not found"}', 404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(length) if length else b""
        if self.path.startswith("/reports"):
            STATE["submissions"].append({
                "path": self.path,
                "length": length,
                "sha256_prefix": __import__("hashlib").sha256(body).hexdigest()[:16],
                "preview": body[:400].decode("utf-8", "replace"),
            })
            # 503 -> the CLI reports that the result was NOT persisted, so a
            # laboratory measurement can never be mistaken for a real one.
            self._send(b'{"error":"laboratory environment: result submission disabled"}', 503)
            _flush_state(self.server.state_path)
            return
        self._send(b'{"error":"not found"}', 404)



class StubServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, addr, certfile, keyfile, config_path, lab_server, state_path=None):
        self.config_path = config_path
        self.lab_server = lab_server
        self.state_path = state_path or str(LAB / "results" / "cli-stub-state.json")
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(certfile, keyfile)
        super().__init__(addr, Handler)
        self.socket = ctx.wrap_socket(self.socket, server_side=True)


def _flush_state(path):
    try:
        Path(path).write_text(json.dumps(STATE, indent=2), encoding="utf-8")
    except OSError:
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=443)
    ap.add_argument("--cert", default=str(LAB / "certs" / "control.crt"))
    ap.add_argument("--key", default=str(LAB / "certs" / "control.key"))
    ap.add_argument("--config", default=str(DEFAULT_CONFIG))
    ap.add_argument("--server", default=DEFAULT_SERVER)
    ap.add_argument("--state", default=str(LAB / "results" / "cli-stub-state.json"))
    ap.add_argument("--pidfile", default=None)
    args = ap.parse_args()

    def _on_term(_signum, _frame):
        _flush_state(args.state)
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, _on_term)
    signal.signal(signal.SIGINT, _on_term)

    if args.pidfile:
        Path(args.pidfile).write_text(str(os.getpid()), encoding="utf-8")

    server = StubServer((args.host, args.port), args.cert, args.key,
                        Path(args.config), args.server, args.state)
    print(f"CLI control-plane stub listening on {args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        _flush_state(args.state)
        print(json.dumps(STATE, indent=2), flush=True)


if __name__ == "__main__":
    sys.exit(main())
