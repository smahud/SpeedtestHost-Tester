#!/bin/sh
# Remove the lab redirect again (do not leave a real domain pinned to loopback).
set -eu
DOMAIN=${1:-myspeed.gorge.net}
sudo -n sed -i "/^127\.0\.0\.1[[:space:]]\+${DOMAIN//./\\.}[[:space:]]*$/d" /etc/hosts
echo "removed redirect for $DOMAIN"
