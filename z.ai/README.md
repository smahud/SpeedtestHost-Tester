# z.ai — Speedtest Host Tester (web clone + zero-dependency CLI)

Submission by the **z.ai agent** for the multi-agent comparison repo.

A 1:1 functional clone of the Ookla® Server Tester
(<https://www.speedtest.net/host-tester>) — **no captcha, no banner, a single
domain input** — plus a **CLI** that runs the exact same test from the
terminal, so you never have to open the page.

The web app and the CLI share **one engine**
(`web/src/lib/host-tester.ts`), so a test from the page and a test from the
terminal execute identical checks with identical measurement methodology.

> Detailed project docs (CLI guide, 340-line technical notes) are written in
> Indonesian as they were authored during the work; this README and
> `AUDIT.md` are in English to match the repo's comparison index.

---

## Quick start

### CLI — Node.js ≥ 18, zero dependencies

```bash
node cli/speedtest-host-tester.mjs host.yapsidarussalam.or.id:8080
node cli/speedtest-host-tester.mjs host.yapsidarussalam.or.id     # port defaults to 8080
node cli/speedtest-host-tester.mjs host.yapsidarussalam.or.id:8080 --json   # machine-readable
node cli/speedtest-host-tester.mjs host.yapsidarussalam.or.id:8080 --download 5 --upload 5
```

Exit codes: `0` all checks passed · `1` failed checks · `2` bad input.
Full flag reference: [`cli/README.md`](cli/README.md).

### Web — Next.js 16

```bash
cd web
bun install        # or npm install / pnpm install
bun run dev        # open http://localhost:3000
```

Type the host (domain only, `host:port`, `[IPv6]:port`, or a full URL) into
the single input box. Results stream in live (NDJSON) and render the same
10 checks plus PING / DOWNLOAD / UPLOAD measurements.

---

## What the tester does (identical for web & CLI)

**10 checks, in Ookla Server Tester order:**

1. Hostname resolution (DNS)
2. OoklaServer daemon connection (`GET /`)
3. OoklaServer daemon version (netgauge `HI` → `HELLO <version>`)
4. Netgauge / WebSocket on the daemon port (`ws(s)://host:port/ws`, `PING` → `PONG`)
5. HTTPS functionality (TLS handshake + response on the same port)
6. Keep-Alive (`Connection` response header)
7. Latency file (`GET /speedtest/latency.txt` → `test=test`)
8. Download images (`GET /speedtest/random{350..4000}x{…}.jpg`, all 10 sizes)
9. Legacy HTTP upload script (`POST /speedtest/upload.php` → `size=N`)
10. Crossdomain settings (`GET /crossdomain.xml`)

**Measurements — Ookla's HTTP legacy methodology:**

- **Ping** — repeated samples, the *lowest* value is the result (netgauge
  WebSocket `PING`/`PONG`, HTTP fallback); jitter from sample variance.
- **Download** — pre-test estimates the speed → adaptive file size →
  2 threads (4 threads when the estimate is ≥ 4 Mbit/s) → cache-busting
  random query strings → per-sample aggregation: sort, drop the 2 fastest,
  drop the lowest quarter, average the rest.
- **Upload** — small pre-test upload → uniform chunk size → up to 4 parallel
  threads → chunks sorted by speed → the fastest half is averaged.

Every claim above is implemented in one place:
[`web/src/lib/host-tester.ts`](web/src/lib/host-tester.ts) (1,134 lines,
heavily commented).

---

## Directory map

| Path | What it is |
| --- | --- |
| `README.md` | this file |
| `AUDIT.md` | fidelity audit: exact / approximated / unverifiable, evidence, arena.ai comparison |
| `cli/speedtest-host-tester.mjs` | **the CLI artifact** — single file, zero dependencies, Node ≥ 18 (bundled from `web/src/cli/main.ts` + engine) |
| `cli/README.md` | CLI usage guide (flags, exit codes, example output) |
| `web/` | runnable Next.js 16 source of the web clone (page, streaming API route, engine, CLI source) |
| `docs/OoklaServer-Technical-Notes.md` | 340-line technical notes: official OoklaServer 2.11.5.2 lab, config dictionary, verified endpoints/protocol, deterministic file sizes, behavioral findings |
| `lab/` | lab config (`OoklaServer.properties` + official default) and protocol probe scripts |
| `audit/ui-local-daemon.png` | web UI screenshot during the verified lab session (2026-11-02) |
| `results/` | fresh, honest captures: target-host run + 10/10 PASS run against the official daemon |

Not included (by design): the 15.5 MB OoklaServer binary / 4.9 MB tgz
(SHA256 pinned in `docs` §2 — re-download from the official URL), TLS key
material, logs, `node_modules`.

---

## Verification summary

- **Engine validated against the official OoklaServer 2.11.5.2 binary**
  (build `2026-06-04.1737.7d0993d`, SHA256 pinned) running in a local lab:
  **10/10 checks PASS** with real loopback measurements —
  `results/hasil-lab-official-daemon.txt`.
- **Cross-checked against Ookla's own production server**
  (`1010.hkspeedtest.com.prod.hosts.ooklaserver.net:8080`, Hong Kong):
  10/10 PASS, identical daemon version via the `HELLO` handshake
  (docs §8.3).
- The target `host.yapsidarussalam.or.id:8080` passed **all 10 checks while it
  was online** during the 2026-11-02 session (example output in
  `cli/README.md`: ping 21.4 ms, download 87.42 Mbps, upload 45.18 Mbps).
  At push time the host refuses connections again — consistent with the
  dynamic-IP/CGNAT analysis in `docs` §9.8 (MikroTik DDNS), **not** a daemon
  misconfiguration; the honest fresh capture is kept in
  `results/hasil-target-host.txt` (1 PASS / 9 FAIL, ECONNREFUSED).

## Honest limitations

- This is a **functional clone of the public page and the documented
  protocol**, not a provable byte-identical copy of Ookla's hidden backend:
  the real verdict is produced by Ookla's regional watchdogs, not by the
  browser page.
- The UI is a re-implementation (React/Tailwind, Ookla dark style, single
  domain input). Captcha and banners are intentionally absent per the
  requirements — so it is not a pixel-diff of the original page.
- Measured speeds reflect the path **from the machine running the test to the
  server** — exactly how the Ookla tester behaves.
- Full fidelity matrix with evidence: [`AUDIT.md`](AUDIT.md).
