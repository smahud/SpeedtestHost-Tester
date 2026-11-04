#!/usr/bin/env python3
"""Regenerate the saved result artefacts (hasil-*) against the laboratory daemon.

The artefacts are the submission's own evidence: they must be reproducible
from the current code, so they are always produced from the genuine official
OoklaServer daemon that runs in the laboratory on 127.0.0.1:8080.

    python3 lab/scripts/regenerate-hasil.py [--host 127.0.0.1:8080] [--out .]

Artefacts written:
    hasil-cli.json           CLI run, machine readable
    hasil-cli.txt            CLI run, human readable
    hasil-cli-summary.txt    CLI run, summary only
    hasil-test.json          the /api/test payload
    hasil-test.txt           the same result, human readable
    hasil-test.html          the result page
    hasil-test-clean.html    the result page without navigation / footer
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LAB = os.path.dirname(HERE)
ROOT = os.path.dirname(LAB)
sys.path.insert(0, ROOT)

from app import format_text, render_results, run_all_tests  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1:8080")
    ap.add_argument("--out", default=ROOT)
    ap.add_argument("--ca-bundle", default=os.path.join(LAB, "certs", "ca.crt"))
    ap.add_argument("--legacy-port", type=int, default=8080)
    args = ap.parse_args()

    os.chdir(ROOT)
    ca = args.ca_bundle if os.path.exists(args.ca_bundle) else None

    # ---- the CLI artefacts --------------------------------------------
    cmd = [
        sys.executable, os.path.join(ROOT, "cli.py"), args.host,
        "--allow-private", "--legacy-port", str(args.legacy_port),
        "--upload-mode", "auto", "--no-color",
    ]
    if ca:
        cmd += ["--ca-bundle", ca]

    rc = 0
    for suffix, extra in (
        ("hasil-cli.json", ["--json"]),
        ("hasil-cli.txt", []),
        ("hasil-cli-summary.txt", ["--summary"]),
    ):
        res = subprocess.run(cmd + extra, capture_output=True, text=True)
        with open(os.path.join(args.out, suffix), "w", encoding="utf-8") as fh:
            fh.write(res.stdout)
        print(f"{suffix}: exit {res.returncode}, {len(res.stdout)} bytes")
        rc = rc or res.returncode

    # ---- the web artefacts --------------------------------------------
    data = run_all_tests(
        args.host,
        allow_private=True,
        ca_bundle=ca,
        legacy_port=args.legacy_port,
        upload_mode="auto",
        timeout=180.0,
        default_port=8080,
    )
    data["input"] = args.host
    summary = data["summary"]
    print(f"engine: {summary['passed']} PASSED / {summary['failed']} FAILED of {summary['total']}")

    with open(os.path.join(args.out, "hasil-test.json"), "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    with open(os.path.join(args.out, "hasil-test.txt"), "w", encoding="utf-8") as fh:
        fh.write(format_text(data))
    with open(os.path.join(args.out, "hasil-test.html"), "w", encoding="utf-8") as fh:
        fh.write(render_results(data))
    with open(os.path.join(args.out, "hasil-test-clean.html"), "w", encoding="utf-8") as fh:
        fh.write(render_results(data, clean=True))

    for name in ("hasil-test.json", "hasil-test.txt", "hasil-test.html",
                 "hasil-test-clean.html"):
        size = os.path.getsize(os.path.join(args.out, name))
        print(f"{name}: {size} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
