# Hasil simulasi

| File | Sumber | Ringkas |
| --- | --- | --- |
| `http-cli.json` | CLI `localhost:8080 --allow-private --json` | 18 PASSED / 1 FAILED / 19 |
| `http-cli.txt` | `format_text()` dari JSON di atas | Teks lengkap |
| `http-cli.html` | `render_results(clean=True)` | Halaman hasil self-contained |
| `http-cli.err` | stderr CLI | Kosong / progress dimatikan dengan `-q` |
| `http-api.json` | `GET /api/test?host=localhost:8080&allow_private=1` | 18/1/19 |
| `http-fullurl.txt` | CLI `http://localhost:8080/path?x=1 --summary` | 18/1/19, path/query diabaikan |
| `https-cli.json` | CLI `https://localhost:8080/ --allow-private --json` + `SSL_CERT_FILE` | **19 PASSED / 0 FAILED / 19** |
| `https-cli.txt` | Teks lengkap hasil HTTPS | 19/0/19 |
| `https-cli.html` | Halaman hasil HTTPS, clean mode | 19/0/19 |
| `https-cli.err` | stderr CLI HTTPS | Kosong |
| `https-api.json` | Web API dengan app memakai CA lab | **19/0/19** |
| `https-hostport.txt` | CLI `localhost:8080` tanpa scheme | **19/0/19** |
| `direct-8080-probes.json` | Probe langsung HTTP ke daemon 8080 | `/`, `/hi`, crossdomain, latency, upload, 10 JPEG, keepalive |
| `direct-8080-https-probes.json` | Probe langsung HTTPS + WSS ke daemon 8080 | `/`, `/hi`, crossdomain, latency, upload, 2 JPEG, WSS |
| `server-logs.md` | Log startup HTTP/HTTPS/legacy | Kunci konfirmasi TLS context dan binding |

Exit code: `1` jika ada FAILED (HTTP mode), `0` jika semua PASSED (HTTPS mode). Ini sesuai kontrak CLI v1.1.0.
