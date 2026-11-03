# DECISIONS — architecture & policy decisions to preserve

Each entry: **DECISION** + rationale. Do not reverse these without new evidence.

- **D1 — One engine, two frontends.** `web/src/lib/host-tester.ts` is the single
  source of truth; the CLI is a bun bundle of it. Rebuild after every engine
  change: `cd web && bun build src/cli/main.ts --target=node --format=esm --outfile=../cli/speedtest-host-tester.mjs`.
  (Round 2 shipped a v1.0.1 engine fix but the committed bundle had been built
  from it — keep it that way; never hand-edit the bundle.)

- **D2 — HTTPS check: functional pass/fail + WARN for cert problems, never a
  silent pass.** The check mirrors the public tester's "HTTPS functionality"
  semantics (does TLS + HTTP work on the daemon port?). Trust-chain/expiry/
  hostname problems are surfaced in the detail and downgrade the check to WARN
  but do not fail the verdict, because (a) Ookla's exact grading is not public,
  (b) pre-submission servers legitimately run self-signed certs (Ookla policy:
  LE provisioning starts only after submission). Classification: documented
  approximation.

- **D3 — Never follow redirects.** Engine fetches use `redirect:"manual"`; a
  redirect is *evidence* (daemon canonical-name behavior), not an instruction.
  Cross-host fetching from a redirect would be both misleading and an SSRF-ish
  hazard. (Z-4.1.)

- **D4 — Daemon connection check passes on the 307 canonical redirect.** The
  redirect is a verified official-daemon signature (Host ∉ cert SANs) — the
  daemon is responding. The *endpoint* checks (latency/images/upload/crossdomain)
  fail in that situation because those endpoints genuinely are not served for
  that Host. This split is deliberate: connection ≠ endpoint availability.

- **D5 — Always send a browser User-Agent.** Mandatory: the official daemon
  500s UA-less HTTP requests (core behavior, verified round 4 — stronger than
  the round-1 "production filter" theory).

- **D6 — Web route is a local/lab tool.** Loopback+private targeting is a
  feature, not an SSRF bug, for this use case. Public deployment requires an
  auth/egress gateway (out of scope). A configurable allowlist was considered
  and deferred (keeps v1.1.0 minimal; SECURITY_AUDIT S1).

- **D7 — Cross-validation must be non-publishing.** Round 4 blocks
  `results.speedtest.net` at the proxy. Loopback measurements must never be
  submitted as genuine public results (no `--no-submit` exists in CLI 1.2.0).
  Future rounds must keep this property.

- **D8 — Port 8080 only in the lab.** Lab constraint (sandbox + Ookla host
  requirement). The engine defaults to 8080 and accepts any port for real-world
  use, but lab evidence is 8080-only.

- **D9 — Binaries and private keys are never committed.** Official tarballs are
  re-downloadable (SHA-256 pinned in ENVIRONMENT.md); lab PKI is regenerable
  (`lab/scripts/gen-certs.sh`). Evidence (logs, JSON, probe outputs) IS committed.

- **D10 — Loopback numbers are lab evidence, not capacity.** All result files
  and reports label loopback measurements as such.

- **D11 — IPv6-literal HTTP limitation is daemon-side.** OoklaServer 2.11
  SAN-matching does not strip brackets from `Host: [::1]:8080`, so legacy HTTP
  endpoints are unreachable for IPv6-literal targets. The tester now reports
  this accurately (redirect explanation). Recommend testing via hostname.
  Do not "fix" this client-side (e.g. by stripping brackets — that would send a
  non-conforming Host header and still not SAN-match).

- **D12 — Version numbering.** v1.1.0 (behavior additions: redirect handling,
  /hi fallback, https enrichment, crossdomain strictness, SIGINT/exit-code
  semantics, input hardening). Next engine change → 1.1.x or 1.2.0 by scope.
