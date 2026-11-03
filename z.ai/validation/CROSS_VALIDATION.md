# CROSS_VALIDATION — three-way: official CLI × official OoklaServer × z.ai Host Tester

## Round 4 (this audit) — NON-PUBLISHING method

Prior rounds (2/3) validated the official CLI against the lab daemon but let the
CLI **submit loopback results to results.speedtest.net** against a real
production server id (43356) — artificial public data. Round 4 repeats the
experiment with a **non-publishing guarantee**.

### Method (FACT)

1. Local TLS-terminating proxy (`lab/scripts/cv-proxy.py`, adapted from the
   round-2/3 design in this workspace):
   - MITMs exactly `cli.speedtest.net:443` (CLI trusts the lab CA via
     `--ca-certificate=certs/ca-bundle.pem`), fetches the **live** config with
     the CLI's **own query string** (license, engine params, all other servers
     genuine), and rewrites **one** entry: server **43356**
     (`1010.hkspeedtest.com:8080`, the CLI's own top pick, re-verified via
     `speedtest -L` this round) → `localhost:8080`.
   - **REFUSES every connection to `results.speedtest.net`** → no artificial
     result can be submitted (the CLI has no `--no-submit` flag; verified).
   - Everything else tunneled + logged.
2. Official CLI 1.2.0.84 run:
   `ALL_PROXY=http://127.0.0.1:8888 ./speedtest --accept-license --ca-certificate=… -f json --selection-details -P 0`
3. Daemon access log snapshotted before/after; daemon console log captured.

### Results (FACT — evidence in `cross-validation/round-4/`)

| Item | Value |
| --- | --- |
| CLI exit code | **0** |
| Selected server | id 43356, `host: "localhost"`, `port: 8080`, name "1010 → LOCALHOST (lab official binary, round 4)" |
| Idle latency | **0.053 ms** (jitter 0.004, low 0.051, high 0.066) |
| Download | bandwidth 8,103,833,058 B/s ≈ **64.8 Gbit/s**, 52.3 GB in 6.4 s (loaded latency IQM 0.161 ms) |
| Upload | bandwidth 5,993,144,189 B/s ≈ **47.9 Gbit/s**, 70.2 GB in 12.8 s |
| Packet loss | **0** (UDP netgauge path) |
| Proxy log | config fetched 3× with CLI's own query (2,674 B live → 2,891 B served); `[BLOCKED] CONNECT results.speedtest.net:443 -> refused (non-publishing guarantee)` |
| Daemon access-log delta | **0 entries** — the official client made **zero HTTP requests**; pure netgauge TCP/TLS (+ UDP) |
| Daemon console log | netgauge session churn (threads 45–52, connect/disconnect) exactly in the run window 14:04:34–14:04:53 |

### Conclusions

1. **Official CLI ↔ official OoklaServer interop re-verified end-to-end** without
   polluting Ookla's public dataset. Infrastructure validated from the client side.
2. **Protocol separation re-confirmed**: genuine speedtest clients use netgauge
   (0 HTTP requests); the Host-Tester surface is the legacy HTTP + WS layer.
   Both surfaces served by the same official binary, each exercised by its
   genuine client (CLI = netgauge; z.ai tester = HTTP/WS, see below).
3. The `packetLoss: 0` result implies functioning **UDP** netgauge on 8080 even
   though naive UDP text probes get no response (OBSERVATION).

## z.ai Host Tester ↔ official daemon (this round)

- v1.1.0 CLI: `localhost:8080` → **10/10 PASS**, exit 0
  (`results/hasil-lab-official-daemon-v1.1.0.txt/.json`; ping 0.1 ms,
  download 10,140 Mbps, upload 2,178 Mbps, 16.3 GB in 21.4 s — loopback,
  not internet capacity).
- v1.1.0 CLI: `127.0.0.1:8080` → 10/10; `[::1]:8080` → accurate 6-pass/4-fail
  redirect diagnosis (TEST_MATRIX).
- The daemon access log during z.ai runs shows the full documented surface:
  `GET /`, `GET /hi`, `GET /speedtest/latency.txt`, `HEAD random*.jpg` ×10,
  `POST /speedtest/upload.php`, `GET /crossdomain.xml`, `GET /ws` upgrades
  (101) — matching rounds 1–3 traffic decode.

## Three-way comparison

| Dimension | Official CLI | z.ai Host Tester | Classification |
| --- | --- | --- | --- |
| Transport | netgauge TCP/TLS + UDP | HTTP/HTTPS/WS + raw netgauge WS | different by design |
| Server identification | server list + latency probe | `HI→HELLO` + `GET /hi` fallback | functionally compatible (same version string surfaced) |
| Latency | idle + loaded latency, IQM | min-of-samples HTTP legacy + WS PING | different by design (legacy methodology) |
| Throughput | netgauge 32 MB packets, 15 s, 4 threads | HTTP legacy images/upload, 10 s, 2–4 threads | different by design |
| Failure reporting | CLI exit codes | check-level pass/warn/fail + exit 0/1/2/130 | functionally compatible |
| Cert validation | strict (CA + hostname), `--ca-certificate` | functional check + trust/hostname/expiry reporting (WARN) | partially compatible (documented approximation) |
| Result submission | results.speedtest.net (blocked in lab) | none — diagnostic only | different by design |

Do **not** force identical outcomes: the CLI measures internet capacity via
netgauge; the Host Tester diagnoses server configuration via the documented
host-tester surface. Loopback numbers from either are lab evidence only.
