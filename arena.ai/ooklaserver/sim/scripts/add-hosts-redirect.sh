#!/bin/sh
# "Jadikan domain tersebut sebagai localhost": map one real Ookla server host
# to 127.0.0.1 so the official Speedtest CLI connects to our local daemon.
# NOTE: /etc/hosts is outside the workspace snapshot; re-run after a restart.
set -eu
DOMAIN=${1:-myspeed.gorge.net}
if ! grep -qE "^[[:space:]]*127\.0\.0\.1[[:space:]]+${DOMAIN//./\\.}[[:space:]]*$" /etc/hosts; then
  printf '127.0.0.1\t%s\n' "$DOMAIN" | sudo -n tee -a /etc/hosts >/dev/null
fi
getent hosts "$DOMAIN"
