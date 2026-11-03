# SECURITY_AUDIT — z.ai Host Tester v1.1.0

Scope: engine (`web/src/lib/host-tester.ts`), CLI (`cli/speedtest-host-tester.mjs`),
web API route (`web/src/app/api/host-test/route.ts`). Lab-only components
(probe scripts, cv-proxy) are internal tooling, not shipped.

## Threat model & findings

| # | Threat | Assessment | Mitigation / status |
| --- | --- | --- | --- |
| S1 | **SSRF via web route** (`/api/host-test?target=…`) | The route connects to arbitrary hosts incl. loopback/private IPs — **by design** (a server tester must test private/lab servers, e.g. `localhost:8080`). If deployed publicly, any visitor could probe internal networks. | **Documented** in the route header; recommended deployment: local/trusted network only. Adding a hard block on private ranges would break the tool's core use case (lab). Open item: optional env-based allowlist (`HOST_TESTER_ALLOWED_TARGETS`) — not implemented to keep v1.1.0 scope tight (see DECISIONS D6). |
| S2 | **DNS rebinding** | A public hostname resolving to an internal IP would be probed. Same class as S1, same deployment assumption. | Documented; not additionally mitigated (would require resolving + pinning IPs pre-connect; noted as future work). |
| S3 | **Resource exhaustion (concurrent tests)** | Unbounded concurrent runs × (4 download + 4 upload workers) could exhaust sockets/memory. | **FIXED this round**: in-process concurrency guard (max 3 concurrent runs → HTTP 429). CLI side: single run per process. |
| S4 | **Excessive payload allocation** | Download phase streams via `reader.read()` (no full-buffer); upload builds one ≤4 MiB chunk body per worker; image check uses HEAD (falls back to full GET only if HEAD unsupported). WS frame limit 64 MiB enforced client-side. | OK (bounded by design); verified by code review + lab runs (16.3 GB streamed without growth). |
| S5 | **TLS verification bypass** | The *functional* HTTPS check intentionally uses `rejectUnauthorized:false` (mirrors "does TLS work at all"). It is **never** reported as a validated secure connection: v1.1.0 adds an explicit strict-trust probe and surfaces `trust: not publicly trusted (…)` plus WARN for expired/hostname-mismatch. | OK — separation of functional vs trust is now explicit in output. |
| S6 | **Unsafe redirects** | v1.0.1 followed redirects silently (could be pointed at arbitrary hosts by a malicious server; produced misleading errors). | **FIXED**: `redirect:"manual"` everywhere; redirects are detected and explained, never followed. |
| S7 | **Command injection / path traversal** | No `exec`/`spawn` in engine or route; no filesystem writes from user input. CLI argv parsing only. | N/A (none possible). |
| S8 | **Secrets exposure** | Lab private keys live only in `lab/certs/` (gitignored; root `*.key` also ignores). No credentials in committed files; cross-validation proxy logs contain the CLI's own query strings — checked: deviceId/hid/sid are device fingerprints, not credentials; license token was redacted in round-2 artifacts and round-4 artifacts contain none. | OK. |
| S9 | **CSRF on web route** | GET-based streaming route; a third-party page cannot read cross-origin NDJSON responses (no ACAO on our route) and cannot meaningfully trigger long tests (no side effects beyond the test itself). Local use assumed. | Accepted residual risk (local tool); documented. |
| S10 | **Input validation** | `parseTarget` strictly validates hostname/IPv4/IPv6/port; rejects garbage, port 0/65536+, dotted-quad typos, unbracketed `host:garbage`. | **Hardened this round** (regression-covered). |
| S11 | **Subprocess cleanup** | CLI: no children. Lab scripts: proxy/daemon are manually managed lab processes (not shipped). | N/A for deliverable. |
| S12 | **Rate limits of the target daemon** | Repeated mass testing can trip the daemon's own `ipTracking` limits (maxConnPerIp 500 / 20000 per 5-min bucket — official default config). The engine's request volume per run (~30–60 requests + WS) stays far below. | Documented (docs §9.4); no engine change needed. |

## Negative/failure testing performed (TEST_MATRIX has the full table)

- connection refused, NXDOMAIN, wrong port, unreachable IPv6 → clean, correct failures; exit codes 1/2.
- expired / mismatched / untrusted TLS → functional pass + explicit WARN + reasons.
- redirecting server (official + mock) → no cross-host fetch, clear explanation.
- SIGINT → exit 130; global timeout honored.
- 4 concurrent full runs → all 10/10, daemon healthy.

## Residual risks (accepted, documented)

1. Public deployment of the web app without auth (S1/S2/S9) — the tool is a
   local/lab diagnostic; a production deployment needs a gateway with auth +
   egress policy (outside this project's scope).
2. `rejectUnauthorized:false` remains in the functional HTTPS probe by design
   (it is *diagnosing* TLS, and its output never claims trust).
3. Loopback speed numbers must never be presented as internet capacity
   (results files are labeled "loopback").
