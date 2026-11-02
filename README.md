# SpeedtestHost-Tester

**Multi-agent comparison repository** for a local 1:1-style clone of <https://www.speedtest.net/host-tester>.

Repository: <https://github.com/smahud/SpeedtestHost-Tester>  
Created: 2026-11-03 (Asia/Jakarta)  
Default branch: `main`

## Purpose

Several agents are working on the same project independently. This repository keeps each agent's complete submission in its own directory so the **main agent can compare them first** and only then merge the final project. The root `README.md` is an index and comparison guide — it is **not** the merged implementation.

> **Do not merge directly from this root.** Compare the agent directories, then produce the final project from the best evidence.

## Required layout

| Path | Agent | Status | What belongs here |
| --- | --- | --- | --- |
| `README.md` | — | Ready | This comparison index |
| `arena.ai/` | Arena.ai Agent Mode | **Complete submission** | Full project: app, CLI, assets, audit, screenshots, result files |
| `z.ai/` | z.ai agent | **Complete submission** | Full project: zero-dep CLI, Next.js web app, engine, lab config + probes, docs, audit, fresh results |
| `mistral.ai/` | mistral.ai agent | Placeholder | Reserved for that agent's complete project |

`z.ai/` and `mistral.ai/` keep a short `README.md` so the directories are tracked. Other agents should add their own `README.md`, source, audit notes, and result files inside their own directory without overwriting another agent's work.

> Note: the initial placeholder for the z.ai agent was created as `z.a/` (typo);
it was renamed to `z.ai/` when that agent's submission landed. `mistral.ai/` is
still reserved and empty.

---

## Submission: `arena.ai/`

### Entry points

```bash
# Web clone (live preview / local server)
python3 arena.ai/app.py
# then open /host-tester, /host-tester?clean=1, or /api/test?host=...

# CLI, no browser needed
./arena.ai/host-tester host.yapsidarussalam.or.id:8080
./arena.ai/host-tester https://host.yapsidarussalam.or.id:8080/
./arena.ai/host-tester host.yapsidarussalam.or.id --summary --json -o hasil.json
```

### New in this update: official OoklaServer simulation

To stop guessing, the official static-musl binaries were downloaded, the x86_64 daemon was run locally on `127.0.0.1:8080`, and the clone was pointed at `localhost`. Full technical variables are in `arena.ai/ooklaserver/sim/SIMULASI.md` and `arena.ai/ooklaserver/sim/manifest.json`.

- Binary `2.11.5.2`, build `2026-06-04.1737.7d0993d`, SHA-256 recorded for both architectures.
- Port 8080 serves **HTTP and TLS simultaneously** when a custom cert is configured; plain NetGauge, WebSocket, and WSS all verified.
- Self-signed CA installed to system trust + `SSL_CERT_FILE` used; strict TLS verification was **not** disabled.
- A separate control server on port 80 served the official `http_legacy_fallback.zip` for legacy checks.
- HTTP mode: **18 PASSED / 1 FAILED**. HTTPS mode: **19 PASSED / 0 FAILED / 19 checks**, exit code 0.
- The simulation exposed concrete update items: TLS scheme hint is discarded by normalization, legacy port is hardcoded to 80, upload algorithm differs between legacy PHP and daemon, and WSS/`--ca-bundle` support is missing.

### Follow-up update: official Speedtest CLI cross-validation → code v1.2.0

The official `Speedtest by Ookla 1.2.0.84` CLI was downloaded, `./speedtest -L` gave `myspeed.gorge.net:8080` (id 4063), and `/etc/hosts` mapped that domain to `127.0.0.1`. The CLI then completed a full speedtest against the local daemon (`server.ip = 127.0.0.1`, exit 0) in four variants, including HTTP-mode daemon. Only the server domain was redirected; `cli.speedtest.net` / `results.speedtest.net` stayed on Cloudflare. Full analysis: `arena.ai/ooklaserver/sim/CROSS_VALIDATION.md`.

All code gaps above are now **closed in v1.2.0**: `--ca-bundle`, `--legacy-port`, `--upload-mode`, `--daemon-tls`, `input_scheme`, and `options{}`. Every HTTPS variant returns **19/19 PASSED**, negative controls fail cleanly, and the 1:1 form is byte-identical before/after the patch. Results in `arena.ai/ooklaserver/sim/results/v1.2/`.

### Key files

| File | Purpose |
| --- | --- |
| `arena.ai/README.md` | Project documentation, routes, CLI flags, probe sequence, caveats |
| `arena.ai/AUDIT.md` | Full end-to-end audit matrix + simulation addendum |
| `arena.ai/ooklaserver/sim/SIMULASI.md` | Official-binary simulation: binaries, config, TLS, ports, results, update list |
| `arena.ai/ooklaserver/sim/manifest.json` | Machine-readable technical variables |
| `arena.ai/ooklaserver/BINARY_MANIFEST.md` | Binary hashes and repo size decisions |
| `arena.ai/ooklaserver/sim/CROSS_VALIDATION.md` | Official Speedtest CLI ↔ OoklaServer ↔ clone cross-analysis |
| `arena.ai/ooklaserver/sim/results/v1.2/` | v1.2.0 19/19 results, negative controls, regression |
| `arena.ai/speedtest-cli/` | Official Speedtest CLI tarball, binary, `CLI_MANIFEST.md` |
| `arena.ai/app.py` | Web server, shared input normalizer, shared test engine, renderers |
| `arena.ai/cli.py` | CLI v1.2.0 |
| `arena.ai/host-tester` | Executable CLI wrapper |
| `arena.ai/assets/chrome.html` | Original page shell: masthead, nav, footer, SVG symbols |
| `arena.ai/assets/form.html` | Original form markup with reCAPTCHA removed |
| `arena.ai/assets/inline.css` | Original Speedtest CSS + embedded fonts + minimal overrides |
| `arena.ai/assets/fonts/` | Local Montserrat / gauge-mono font files |
| `arena.ai/audit/comparison.png` | Side-by-side original vs clone form screenshot |
| `arena.ai/audit/computed-styles.json` | Playwright computed-style comparison, 0 diffs |
| `arena.ai/hasil-test.html` | Self-contained web result, full chrome |
| `arena.ai/hasil-test-clean.html` | Same result in clean/test-only mode |
| `arena.ai/hasil-test.json`, `.txt` | Same result as JSON / plain text |
| `arena.ai/hasil-cli.json`, `.txt`, `-summary.txt` | CLI outputs |

### Verified claims from this agent

- Form page matches the original **DOM, CSS, computed styles, typography, colors, and geometry**: 0 differences across 10 selectors × 15 properties (`audit/computed-styles.json`).
- Original `POST /host-tester`, `method=post`, `name/id="ookla-server"`, `pure-form pure-form-stacked`, label/legend/note/Submit preserved.
- reCAPTCHA, widget, sitekey, `api.js`, privacy modal, ads, analytics, and external resources removed; Playwright recorded only 1 local request and 0 console errors.
- Masthead/nav/footer restored for 1:1 fidelity; `?clean=1` hides them for a test-only view.
- Web **and** CLI accept `host`, `host:port`, `[IPv6]:port`, and full URLs; missing port defaults to `8080`.
- Backend reproduces the documented probe order: NetGauge TCP, WebSocket `/ws`, crossdomain, strict HTTPS, then legacy port-80 crossdomain/latency/upload/max_upload/ten image sizes/KeepAlive.
- Original target result: **4 PASSED / 15 FAILED / 19 checks**. During re-audit the target's port 8080 began resetting connections, so a fresh live run gives **1 PASSED / 18 FAILED**; the saved `hasil-*` files preserve the successful original run.
- Local official-binary simulation: HTTP mode **18/19 PASSED**; HTTPS mode **19/19 PASSED** with strict TLS verification against a locally trusted CA. Evidence is in `arena.ai/ooklaserver/sim/results/`.
- Official Speedtest CLI `1.2.0.84` redirected via `/etc/hosts` to `127.0.0.1`: full speedtest exit 0, `server.ip = 127.0.0.1`, 4 variants. Evidence in `arena.ai/ooklaserver/sim/results/cli-*.json`.
- Code **v1.2.0** (`--ca-bundle`, `--legacy-port`, `--upload-mode`, `--daemon-tls`) re-verified: **19/19 PASSED** on HTTPS mode, clean negative controls, form hash unchanged.

### Honest limitation

This is a **functional local 1:1-style replacement**, not a provable byte-identical clone of Ookla's hidden backend. The official result page is behind reCAPTCHA, no public result API was found, and Ookla runs checks from regional watchdogs rather than this sandbox. Exact server-side HTTPS/KeepAlive/legacy-POST criteria remain unverifiable. The official-binary simulation and the official Speedtest CLI cross-validation remove the guesswork about daemon/client protocol behaviour on ports 8080/80 and closed every code gap found (v1.2.0), but they still do not expose Ookla's own `/host-tester` implementation. See `arena.ai/ooklaserver/sim/SIMULASI.md` section 8, `arena.ai/ooklaserver/sim/CROSS_VALIDATION.md`, and `arena.ai/AUDIT.md` section 5 + addenda.

---

## Submission: `z.ai/`

### Entry points

```bash
# CLI, no browser needed — single file, zero dependencies, Node >= 18
node z.ai/cli/speedtest-host-tester.mjs host.yapsidarussalam.or.id:8080
node z.ai/cli/speedtest-host-tester.mjs host.yapsidarussalam.or.id        # port defaults to 8080
node z.ai/cli/speedtest-host-tester.mjs host.yapsidarussalam.or.id:8080 --json

# Web clone (Next.js 16) — same engine as the CLI
cd z.ai/web && bun install && bun run dev   # http://localhost:3000
```

### Key files

| File | Purpose |
| --- | --- |
| `z.ai/README.md` | Submission overview, quick start, verification summary, honest limitations |
| `z.ai/AUDIT.md` | Fidelity audit: exact / approximated / unverifiable, engine code excerpts, lab reproduction, head-to-head vs `arena.ai` |
| `z.ai/cli/speedtest-host-tester.mjs` | **CLI artifact** — 41 KB single file, zero deps, `--json`, exit codes 0/1/2 |
| `z.ai/cli/README.md` | CLI guide (flags, checks, methodology, example output) — Indonesian |
| `z.ai/web/` | Runnable Next.js 16 source: page, streaming NDJSON API route, engine |
| `z.ai/web/src/lib/host-tester.ts` | **The engine** (1,134 lines) — 10 checks + Ookla measurement methodology, shared by web & CLI |
| `z.ai/docs/OoklaServer-Technical-Notes.md` | 340-line technical notes: official OoklaServer 2.11.5.2 lab, config dictionary, verified endpoints/netgauge protocol, deterministic file-size fingerprints — Indonesian |
| `z.ai/lab/` | Lab config (official + as-run) and netgauge probe scripts |
| `z.ai/cross-validation/` | **Round 2**: the official Speedtest CLI 1.2.0 redirected onto the same lab daemon (domain→localhost via licensed live config) — method, evidence, live engine parameters, findings, and the v1.0.1 bugfix it produced |
| `z.ai/audit/ui-local-daemon.png` | Web UI screenshot from the verified lab session |
| `z.ai/results/` | Fresh captures: 10/10 PASS vs official daemon (lab) + honest ECONNREFUSED capture of the target at push time |

### Verified claims from this agent

- Engine validated against the **official OoklaServer 2.11.5.2 binary** (stable channel, SHA256 pinned) in a local lab: **10/10 checks PASS** with real measurements — `results/hasil-lab-official-daemon.txt`.
- Cross-checked against Ookla's **production** server (`1010.hkspeedtest.com.prod.hosts.ooklaserver.net:8080`, Hong Kong): 10/10 PASS, identical daemon version via the netgauge `HI→HELLO` handshake.
- Daemon version detection via netgauge WebSocket handshake: `HELLO 2.11 (2.11.5) 2026-06-04.1737.7d0993d` — same build reported by the target host while it was online.
- Deterministic per-version `random*.jpg` size fingerprint table (10 sizes, identical across lab, target, and Ookla HK production) documented in `docs` §7.2.
- Ookla measurement methodology implemented and commented in source: pre-test → adaptive file size → 2/4 threads (≥ 4 Mbit/s → 4) → download aggregation (drop 2 fastest + lowest ¼, average rest), upload fastest-half averaging, ping = minimum of samples.
- Behavioral findings from direct probing: production UA filter (UA-less clients are reset), per-IP rate limits (`maxConnPerIp=500`, 20 000/bucket), POST-only `upload.php`, single-port protocol multiplexing.
- **Cross-validated with the official Speedtest CLI 1.2.0** (`z.ai/cross-validation/`): redirected onto the same lab daemon (its top server pick `1010.hkspeedtest.com:8080` → `localhost:8080` through a licensed, live-served config), the official client completed a full genuine test — idle latency 0.06 ms, download 67 478 Mbps, upload 45 092 Mbps, packet loss 0.0% — while making **zero HTTP requests** (pure netgauge). The z.ai engine's 3 624 logged requests on the same daemon decode to exactly the documented host-tester surface. Live engine parameters captured (15 s / 4 threads / 32 MB packets / pingCount 5 / stableStop / IQM).
- **The cross-validation sweep found and fixed a real bug (v1.0.1):** IPv6-literal targets (`[::1]:8080`) failed 5 checks with `ERR_INVALID_URL` (unbracketed IPv6 in URL construction) — fixed in the shared engine, verified 10/10 with a green regression battery.
- The target `host.yapsidarussalam.or.id:8080` passed **all 10 checks while online** during the 2026-11-02 session (ping 21.4 ms, download 87.42 Mbps, upload 45.18 Mbps — quoted in `cli/README.md`); at push time it refuses connections again (dynamic IP/CGNAT behind MikroTik DDNS, `docs` §9.8), and the honest fresh capture (**1 PASS / 9 FAIL, ECONNREFUSED**) is committed as `results/hasil-target-host.*`.

### Honest limitation

Functional clone of the public page + documented protocol — not a provable byte-identical copy of Ookla's hidden backend; the real qualification verdict runs from Ookla's regional watchdogs. The UI is a React/Tailwind re-implementation (single domain input, Ookla dark style) rather than a pixel-diff of the original page. Speeds are measured from the machine running the test, exactly like the real tester. Full matrix: `z.ai/AUDIT.md`.

---

## Comparison checklist for the main agent

- [ ] Read each agent's `README.md` and audit/report file.
- [ ] Compare form DOM/CSS/geometry evidence (`computed-styles.*`, screenshots).
- [ ] Compare backend probe order and evidence against Ookla docs / protocol observation, including `arena.ai/ooklaserver/sim/results/` and the official CLI cross-validation in `arena.ai/ooklaserver/sim/results/cli-*.json`.
- [ ] Compare "no captcha / no banner / domain-only input" compliance.
- [ ] Compare CLI behavior, output formats, and exit codes.
- [ ] Compare real test results for `host.yapsidarussalam.or.id:8080`.
- [ ] Separate **verified** claims from **approximations** and **unverifiable** claims.
- [ ] Merge only after selection; keep every agent directory intact for traceability.

## Notes

- Repository visibility: **public** (no visibility was specified when the repo was created).
- No credentials are committed. The disposable PAT was used only for the push, stored temporarily outside the workspace, and removed afterwards; `.gitignore` also excludes `*token*`, `*.pat`, `.env`, `*.key`, and `*.csr`. Lab CA/server private keys are regenerated locally; only public certificates and the full chain are tracked.
- `arena.ai` is Python standard library only (plus the committed official binaries under `arena.ai/ooklaserver/`). `z.ai` ships a zero-dependency Node CLI plus a Next.js web app source tree (trimmed to the real import closure); no `node_modules`, no build artifacts, no 15 MB daemon binary — the official binary is re-downloadable, SHA256 pinned in `z.ai/docs` §2.
