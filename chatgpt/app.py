#!/usr/bin/env python3
"""Loopback-only web adapter. Runs the CLI in a time-bounded subprocess."""
import argparse
import html
import json
from pathlib import Path
import secrets
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parent


def render(value='', content='', csrf=''):
    return (ROOT / 'index.html').read_text().replace('__HOST__', html.escape(value, quote=True)).replace('__CSRF__', csrf).replace('__RESULT__', content)


def results(data):
    summary = data['summary']
    out = [f"<section aria-label='Results'><h2>{summary['passed']} passed · {summary['failed']} failed</h2>"]
    out.append('<p>' + html.escape(data['normalized_input']) + ' · ' + html.escape(data['timestamp']) + '</p>')
    for section in data['sections']:
        out.append('<h3>' + html.escape(section['title']) + '</h3>')
        for parent in section['rows']:
            for row in parent.get('subrows') or [parent]:
                state = row['status']
                out.append(f"<details class='{state.lower()}'><summary><span>{html.escape(row['key'])}</span><strong>{state}</strong></summary><pre>{html.escape(row['details'])}</pre></details>")
    out.append('<p>Measured from this computer. This is not an Ookla qualification verdict.</p></section>')
    return ''.join(out)


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def send(self, body, status=200, kind='text/html; charset=utf-8'):
        raw = body.encode()
        self.send_response(status)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
        self.end_headers()
        self.wfile.write(raw)

    def valid_host(self):
        return self.headers.get('Host') in (f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}')

    def do_GET(self):
        if not self.valid_host():
            return self.send('Invalid Host', 403, 'text/plain')
        path = urlsplit(self.path).path
        if path in ('/', '/host-tester'):
            return self.send(render(csrf=self.server.csrf))
        if path == '/style.css':
            return self.send((ROOT / 'style.css').read_text(), kind='text/css')
        if path == '/health':
            return self.send('{"status":"ok"}', kind='application/json')
        return self.send('Not found', 404, 'text/plain')

    def do_POST(self):
        if not self.valid_host():
            return self.send('Invalid Host', 403, 'text/plain')
        if urlsplit(self.path).path != '/host-tester':
            return self.send('Not found', 404, 'text/plain')
        if self.headers.get_content_type() != 'application/x-www-form-urlencoded' or self.headers.get('Transfer-Encoding'):
            return self.send('Unsupported request encoding', 415, 'text/plain')
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 4096:
                return self.send('Request too large or empty', 413, 'text/plain')
            form = parse_qs(self.rfile.read(length).decode('utf-8'), max_num_fields=8)
        except (ValueError, UnicodeError):
            return self.send('Invalid request', 400, 'text/plain')
        if not secrets.compare_digest(form.get('csrf', [''])[0], self.server.csrf):
            return self.send('Invalid form session; reload the page', 403, 'text/plain')
        target = form.get('ookla-server', [''])[0]
        if not self.server.gate.acquire(blocking=False):
            return self.send('Another test is running. Try again after it finishes.', 429, 'text/plain')
        try:
            command = [sys.executable, str(ROOT / 'cli.py'), '--json', '--quiet', '--legacy-port', str(self.server.legacy_port)]
            if self.server.allow_private:
                command.append('--allow-private')
            if self.server.ca_bundle:
                command.extend(['--ca-bundle', self.server.ca_bundle])
            command.extend(['--', target])
            proc = subprocess.run(command, capture_output=True, text=True, timeout=180)
            if proc.returncode not in (0, 1):
                return self.send(render(target, '<p role="alert">' + html.escape(proc.stderr[-2000:]) + '</p>', self.server.csrf), 400)
            return self.send(render(target, results(json.loads(proc.stdout)), self.server.csrf))
        except subprocess.TimeoutExpired:
            return self.send(render(target, '<p role="alert">Test exceeded the 180-second web budget. Use the CLI to diagnose individual failures.</p>', self.server.csrf), 504)
        except (ValueError, OSError):
            return self.send('Test runner failed', 500, 'text/plain')
        finally:
            self.server.gate.release()


def make_server(port=8000, allow_private=False, legacy_port=80, ca_bundle=None):
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.csrf = secrets.token_urlsafe(32)
    server.gate = threading.BoundedSemaphore(1)
    server.allow_private, server.legacy_port, server.ca_bundle = allow_private, legacy_port, ca_bundle
    return server


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--allow-private', action='store_true', help='Operator-only opt-in for trusted lab targets')
    parser.add_argument('--legacy-port', type=int, default=80)
    parser.add_argument('--ca-bundle')
    args = parser.parse_args()
    if not 1 <= args.port <= 65535 or not 1 <= args.legacy_port <= 65535:
        parser.error('Ports must be between 1 and 65535')
    with make_server(args.port, args.allow_private, args.legacy_port, args.ca_bundle) as server:
        print(f'Open http://127.0.0.1:{server.server_port}/host-tester', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
