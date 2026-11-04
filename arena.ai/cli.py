#!/usr/bin/env python3
"""
CLI for the local Ookla Server Tester clone.

Examples:
  python3 cli.py host.yapsidarussalam.or.id:8080
  ./host-tester https://host.yapsidarussalam.or.id:8080
  ./host-tester host.yapsidarussalam.or.id --json --output hasil.json
  ./host-tester localhost:8080 --allow-private --summary
  ./host-tester localhost:8080 --allow-private --ca-bundle sim/certs/ca.crt
  ./host-tester localhost:8080 --allow-private --legacy-port 8080 --upload-mode auto
  ./host-tester localhost:8080 --allow-private --daemon-tls --ca-bundle sim/certs/ca.crt

Exit codes: 0 = all passed, 1 = at least one failed, 2 = invalid input/error.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from app import detect_scheme, format_text, normalize_target, run_all_tests

VERSION = "1.3.0"


class Colors:
    RESET = "\033[0m"
    GREEN = "\033[92m"
    RED = "\033[91m"
    CYAN = "\033[96m"
    DIM = "\033[2m"


def use_colors(stream, no_color=False):
    return not no_color and hasattr(stream, "isatty") and stream.isatty()


def paint(text, enabled):
    if not enabled:
        return text
    out = text
    out = out.replace("PASSED", Colors.GREEN + "PASSED" + Colors.RESET)
    out = out.replace("FAILED", Colors.RED + "FAILED" + Colors.RESET)
    return out


def build_parser():
    p = argparse.ArgumentParser(
        prog="host-tester",
        description="Run the Ookla Server Tester checks from the command line.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
Input formats:
  host.example.com:8080
  https://host.example.com:8080/
  host.example.com            (port defaults to 8080)

Advanced options (verified against official OoklaServer + official Speedtest CLI):
  --ca-bundle FILE       PEM CA bundle for strict TLS verification.
                         Replaces the default trust store, exactly like the
                         official Speedtest CLI --ca-certificate. Verification
                         is never disabled.
  --legacy-port N        port for the legacy HTTP fallback (default: 80).
                         The official daemon also serves /speedtest/* on 8080.
  --upload-mode MODE     legacy | native | auto (default: auto).
                         legacy = PHP 500+len(key)+len(value)+3
                         native = daemon raw Content-Length
  --daemon-tls           force TLS for NetGauge/WebSocket/crossdomain checks.
  --no-daemon-tls        force plain TCP for those checks.
                         (default: auto -- an https:// target is probed over TLS)
  --timeout SECONDS      global budget for the whole run (default: 180).

Exit codes:
  0  all checks passed
  1  one or more checks failed
  2  invalid input or test error
""",
    )
    p.add_argument("target", help="host:port or full URL of the OoklaServer daemon")
    p.add_argument("-p", "--port", type=int, default=8080,
                   help="default port when the target has no explicit port (default: 8080)")
    p.add_argument("--json", action="store_true", help="print machine-readable JSON instead of text")
    p.add_argument("--summary", action="store_true", help="print only the summary lines")
    p.add_argument("-o", "--output", metavar="FILE", help="also write the result to FILE")
    p.add_argument("--allow-private", action="store_true",
                   help="allow private/local IPs (for lab or not-yet-public servers)")
    p.add_argument("--ca-bundle", metavar="FILE",
                   help="PEM CA bundle for strict TLS verification (never disables verification)")
    p.add_argument("--legacy-port", type=int, default=80, metavar="N",
                   help="port for the HTTP legacy fallback (default: 80)")
    p.add_argument("--upload-mode", choices=("auto", "legacy", "native"), default="auto",
                   help="upload size algorithm: auto, legacy PHP, or native daemon (default: auto)")
    p.add_argument("--daemon-tls", dest="daemon_tls", action="store_true", default=None,
                   help="force TLS for NetGauge/WebSocket/crossdomain daemon checks")
    p.add_argument("--no-daemon-tls", dest="daemon_tls", action="store_false",
                   help="force plain TCP for NetGauge/WebSocket/crossdomain daemon checks")
    p.add_argument("--timeout", type=float, default=180.0, metavar="SECONDS",
                   help="global budget for the whole run (default: 180)")
    p.add_argument("--no-color", action="store_true", help="disable ANSI colors")
    p.add_argument("-q", "--quiet", action="store_true", help="do not print progress to stderr")
    p.add_argument("--version", action="version", version=f"host-tester {VERSION}")
    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    if not (1 <= args.port <= 65535):
        print("error: --port must be between 1 and 65535", file=sys.stderr)
        return 2
    if not (1 <= args.legacy_port <= 65535):
        print("error: --legacy-port must be between 1 and 65535", file=sys.stderr)
        return 2
    if args.timeout <= 0:
        print("error: --timeout must be greater than zero", file=sys.stderr)
        return 2

    try:
        target, warning = normalize_target(args.target, args.port)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        print("hint: use host:8080 or https://host:8080", file=sys.stderr)
        return 2

    if warning and not args.quiet:
        print(f"note: {warning}", file=sys.stderr)
    if not args.quiet:
        print(f"Testing {target} …", file=sys.stderr, flush=True)

    try:
        # The ORIGINAL input is passed on purpose: its scheme decides whether
        # the daemon checks run over TLS or plain TCP.
        data = run_all_tests(
            args.target,
            allow_private=args.allow_private,
            ca_bundle=args.ca_bundle,
            legacy_port=args.legacy_port,
            upload_mode=args.upload_mode,
            daemon_tls=args.daemon_tls,
            timeout=args.timeout,
            default_port=args.port,
        )
        data["input"] = args.target
        # run_all_tests receives the normalized target (so -p/--port is kept);
        # record the scheme from the original user input explicitly.
        data["input_scheme"] = detect_scheme(args.target)
        if warning:
            data["normalization_note"] = warning
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\ninterrupted", file=sys.stderr)
        return 130
    except Exception as exc:
        print(f"error: test failed: {exc}", file=sys.stderr)
        return 2

    if args.json:
        payload = data
        if args.summary:
            payload = {
                "host": data["host"],
                "port": data["port"],
                "input": data["input"],
                "timestamp": data["timestamp"],
                "summary": data["summary"],
                "options": data.get("options", {}),
            }
        output = json.dumps(payload, indent=2, ensure_ascii=False)
    else:
        output = format_text(data, summary_only=args.summary)

    if args.output:
        path = Path(args.output).expanduser()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(output + ("\n" if not output.endswith("\n") else ""), encoding="utf-8")
        if not args.quiet:
            print(f"written: {path}", file=sys.stderr)

    if not args.quiet or not args.output:
        print(paint(output, use_colors(sys.stdout, args.no_color)))

    return 0 if data["summary"]["failed"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
