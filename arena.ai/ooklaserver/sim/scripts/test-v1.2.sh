#!/bin/sh
# Re-run the clone against the local official daemon with v1.2.0 options.
# Usage: test-v1.2.sh http|https
set -eu
cd /home/user
exec python3 /home/user/ooklaserver/sim/scripts/run-v1.2.py "${1:-https}"
