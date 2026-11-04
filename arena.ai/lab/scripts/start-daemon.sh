#!/bin/sh
# Start the official OoklaServer daemon in the laboratory.
#
#   start-daemon.sh http    -> plain HTTP + raw TCP + WebSocket on 127.0.0.1:8080
#   start-daemon.sh https   -> the same port, with the laboratory TLS context
#
# The daemon is started with -d (develop mode) so that it does not fork and
# does not attempt a self-update.  Its PID file is written into the runtime
# directory so stop-daemon.sh can shut it down deterministically.
#
# All paths are derived from the script location; nothing is hardcoded to a
# particular home directory.
set -eu

MODE=${1:-http}
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
LAB_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
BIN="$LAB_DIR/binaries/x86_64/OoklaServer"
RUNTIME="$LAB_DIR/runtime/$MODE"
LOGS="$LAB_DIR/logs"

case "$MODE" in
  http|https) ;;
  *) echo "usage: $0 [http|https]" >&2; exit 2 ;;
esac

if [ ! -x "$BIN" ]; then
  echo "official OoklaServer binary missing at $BIN" >&2
  echo "run: sh $SCRIPT_DIR/download-official.sh" >&2
  exit 3
fi

mkdir -p "$RUNTIME" "$LOGS"
rm -f "$RUNTIME/OoklaServer.properties"

# Guard: OoklaServer binds its data plane with SO_REUSEPORT, so a second
# instance silently shares port 8080 with the first one and the kernel then
# distributes incoming connections between two daemons.  That makes every
# measurement non-deterministic, so refuse to start.
if command -v ss >/dev/null 2>&1; then
  if ss -lntup 2>/dev/null | grep -q "127\.0\.0\.1:8080\b"; then
    echo "port 8080 is already in use -- run: sh $SCRIPT_DIR/stop-daemon.sh" >&2
    ss -lntup 2>/dev/null | grep "127\.0\.0\.1:8080\b" >&2 || true
    exit 4
  fi
fi

if [ "$MODE" = "https" ]; then
  sed "s#@CERT_DIR@#$LAB_DIR/certs#g" "$LAB_DIR/config/OoklaServer.https.properties" \
    > "$RUNTIME/OoklaServer.properties"
else
  cp "$LAB_DIR/config/OoklaServer.http.properties" "$RUNTIME/OoklaServer.properties"
fi

cd "$RUNTIME"
exec "$BIN" -d --pidfile="$RUNTIME/ooklaserver.pid" \
  > "$LOGS/daemon-$MODE.log" 2>&1
