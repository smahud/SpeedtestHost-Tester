# HANDOFF — authoritative continuation entry point for the z.ai workspace

> Read this first if you are a future agent session working on `z.ai/`.
> It repeats the workspace-isolation policy on purpose.

## Workspace isolation (NON-NEGOTIABLE)

- Your execution directory is **`z.ai/`** (TARGET_DIR). All runs, builds, tests,
  artifacts, and logs stay inside it.
- `arena.ai/`, `chatgpt/`, `mistral.ai/` are **read-only references**. Never
  execute, modify, or commit their files. Learn from them, verify independently.
- Root files (README, .gitignore) are read-only.
- Git: branch `audit/z-ai-…` or `zai/…`, stage **only** `z.ai/` paths, never
  force-push, never touch other branches.

## What this project is

A Speedtest **Host Tester** — functional clone of
<https://www.speedtest.net/host-tester> — that diagnoses whether an
OoklaServer host is properly configured (10 checks + ping/download/upload
measurements). One TypeScript engine shared by a Next.js web UI and a
zero-dependency Node CLI. It is NOT a speedtest client and NOT a daemon.

## Current state (after Round 4, 2026-11-03)

| Item | Value |
| --- | --- |
| Validated version | **v1.1.0** (engine + CLI bundle rebuilt from it) |
| Baseline audited | `eab16976a4dbf48f36b0d81da5413cf2860e3cfa` |
| Deliver branch | `audit/z-ai-official-validation` (commit SHA: see FINAL_REPORT §J / git log) |
| Regression battery | `node tests/regression.mjs unit` (43) + `… lab` (13) — **both green** |
| Official binaries | OoklaServer 2.11.5.2 (`2026-06-04.1737.7d0993d`) + Speedtest CLI 1.2.0.84 — SHA-256 pinned in `validation/ENVIRONMENT.md` |
| Verified vs official daemon | 10/10 PASS (localhost + 127.0.0.1); redirect/expired/mismatch scenarios behave as designed |
| Cross-validation | official CLI → lab daemon, **non-publishing** (results.speedtest.net blocked), exit 0, zero HTTP requests (pure netgauge) |

## Key files

| Path | Role |
| --- | --- |
| `web/src/lib/host-tester.ts` | THE engine (all checks + measurements) |
| `web/src/lib/host-tester-types.ts` | shared types/constants |
| `web/src/cli/main.ts` | CLI source (bundled → `cli/speedtest-host-tester.mjs`) |
| `web/src/app/api/host-test/route.ts` | NDJSON streaming API (concurrency-guarded) |
| `tests/regression.mjs` | regression battery (unit / lab modes) |
| `lab/scripts/gen-certs.sh` | lab PKI generator (valid/expired/mismatch) |
| `lab/scripts/probe-protocol.mjs` | protocol probe battery |
| `lab/scripts/cv-proxy.py` | non-publishing cross-validation proxy |
| `lab/probes/mock-ooklaserver.mjs` | faithful mock daemon (REDIRECT_MODE, /hi) |
| `lab/run/OoklaServer.properties` | daemon config (port 8080 only, access log on) |
| `validation/*.md` | this documentation set |

## How to run (short version)

1. `bash lab/scripts/gen-certs.sh` (once) + stage binaries (`validation/REPRODUCE.md` §1)
2. start daemon (`REPRODUCE.md` §2)
3. `node tests/regression.mjs unit && node tests/regression.mjs lab`
4. after any engine change: rebuild the CLI (`REPRODUCE.md` §8) and re-run both.

## What is verified (do not re-litigate without new evidence)

- Full protocol matrix: `validation/PROTOCOL_MATRIX.md` (multiplexing, UA-500
  rule, `/hi`, WS path sensitivity, CORS reflection, Range ignored, upload
  semantics, 307 canonical redirect, TLS 1.2 floor, image fingerprints).
- The v1.1.0 defect fixes: `validation/FINDINGS.md` (Z-4.1 … Z-4.7).

## Highest-priority next steps

1. **Re-run against the live target host** (`host.yapsidarussalam.or.id:8080`)
   when it is online again — the real-world case for this tool; compare with the
   DDNS/CGNAT analysis in `docs/OoklaServer-Technical-Notes.md` §9.8.
2. **Optional SSRF allowlist** for the web route (`HOST_TESTER_ALLOWED_TARGETS`
   env) if public deployment is ever needed (SECURITY_AUDIT S1, DECISIONS D6).
3. **Web UI E2E re-run** after any UI change (R3 evidence covers the old UI).
4. **Daemon upgrade watch**: if `install.speedtest.net/ooklaserver/stable`
   ships a new build (compare `HELLO` string + tgz SHA-256), re-run the whole
   lab + battery and update the fingerprint table.
5. **UDP netgauge** deeper probe (optional; proprietary framing — only feasible
   by observing the official client).

## Decisions to preserve

See `validation/DECISIONS.md` (D1–D12). The big ones: single engine + rebuilt
bundle (D1), HTTPS functional-vs-trust split with WARN (D2), never follow
redirects (D3), always send UA (D5), non-publishing cross-validation (D7),
never commit binaries/keys (D9), loopback ≠ capacity (D10).

## Known limitations

- Public Ookla tester parity is unverifiable (captcha + closed backend).
- IPv6-literal targets cannot pass legacy HTTP checks on OoklaServer 2.11
  (daemon-side bracket/SAN behavior) — reported accurately since v1.1.0.
- Verdict thresholds are approximations (documented).
