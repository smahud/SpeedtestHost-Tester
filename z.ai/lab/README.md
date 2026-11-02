# Lab — official OoklaServer verification environment

Everything needed to reproduce the verification runs behind
`../results/hasil-lab-official-daemon.txt`, except the binary itself.

## Contents

| File | Purpose |
| --- | --- |
| `OoklaServer.properties` | lab config actually used (ports 8080 TCP+UDP, IPv6 on, auto-update **off** so the tested version stays pinned, self-signed cert paths, Poco logging with 10 MB rotation) |
| `OoklaServer.properties.default` | untouched official reference config — the source of the config dictionary in `../docs` §4.2 |
| `probes/mock-ooklaserver.mjs` | mock daemon (HTTP + WS) used to develop the engine without the official binary |
| `probes/ws-probe.mjs`, `ws-probe2.mjs`, `ws-probe3.mjs` | raw netgauge WebSocket probes used to derive the handshake semantics (`HI/HELLO`, `PING/PONG`, `DOWNLOAD/UPLOAD`) in `../docs` §7.3 |
| `probes/ws-debug-prod.mjs` | probe used against Ookla's production server (UA-filter finding, `../docs` §9.1) |

## Reproduce (5 minutes)

See `../AUDIT.md` §4 for the exact commands: download the official tgz
(SHA256 pinned in `../docs` §2), copy this properties file next to the
binary, generate the self-signed cert (`../docs` §5), start the daemon, and
run `node ../cli/speedtest-host-tester.mjs localhost:8080` — expect the same
10/10 PASS as the saved result.

> The binary (15.5 MB) and tgz are not committed; the certificate/private key
> are never committed (gitignored by policy).
