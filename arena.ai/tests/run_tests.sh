#!/bin/sh
# Run the whole regression suite.
#
#   sh tests/run_tests.sh            unit + protocol + security suites
#   sh tests/run_tests.sh --all      also run the integration suite against
#                                    the official OoklaServer daemon
#
# The integration suite is skipped automatically when no daemon is reachable.
# Exit code 0 means every test passed.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
cd "$APP_DIR"

PY=${PYTHON:-python3}
STATUS=0

echo "== unit: normalisation / address policy =="
"$PY" -m unittest discover -s tests -p 'test_normalize.py' -v || STATUS=1

echo
echo "== protocol: every check against a controllable daemon =="
"$PY" -m unittest discover -s tests -p 'test_protocol.py' -v || STATUS=1

echo
echo "== security: SSRF, path traversal, TLS policy, resource limits =="
"$PY" -m unittest discover -s tests -p 'test_security.py' -v || STATUS=1

echo
echo "== integration: official OoklaServer daemon (skipped when absent) =="
"$PY" -m unittest discover -s tests -p 'test_integration_official.py' -v || STATUS=1

if [ "$STATUS" -eq 0 ]; then
  echo
  echo "ALL REGRESSION TESTS PASSED"
else
  echo
  echo "REGRESSION TESTS FAILED"
fi
exit "$STATUS"
