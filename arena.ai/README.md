# Ookla Server Tester — local 1:1-style clone

A local replacement for `https://www.speedtest.net/host-tester`. After the end-to-end audit, the form page now uses the **original DOM structure, original CSS, original masthead/navigation/footer, original label/legend/button spacing, and original `POST /host-tester` contract**. The only removed UI is reCAPTCHA, advertising/consent banners, analytics and external network dependencies.

- **No reCAPTCHA** — widget, sitekey and `api.js` removed; an invisible spacer keeps the original vertical rhythm.
- **No banners** — no cookie/privacy modal, no ads, no GTM/analytics, no external scripts or stylesheets.
- **Only the test page** — add `?clean=1` to hide nav/footer and show the test-only view.
- **`cukup domain saja`** — `host`, `host:port`, `[IPv6]:port`, and full `http(s)://.../path?query` are accepted on **both web and CLI**; missing port defaults to `8080`.
- **Same backend checks** — recreated from Ookla docs, the downloadable OoklaServer bundle, the legacy fallback package and direct protocol observation.
- **CLI without a browser** — just pass a URL or hostname and get text/JSON results.

> "1:1" here means form-level DOM/CSS/geometry equivalence and a faithful functional reconstruction. It does **not** mean byte-identical to Ookla's hidden server-side implementation. See [`AUDIT.md`](AUDIT.md) for the exact matrix and limits.

## Run

```bash
cd /home/user
python3 app.py
```

Open `http://localhost:3000/host-tester`. In Arena the live preview is started automatically on port 3000.

Useful URLs:

| URL | Result |
| --- | --- |
| `GET /host-tester` | Original-style form with full masthead/nav/footer |
| `GET /host-tester?clean=1` | Test-only view; nav/footer hidden |
| `POST /host-tester` | Run test with `ookla-server=<target>` |
| `GET /host-tester?run=1&ookla-server=<target>` | Run test via GET, handy for screenshots |
| `GET /api/test?host=<target>` | Raw JSON result |

Optional query/POST flags: `allow_private=1|true|yes`, `clean=1|true|yes`.

Accepted target formats:

```text
host.yapsidarussalam.or.id                 -> host.yapsidarussalam.or.id:8080
host.yapsidarussalam.or.id:8080            -> unchanged
https://host.yapsidarussalam.or.id:8080/x  -> host.yapsidarussalam.or.id:8080
[2001:db8::1]:8080                        -> unchanged
```

This is intentionally more forgiving than the official form, which rejects bare hostnames and full URLs. The original `host:port` format still works exactly.

## CLI

Version `1.1.0`. No browser needed:

```bash
# host:port
./host-tester host.yapsidarussalam.or.id:8080

# full URL — scheme/path/query are ignored and recorded as a note
./host-tester 'https://host.yapsidarussalam.or.id:8080/path?x=1'

# bare hostname -> port defaults to 8080
./host-tester host.yapsidarussalam.or.id

# machine-readable output + save to a file
./host-tester host.yapsidarussalam.or.id:8080 --json --output hasil.json

# only the summary lines
./host-tester host.yapsidarussalam.or.id:8080 --summary

# local / not-yet-public lab server
./host-tester localhost:8080 --allow-private

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
| `--no-color` | disable ANSI status colors |
| `-q, --quiet` | suppress progress notes on stderr |
| `--version` | print CLI version |

Exit codes: `0` = all checks passed, `1` = at least one check failed, `2` = invalid input or test error.

## What the backend actually does

### OoklaServer / NetGauge TCP (on `host:port`)

1. **netgauge** — raw TCP connect, send `HI\n`, expect `HELLO <major> (<version>) <build>`, then `QUIT\n`.
2. **websocket** — HTTP/1.1 Upgrade to `GET /ws` with `Origin: https://www.speedtest.net`, verify `101 Switching Protocols` and `Sec-WebSocket-Accept`, send a masked text frame `HI\n`, expect `HELLO ...`.
3. **crossdomain** — `GET /crossdomain.xml`, parse `<allow-access-from domain=... to-ports=.../>`, require `*.ookla.com`, `*.speedtest.net`, `*.speedtestcustom.com` (or `*`) and the tested port.
4. **https** — strict TLS `GET /hi` on the same port with `ssl.create_default_context()`, expect `hello ...`. A self-signed/private certificate is FAILED unless its CA is explicitly trusted by the runtime (e.g. `SSL_CERT_FILE` pointing at a lab CA).

### HTTP Legacy Fallback (port 80 of the hostname)

The original tester uses `http://<hostname>/speedtest/upload.php`; the `:8080` daemon port is **not** reused by the clone. The official daemon does, however, serve the same legacy paths on 8080 — this is documented in the simulation addendum below.

1. **crossdomain** — `GET http://<hostname>/crossdomain.xml`.
2. **latency** — `GET /speedtest/latency.txt`, expect `test=test`.
3. **upload** — `POST /speedtest/upload.php` with `content1=<random>` sized so the legacy PHP script returns `size=516300`.
4. **max_upload** — same POST sized for `size=1981500`.
5. **image_sizes** — `GET` all ten `random{WxW}.jpg` files and compare actual byte counts with the official `http_legacy_fallback.zip` sizes.
6. **keepalive** — two sequential HTTP/1.1 requests on one TCP socket; verify reuse and a fast second response.

The legacy `upload.php` computes `500 + len(key) + len(value) + 3`; with key `content1` this is `value_length + 511`.

## Official-binary simulation (2026-11-03)

The assumptions above were tested against the real daemon, not guessed. See [`ooklaserver/sim/SIMULASI.md`](ooklaserver/sim/SIMULASI.md) and [`ooklaserver/sim/manifest.json`](ooklaserver/sim/manifest.json).

- Both official static-musl tarballs were downloaded; x86_64 `OoklaServer 2.11.5.2` was run with `-d` from `ooklaserver/sim/http` or `.../https`.
- Only `127.0.0.1:8080` was used for the daemon. A separate control server served `http_legacy_fallback.zip` on port 80.
- With the custom certificate, port 8080 accepted **plain HTTP, raw NetGauge, WebSocket, HTTPS, and WSS at the same time**.
- HTTP mode produced **18/19 PASSED** (only `https` failed). HTTPS mode with a locally trusted CA produced **19/19 PASSED**, exit code `0`.
- Strict TLS verification was kept; the lab CA was added to the system trust store and passed via `SSL_CERT_FILE`.

The simulation identified concrete code updates: preserve the URL scheme for daemon TLS checks, make the legacy port configurable, distinguish the legacy PHP `+502` upload formula from the daemon's raw `Content-Length` response, add WSS probing, and document `--ca-bundle`/`SSL_CERT_FILE`.

## Files

| File | Purpose |
| --- | --- |
| `app.py` | Web server, shared `normalize_target()`, shared test engine, renderers |
| `cli.py` | Command-line interface, v1.1.0 |
| `host-tester` | Executable wrapper for `cli.py` |
| `assets/chrome.html` | Original page shell (masthead, nav, footer, SVG symbols) with placeholders |
| `assets/form.html` | Original form markup, reCAPTCHA removed |
| `assets/inline.css` | Original Speedtest CSS + embedded fonts + minimal clone/result overrides |
| `assets/fonts/` | Locally downloaded Montserrat / gauge-mono font files |
| `ooklaserver/` | Official binaries, simulation configs, CA/certificates, control server, results and `SIMULASI.md` |
| `AUDIT.md` | Full end-to-end audit matrix, evidence and honest limitations |
| `audit/comparison.png` | Side-by-side original vs clone form screenshot |
| `audit/computed-styles.json` | Playwright computed-style comparison, original vs clone |
| `hasil-test.html` | Pre-generated web result, full chrome, self-contained |
| `hasil-test-clean.html` | Same result in clean/test-only mode |
| `hasil-test.json`, `hasil-test.txt` | Same result as JSON / plain text |
| `hasil-cli.json`, `hasil-cli.txt`, `hasil-cli-summary.txt` | CLI outputs |

## Caveat

This clone runs from the Arena sandbox, not from Ookla's regional watchdog servers. Ookla's monitoring can disagree with a result obtained here. The official result page is behind reCAPTCHA and cannot be observed without a valid token; the result layout here is an approximation based on the public Ookla Server Tester result schema. Exact server-side watchdog/HTTPS/KeepAlive criteria remain unverifiable. See `AUDIT.md`.

During the original delivery the target `host.yapsidarussalam.or.id:8080` produced **4 PASSED / 15 FAILED / 19 checks**. During the re-audit its port 8080 began resetting connections, so a fresh live run produces **1 PASSED / 18 FAILED**; the saved `hasil-test.*` / `hasil-cli.*` files preserve the successful original run. Port 80 still responds from an external fetch, so the change is on the target daemon/port, not in the clone.
