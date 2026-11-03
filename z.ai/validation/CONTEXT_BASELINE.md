# CONTEXT_BASELINE — z.ai workspace, Round 4 audit

**FACT** unless marked otherwise.

| Item | Value |
| --- | --- |
| Repository | https://github.com/smahud/SpeedtestHost-Tester |
| Baseline commit (audit start) | `eab16976a4dbf48f36b0d81da5413cf2860e3cfa` (`main`) |
| Working branch | `audit/z-ai-official-validation` |
| Assigned workspace (TARGET_DIR) | `z.ai/` |
| Other agent directories | `arena.ai/`, `chatgpt/`, `mistral.ai/` — READ-ONLY, untouched |
| Audit date | 2026-11-03 (UTC) |
| Deliverable version | Host Tester **v1.1.0** (engine + CLI), up from v1.0.1 |

## What the project is

A functional clone of the Ookla® Server Tester (<https://www.speedtest.net/host-tester>)
— a **diagnostic tool**, not a replacement for the proprietary OoklaServer daemon:

1. **Official OoklaServer** — the server under test.
2. **Official Speedtest CLI** — a genuine speedtest *client* (different role).
3. **z.ai Host Tester** (this workspace) — the diagnostic implementation.
4. **Public Speedtest.net Host Tester** — functional reference (closed source).

One shared TypeScript engine (`web/src/lib/host-tester.ts`) powers the web UI
(Next.js 16) and a zero-dependency CLI (`cli/speedtest-host-tester.mjs`,
Node ≥ 18, bundled with bun).

## Prior-round claims evaluated this round

| Prior claim (source) | Round-4 verdict |
| --- | --- |
| R1: 10/10 PASS vs official OoklaServer 2.11.5.2 lab (`AUDIT.md`) | **VERIFIED** — reproduced twice (localhost + 127.0.0.1) with the fresh binary, same build `2026-06-04.1737.7d0993d`, same 10 fingerprint file sizes |
| R1: "all probes on the daemon port; HTTP/HTTPS/WS multiplexed on 8080" | **VERIFIED** — TCP+UDP+HTTP+HTTPS+WS+WSS all confirmed on 8080 (PROTOCOL_MATRIX §1) |
| R2: official CLI 1.2.0 completes a full test against the lab daemon | **VERIFIED (fresh)** — Round 4 reproduced it with a **non-publishing** proxy (submission blocked), exit 0, `server 43356 → localhost:8080` |
| R2 fix: IPv6 literal `[::1]:8080` 10/10 PASS after v1.0.1 URL-bracket fix | **CONTRADICTED (context-dependent)** — against a daemon whose cert SANs contain `IP::1`, the *bracketed* `Host: [::1]:8080` header does not SAN-match, so the official daemon 307-redirects every plain-HTTP GET; v1.0.1 then reported 6 misleading DNS errors. Fixed in v1.1.0 (FINDINGS Z-4.1). The earlier PASS evidently came from a lab cert whose SAN set made the redirect not trigger. |
| R3: visual input bug fixed, re-validated 10/10 | Not re-tested (web UI unchanged this round except the API route; the engine/CLI path was re-validated) |
| mistral.ai: `GET /hi` returns daemon version | **VERIFIED** and adopted as v1.1.0 fallback (PROTOCOL_MATRIX §2.2) |
| mistral.ai: crossdomain requires `domain="*"` | **VERIFIED** against official daemon policy body; adopted in v1.1.0 (WARN otherwise) |
| chatgpt: redirect-following can mask real behavior | **VERIFIED** — materialized here as Z-4.1 |

## Baseline state of the workspace (before this audit)

- Engine `web/src/lib/host-tester.ts` v1.0.1 (1,138 lines) + bundled CLI v1.0.1
- Lab config + probe scripts from rounds 1–3 (no pinned lab layout, no cert PKI,
  no regression battery, no validation/ directory)
- No automated tests in `z.ai/`
