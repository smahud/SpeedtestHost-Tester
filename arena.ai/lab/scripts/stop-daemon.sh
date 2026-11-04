#!/bin/sh
# Stop every laboratory OoklaServer / legacy-control process.
#
# The daemon ignores SIGTERM in some situations, so a SIGKILL fallback is
# included.  Only processes started from this laboratory directory are touched.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
LAB_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

for pidfile in "$LAB_DIR"/runtime/*/ooklaserver.pid; do
  [ -f "$pidfile" ] || continue
  pid=$(cat "$pidfile" 2>/dev/null || true)
  if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
  fi
done
sleep 1
for pidfile in "$LAB_DIR"/runtime/*/ooklaserver.pid; do
  [ -f "$pidfile" ] || continue
  pid=$(cat "$pidfile" 2>/dev/null || true)
  if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null || true
  fi
done

pkill -TERM -f "$LAB_DIR/binaries/x86_64/OoklaServer" 2>/dev/null || true
pkill -TERM -f "$LAB_DIR/scripts/legacy_control.py" 2>/dev/null || true
sleep 1
pkill -KILL -f "$LAB_DIR/binaries/x86_64/OoklaServer" 2>/dev/null || true
pkill -KILL -f "$LAB_DIR/scripts/legacy_control.py" 2>/dev/null || true

rm -f "$LAB_DIR"/runtime/*/ooklaserver.pid 2>/dev/null || true
echo "lab processes stopped"
