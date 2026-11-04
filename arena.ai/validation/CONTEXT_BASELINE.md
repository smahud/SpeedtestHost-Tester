# CONTEXT_BASELINE.md — reconstructed project context

**Authoritative directory:** `arena.ai/`
**Repository:** `https://github.com/smahud/SpeedtestHost-Tester`
**Baseline commit (before this audit):** `eab16976a4dbf48f36b0d81da5413cf2860e3cfa`
**Baseline branch:** `main`
**Audit branch:** `audit/arena-official-validation`
**Audit date:** 2026-11-04 (Asia/Jakarta)

---

## 1. What the project is

`arena.ai/` contains an independent, local re-implementation of Ookla's
**Server Tester** (`https://www.speedtest.net/host-tester`).  It is a
*diagnostic* client: it probes a remote OoklaServer daemon and reports which
of the 19 server-side checks passed.  It is **not** a speedtest engine and
**not** a replacement for the OoklaServer daemon.

The submission has two entry points:

| Entry point | Purpose |
| --- | --- |
| `app.py` | HTTP server (port 3000) rendering the original-style form and running the checks |
| `cli.py` | the same engine without a browser; `host-tester` is a thin wrapper |

Both share one engine (`run_all_tests()` in `app.py`), one input normaliser
(`normalize_target()`), and one renderer.

## 2. Baseline state found by this audit

The baseline was **not** empty.  Three earlier commits had already built a
substantial submission:

| Commit | Content |
| --- | --- |
| `80cca35` | the first complete `arena.ai` submission (form clone, engine, CLI) |
| `59e1944` | an OoklaServer laboratory simulation, certificates and result artefacts |
| `2c49b98` | official Speedtest CLI cross-validation and the `v1.2.0` feature set |

The baseline therefore already claimed: 18/19 in HTTP mode, 19/19 in HTTPS
mode against a local official daemon, and a successful official-CLI
cross-validation.  **This audit re-derived those claims from scratch instead
of trusting them** — see `FINDINGS.md` for the classification of each prior
claim (`VERIFIED` / `PARTIALLY VERIFIED` / `CONTRADICTED` / `UNVERIFIED`).

### Baseline tree (measured, not assumed)

```
arena.ai/
├── app.py            42 946 B   engine + web server
├── cli.py             6 827 B   CLI v1.2.0
├── host-tester                    sh wrapper
├── assets/                      chrome.html, form.html, inline.css, fonts/
├── audit/                        Playwright screenshots and computed styles
├── ooklaserver/                 official binaries + sim/ (certificates, scripts, results)
├── speedtest-cli/               official Speedtest CLI + docs
├── hasil-*                       saved result artefacts
├── AUDIT.md, README.md, SIMULASI-OOKLASERVER.md
```

### Baseline gaps identified immediately

1. **No `validation/` directory** — the required persistent memory set
   (`CONTEXT_BASELINE.md`, `ENVIRONMENT.md`, `PROTOCOL_MATRIX.md`,
   `TEST_MATRIX.md`, `CROSS_VALIDATION.md`, `SECURITY_AUDIT.md`,
   `FINDINGS.md`, `DECISIONS.md`, `REPRODUCE.md`, `HANDOFF.md`,
   `FINAL_REPORT.md`) did not exist.
2. **No automated tests** — every claim rested on hand-run scripts.
3. **Proprietary binaries were committed** to the repository
   (`ooklaserver/x86_64/OoklaServer`, both `*.tgz` tarballs, the aarch64
   build, `speedtest-cli/x86_64/speedtest`).
4. **Laboratory scripts hardcoded `/home/user/...`** absolute paths and were
   therefore broken in the actual repository layout (`repo/arena.ai/...`).
5. **The laboratory depended on a third-party mirror** of the 95 MB
   `http_legacy_fallback.zip` (`http://speedtest.lungit.com/...`), i.e. an
   unverified external supply-chain dependency, and that mirror was the
   component that made the legacy-fallback checks pass.

## 3. Role separation (kept explicit throughout this audit)

| # | Role | What it proves |
| --- | --- | --- |
| 1 | **Official OoklaServer** `2.11.5.2` | the server under test |
| 2 | **Official Speedtest CLI** `1.2.0.84` | a genuine speedtest client |
| 3 | **This Host Tester** | the diagnostic implementation under audit |
| 4 | `speedtest.net/host-tester` | the functional reference (behind reCAPTCHA) |

A successful CLI benchmark does **not** prove that the diagnostic tester is
correct; the two are compared layer by layer in `CROSS_VALIDATION.md`.

## 4. What this audit changed (summary)

* `app.py` / `cli.py` raised to **v1.3.0** with eight confirmed fixes
  (`FINDINGS.md` F-01 … F-14).
* A new **regression suite** (`tests/`, 77 tests) that runs without the
  official binaries and a separate integration suite that runs against them.
* The laboratory was rebuilt as `lab/` with **portable scripts**, a fresh
  laboratory PKI including three *negative* certificates, and **no external
  download dependency**.
* The official binaries were **removed from version control** and replaced by
  a hash-verified download script.
* The official-CLI cross-validation was re-run with **proof that nothing was
  published** (`persisted: false`, upload intercepted locally with HTTP 503).

## 5. Deliberate non-goals

* No attempt is made to imitate Ookla's closed server-side implementation.
  The official result page is behind reCAPTCHA and was **not** bypassed.
* No other agent's directory was executed or modified (§11 isolation).
* No claim of "official Ookla certification" is made anywhere.
