#!/bin/sh
set -eu
cd /home/user
./host-tester localhost:8080 --allow-private --json --no-color -q \
  -o ooklaserver/sim/results/http-cli.json >/dev/null
curl -sS 'http://127.0.0.1:3000/api/test?host=localhost:8080&allow_private=1' \
  -o ooklaserver/sim/results/http-api.json
./host-tester 'http://localhost:8080/path?x=1' --allow-private --summary --no-color -q \
  > ooklaserver/sim/results/http-fullurl.txt 2>&1 || true
python3 - <<'PY'
import json, app
from pathlib import Path
d=json.load(open('ooklaserver/sim/results/http-cli.json'))
Path('ooklaserver/sim/results/http-cli.txt').write_text(app.format_text(d))
Path('ooklaserver/sim/results/http-cli.html').write_text(app.render_results(d,clean=True))
print('http summary',d['summary'])
PY
