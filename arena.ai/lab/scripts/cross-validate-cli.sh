#!/bin/sh
# Cross-validate the OFFICIAL Speedtest CLI against the OFFICIAL OoklaServer
# daemon.
#
#   sh lab/scripts/cross-validate-cli.sh [http|https] [real|isolated]
#
# Modes
# -----
# real       The CLI talks to the genuine Ookla control plane
#            (cli.speedtest.net, www.speedtest.net) because the licence key
#            that the config API issues is bound to the device and to the ISP
#            that the CLI detects.  Two names are pointed at 127.0.0.1:
#              - the Ookla server host   -> the laboratory daemon
#              - results.speedtest.net   -> a local stub that answers 503
#            so that NO laboratory measurement can be stored as a genuine
#            public speedtest result.
#
# isolated   Everything runs inside a network namespace that has nothing but
#            loopback.  The control plane is replaced by a local stub that
#            serves a captured configuration document.  The licence check of
#            the CLI fails in this mode (LICENSE_ERROR) because the licence
#            key is bound to the device/ISP context -- that limitation is
#            recorded, not hidden.
#
# In both modes /etc/hosts is restored before the script exits.
set -eu

MODE=${1:-https}
SCOPE=${2:-real}
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
LAB_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
APP_DIR=$(CDPATH= cd -- "$LAB_DIR/.." && pwd)
RESULTS="$LAB_DIR/results"
LOGS="$LAB_DIR/logs"

SERVER_HOST=myspeed.gorge.net
RESULTS_HOST=results.speedtest.net
CONTROL_HOSTS="cli.speedtest.net $RESULTS_HOST"

CA="$LAB_DIR/certs/ca.crt"
BUNDLE="$LAB_DIR/certs/ca-bundle-cli.pem"
CLI="$LAB_DIR/cli/speedtest"
STUB_CERT="$LAB_DIR/certs/control.crt"
STUB_KEY="$LAB_DIR/certs/control.key"

mkdir -p "$RESULTS" "$LOGS"

[ -x "$CLI" ] || { echo "official CLI missing at $CLI -- run lab/scripts/download-official.sh" >&2; exit 3; }
[ -f "$BUNDLE" ] || { echo "CA bundle missing at $BUNDLE -- run lab/scripts/make-certs.sh" >&2; exit 3; }

cleanup() {
  sudo -n sed -i "/# arena-lab cross-validation (temporary)/d" /etc/hosts 2>/dev/null || true
}
trap cleanup EXIT INT TERM

cleanup
if [ "$SCOPE" = "isolated" ]; then
  sudo -n sh -c 'printf "127.0.0.1\t'"$SERVER_HOST"' '"$CONTROL_HOSTS"' # arena-lab cross-validation (temporary)\n" >> /etc/hosts'
else
  # only the test server and the result-submission endpoint are redirected
  sudo -n sh -c 'printf "127.0.0.1\t'"$SERVER_HOST"' # arena-lab cross-validation (temporary)\n" >> /etc/hosts'
  sudo -n sh -c 'printf "127.0.0.1\t'"$RESULTS_HOST"' # arena-lab cross-validation (temporary)\n" >> /etc/hosts'
fi
echo "--- /etc/hosts entries for this run:"
grep 'arena-lab cross-validation' /etc/hosts || true

# The daemon binds its data plane with SO_REUSEPORT, so a daemon that is
# already running would silently share port 8080 and make every measurement
# non-deterministic.  Stop it first; this script starts its own instance.
sh "$SCRIPT_DIR/stop-daemon.sh" >/dev/null 2>&1 || true

NS_PREFIX=""
SUDO=""
if [ "$SCOPE" = "isolated" ]; then
  # Inside a user namespace we are uid 0 with a full capability set over that
  # namespace, so the stub can bind the privileged port 443 without sudo.
  # sudo itself does NOT work inside a user namespace (it cannot read
  # /etc/sudoers), which is why the isolated scope must not use it.
  NS_PREFIX="unshare -rn"
else
  # Outside a namespace port 443 is privileged, so the stub needs root.
  SUDO="sudo -n"
fi

echo
echo "--- launching the cross-validation (daemon mode: $MODE, scope: $SCOPE)"

$NS_PREFIX sh -c '
  set -eu
  ip link set lo up 2>/dev/null || true
  LAB_DIR="'"$LAB_DIR"'"
  APP_DIR="'"$APP_DIR"'"
  MODE="'"$MODE"'"
  SCOPE="'"$SCOPE"'"
  SUDO="'"$SUDO"'"
  SERVER_HOST="'"$SERVER_HOST"'"

  # 1. the laboratory OoklaServer daemon on 127.0.0.1:8080
  cd "$LAB_DIR/runtime/$MODE"
  "$LAB_DIR/binaries/x86_64/OoklaServer" -d --pidfile="$LAB_DIR/runtime/$MODE/ooklaserver.pid" \
      > "'"$LOGS"'/daemon-cli-$MODE.log" 2>&1 &
  DAEMON_PID=$!
  sleep 3

  # 2. the control-plane stub: serves /api/cli/config and refuses /reports.
  #    Port 443 is privileged, so outside a namespace the stub needs root.
  STUB_CMD="python3 $LAB_DIR/scripts/cli_stub.py --host 127.0.0.1 --port 443 \
      --cert '"$STUB_CERT"' --key '"$STUB_KEY"' \
      --config '"$RESULTS"'/cli-config-device.json \
      --server '"$SERVER_HOST"':8080 \
      --state '"$RESULTS"'/cli-stub-state.json \
      --pidfile '"$RESULTS"'/cli-stub.pid"
  if [ -n "$SUDO" ]; then
    $SUDO sh -c "$STUB_CMD" > "'"$LOGS"'/cli-stub.log" 2>&1 &
  else
    sh -c "$STUB_CMD" > "'"$LOGS"'/cli-stub.log" 2>&1 &
  fi
  STUB_PID=$!
  sleep 2

  echo "--- daemon startup log:"
  head -8 "'"$LOGS"'/daemon-cli-$MODE.log" || true
  echo "--- stub startup log:"
  head -4 "'"$LOGS"'/cli-stub.log" || true

  # 3. the official CLI
  cd "$APP_DIR"
  set +e
  "$LAB_DIR/cli/speedtest" --host="'"$SERVER_HOST"'" \
      --accept-license --accept-gdpr \
      --format=json-pretty --progress=no \
      --ca-certificate="'"$BUNDLE"'" \
      -v -v -v \
      > "'"$RESULTS"'/cli-cross-validation.json" 2> "'"$RESULTS"'/cli-cross-validation.log"
  CLI_EXIT=$?
  set -e
  echo "--- official CLI exit code: $CLI_EXIT"
  echo "$CLI_EXIT" > "'"$RESULTS"'/cli-cross-validation.exit"
  echo "$MODE-$SCOPE" > "'"$RESULTS"'/cli-cross-validation.scope"

  # 4. stop the stub and the daemon, then dump the stub state
  if [ -f "'"$RESULTS"'/cli-stub.pid" ]; then
    STUB_REAL_PID=$(cat "'"$RESULTS"'/cli-stub.pid")
    # outside a namespace the stub runs as root, so root is needed to signal it
    $SUDO kill -TERM "$STUB_REAL_PID" 2>/dev/null || true
    sleep 2
    $SUDO kill -KILL "$STUB_REAL_PID" 2>/dev/null || true
    rm -f "'"$RESULTS"'/cli-stub.pid"
  fi
  $SUDO chmod 644 "'"$RESULTS"'/cli-stub-state.json" 2>/dev/null || true
  kill -TERM $DAEMON_PID 2>/dev/null || true
  sleep 1
  kill -KILL $DAEMON_PID 2>/dev/null || true

  # 5. keep a scope-specific copy of this run next to the generic artefact
  cp -f "'"$RESULTS"'/cli-cross-validation.json" "'"$RESULTS"'/cli-cross-validation-$MODE-$SCOPE.json" 2>/dev/null || true
  cp -f "'"$RESULTS"'/cli-cross-validation.log"  "'"$RESULTS"'/cli-cross-validation-$MODE-$SCOPE.log"  2>/dev/null || true
  exit 0
'

echo
echo "--- official CLI result (JSON):"
if [ -s "$RESULTS/cli-cross-validation.json" ]; then
  head -60 "$RESULTS/cli-cross-validation.json"
else
  echo "(no JSON produced -- see the log below)"
fi
echo
echo "--- CLI verbose log (filtered):"
grep -aE "Running Speedtest|Resolved address|Opening socket|Ping |Packet loss|results\.speedtest|cli\.speedtest|LICENSE|Could not|error" "$RESULTS/cli-cross-validation.log" 2>/dev/null | head -30 || true
echo
echo "--- stub state (proof that no result was published):"
cat "$RESULTS/cli-stub-state.json" 2>/dev/null || echo "(stub state not written)"
