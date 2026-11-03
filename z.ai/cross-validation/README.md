# Cross-Validation — official OoklaServer daemon × official Speedtest CLI

Round 2 of verification. Round 1 (see `../AUDIT.md`) validated the z.ai
engine against the **official OoklaServer 2.11.5.2 binary** (10/10 checks).
This round validates the project from the *other side of the protocol*: the
**official Speedtest CLI client** was made to run against the same lab
daemon, and both clients' traffic was recorded daemon-side and compared.

| Component | Artifact | SHA-256 (first 16) |
| --- | --- | --- |
| Official client | `ookla-speedtest-1.2.0-linux-x86_64.tgz` → `speedtest` 1.2.0.84 (ea6b6773cf) | `5690596c54ff9bed…` / `31f1124c5ab8acda…` |
| Official server | OoklaServer 2.11.5.2 build `2026-06-04.1737.7d0993d` | `f19e5ed240dc185b…` |
| z.ai engine | `speedtest-host-tester.mjs` **v1.0.1** | `e42580db13ff3678…` |

Full hashes: `official-cli/SHA256SUMS-cli`, `official-cli/SHA256SUMS-artifacts`.

## Method — the "server domain → localhost" redirect

The official CLI only tests servers from its server list, and this sandbox
cannot write `/etc/hosts` (no root). The redirect was therefore implemented
at the configuration level — functionally identical to pointing the server's
domain at localhost:

1. The CLI honors `ALL_PROXY`; a local proxy TLS-terminates
   `cli.speedtest.net` (the client trusts the lab CA via `--ca-certificate`).
2. The proxy fetches the **live** config document **with the CLI's own query
   string** — so the license key, engine parameters and all other servers
   stay genuine and validate normally — and rewrites exactly **one** entry:
   server `43356` (`1010.hkspeedtest.com:8080`, the CLI's own top pick) →
   `localhost:8080`, where the official OoklaServer daemon runs.
3. Daemon access logging (`logging.loggers.access.*`) was enabled to record
   every HTTP/WS request each client makes.

The client then executed a fully genuine test flow — config, license, server
selection, netgauge test, result generation — against the local official
daemon. Mechanics log: `official-cli/mitm-proxy.txt`.

## Result — official client completes a full test against the lab daemon

Human-readable run (`official-cli/official-cli-lab.txt`):

```
   Speedtest by Ookla
      Server: 1010 - 1010 -> LOCALHOST (lab official binary) (id: 43356)
         ISP: Alibaba
Idle Latency:     0.06 ms   (jitter: 0.01ms, low: 0.05ms, high: 0.07ms)
    Download: 67478.22 Mbps (data used: 89.1 GB)
      Upload: 45091.79 Mbps (data used: 55.7 GB)
 Packet Loss:     0.0%
```

JSON run (`official-cli/official-cli-lab.json`): ping 0.073 ms
(low 0.06 / high 0.207 / jitter 0.072), download 56 634 Mbps
(26.9 GB, elapsed **3.8 s** — the engine's stable-stop ended the phase
early), upload 41 086 Mbps, `packetLoss: 0`, server `localhost:8080`
via `::1`, result id `2bbe1c4c-…` (persisted: false).

The live engine configuration the client runs with — captured and committed
(`official-cli/engine-config-redacted.json`, license key redacted) — is the
authoritative reference for Ookla's current measurement engine:

| Parameter (live) | Value | z.ai engine (host-tester legacy methodology) |
| --- | --- | --- |
| `testDurationSeconds` | 15 | `--download/--upload` default 10 s (host-tester behavior) |
| `threadCount` | 4 | 2, or 4 when pre-test ≥ 4 Mbit/s (legacy rule) |
| `packetSizeBytes` (upload) | 32 MB | uniform chunks, size adapted by pre-test (4 MB at lab speed) |
| `latency.pingCount` | 5 | 5 netgauge pings (`--samples` for HTTP fallback) |
| download `maxConnections` | 32 (scaled) | fixed 2/4 threads (legacy HTTP) |
| `stableStop` | enabled (phase ended at 3.8 s) | fixed-duration phases (legacy HTTP) |
| loaded latency | UDP + TCP | not part of host-tester scope |
| latency statistic | IQM + low/high/jitter | min (ping), avg, jitter (host-tester semantics) |

## Finding 1 — protocol separation, confirmed from both sides

Daemon-side access logs during identical conditions:

| Client | HTTP/WS requests logged | Protocol actually used |
| --- | --- | --- |
| Official Speedtest CLI (2 runs) | **0** — `daemon-access-official-cli*.txt` are empty | pure netgauge over TCP/TLS (+ UDP for loaded latency); daemon stdout shows 6–9 concurrent TCP connections, resets on close |
| z.ai host-tester (v1.0.1, 2 runs) | **3 624** — `zai-engine/daemon-access-zai-cli.txt` | netgauge WebSocket handshake + the full host-tester HTTP surface |

The z.ai engine's 3 624 requests decode to exactly the documented surface
(URL-decoded summary):

| Count | Request | Meaning |
| ---: | --- | --- |
| 2 758 | `POST /speedtest/upload.php?ck=<rand>` | upload measurement chunks (cache-busted) |
| 800 | `GET /speedtest/random<N>x<N>.jpg?ck=<rand>` | download measurement chunks |
| 20 | `HEAD /speedtest/random350..4000.jpg` | the 10-size image check (2 runs); Content-Lengths match the fingerprint table in `../docs` §7.2 exactly |
| 20 | `GET /speedtest/latency.txt?ck=<rand>` | HTTP latency samples |
| 10 | netgauge `PING 0 100` (WS frames) | WS latency measurement |
| 2 | netgauge `HI` handshake → `HELLO 2.11 (2.11.5) …` | daemon version detection |
| 2 | `GET /ws` → `101` | WebSocket upgrade |
| 4 | `GET /` | daemon detection (check + phase pre-test) |
| 2 | `GET /speedtest/latency.txt`, `POST /speedtest/upload.php`, `GET /crossdomain.xml` | the three remaining checks |

Every request carries a browser User-Agent — the documented production
requirement (`../docs` §9.1).

**Interpretation.** The consumer client speaks netgauge only; the
host-tester exercises the daemon's HTTP legacy surface **plus** netgauge.
Both surfaces were now exercised against the same official daemon by
genuine clients: the daemon serves both correctly, and the z.ai engine's
request pattern is exactly the host-tester surface it claims to implement.

## Finding 2 — a real bug found and fixed (v1.0.1)

The cross-validation sweep exposed a genuine defect that normal happy-path
testing had missed:

- **Bug:** IPv6-literal targets (`[::1]:8080`) failed 5 of 10 checks with
  `ERR_INVALID_URL` — HTTP URLs were built as `http://::1:8080/…`; IPv6
  literals must be bracketed inside URLs. (The WS/HTTPS checks passed
  because they use request options, not URL strings.)
- **Fix:** `web/src/lib/host-tester.ts` now brackets IPv6 literals for all
  URL construction (`urlHost` helper); the web app shares the same source.
- **Verification:** `[::1]:8080` → **10/10 PASS**; regression battery green —
  `127.0.0.1:8080` 10/10, `localhost:8080` 10/10, `http://localhost:8080/`
  (full URL) 10/10, garbage input → exit 2, port out of range → exit 2,
  unreachable host → valid JSON with `verdict.ok:false`, exit 1.
- The committed evidence (`zai-engine/*`, `../results/hasil-lab-official-daemon.*`)
  was re-captured with the final v1.0.1 artifact.

## Verdict

- **Concept** — the host-tester (HTTP legacy + netgauge checks) and the
  consumer client (netgauge only) are distinct surfaces of the same daemon;
  the clone implements the correct one, now demonstrated from both sides.
- **Technical** — engine behavior matches the official daemon's actual
  responses byte-for-byte where observable (endpoints, headers, sizes, WS
  handshake), and the official client's live engine parameters are now
  documented against ours.
- **Infrastructure** — the lab daemon simultaneously satisfies a genuine
  official client (full test, 0.0% packet loss) and the z.ai host-tester
  (10/10) — the test environment is provably correct.
- **Architecture** — one shared engine serves web + CLI; a defect class
  found by cross-validation was fixed once and applied to both.

Remaining honest limits are unchanged (Ookla's hidden verdict criteria,
regional watchdogs) — see `../AUDIT.md` §3.

## Files

| Path | Evidence |
| --- | --- |
| `official-cli/official-cli-lab.txt` / `.json` | official client result vs lab daemon (human / json-pretty) |
| `official-cli/daemon-access-official-cli.txt` / `-human.txt` | **empty** — proof the official client makes 0 HTTP requests |
| `official-cli/daemon-stdout-official-cli.txt` / `-human.txt` | daemon view: netgauge TCP activity during official runs |
| `official-cli/engine-config-redacted.json` | live Ookla engine parameters (license redacted) |
| `official-cli/mitm-proxy.txt` | redirect mechanics (live config fetch + one server entry rewritten) |
| `official-cli/SHA256SUMS-cli`, `SHA256SUMS-artifacts` | pinned hashes: official client, official daemon, z.ai engine |
| `zai-engine/zai-cli-lab-run.txt` / `.json` | z.ai engine v1.0.1 vs the same daemon (10/10 PASS) |
| `zai-engine/daemon-access-zai-cli.txt` | 3 624 requests — the full host-tester surface, URL-encoded as the daemon logs it |
| `zai-engine/daemon-stdout-zai-cli.txt` | daemon view during the z.ai runs |

---

# Round 4 (2026-11-03) — non-publishing re-validation with v1.1.0

Round 4 repeats the official-client experiment with two differences:

1. **Non-publishing guarantee.** The proxy (`../lab/scripts/cv-proxy.py`, a
   hardened adaptation of the round-2/3 MITM proxy) now **refuses every
   connection to `results.speedtest.net`** — the CLI (1.2.0.84, which has no
   `--no-submit` option) completed its measurements but could not submit the
   artificial loopback results as genuine public data. Rounds 2/3 allowed that
   submission; that is now considered a methodology defect and is deliberately
   not repeated.
2. Fresh binaries (SHA-256 re-verified: identical to the round-2/3 pins) and
   the CLI's own top pick re-confirmed as server 43356 (`1010.hkspeedtest.com`).

## Result (evidence: `round-4/`)

- CLI exit **0**; `serverSelection.servers[0] = {id: 43356, host: "localhost",
  port: 8080}` — a genuine test flow against the local official daemon:
  idle latency **0.053 ms**, download ≈ **64.8 Gbit/s** (52.3 GB / 6.4 s),
  upload ≈ **47.9 Gbit/s** (70.2 GB / 12.8 s), packet loss **0**.
- Proxy log: config fetched live 3× with the CLI's own query (license genuine),
  then `[BLOCKED] CONNECT results.speedtest.net:443 -> refused`.
- Daemon access-log delta: **0 HTTP entries** — the official client speaks pure
  netgauge; the daemon console log shows the netgauge session (worker threads,
  connect/disconnect churn) exactly in the run window.

Full analysis: [`../validation/CROSS_VALIDATION.md`](../validation/CROSS_VALIDATION.md).
