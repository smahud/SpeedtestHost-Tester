#!/usr/bin/env python3
"""Local HTTP Legacy Fallback simulator for port 80.

Reads the official http_legacy_fallback.zip directly (no extraction) and
reproduces the 2007 upload.php size algorithm.  This is a control service for
the clone tester; OoklaServer itself stays bound to 127.0.0.1:8080 only.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qsl, urlsplit
from pathlib import Path
import zipfile

ZIP = Path('/home/user/.cache/http_legacy_fallback.zip')
_zf = zipfile.ZipFile(ZIP)
CROSS = _zf.read('crossdomain.xml')
LATENCY = _zf.read('speedtest/latency.txt')

class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'Apache/2.4.29 (Ubuntu)'

    def _send(self, body, ctype='text/html; charset=UTF-8', status=200):
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Connection', 'keep-alive')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/crossdomain.xml':
            return self._send(CROSS, 'text/xml')
        if path == '/speedtest/latency.txt':
            return self._send(LATENCY, 'text/plain; charset=UTF-8')
        if path.startswith('/speedtest/random') and path.endswith('.jpg'):
            name = path.lstrip('/')
            try:
                return self._send(_zf.read(name), 'image/jpeg')
            except KeyError:
                pass
        return self._send(b'Not Found', status=404)

    def do_POST(self):
        path = urlsplit(self.path).path
        length = int(self.headers.get('Content-Length', '0') or 0)
        body = self.rfile.read(min(length, 4_000_000)) if length else b''
        if path in ('/speedtest/upload.php', '/upload.php'):
            size = 500
            for key, value in parse_qsl(body.decode('utf-8', 'replace'), keep_blank_values=True):
                size += len(key) + len(value) + 3
            return self._send(f'size={size}'.encode(), 'text/html; charset=UTF-8')
        return self._send(b'Not Found', status=404)

    def log_message(self, fmt, *args):
        print('legacy80', fmt % args, flush=True)

if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 80), Handler)
    server.daemon_threads = True
    print('Legacy fallback listening on 127.0.0.1:80', flush=True)
    server.serve_forever()
