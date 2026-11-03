# Lab — official OoklaServer verification environment (Round 4 layout)

Everything needed to reproduce the verification runs, except the official
binaries themselves (re-download; SHA-256 pinned in
`../validation/ENVIRONMENT.md`). Full step-by-step: `../validation/REPRODUCE.md`.

## Contents

| Path | Purpose |
| --- | --- |
| `binaries/` | official tarballs (gitignored — never committed) |
| `run/` | daemon working dir: extracted binaries, active `cert.pem`/`key.pem`, `OoklaServer.properties` (ports 8080 TCP+UDP, IPv6 on, auto-update **off**, **access log on**), daemon logs (gitignored) |
| `certs/` | lab PKI from `scripts/gen-certs.sh`: dedicated CA + VALID / EXPIRED / HOSTNAME-MISMATCH server certs + `ca-bundle.pem` trust bundle (gitignored) |
| `scripts/gen-certs.sh` | generate the lab PKI (RSA-2048 CA; expired cert backdated via OpenSSL 3 `-not_before/-not_after`) |
| `scripts/probe-protocol.mjs` | 41-probe protocol battery: HTTP surface, HEAD/Range, upload semantics, CORS, keep-alive, raw TCP netgauge, WS path sensitivity + accept-key, TLS versions, strict CA/hostname verification, UDP probes → `results/probe-protocol-8080.json` |
| `scripts/cv-proxy.py` | Round-4 **non-publishing** cross-validation proxy (rewrites server 43356 → `localhost:8080` in the live CLI config; **blocks `results.speedtest.net`**) |
| `results/` | committed machine-readable evidence (probe JSON, CORS/upload evidence, regression logs, round-4 CLI run) |
| `OoklaServer.properties` | (legacy, rounds 1–3) config used for the original 10/10 run — superseded by `run/OoklaServer.properties` (adds access log) |
| `OoklaServer.properties.default` | untouched official reference config — source of the config dictionary in `../docs` §4.2 |
| `probes/mock-ooklaserver.mjs` | faithful mock daemon (HTTP + WS netgauge + `/hi` + `REDIRECT_MODE=1` canonical-307 mode, dual-stack) — powers the redirect regressions |
| `probes/ws-probe*.mjs`, `ws-debug-prod.mjs` | raw probes from rounds 1–3 (handshake semantics, UA-filter finding) |

## Quick reproduce

```bash
bash scripts/gen-certs.sh
(cd run && nohup ./OoklaServer > ../logs/daemon-stdout.log 2>&1 &)
sleep 3 && curl -s http://localhost:8080/hi
cd .. && node tests/regression.mjs lab
```

> Binaries (15.5 MB daemon / 2.6 MB CLI), the tgz archives, private keys and
> logs are never committed (see `../.gitignore` + root policy).
