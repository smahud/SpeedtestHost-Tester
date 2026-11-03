# REPRODUCE — full lab reproduction guide

Everything below runs inside `z.ai/` (workspace isolation). Estimated time:
15–20 min including downloads.

## 0. Prerequisites

- Linux x86_64, non-root is fine; Node ≥ 18 (tests: ≥ 22.6 or bun for engine
  import); bun (CLI rebuild only); openssl 3.x; python3 (cross-validation proxy).
- Outbound access to `install.speedtest.net` and `cli.speedtest.net`.

## 1. Stage official binaries

```bash
cd z.ai/lab
mkdir -p binaries run logs results certs scripts
curl -o binaries/OoklaServer-linux-x86_64-static-musl.tgz \
     https://install.speedtest.net/ooklaserver/stable/OoklaServer-linux-x86_64-static-musl.tgz
curl -o binaries/ookla-speedtest-1.2.0-linux-x86_64.tgz \
     https://install.speedtest.net/app/cli/ookla-speedtest-1.2.0-linux-x86_64.tgz
sha256sum binaries/*.tgz
# expected:
#   ce180aa3ed9b3c099713cf37ea2ded48c1f799f47c534ab732e21cea61598159  OoklaServer-…tgz
#   5690596c54ff9bed63fa3732f818a05dbc2db19ad36ed68f21ca5f64d5cfeeb7  ookla-speedtest-…tgz

cd run && tar xzf ../binaries/OoklaServer-linux-x86_64-static-musl.tgz \
    && tar xzf ../binaries/ookla-speedtest-1.2.0-linux-x86_64.tgz && cd ..
```

## 2. Lab PKI + daemon config + start

```bash
bash scripts/gen-certs.sh          # CA + valid/expired/mismatch certs -> certs/, run/cert.pem+key.pem
cp OoklaServer.properties run/    # committed lab config (8080, IPv6, access log ON) -> daemon working dir (push-day fix 2026-11-04: this step is REQUIRED — the tgz ships only .properties.default)
cd run && nohup ./OoklaServer > ../logs/daemon-stdout.log 2>&1 & echo $! > ooklaserver.pid
sleep 3
curl -s http://localhost:8080/hi    # -> hello 2.11 (2.11.5) 2026-06-04.1737.7d0993d
```

Stop the daemon: `pkill -f "lab/run/OoklaServer"`.

## 3. Protocol probes (evidence for PROTOCOL_MATRIX)

```bash
node scripts/probe-protocol.mjs localhost 8080 > results/probe-protocol-8080.json 2> results/probe-protocol-8080.log
```

## 4. Regression battery

```bash
cd ..   # z.ai/
node tests/regression.mjs unit   # 43 assertions (no official binary needed)
node tests/regression.mjs lab    # 13 assertions (needs the live daemon, valid cert)
```

## 5. TLS scenarios (swap the active cert, restart daemon between runs)

```bash
cd lab
pkill -f "lab/run/OoklaServer"; sleep 1
cp certs/server-expired.crt run/cert.pem   # EXPIRED scenario
(cd run && nohup ./OoklaServer > ../logs/daemon-expired-stdout.log 2>&1 &); sleep 5
cd .. && node cli/speedtest-host-tester.mjs localhost:8080 --json | jq '.checks[] | select(.id=="https")'
# expected: status "warn", detail contains "EXPIRED"

# MISMATCH scenario: repeat with certs/server-mismatch.crt
# then restore: cp certs/server.crt run/cert.pem
```

## 6. Official CLI cross-validation (NON-PUBLISHING)

```bash
cd lab
python3 scripts/cv-proxy.py 8888 &          # logs to logs/cv-proxy.log
cd run
ALL_PROXY=http://127.0.0.1:8888 ./speedtest --accept-license \
  --ca-certificate=../certs/ca-bundle.pem -f json --selection-details -P 0 \
  > ../results/cv-round4-cli.json 2> ../results/cv-round4-cli.stderr
# expected: exit 0; JSON serverSelection.servers[0].server.host == "localhost", port 8080
# proxy log ends with: [BLOCKED] CONNECT results.speedtest.net:443 -> refused
# daemon access log gains ZERO entries (pure netgauge)
kill %1
```

## 7. Web app (optional)

```bash
cd web && bun install && bun run dev    # http://localhost:3000
# form input: localhost:8080
```

## 8. Rebuild the CLI after engine changes

```bash
cd web && bun build src/cli/main.ts --target=node --format=esm --outfile=../cli/speedtest-host-tester.mjs
```

## Notes

- Daemon processes do not survive sandbox restarts; configs/certs/binaries do.
- If port 8080 is occupied, all lab scripts accept a port argument — but the
  official-daemon evidence in this repo is 8080-only (lab constraint).
- Never commit `lab/binaries/`, `lab/run/`, `lab/certs/`, `lab/logs/` (see
  `z.ai/.gitignore`).
