#!/bin/sh
# Full cross-analysis: official Speedtest CLI -> /etc/hosts trick -> local OoklaServer.
set -eu
DOMAIN=${1:-myspeed.gorge.net}
OUT=${2:-/home/user/ooklaserver/sim/results/cli-cross-check.json}
CLI=/home/user/speedtest-cli/x86_64/speedtest
CA=/home/user/ooklaserver/sim/certs/ca-bundle-cli.pem

sh "$(dirname "$0")/add-hosts-redirect.sh" "$DOMAIN"
"$CLI" -L --format=json --accept-license --accept-gdpr --progress=no \
  > /home/user/ooklaserver/sim/results/cli-server-list.json
"$CLI" --host="$DOMAIN" --accept-license --accept-gdpr \
  --format=json-pretty --progress=no --ca-certificate="$CA" \
  > "$OUT" 2> "${OUT%.json}.err"
echo "written: $OUT"
python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print('server',d['server'],'ping',d['ping']['latency'],'persisted',d['result']['persisted'])" "$OUT"
