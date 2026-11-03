# Results — fresh, honest captures

Round-4 captures (2026-11-03, v1.1.0, official OoklaServer 2.11.5.2 lab with
lab-CA certificate) come first; the round-1–3 captures follow unchanged.

## Round 4 (v1.1.0)

| File | Target | Outcome |
| --- | --- | --- |
| `hasil-lab-official-daemon-v1.1.0.txt` / `.json` | official daemon, `localhost:8080`, valid lab-CA cert | **10/10 checks PASS** — ping 0.1 ms (netgauge WS), download 10 140 Mbps (4 threads, 11.4 GB / 10 s), upload 2 178 Mbps (4 MB chunks, 4.9 GB / 10 s) — **loopback speeds only prove the engine** |
| `../lab/results/regression-unit.txt` | unit battery (43 assertions) | all green |
| `../lab/results/regression-lab.txt` | live-daemon matrix (13 assertions) | all green (incl. `[::1]` redirect-diagnosis scenario) |
| `../lab/results/probe-protocol-8080.json` | 41 protocol probes vs the official daemon | decoded in `../validation/PROTOCOL_MATRIX.md` |
| `../cross-validation/round-4/` | official Speedtest CLI 1.2.0.84 → local daemon | exit 0, server `localhost:8080`, **submission blocked** (non-publishing) |

## Rounds 1–3 (2026-11-02)

Both runs below were executed by the **same CLI artifact**
(`../cli/speedtest-host-tester.mjs`, engine identical to the web app) during
the final push session on 2026-11-02 (~19:45 UTC). Nothing was edited except
stripping terminal animation frames so the text reads like the final screen.

| File | Target | Outcome |
| --- | --- | --- |
| `hasil-lab-official-daemon.txt` / `.json` | official OoklaServer 2.11.5.2, `localhost:8080` | **10/10 checks PASS** — “Server is publicly available and properly configured.” Ping 0.2 ms (netgauge WS), download 10 099.06 Mbps (4 threads, `random4000x4000.jpg`, 11.8 GB / 10.2 s), upload 2 307.40 Mbps (4 MB chunks, 5.11 GB / 10 s) — loopback speeds only prove the engine |
| `hasil-target-host.txt` / `.json` | `host.yapsidarussalam.or.id:8080` | 1 PASS / 9 FAIL — `ECONNREFUSED 125.164.215.24:8080` (DNS fine, daemon unreachable). See `../docs` §9.8: the host is behind MikroTik DDNS with a dynamic IP; earlier the same day it was **online and passed all 10 checks** (real run quoted in `../cli/README.md`: ping 21.4 ms, download 87.42 Mbps, upload 45.18 Mbps) |

JSON shape (for automation): `target/host/port/ip/daemonVersion/checks[]/
ping/netgaugePing/httpPing/download/upload/verdict` — `verdict.ok` mirrors
the exit code (`0` pass / `1` fail).

Re-run any time:

```bash
node ../cli/speedtest-host-tester.mjs host.yapsidarussalam.or.id:8080
node ../cli/speedtest-host-tester.mjs host.yapsidarussalam.or.id:8080 --json
```
