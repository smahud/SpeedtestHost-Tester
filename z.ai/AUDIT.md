# AUDIT — z.ai submission

What is **exactly verified**, what is **approximated**, and what is
**unverifiable**. Method: every protocol claim below was tested against the
**official OoklaServer 2.11.5.2 binary** (stable channel, SHA256 pinned in
`docs/OoklaServer-Technical-Notes.md` §2) running in a local lab, and
cross-checked against Ookla's production Hong Kong server.

---

## 1. EXACT — verified against the official daemon

| Area | Verified behavior | Evidence |
| --- | --- | --- |
| netgauge handshake | text frame `HI\n` → `HELLO 2.11 (2.11.5) 2026-06-04.1737.7d0993d`; unknown command → `ERROR` | engine `runNetgaugeHandshake`, docs §7.3 |
| Daemon version check | parsed from the `HELLO` line — the same string Ookla's tester surfaces | lab run: `PASS 2.11 (2.11.5) 2026-06-04.1737.7d0993d` |
| netgauge latency | `PING 0 100\n` → `PONG <epoch-ms>`; RTT measured over 5+ samples | docs §7.3, `results/hasil-lab-official-daemon.txt` |
| Protocol multiplex | HTTP + HTTPS + WS + WSS all served on the **same port** (8080), detected per connection — no separate HTTP/HTTPS ports in OoklaServer 2.11 | docs §9.3 |
| Latency file | `GET /speedtest/latency.txt` → `200` body `test=test` | docs §7.1 |
| Download images | `GET /speedtest/random{n}x{n}.jpg`, n = 350, 500, 750, 1000, 1500, 2000, 2500, 3000, 3500, 4000 — **deterministic per-version sizes** (fingerprint table in docs §7.2, identical across lab, user server, and Ookla HK production) | lab run: `10/10 files (240 KB – 30.2 MB)` |
| Upload script | `POST /speedtest/upload.php` → `200` body `size=<byte count>`; **GET → 404** (POST-only) | docs §7.1, §9.5 |
| Crossdomain | `GET /crossdomain.xml` → 200 policy XML with `allow-access-from domain="*"` | docs §7.1 |
| Keep-Alive | response header `Connection: Keep-Alive` (plus `Cache-Control: no-store`, `X-Frame-Options: DENY`, strict CSP on the daemon) | docs §7.1 |
| HTTPS check | TLS handshake on the daemon port, functional check with `rejectUnauthorized:false` — mirrors the tester's "check that TLS works" behavior, not CA trust | docs §5 |
| User-Agent | browser UA always sent — Ookla **production** resets UA-less clients (empirically confirmed during probing; the lab config leaves the filter off) | docs §9.1, engine `BROWSER_HEADERS` |
| Measurement methodology | pre-test → adaptive file size → 2/4 threads (≥ 4 Mbit/s → 4 threads); download aggregation: sort sample speeds, **drop the 2 fastest, drop the lowest ¼, average the rest**; upload: uniform chunks, sorted, **fastest half averaged**; ping = **minimum** of samples | engine source `aggregatePing` / download phase / upload phase (quoted in §6 below) |

Engine excerpt (download aggregation, `web/src/lib/host-tester.ts`):

```ts
// Ookla aggregation: sort samples by speed, drop the two fastest,
// then drop the lowest quarter, and average what remains.
const speeds = samples.map(/* mbit/s per sample */).sort((a, b) => a - b);
const noTop2 = speeds.slice(0, speeds.length - 2);
const kept = noTop2.slice(Math.floor(noTop2.length / 4));
```

Upload: `sorted = [...chunkSpeeds].sort((a,b)=>a-b); fastestHalf = sorted.slice(Math.floor(sorted.length/2)); /* average */`

## 2. APPROXIMATED

| Area | Why it is an approximation |
| --- | --- |
| UI fidelity | Re-implementation in React + Tailwind (Ookla dark style, single domain input, live progress). Not a byte/pixel diff of the original page — captcha and banners are intentionally absent per requirements. |
| Verdict thresholds | Ookla's exact server-side pass/fail criteria for some checks (e.g. required TLS versions, header strictness) are not public; each check here passes/fails on direct response evidence from the official daemon. |
| Speed fairness | Measured from the machine that runs the test (same as the real tester). Loopback lab numbers (e.g. 10 Gbps) only prove the engine works, not the server's WAN capacity. |

## 3. UNVERIFIABLE

- Whether Ookla's backend would actually **grant host qualification** — the
  real verdict is computed from Ookla's regional watchdog infrastructure,
  which cannot be triggered from here.
- Byte-identical parity with Ookla's internal tester implementation (closed
  source). Parity here means *same probes, same order, same documented
  methodology* — validated against the official daemon, not against Ookla's
  private code.

## 4. Lab reproduction (5 minutes)

```bash
# 1. official binary (SHA256: ce180aa3…598159, docs §2)
curl -O https://install.speedtest.net/ooklaserver/stable/OoklaServer-linux-x86_64-static-musl.tgz
tar xzf OoklaServer-linux-x86_64-static-musl.tgz

# 2. lab config from this submission + self-signed cert (docs §5)
cp ../lab/OoklaServer.properties .
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 825 -nodes \
  -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:0:0:0:0:0:0:0:1"

# 3. run daemon, run the tester against it
./OoklaServer &
node ../cli/speedtest-host-tester.mjs localhost:8080
# expected: 10/10 PASS — same as results/hasil-lab-official-daemon.txt
```

`lab/OoklaServer.properties` is the exact config used in the lab (auto-update
disabled so the tested version stays pinned). `lab/probes/` contains the raw
protocol probe scripts (`ws-probe*.mjs`, mock daemon) used to derive the
findings in `docs` §7/§9.

## 5. Result files

| File | Run | Outcome |
| --- | --- | --- |
| `results/hasil-lab-official-daemon.txt` / `.json` | official OoklaServer 2.11.5.2 at `localhost:8080`, 2026-11-02 19:46 UTC | **10/10 PASS** — verdict *“Server is publicly available and properly configured.”*; ping 0.2 ms, download 10 099 Mbps (4 threads, `random4000x4000.jpg`), upload 2 307 Mbps (4 MB chunks) — loopback |
| `results/hasil-target-host.txt` / `.json` | `host.yapsidarussalam.or.id:8080`, 2026-11-02 19:45 UTC (push time) | 1 PASS / 9 FAIL — `ECONNREFUSED`; DNS still resolves to 125.164.215.24 |
| `audit/ui-local-daemon.png` | web UI session, 2026-11-02 | the web clone rendering results against the lab daemon |

Target-host context (docs §9.8): the host sits behind MikroTik DDNS with a
dynamic IP; during the 2026-11-02 session it was **online and passed all 10
checks** (real run quoted in `cli/README.md`: ping 21.4 ms / download
87.42 Mbps / upload 45.18 Mbps), then started refusing connections — the
failure mode is the connection layer (dynamic IP/CGNAT), not the daemon. The
daemon build reported by the target while online was identical to the lab
build, so the lab result is representative of the target's configuration.

## 6. Differences vs `arena.ai/` (for the main agent)

Both submissions cover the documented Ookla probe set; differences that
matter for the merge decision:

| Dimension | z.ai (this) | arena.ai |
| --- | --- | --- |
| Engine | TypeScript, zero runtime deps (node builtins + fetch); one engine shared by web + CLI | Python stdlib; shared engine for web + CLI |
| CLI artifact | single 41 KB file, Node ≥ 18, `--json`, exit codes 0/1/2 | `cli.py` / `host-tester` wrapper, flags incl. `--summary --json -o` |
| Version detection | netgauge `HI→HELLO` handshake → daemon version (2.11.5.2) | netgauge TCP/WS probe battery (19 checks) |
| Port model | all probes on the daemon port (default 8080), justified by OoklaServer 2.11 single-port multiplex (docs §9.3) | additionally probes legacy port-80 endpoints explicitly |
| Measurement | full Ookla legacy methodology: pre-test → adaptive size → 2/4 threads → sample aggregation (drop-2-fastest + lowest-¼ / fastest-half) | probe-focused result capture (see their README) |
| Verification base | official binary in local lab (SHA256-pinned) + Ookla HK production cross-check + deterministic file-size fingerprint table | computed-style 0-diff audit of the original form DOM/CSS, original assets/fonts, Playwright network evidence |
| Form fidelity | functional re-implementation (single input, Ookla style) | **stronger**: byte-level form markup/CSS from the original page, 0 computed-style diffs |
| Protocol depth | **stronger**: handshake transcripts, WS frame semantics, aggregation math, per-version file fingerprints, UA-filter + rate-limit findings | probe order + response evidence |

Suggested merge direction: use `arena.ai`'s page shell/assets for pixel
fidelity and `z.ai`'s engine + lab methodology for the test logic and
measurement phases — then re-run both CLIs against the target once it is
online again.

## 7. Round 2 — cross-validation with the official Speedtest CLI

Full report and evidence: [`cross-validation/README.md`](cross-validation/README.md).

The **official Ookla Speedtest CLI 1.2.0** (SHA256 pinned) was redirected
onto the same lab daemon — its own top server pick
`1010.hkspeedtest.com:8080` was rewritten to `localhost:8080` inside a
licensed, live-served configuration (the sandbox cannot write `/etc/hosts`,
so the "domain → localhost" trick was implemented at the config level via a
local proxy; engine parameters, license and all other servers stayed
genuine).

Findings:

1. **The official client completes a full test against the lab daemon** —
   idle latency 0.06 ms, download 67 478 Mbps, upload 45 092 Mbps, packet
   loss 0.0%. Infrastructure validated from the client side.
2. **Protocol separation confirmed:** the official client made **zero HTTP
   requests** (empty access logs) — it speaks pure netgauge TCP/TLS + UDP.
   The z.ai engine's 3 624 logged requests on the same daemon decode to
   exactly the documented host-tester surface (upload chunks, image files,
   latency samples, WS handshake). Both surfaces of the official daemon are
   now proven by genuine clients.
3. **Live engine parameters captured** (15 s duration, 4 threads, 32 MB
   upload packets, pingCount 5, stableStop, up to 32 scaled connections,
   IQM latency statistics) — documented against the z.ai engine's
   host-tester legacy methodology.
4. **A real bug was found and fixed (v1.0.1):** IPv6-literal targets
   (`[::1]:8080`) failed 5 checks with `ERR_INVALID_URL` — HTTP URLs were
   built without bracketing IPv6 literals. Fixed in
   `web/src/lib/host-tester.ts` (shared by web + CLI); verified 10/10 with a
   green regression battery. This is precisely the class of defect the
   cross-validation was designed to surface.

## 8. Round 3 — visual-bug fix + full re-test / re-audit / re-validation

A user reported a visual bug: **typed text in the host input field was
invisible** (text color = field background). Root cause: the shadcn `Card`
component applies its own `text-card-foreground`; with no `.dark` class on
`<html>` that resolves to the light-theme near-black `--foreground`
(oklch 0.145). The page's dark palette (`bg-[#0d0e12]`, `text-zinc-100`) is
hardcoded per-element, and the input was the only element relying on color
inheritance — so typed text and caret rendered near-black on a near-black
field (computed `color: lab(2.75)` on `background: rgb(13,14,18)`).

Fix (web only, engine untouched):

- `web/src/app/page.tsx` — explicit `text-zinc-100 caret-zinc-100` on the
  host input.
- `web/src/app/globals.css` — `input:-webkit-autofill` guard (inset
  `#0d0e12` + `#f4f4f5` text) so browser autofill can never repaint the
  field into an unreadable state.

Verified headlessly (Chromium, before/after pixel audit —
`audit/input-bug-before.png`, `audit/input-bug-after.png`): before = **0**
light pixels in the input box, after = **364** core light pixels spanning
exactly the typed string `localhost:8080`, brightest sample `rgb(244,244,245)`
= zinc-100. A 3rd full E2E run through the fixed UI completed in 21.8 s:
**10/10 checks PASS**, ping 0.4 ms avg, download 2572.77 Mbps, upload
1388.80 Mbps, verdict "Server is publicly available and properly
configured" (`audit/ui-retest-after-fix.png` not needed — same flow as
`audit/ui-local-daemon.png`).

Re-validation after the fix — both sides re-run fresh against the same lab
daemon (official OoklaServer 2.11.5.2, SHA256 `f19e5ed240dc185b…`):

| Client | Result | Evidence |
| --- | --- | --- |
| z.ai CLI v1.0.1 (SHA256 `e42580db13ff3678…`, unchanged) | 10/10 PASS · ping 0.6 ms avg · download 11588 Mbps · upload 2409 Mbps · 18.3 GB in 21.4 s | `cross-validation/zai-engine/zai-cli-retest-round3.json` |
| **Official Ookla Speedtest CLI 1.2.0** (via config-level redirect, server 43356 `1010.hkspeedtest.com:8080` → `localhost:8080`) | idle latency 0.06 ms · download 67050 Mbps (33.7 GB) · upload 40289 Mbps (51.9 GB) · packet loss 0.0% | `cross-validation/official-cli/official-cli-retest-round3.txt` |

Daemon-side signature reconfirmed: the official client again produced
**zero HTTP access-log entries** (pure netgauge), while its netgauge session
teardown is timestamped in the daemon log at the run window. Cross
validation passes in both directions after the fix.
