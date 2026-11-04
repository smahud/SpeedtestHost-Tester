# Ookla Server Tester — local 1:1-style clone

A local replacement for `https://www.speedtest.net/host-tester`. The form page
uses the **original DOM structure, original CSS, original masthead/navigation/
footer, original label/legend/button spacing, and the original
`POST /host-tester` contract**. The only removed UI is reCAPTCHA,
advertising/consent banners, analytics and external network dependencies.

- **No reCAPTCHA** — widget, sitekey and `api.js` removed; an invisible spacer keeps the original vertical rhythm.
- **No banners** — no cookie/privacy modal, no ads, no GTM/analytics, no external scripts or stylesheets.
- **Only the test page** — add `?clean=1` to hide nav/footer and show the test-only view.
- **`cukup domain saja`** — `host`, `host:port`, `[IPv6]:port`, and full `http(s)://.../path?query` are accepted on **both web and CLI**; missing port defaults to `8080`.
- **Same backend checks** — recreated from direct protocol observation against the **genuine official OoklaServer 2.11.5.2** daemon.
- **CLI without a browser** — just pass a URL or hostname and get text/JSON results.
- **Independently audited** — the implementation was re-audited against the official daemon and the official Speedtest CLI; see [`validation/`](validation/).

> "1:1" here means form-level DOM/CSS/geometry equivalence and a faithful functional reconstruction. It does **not** mean byte-identical to Ookla's hidden server-side implementation. See [`AUDIT.md`](AUDIT.md) for the exact matrix and limits.

## Run

```bash
cd arena.ai
python3 app.py          # or: PORT=3000 python3 app.py
```

Open `http://localhost:3000/host-tester`. In Arena the live preview is started automatically on port 3000.

Useful URLs:

| URL | Result |
| --- | --- |
| `GET /host-tester` | Original-style form with full masthead/nav/footer |
| `GET /host-tester?clean=1` | Test-only view; nav/footer hidden |
| `POST /host-tester` | Run test with `ookla-server=<target>` |
| `GET /host-tester?run=1&host=<target>` | Run test via GET, handy for screenshots |
| `GET /api/test?host=<target>` | Raw JSON result |

Optional query/POST flags: `allow_private=1|true|yes`, `daemon_tls=1|0|true|false`, `clean=1|true|yes`, `ca_bundle=<path>`, `legacy_port=<n>`, `upload_mode=auto|legacy|native`.

Accepted target formats:

```text
host.yapsidarussalam.or.id                 -> host.yapsidarussalam.or.id:8080
host.yapsidarussalam.or.id:8080            -> unchanged
https://host.yapsidarussalam.or.id:8080/x  -> host.yapsidarussalam.or.id:8080
[2001:db8::1]:8080                        -> unchanged
```

This is intentionally more forgiving than the official form, which rejects bare hostnames and full URLs. The original `host:port` format still works exactly.

An `https://` target is probed **over TLS** for the daemon checks; `--no-daemon-tls` forces plain TCP again.

## CLI

Version `1.3.0`. No browser needed:

```bash
# host:port
./host-tester host.yapsidarussalam.or.id:8080

# full URL — the scheme selects TLS for the daemon checks
./host-tester 'https://host.yapsidarussalam.or.id:8080/path?x=1'

# bare hostname -> port defaults to 8080
./host-tester host.yapsidarussalam.or.id

# machine-readable output + save to a file
./host-tester host.yapsidarussalam.or.id:8080 --json --output hasil.json

# only the summary lines
./host-tester host.yapsidarussalam.or.id:8080 --summary

# local / not-yet-public lab server
./host-tester localhost:8080 --allow-private

# lab CA for strict TLS (verification is never disabled)
./host-tester localhost:8080 --allow-private --ca-bundle lab/certs/ca.crt

# daemon also serves legacy /speedtest/* on 8080 (native upload algorithm)
./host-tester localhost:8080 --allow-private --legacy-port 8080 --upload-mode auto

# TLS-only daemon checks (wss) with a lab CA
./host-tester localhost:8080 --allow-private --daemon-tls --ca-bundle lab/certs/ca.crt

# global budget for the whole run
./host-tester localhost:8080 --timeout 30

# equivalent without the wrapper
python3 cli.py host.yapsidarussalam.or.id:8080
```

Flags:

| Flag | Meaning |
| --- | --- |
| `-p, --port N` | default port when the target has no explicit port (default `8080`) |
| `--json` | print raw JSON instead of formatted text |
| `--summary` | print only host/time/DNS/summary lines |
| `-o, --output FILE` | also write the result to `FILE` |
| `--allow-private` | allow RFC1918 / loopback / local targets |
| `--ca-bundle FILE` | PEM CA bundle for strict TLS verification (replaces default trust store; never disables verification) |
| `--legacy-port N` | port for the HTTP legacy fallback (default `80`) |
| `--upload-mode MODE` | `auto` \| `legacy` \| `native` upload size algorithm (default `auto`) |
| `--daemon-tls` / `--no-daemon-tls` | force TLS / plain TCP for the NetGauge, WebSocket and crossdomain checks (default: auto — an `https://` target uses TLS) |
| `--timeout SECONDS` | global budget for the whole run (default `180`) |
| `--no-color` | disable ANSI status colors |
| `-q, --quiet` | suppress progress notes on stderr |
| `--version` | print CLI version |

Exit codes: `0` = all checks passed, `1` = at least one check failed, `2` = invalid input or test error.

## What the backend actually does

### OoklaServer / NetGauge TCP (on `host:port`)

1. **netgauge** — raw TCP connect, send `HI\n`, expect `HELLO <major> (<version>) <build>`, then `QUIT\n`.
2. **websocket** — HTTP/1.1 Upgrade to `GET /ws` with `Origin: https://www.speedtest.net`, require `101 Switching Protocols` **and** a matching `Sec-WebSocket-Accept`, send a masked text frame `HI\n`, expect `HELLO ...`.
3. **crossdomain** — `GET /crossdomain.xml`, parse `<allow-access-from domain=... to-ports=.../>`, require `*.ookla.com`, `*.speedtest.net`, `*.speedtestcustom.com` (or `*`) and the tested port.
4. **https** — strict TLS `GET /hi` on the same port with `ssl.create_default_context()`, expect `hello ...`. A self-signed/private certificate is FAILED unless its CA is explicitly trusted via `--ca-bundle` / `ca_bundle=` (verification is never disabled).

### HTTP Legacy Fallback (port 80 of the hostname by default)

The original tester uses `http://<hostname>/speedtest/upload.php`; the `:8080` daemon port is **not** reused by default. Use `--legacy-port 8080` to probe the daemon's own legacy paths — the official daemon serves them on the same port.

1. **crossdomain** — `GET http://<hostname>/crossdomain.xml`.
2. **latency** — `GET /speedtest/latency.txt`, expect `test=test`.
3. **upload** — `POST /speedtest/upload.php` with `content1=<random>` sized so the legacy PHP script returns `size=516300`.
4. **max_upload** — same POST sized for `size=1981500`.
5. **image_sizes** — `GET` all ten `random{WxW}.jpg` files and compare actual byte counts with the official legacy sizes.
6. **keepalive** — two sequential HTTP/1.1 requests on one TCP socket; verify reuse and a fast second response.

The legacy `upload.php` computes `500 + len(key) + len(value) + 3`; with key `content1` this is `value_length + 511`. The official OoklaServer daemon instead returns `size=<raw POST Content-Length>`. `--upload-mode auto` accepts either and reports `detected_mode`; `legacy`/`native` force one interpretation.

## Files

| File | Purpose |
| --- | --- |
| `app.py` | Web server, shared `normalize_target()`, shared test engine, renderers |
| `cli.py` | Command-line interface, v1.3.0 |
| `host-tester` | Executable wrapper for `cli.py` |
| `assets/chrome.html` | Original page shell (masthead, nav, footer, SVG symbols) with placeholders |
| `assets/form.html` | Original form markup, reCAPTCHA removed |
| `assets/inline.css` | Original Speedtest CSS + embedded fonts + minimal clone/result overrides |
| `assets/fonts/` | Locally downloaded Montserrat / gauge-mono font files |
| `AUDIT.md` | Full end-to-end audit matrix, evidence and honest limitations |
| `validation/` | The independent re-audit: 11 documents (context, environment, protocol matrix, test matrix, cross-validation, security audit, findings, decisions, reproduce, handoff, final report) |
| `tests/` | Regression suite — 77 tests, `sh tests/run_tests.sh` |
| `lab/` | The laboratory: official binaries (downloaded, hash-verified), laboratory PKI, daemon control scripts, the CLI control-plane stub and all raw artefacts |
| `audit/comparison.png` | Side-by-side original vs clone form screenshot |
| `audit/computed-styles.json` | Playwright computed-style comparison, original vs clone |
| `hasil-test.html` | Pre-generated web result, full chrome, self-contained |
| `hasil-test-clean.html` | Same result in clean/test-only mode |
| `hasil-test.json`, `hasil-test.txt` | Same result as JSON / plain text |
| `hasil-cli.json`, `hasil-cli.txt`, `hasil-cli-summary.txt` | CLI outputs |

## The laboratory

The official OoklaServer daemon and the official Speedtest CLI are
**proprietary and are not committed**. They are downloaded and
**SHA-256-verified** by a script:

```bash
sh lab/scripts/download-official.sh
sh lab/scripts/make-certs.sh
sh lab/scripts/start-daemon.sh https      # official daemon on 127.0.0.1:8080
python3 cli.py localhost:8080 --allow-private \
        --ca-bundle lab/certs/ca.crt --legacy-port 8080 --upload-mode auto
```

Against that genuine daemon the clone scores **19 PASSED / 0 FAILED**
(`lab/results/final-hosttester-tls.json`).

The official Speedtest CLI was pointed at the same daemon
(`sh lab/scripts/cross-validate-cli.sh https real`): exit code `0`,
`server.ip = 127.0.0.1`, and the result submission was intercepted locally
and refused with HTTP 503, so **no laboratory measurement was ever published**
(`result.persisted = false`).

## Caveat

This clone runs from the Arena sandbox, not from Ookla's regional watchdog servers. Ookla's monitoring can disagree with a result obtained here. The official result page is behind reCAPTCHA and cannot be observed without a valid token; the result layout here is an approximation based on the public Ookla Server Tester result schema. Exact server-side watchdog/HTTPS/KeepAlive criteria remain unverifiable.

The saved `hasil-*` artefacts were regenerated against the **laboratory daemon**
(`127.0.0.1:8080`, official OoklaServer 2.11.5.2) so that they are
reproducible from the current code; the original delivery's live run against
`host.yapsidarussalam.or.id:8080` produced **4 PASSED / 15 FAILED / 19 checks**
and is preserved in `lab/results/previous-session/`.

**Loopback throughput is not internet capacity.** The official CLI measured
10–12 GB/s over `lo` in the laboratory; that number says nothing about a real
link and is never presented as such.

See [`validation/FINAL_REPORT.md`](validation/FINAL_REPORT.md) for the full
assessment, the confirmed findings and the production-readiness verdict.
