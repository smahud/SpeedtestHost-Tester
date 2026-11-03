# FINAL_REPORT — z.ai Round 4 audit (2026-11-03)

## A. Agent workspace

| Item | Value |
| --- | --- |
| Assigned directory (TARGET_DIR) | `z.ai/` — verified, all execution inside it |
| Branch | `audit/z-ai-official-validation` |
| Baseline SHA | `eab16976a4dbf48f36b0d81da5413cf2860e3cfa` |
| Final SHA | `32c719b2fa8b99045cfd182af84cfab04c5fe0f8` (deliverable commit; FINAL_REPORT, push-day re-verification and push metadata in follow-up commits — see git log) |
| Deliverable version | Host Tester **v1.1.0** (engine + CLI bundle `43dc23e81a37d856e9b2391e7bd01bc03a1d2cf0a1201ffd54090668d8da7c55`) |

## B. Scope compliance

**Confirmed:** every executed process, written file, and committed change lives
under `z.ai/` (verified via `git status` review pre-commit: zero changes outside
`z.ai/`). Other agent directories (`arena.ai/`, `chatgpt/`, `mistral.ai/`) were
read as references only — never executed, modified, or staged. Root files
untouched. Git operations: one branch created, one commit, **no force-push,
no main modification**. Borrowed concepts (mistral.ai: `/hi` endpoint +
crossdomain `domain="*"`; chatgpt: never follow redirects blindly) were
independently verified and re-implemented, with attribution recorded
(AUDIT.md §9, FINDINGS Z-4.1, TEST_MATRIX).

## C. Audit findings (confirmed, with evidence)

7 defects fixed — full table in FINDINGS.md:

| ID | Severity | Defect |
| --- | --- | --- |
| Z-4.1 | HIGH | silent redirect-following → misleading `ENOTFOUND` DNS failures when Host ∉ cert SANs (official daemon 307 canonical-name redirect); broke IPv6-literal targets |
| Z-4.2 | MEDIUM | HTTPS check passed expired/hostname-mismatched/untrusted certs with near-silent detail |
| Z-4.3 | MEDIUM | `parseTarget` accepted `host:garbage` (misclassified as IPv6); mangled bare IPv6; accepted `256.1.1.1` |
| Z-4.4 | MEDIUM | crossdomain check accepted any policy (Ookla expects `domain="*"`) |
| Z-4.5 | LOW | SIGINT exited 0 instead of 130 |
| Z-4.6 | LOW | unbracketed IPv6 in WS Host header |
| Z-4.7 | LOW | mock daemon IPv4-only, missing `/hi` + redirect mode (test infrastructure) |

Plus new verified protocol knowledge (PROTOCOL_MATRIX): `GET /hi`; **UA-less
HTTP → 500 (core daemon behavior)**; 307 canonical redirect rule (brackets not
stripped from Host); CORS reflection; Range ignored; exact netgauge byte
semantics; server-enforced TLS 1.2 floor; WS path sensitivity; UDP netgauge
functional for genuine clients. Round-2's "[::1] 10/10 after v1.0.1 fix" claim
corrected as context-dependent.

## D. Official binary validation

| Binary | Version / build | SHA-256 | Result |
| --- | --- | --- | --- |
| OoklaServer tgz (stable, x86_64) | 2.11.5.2 `2026-06-04.1737.7d0993d` | `ce180aa3…598159` (**matches round-1 pin**) | run on port 8080 TCP+UDP, IPv4+IPv6, lab-CA cert, access log on, auto-update off |
| extracted daemon | — | `f19e5ed2…92f027a` (matches pin) | dual-fork start, 2 MB download data gen, all 41 probes answered |
| Speedtest CLI tgz | 1.2.0.84 (ea6b6773cf) | `5690596c…cfeeb7` (**matches pin**) | `--help`/`-L` captured; no `--no-submit` flag exists |
| extracted CLI | — | `31f1124c…53c051` (matches pin) | full genuine test vs local daemon (below) |

Not committed (redistribution not permitted; re-download via official URLs in REPRODUCE.md).

## E. Cross-validation (three-way)

- **Official CLI ↔ official daemon (fresh, non-publishing):** exit 0; server
  43356 rewritten to `localhost:8080` (config-level redirect via TLS-terminating
  proxy; license + engine params genuine); idle latency 0.053 ms, download
  ≈ 64.8 Gbit/s (52.3 GB / 6.4 s), upload ≈ 47.9 Gbit/s (70.2 GB / 12.8 s),
  packetLoss 0; **results.speedtest.net refused at the proxy** (no artificial
  public data); daemon access-log delta **0 HTTP requests** — pure netgauge;
  daemon console log shows the netgauge session in the run window.
- **z.ai Host Tester ↔ official daemon:** 10/10 PASS (localhost + 127.0.0.1);
  `[::1]` accurate 6-pass/4-fail redirect diagnosis; expired cert → https WARN;
  mismatch cert → https WARN + endpoint FAILs explained.
- **z.ai Host Tester ↔ official CLI:** different roles by design (diagnostic
  HTTP/WS surface vs netgauge capacity client) — both surfaces proven on the
  same official binary by their genuine clients. Full comparison table:
  CROSS_VALIDATION.md.

## F. Code improvements

Engine (`web/src/lib/host-tester.ts`, v1.1.0): redirect handling (`redirect:
"manual"` + `explainRedirect`), `/hi` version fallback, enriched HTTPS check
(issuer/trust/hostname/expiry + WARN policy), strict crossdomain parsing,
`parseTarget` hardening (`net.isIP`), bracketed WS Host header.
CLI: v1.1.0, SIGINT → 130, help/version updated.
Web API route: concurrency guard (max 3 → 429) + local-use security note.
Test infra: `tests/regression.mjs` (56 assertions), lab PKI generator
(valid/expired/mismatch), 41-probe protocol battery, hardened mock daemon,
non-publishing cv-proxy. Docs: 11-file validation/ set + README/AUDIT/tech-notes
updates.

## G. Security assessment

SECURITY_AUDIT.md: 12 threat classes assessed. **Resolved this round:** S3
(concurrency guard), S6 (redirect following), S10 (input hardening).
**Verified-safe:** payload bounds, subprocess (none), secrets handling,
TLS-bypass separation (functional vs trust now explicit). **Accepted/documented
residuals:** S1/S2/S9 (web route is a local/lab tool — public deployment needs
auth + egress gateway), loopback ≠ capacity.

## H. Test results (real, evidence-linked)

| Suite | Result | Evidence |
| --- | --- | --- |
| Regression unit (43 assertions) | **PASS 43/43** | `lab/results/regression-unit.txt` |
| Regression lab, live official daemon (13 assertions) | **PASS 13/13** | `lab/results/regression-lab.txt` |
| v1.1.0 full run vs official daemon | **10/10 PASS, exit 0** | `results/hasil-lab-official-daemon-v1.1.0.txt/.json` |
| TLS scenarios (valid/expired/mismatch) | behave as designed (WARN + explanations) | TEST_MATRIX |
| Concurrency (4 parallel full runs) | 4× 10/10, daemon healthy | TEST_MATRIX |
| Global timeout / SIGINT | capped at 10 s / exit 130 | TEST_MATRIX |
| Official CLI cross-validation | exit 0, non-publishing | `cross-validation/round-4/` |
| **Push-day re-verification (2026-11-04)** | unit 43/43 · live lab 13/13 · expired-cert `https` WARN re-confirmed · valid-cert full run 10/10 exit 0 · official-CLI CV re-run ×2 exit 0 (access-log delta 0, `persisted=false`) | `lab/results/*2026-11-04*`, `results/hasil-lab-official-daemon-v1.1.0-2026-11-04.txt` |
| Web UI E2E | **NOT RE-RUN** (no UI change; R3 evidence stands) | limitation |

## I. Documentation

`z.ai/validation/`: CONTEXT_BASELINE, ENVIRONMENT, PROTOCOL_MATRIX, TEST_MATRIX,
CROSS_VALIDATION, SECURITY_AUDIT, FINDINGS, DECISIONS, REPRODUCE, HANDOFF,
FINAL_REPORT (this file). Updated: README.md, AUDIT.md, cli/README.md,
lab/README.md, results/README.md, cross-validation/README.md,
docs/OoklaServer-Technical-Notes.md.

## J. Git delivery

| Item | Status |
| --- | --- |
| Branch | `audit/z-ai-official-validation` (local + GitHub `origin`) |
| Deliverable commit | `32c719b2fa8b99045cfd182af84cfab04c5fe0f8` |
| Push to GitHub | **COMPLETED 2026-11-04** — the repository owner provided a fine-grained PAT for the session; the branch was pushed over HTTPS as a fast-forward creation of `refs/heads/audit/z-ai-official-validation` from `main` @ `eab16976` (no force-push, no other branches touched). The token was used transiently on the push command line only — never written to any file, git config, or commit — and the owner is advised to revoke it (it was shared via chat). The previously exported `zai-audit-branch.bundle` is now redundant. |
| Remote state | **Verified post-push** via `git ls-remote`: the remote branch head equals the pushed local HEAD (deliverable `32c719b` + push-day follow-up commits; see git log). |
| Pull request | Not opened (not requested) — branch pushed for owner review/merge. |

## K. Production readiness

**CONDITIONAL PASS.**

Justification: the diagnostic engine is validated against the official
OoklaServer 2.11.5.2 binary across the full documented check surface, the
negative/TLS/redirect scenarios, and a genuine official-client cross-validation,
with a 56-assertion regression battery and complete reproducible lab. Remaining
conditions: (1) push to GitHub — **completed 2026-11-04** (was: pending credentials); (2) web app is explicitly a
local/lab tool — public deployment requires an auth/egress gateway; (3) Ookla's
hidden verdict thresholds remain an approximation; (4) re-run the lab when
Ookla ships a new daemon build (fingerprint watch). No claim of Ookla
certification or zero defects is made.
