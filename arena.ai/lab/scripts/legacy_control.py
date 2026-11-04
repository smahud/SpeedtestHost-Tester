#!/usr/bin/env python3
"""Self-contained HTTP legacy-fallback control server.

The original Ookla "HTTP legacy fallback" package is not redistributable and
is not served from any stable official URL any more.  This control server
reproduces the *observable contract* that the host tester checks, so that the
`--legacy-port 80` code path can be exercised without an external download:

    GET  /crossdomain.xml              -> the policy document
    GET  /speedtest/latency.txt         -> "test=test"
    POST /speedtest/upload.php          -> "size=500+len(key)+len(value)+3"
    GET  /speedtest/random{W}x{H}.jpg  -> a JPEG of the exact official byte size
    HTTP/1.1 keep-alive is supported so the keep-alive check can run.

IMPORTANT: this is a CONTROL, not the official package.  The byte sizes of the
ten image files and the upload.php size formula were taken from the official
package that the previous audit session downloaded, and they were independently
re-confirmed against the genuine official OoklaServer daemon, which serves the
same ten files with exactly the same byte sizes (see
validation/PROTOCOL_MATRIX.md).
"""
from __future__ import annotations

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

IMAGE_SIZES = [
    (350, 245388), (500, 505544), (750, 1118012), (1000, 1986284),
    (1500, 4468241), (2000, 7907740), (2500, 12407926), (3000, 17816816),
    (3500, 24262167), (4000, 31625365),
]

CROSSDOMAIN = (
    '<?xml version="1.0"?>\n'
    '<cross-domain-policy>\n'
    '<allow-access-from domain="*.speedtest.net" to-ports="80"/>\n'
    '<allow-access-from domain="*.ookla.com" to-ports="80"/>\n'
    '</cross-domain-policy>\n'
).encode()

LATENCY = b"test=test"

# A minimal but structurally valid JPEG: SOI + APP0/JFIF + EOI, padded with
# comment bytes so that the file has exactly the official length.
_JPEG_HEAD = (
    b"\xff\xd8"                      # SOI
    b"\xff\xe0"                      # APP0
    b"\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
)
_JPEG_TAIL = b"\xff\xd9"            # EOI


def jpeg_of_size(size: int) -> bytes:
    if size < len(_JPEG_HEAD) + len(_JPEG_TAIL):
        raise ValueError("size too small")
    filler = size - len(_JPEG_HEAD) - len(_JPEG_TAIL)
    return _JPEG_HEAD + b"\xff\xfe" + filler.to_bytes(2, "big") + b"\x00" * (filler - 4) + _JPEG_TAIL


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "Apache/2.4.29 (Ubuntu)"

    def _send(self, body, ctype="text/html; charset=UTF-8", status=200):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/crossdomain.xml":
            return self._send(CROSSDOMAIN, "text/xml")
        if path == "/speedtest/latency.txt":
            return self._send(LATENCY, "text/plain; charset=UTF-8")
        if path.startswith("/speedtest/random") and path.endswith(".jpg"):
            stem = path[len("/speedtest/random"):-len(".jpg")]
            width = stem.split("x")[0]
            for dim, size in IMAGE_SIZES:
                if dim == width:
                    return self._send(jpeg_of_size(size), "image/jpeg")
        return self._send(b"Not Found", status=404)

    def do_POST(self):
        path = urlsplit(self.path).path
        length = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(length) if length else b""
        if path in ("/speedtest/upload.php", "/upload.php"):
            size = 500
            for key, value in parse_qsl(body.decode("utf-8", "replace"), keep_blank_values=True):
                size += len(key) + len(value) + 3
            return self._send(f"size={size}".encode(), "text/html; charset=UTF-8")
        return self._send(b"Not Found", status=404)

    def log_message(self, fmt, *args):
        print("legacy80", fmt % args, flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=80)
    args = ap.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.daemon_threads = True
    print(f"Legacy fallback control listening on {args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    sys.exit(main())
