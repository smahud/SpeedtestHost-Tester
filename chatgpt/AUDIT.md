# Submission audit

Executed 2026-11-03 (Asia/Jakarta). Baseline: `0b19be0e8e915f04ab836c3ce743a19b557eeef6`.
Scope: independent submission in `chatgpt/`, plus a root README index entry only.

## Findings addressed in the derivative engine

| Finding in the reviewed Arena baseline | ChatGPT behavior | Evidence |
| --- | --- | --- |
| Mixed public/private DNS passes initial gate, leaving private fallback addresses | Filter non-global addresses before any connection; reuse one vetted DNS snapshot across ports | Mixed DNS regression |
| URL parser silently strips embedded controls and accepts unsupported schemes | Reject raw controls before parsing; allow only HTTP(S) | Invalid input regression (caught CRLF normalization during development) |
| HTTPS scheme retained as metadata but not applied automatically | HTTPS implies TLS for daemon checks, including CLI after normalization | Official TLS lab + untrusted CA control |
| HTTP body collection can retain full images and repeatedly join buffers | Count stream, retain 4 KiB, cap total bytes per response | 100,000-byte bounded-read test + ten real daemon images |
| WebSocket upgrade checked by substring, reader can consume first frame with headers | Exact status/header validation, bytewise header boundary | Coalesced handshake + ping + fragmented HELLO regression |
| Unbounded advertised WebSocket frame length | Reject masked server frames, reserved bits, oversized frames/messages, invalid controls and excessive frames | Malformed-frame regression |
| Crossdomain regex can conflate port rules across domains or read comments | Parse XML and check domain/port on the same rule | Comment and conflicting rule regressions |
| KeepAlive does not require successful latency responses | Two HTTP 200 `test=test` responses on the same persistent socket | HTTP 404 regression; official daemon success |
| TLS failure triggers unverified diagnostic requests | No unverified TLS connections | Official untrusted-CA control |
| Network error paths may leave sockets open | `finally` cleanup for HTTP, NetGauge, WebSocket, KeepAlive | Code review and repeated lab runs |
| IPv6 HTTP authority formatting | Bracket literal addresses in Host and legacy URL | Normalization coverage; no live IPv6 daemon claim |

The web adapter also validates Host, limits request bodies to 4 KiB, validates a
session CSRF value, escapes all result text, disables framing/external resources via
CSP, rejects GET-triggered probes, limits active test concurrency, and kills a timed-out
child after 180 seconds. These controls are for local operation, not a public hosting claim.

## Fresh validation

| Check | Result | Artifact |
| --- | --- | --- |
| Regression suite | 16 tests passed | `results/unit-tests.txt` |
| Official daemon + trusted generated certificate | 19 passed, 0 failed; CLI exit 0 | `results/official-daemon.json` |
| Official daemon + untrusted certificate | 15 passed, 4 failed; CLI exit 1 | `results/untrusted-tls.json` |
| Web GET form → POST → real CLI → real daemon → HTML | 19 passed, 0 failed | `results/web-integration.txt` |
| Refused loopback endpoint | 0 passed, 19 failed | Regression test |
| Invalid CLI scheme | Exit 2, diagnostic stderr, empty stdout | Regression test |

The official binary reports `HELLO 2.11 (2.11.5) 2026-06-04.1737.7d0993d` in this run.
The lab uses one ephemeral port for the daemon and its native legacy HTTP endpoints.
No root privileges, global trust installation, hosts-file redirection, or license
acceptance is required. Generated certificate/key files are removed on completion.
The durable positive report replaces the deleted certificate path with a descriptive
label; it records the actual host, port, timestamp, binary digest and CLI exit code.

## Limits and unverified claims

- No claim of exact equivalence to Ookla's hidden backend or regional watchdogs.
  Passing locally does not prove public reachability, listing eligibility or certification.
- No fresh official Speedtest CLI throughput cross-validation was performed here.
  Other agents' cross-validation is context only.
- No new external target, including `host.yapsidarussalam.or.id`, was tested. No production changes.
- UI markup and real form HTTP submission were tested; browser screenshots, visual
  pixel comparison, assistive-technology testing and browser rendering were not performed.
- No live IPv6 transport, public CA service, separate PHP legacy server or multi-address
  failover environment was independently exercised. Native legacy upload behavior was tested;
  the alternative PHP arithmetic is inherited, not freshly validated.
- Image byte sizes are the inherited pinned fingerprint, not universal server requirements.
  A future valid daemon version with different files may fail these comparisons.
- Crossdomain response parsing caps the body at 4 KiB; larger policies fail conservatively.
- CLI DNS/overall wall time is not bounded internally. The web child has a total deadline.
- This is a local stdlib HTTP server, without public-service authentication, distributed
  rate limiting, or deployment supervision. There is no production-ready hosting claim.

## Reproduction

Run the two test commands in `README.md`. The optional lab needs Linux x86_64,
OpenSSL, and the hash-verified sibling executable. It chooses an available port,
starts only its own daemon process, and terminates it in `finally`. Private keys are
temporary and excluded by the root ignore rules. Captured reports are genuine
executions; tests are not replaced with canned successful output.
