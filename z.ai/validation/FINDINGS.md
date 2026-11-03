# FINDINGS — confirmed defects & issues (Round 4)

Format: severity · status. All root causes **verified against the official
OoklaServer 2.11.5.2 binary** unless noted.

## Confirmed defects (fixed in v1.1.0)

### Z-4.1 — HIGH · FIXED · engine
**Silent redirect-following produces misleading DNS failures.**
- Repro: run the tester against the official daemon with any target whose Host
  header is not in the daemon cert's SANs (`[::1]:8080` or a wrong hostname).
- Observed (v1.0.1): 4–6 checks fail with `getaddrinfo ENOTFOUND lab.ookla.test`
  (or the cert's canonical name), keep-alive fails with "no HTTP response",
  crossdomain sometimes 400 — all misleading.
- Root cause: the official daemon 307-redirects every plain-HTTP GET to
  `https://<cert-canonical>:<port>/` when Host ∉ SANs (PROTOCOL_MATRIX §6);
  `fetch` followed the redirect cross-host and tried to resolve the canonical
  name, which does not exist in a lab.
- Fix: `redirect:"manual"` in every engine fetch + `explainRedirect()`:
  daemon check PASSes with the redirect explanation (the daemon *is*
  responding — verified signature), endpoint checks FAIL with an actionable
  message naming the redirect and the SAN rule.
- Regression: `tests/regression.mjs` unit (mock redirect mode) + lab ([::1]) —
  asserts no ENOTFOUND and redirect explanations; also the cross-agent borrow
  (chatgpt's "don't follow redirects blindly") is hereby independently
  reproduced and materialized.

### Z-4.2 — MEDIUM · FIXED · engine
**HTTPS check under-reported certificate problems.**
- Observed (v1.0.1): expired cert (notAfter 2021) → 10/10 PASS with a detail
  string ending `valid -2133d` (easy to miss); mismatch cert → PASS; no
  issuer/trust information at all.
- Root cause: the check was functional-only (`rejectUnauthorized:false`, any
  HTTP status > 0 = pass) with no validation reporting.
- Fix (v1.1.0): detail now includes protocol, CN, **issuer**, validity days,
  **strict-trust probe result** (`trust: not publicly trusted (CODE)`), and
  hostname-vs-SAN check; **expired → WARN**, hostname-not-in-SANs → WARN
  (check still passes functionally; verdict unaffected — see DECISIONS D2).
- Regression: expired + mismatch live scenarios (TEST_MATRIX TLS table).

### Z-4.3 — MEDIUM · FIXED · engine
**parseTarget accepted `host.example.com:notaport` as a host.**
- Root cause: the host:port regex failed on the non-numeric port, then the
  whole string was kept and `host.includes(":")` classified it as IPv6.
- Fix: strict IPv6 classification via `net.isIP()`; bare IPv6 literals
  (`::1`, `2001:db8::1`, detected by `::` or ≥2 colons) now parse correctly;
  dotted-quad-shaped invalid strings (`256.1.1.1`) rejected as typos.
- Regression: 20 parseTarget unit cases (previously `2001:db8::1` was
  mangled to `{host:"2001:db8:", port:1}` → rejected; now valid).

### Z-4.4 — MEDIUM · FIXED · engine
**Crossdomain check accepted any policy.**
- Root cause: regex matched `cross-domain-policy|allow-access-from` — a policy
  with only specific domains passed as "policy found".
- Fix: parse `allow-access-from domain="…"` values; `*` → PASS; other domains
  → WARN listing them; unparsable policy → WARN; missing → FAIL. (Ookla
  expects `domain="*"`; non-`*` yields a warning in the official tester —
  mistral.ai reference, adopted.)
- Regression: mock strict-pass case + live official run.

### Z-4.5 — LOW · FIXED · CLI
**SIGINT exited 0 instead of 130.**
- Root cause: the engine returns a partial summary on abort, so the CLI's
  abort branch (which expected a throw) never ran.
- Fix: check `ctrl.signal.aborted` after the run → print "Aborted." → exit 130.
- Verified manually (kill -INT mid-download).

### Z-4.6 — LOW · FIXED · engine
**WS Host header not bracketed for IPv6 literals** (`Host: ::1:8080`).
- The official daemon still upgraded (tolerant), but the header was
  non-conforming; now `[::1]:8080`. (Also aligns with the daemon's SAN-matching
  quirk: brackets are *not* stripped — PROTOCOL_MATRIX §6.)

### Z-4.7 — LOW · FIXED · lab tooling
**Mock daemon listened IPv4-only and lacked `/hi` + redirect behavior**,
so redirect/IPv6 regression paths were untestable without the official binary.
- Fixed: dual-stack listen, `GET /hi`, `REDIRECT_MODE=1` canonical-307 mode.

## Improvements (not defects)

- **I-4.1** daemon-version fallback via `GET /hi` when netgauge WS is blocked
  (endpoint verified this round; concept from mistral.ai reference, implemented
  independently).
- **I-4.2** API route concurrency guard (S3) + explicit local-use security note.
- **I-4.3** Lab PKI (dedicated CA + valid/expired/mismatch certs) and
  `probe-protocol.mjs` battery — reproducible protocol evidence.
- **I-4.4** Formal regression battery (56 assertions, unit + lab modes).

## Non-defects / verified-correct behaviors

- upload.php `size=` = exact body byte count (sent 1009 → size=1009) ✓
- WS upgrade path `/ws` (case-sensitive, `/` ≠ upgrade, 404 otherwise) ✓
- always-send User-Agent is *mandatory* (UA-less HTTP → 500) ✓
- Keep-Alive, image fingerprints, netgauge semantics ✓ (PROTOCOL_MATRIX)

## Remaining blockers / limitations

1. **Public Ookla tester parity** — captcha-gated, closed source; verdict
   thresholds remain an approximation (AUDIT.md §2). Not resolvable here.
2. **UDP netgauge framing** — proprietary; only validated end-to-end via the
   official CLI (packetLoss 0). No z.ai-side UDP check (matches the public
   tester's check set).
3. **Web UI E2E** — not re-run this round (no UI changes; R3 evidence stands).
4. **IPv6-literal targets can never pass the legacy HTTP checks** against
   OoklaServer 2.11 (bracketed Host never SAN-matches) — this is daemon
   behavior, correctly reported now, not fixable client-side. Users should
   test via the hostname.
