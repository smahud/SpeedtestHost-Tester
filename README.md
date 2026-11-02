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
| `z.a/` | z.a agent | Placeholder | Reserved for that agent's complete project |
| `mistral.ai/` | mistral.ai agent | Placeholder | Reserved for that agent's complete project |

`z.a/` and `mistral.ai/` contain a `.gitkeep` and a short `README.md` so the directories are tracked. Other agents should add their own `README.md`, source, audit notes, and result files inside their own directory without overwriting another agent's work.

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

### Key files

| File | Purpose |
| --- | --- |
| `arena.ai/README.md` | Project documentation, routes, CLI flags, probe sequence, caveats |
| `arena.ai/AUDIT.md` | Full end-to-end audit matrix + simulation addendum |
| `arena.ai/ooklaserver/sim/SIMULASI.md` | Official-binary simulation: binaries, config, TLS, ports, results, update list |
| `arena.ai/ooklaserver/sim/manifest.json` | Machine-readable technical variables |
| `arena.ai/ooklaserver/BINARY_MANIFEST.md` | Binary hashes and repo size decisions |
| `arena.ai/app.py` | Web server, shared input normalizer, shared test engine, renderers |
| `arena.ai/cli.py` | CLI v1.1.0 |
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

### Honest limitation

This is a **functional local 1:1-style replacement**, not a provable byte-identical clone of Ookla's hidden backend. The official result page is behind reCAPTCHA, no public result API was found, and Ookla runs checks from regional watchdogs rather than this sandbox. Exact server-side HTTPS/KeepAlive/legacy-POST criteria remain unverifiable. The new official-binary simulation removes much of the guesswork about daemon responses on ports 8080/80, but it still does not expose Ookla's own `/host-tester` implementation; see `arena.ai/ooklaserver/sim/SIMULASI.md` section 8 for the concrete update list. See also `arena.ai/AUDIT.md` section 5 and its simulation addendum.

---

## Comparison checklist for the main agent

- [ ] Read each agent's `README.md` and audit/report file.
- [ ] Compare form DOM/CSS/geometry evidence (`computed-styles.*`, screenshots).
- [ ] Compare backend probe order and evidence against Ookla docs / protocol observation, including `arena.ai/ooklaserver/sim/results/`.
- [ ] Compare "no captcha / no banner / domain-only input" compliance.
- [ ] Compare CLI behavior, output formats, and exit codes.
- [ ] Compare real test results for `host.yapsidarussalam.or.id:8080`.
- [ ] Separate **verified** claims from **approximations** and **unverifiable** claims.
- [ ] Merge only after selection; keep every agent directory intact for traceability.

## Notes

- Repository visibility: **public** (no visibility was specified when the repo was created).
- No credentials are committed. The disposable PAT was used only via an HTTP header for the push, stored temporarily outside the workspace, and removed afterwards; `.gitignore` also excludes `*token*`, `*.pat`, `.env`, `*.key`, and `*.csr`. Lab CA/server private keys are regenerated locally; only public certificates and the full chain are tracked.
- Python standard library only; no `node_modules`, no build artifacts, no `__pycache__` committed.
