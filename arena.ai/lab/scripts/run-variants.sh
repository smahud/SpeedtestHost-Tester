#!/bin/sh
# Variant matrix for the host tester against the laboratory daemon.
#
#   run-variants.sh [lab-dir]
#
# Every case is executed by the clone CLI against 127.0.0.1:8080 (official
# OoklaServer).  The JSON result of each run is stored under lab/results/.
# The script itself performs NO assertions: the assertions live in
# arena.ai/tests/ so that they are reproducible on their own.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
LAB_DIR=${1:-$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)}
APP_DIR=$(CDPATH= cd -- "$LAB_DIR/.." && pwd)
OUT="$LAB_DIR/results/variants"
CA="$LAB_DIR/certs/ca.crt"
mkdir -p "$OUT"

run () {
  name=$1; shift
  echo "--- $name"
  set +e
  (cd "$APP_DIR" && python3 cli.py "$@" --json -q) > "$OUT/$name.json" 2> "$OUT/$name.err"
  code=$?
  set -e
  echo "    exit=$code"
  python3 - "$OUT/$name.json" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception as exc:
    print("    (no json:", exc, ")")
    raise SystemExit(0)
s = d["summary"]
print(f"    {s['passed']} PASSED / {s['failed']} FAILED / {s['total']} checks")
for sec in d.get("sections", []):
    for r in sec["rows"]:
        print(f"      {sec['title'].split()[0]:8} {r['key']:12} {r['status']}")
PY
}

run tls-legacy8080        localhost:8080 --allow-private --ca-bundle "$CA" --legacy-port 8080 --upload-mode auto
run tls-daemon-tls        localhost:8080 --allow-private --ca-bundle "$CA" --legacy-port 8080 --upload-mode auto --daemon-tls
run tls-legacy80          localhost:8080 --allow-private --ca-bundle "$CA"
run no-ca-bundle          localhost:8080 --allow-private --legacy-port 8080
run wrong-ca-bundle       localhost:8080 --allow-private --ca-bundle "$LAB_DIR/certs/untrusted.crt" --legacy-port 8080
run upload-mode-legacy    localhost:8080 --allow-private --ca-bundle "$CA" --legacy-port 8080 --upload-mode legacy
run upload-mode-native    localhost:8080 --allow-private --ca-bundle "$CA" --legacy-port 8080 --upload-mode native
run ipv6-literal          '[::1]:8080' --allow-private --ca-bundle "$CA" --legacy-port 8080

echo "--- variants written to $OUT"
