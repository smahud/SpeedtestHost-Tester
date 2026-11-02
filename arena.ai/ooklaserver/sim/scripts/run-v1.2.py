#!/usr/bin/env python3
"""Reproduce the v1.2.0 clone tests against the local official OoklaServer.

Usage: run-v1.2.py http|https
"""
from __future__ import annotations
import json
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, '/home/user')
import app  # noqa: E402

ROOT = Path('/home/user')
OUT = ROOT / 'ooklaserver' / 'sim' / 'results' / 'v1.2'
CA = '/home/user/ooklaserver/sim/certs/ca.crt'
OUT.mkdir(parents=True, exist_ok=True)


def cli(name, extra, target='localhost:8080'):
    out = OUT / f'{name}.json'
    cmd = [str(ROOT / 'host-tester'), target, '--allow-private', '--no-color', '-q',
           '--json', '-o', str(out)] + extra
    p = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=240)
    if not out.exists():
        print(f'{name:30s} exit={p.returncode} NO OUTPUT {p.stderr.strip()[:160]}')
        return p.returncode
    d = json.loads(out.read_text())
    (OUT / f'{name}.txt').write_text(app.format_text(d))
    (OUT / f'{name}.html').write_text(app.render_results(d, clean=True))
    failed = [r['key'] for s in d['sections'] for r in s['rows'] if r['status'] == 'FAILED']
    print(f'{name:30s} exit={p.returncode} {d["summary"]} failed={failed}')
    return p.returncode


def api(name, params):
    url = 'http://127.0.0.1:3000/api/test?' + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=240) as r:
            d = json.load(r)
        (OUT / f'{name}.json').write_text(json.dumps(d, indent=2))
        print(f'{name:30s} http=200 {d["summary"]}')
    except Exception as exc:
        print(f'{name:30s} ERROR {exc}')


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'https'
    base = {'host': 'localhost:8080', 'allow_private': '1'}
    if mode == 'http':
        cli('http-default', [])
        cli('http-legacy8080-auto', ['--legacy-port', '8080', '--upload-mode', 'auto'])
        cli('http-legacy8080-native', ['--legacy-port', '8080', '--upload-mode', 'native'])
        cli('http-legacy8080-legacy', ['--legacy-port', '8080', '--upload-mode', 'legacy'])
        api('http-api-legacy8080', dict(base, legacy_port='8080', upload_mode='auto'))
    else:
        cli('https-default', ['--ca-bundle', CA])
        cli('https-daemon-tls', ['--ca-bundle', CA, '--daemon-tls'])
        cli('https-legacy8080', ['--ca-bundle', CA, '--legacy-port', '8080', '--upload-mode', 'auto'])
        cli('https-full-url', ['--ca-bundle', CA], target='https://localhost:8080/')
        api('https-api-advanced', dict(base, ca_bundle=CA, legacy_port='8080',
                                       upload_mode='auto', daemon_tls='1'))
    print('done:', OUT)


if __name__ == '__main__':
    main()
