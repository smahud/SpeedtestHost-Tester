# TEST_MATRIX — what is tested, how, and with what result

Legend: **P** = automated regression test (runs in CI-like fashion),
**L** = live lab scenario (official binary required), **M** = manual/one-off probe.
All results from 2026-11-03 unless noted. Battery: `node tests/regression.mjs unit`
(43 assertions) and `node tests/regression.mjs lab` (13 assertions) — **both green**.

## Engine checks (the 10 Host-Tester checks)

| # | Check | Positive test | Negative test | Status |
| --- | --- | --- | --- | --- |
| 1 | Hostname resolution | P+L: localhost / 127.0.0.1 / [::1] resolve | P: NXDOMAIN (`nonexistent.invalid`) → fail with DNS error | PASS |
| 2 | OoklaServer daemon connection | L: HTTP 200 + banner; redirect-mode mock: 307 explained | P: refused port → fail; L: redirect case → pass w/ explanation | PASS |
| 3 | Daemon version | L: netgauge HELLO; **fallback** `GET /hi` (P: mock, L: official) | P: mock redirect-mode + NXDOMAIN → fail w/ both errors | PASS |
| 4 | Netgauge / WebSocket | L: `wss://…/ws` HI→HELLO, PING→PONG ×5, IPv4+IPv6 | P: refused port → fail | PASS |
| 5 | HTTPS functionality | L: TLS 1.3 + 200 (+ enriched cert detail) | L: expired cert → **WARN** "EXPIRED 2133d"; L: mismatch cert → **WARN** hostname-not-in-SANs; mock (no TLS) → fail | PASS |
| 6 | Keep-Alive | L: `Connection: Keep-Alive`; redirect case: 307 headers inspected (P+L) | — (daemon always keep-alive) | PASS |
| 7 | Latency file | L: 200 `test=test` | L: redirect case → fail w/ redirect detail; P: mock | PASS |
| 8 | Download images | L: 10/10 HEAD, sizes = fingerprint table | L: redirect case → fail w/ redirect detail | PASS |
| 9 | Legacy upload script | L: POST → `size=265` exact byte count | L: redirect case → fail; GET → 404 (probe) | PASS |
| 10 | Crossdomain | L: policy w/ `domain="*"` → **strict pass** | M: policy without `*` would WARN (mistral-documented Ookla behavior; mock covers strict pass) | PASS |

## Input validation (`parseTarget`) — 20 unit cases (P)

Accepted: `host`, `host:port`, full URLs, `127.0.0.1[:port]`, `[::1][:port]`,
`[2001:db8::1]:8080`, bare `2001:db8::1`, `::1`.
Rejected: empty/whitespace, `host..example.com`, `-bad.example.com`,
`host.example.com:notaport` (**was wrongly accepted in v1.0.1**),
`host.example.com:0`, `:65536`, `256.1.1.1` (dotted-quad typo), `!!…`, `a b c`.

## CLI behavior

| Scenario | Expected | Result |
| --- | --- | --- |
| `--help` | exit 0, prints version | PASS |
| no args | exit 2 | PASS |
| invalid input (×3) | exit 2 | PASS |
| refused port (127.0.0.1:59999) | exit 1, valid JSON, verdict not ok, daemon check fail, **no ENOTFOUND** | PASS |
| NXDOMAIN | exit 1, resolution check fail w/ DNS error | PASS |
| all-pass run | exit 0 | PASS (L) |
| checks-failed run | exit 1 | PASS (L, [::1] scenario) |
| `--timeout 10` with 15s+15s phases | run capped at ~10 s, partial measurements | PASS (measured 10 s) |
| SIGINT mid-run | exit **130** (fixed this round; was 0) | PASS |
| 4 concurrent runs | all complete, daemon healthy | PASS (4×10/10) |

## Live official-daemon matrix (L) — `lab/results/regression-lab.txt`

| Target | Expected | Result |
| --- | --- | --- |
| `localhost:8080` | exit 0, 10/10, version 2.11.5.2, crossdomain `domain="*"`, https detail w/ trust info, measurements present | **PASS (10/10)** |
| `127.0.0.1:8080` | exit 0, 10/10 | **PASS** |
| `[::1]:8080` (bracketed Host ∉ SANs) | exit 1; daemon/version/netgauge/https/keepalive pass; 4 HTTP-endpoint checks fail **with redirect explanation**; **zero ENOTFOUND** | **PASS (6+4 with clear failures)** |

## TLS scenario matrix (L, one-off; engine behavior verified each time)

| Daemon cert | v1.0.1 behavior | v1.1.0 behavior | Result |
| --- | --- | --- | --- |
| valid lab-CA cert | 10/10 | 10/10 + enriched detail (issuer, SAN check, trust probe) | PASS |
| **expired** (notAfter 2021) | 10/10 (detail `valid -2133d` easy to miss) | https **WARN** `certificate EXPIRED 2133d ago`, verdict still ok, exit 0 | PASS |
| **hostname mismatch** (SAN other.ookla.test) | 4/10 with misleading `ENOTFOUND other.ookla.test` | https WARN hostname∉SANs; endpoint checks FAIL with redirect explanation | PASS |

## Protocol probes (M, `lab/results/probe-protocol-8080.json`)

41 recorded probes across HTTP surface / images / upload / CORS / keep-alive /
raw netgauge / WS path sensitivity / TLS versions / strict verification / UDP —
see PROTOCOL_MATRIX for the decoded results.

## NOT TESTED / NOT APPLICABLE

- Public Speedtest.net host-tester backend parity (captcha-gated; closed) — N/A by design.
- Ookla regional watchdog verdict — not reproducible from the lab.
- Live UDP netgauge framing (proprietary) — only end-to-end via official CLI (packetLoss 0).
- Web UI E2E — unchanged this round except the API route (concurrency guard);
  the R3 visual fix was not re-audited (out of scope; no UI changes made).
