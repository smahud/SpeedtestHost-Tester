#!/bin/sh
set -eu
cd /home/user
export SSL_CERT_FILE=/home/user/ooklaserver/sim/certs/ca.crt
./host-tester 'https://localhost:8080/' --allow-private --json --no-color -q \
  -o ooklaserver/sim/results/https-cli.json >/dev/null
curl -sS 'http://127.0.0.1:3000/api/test?host=localhost:8080&allow_private=1' \
  -o ooklaserver/sim/results/https-api.json
./host-tester localhost:8080 --allow-private --summary --no-color -q \
  > ooklaserver/sim/results/https-hostport.txt 2>&1 || true
python3 - <<'PY'
import json, app
from pathlib import Path
d=json.load(open('ooklaserver/sim/results/https-cli.json'))
Path('ooklaserver/sim/results/https-cli.txt').write_text(app.format_text(d))
Path('ooklaserver/sim/results/https-cli.html').write_text(app.render_results(d,clean=True))
print('https summary',d['summary'])
PY
