# Hasil simulasi & cross-validation

## A. Official Speedtest CLI → localhost OoklaServer

| File | Sumber | Ringkas |
| --- | --- | --- |
| `cli-cross-check.json` | `--host=myspeed.gorge.net` | exit 0, `server.ip=127.0.0.1`, 19-check baseline |
| `cli-cross-check.err` | stderr | notifikasi lisensi |
| `cli-serverid.json` | `--server-id=4063` | exit 0, `server.ip=127.0.0.1` |
| `cli-serverid.err` | stderr | kosong |
| `cli-ca-cert.json` | `--ca-certificate=ca-bundle-cli.pem` | exit 0, `persisted=true` |
| `cli-ca-cert.err` | stderr | kosong |
| `cli-http-mode.json` | daemon mode HTTP (tanpa TLS context) | exit 0, `server.ip=127.0.0.1` |
| `cli-http-mode.err` | stderr | kosong |
| `cli-final-https.json` | final HTTPS daemon + combined CA + `-v -v -v` | exit 0, ping 0,166 ms, dl 10,6 GB/s, ul 7,3 GB/s |
| `cli-final-https.log` | log verbose (identifier diredaksi) | `serverhost=`, `Resolved address 1: 127.0.0.1`, `reports → 200` |
| `cli-verbose.log` | log verbose run pertama (identifier diredaksi) | stage latency/download/upload/packet loss |
| `cli-config-api.json` | `GET https://cli.speedtest.net/api/cli/config` (licenseKey diredaksi) | daftar server resmi, `myspeed.gorge.net:8080` |
| `cli-server-list.json`, `.err` | `./speedtest -L --format=json` | daftar 10 nearest servers dari klien resmi; id 4063 `myspeed.gorge.net:8080` |

## B. Clone v1.1.0 — hasil simulasi awal

| File | Sumber | Ringkas |
| --- | --- | --- |
| `http-cli.json`, `.txt`, `.html`, `.err` | CLI `localhost:8080 --allow-private` | 18 PASSED / 1 FAILED / 19 |
| `http-api.json` | `/api/test?host=localhost:8080&allow_private=1` | 18/1/19 |
| `http-fullurl.txt` | CLI full URL | 18/1/19 |
| `https-cli.json`, `.txt`, `.html`, `.err` | CLI HTTPS + `SSL_CERT_FILE` | **19 PASSED / 0 FAILED / 19** |
| `https-api.json` | web API | **19/0/19** |
| `https-hostport.txt` | CLI `localhost:8080` tanpa scheme | **19/0/19** |
| `direct-8080-probes.json` | probe langsung HTTP ke daemon 8080 | `/`, `/hi`, crossdomain, latency, upload, 10 JPEG, keepalive |
| `direct-8080-https-probes.json` | probe langsung HTTPS + WSS | `/`, `/hi`, crossdomain, latency, upload, 2 JPEG, WSS |
| `server-logs.md` | log startup HTTP/HTTPS/legacy | konfirmasi TLS context dan binding |

## C. Clone v1.2.0 — hasil setelah perbaikan code

| File | Mode | Opsi | Hasil |
| --- | --- | --- | --- |
| `v1.2/http-default.*` | HTTP | default | 18/19 (`https` gagal) |
| `v1.2/http-legacy8080-auto.*` | HTTP | `--legacy-port 8080 --upload-mode auto` | 18/19, `detected_mode: native-daemon` |
| `v1.2/http-legacy8080-native.*` | HTTP | `--upload-mode native` | 18/19 |
| `v1.2/http-legacy8080-legacy.*` | HTTP | `--upload-mode legacy` | **16/19 — kontrol negatif**, upload+max_upload FAILED |
| `v1.2/http-api-legacy8080.json` | HTTP | `/api/test?legacy_port=8080&upload_mode=auto` | 18/19 |
| `v1.2/https-default.*` | HTTPS | `--ca-bundle` | **19/19** |
| `v1.2/https-ca-bundle.*` | HTTPS | `--ca-bundle` | **19/19** |
| `v1.2/https-daemon-tls.*` | HTTPS | `--ca-bundle --daemon-tls` | **19/19**, `transport : TLS` / `wss / TLS` |
| `v1.2/https-legacy8080.*` | HTTPS | `--legacy-port 8080 --upload-mode auto` | **19/19**, `detected_mode: native-daemon` |
| `v1.2/https-full-url.*` | HTTPS | input `https://localhost:8080/` | **19/19**, `input_scheme: https` |
| `v1.2/https-api-advanced.json` | HTTPS | `ca_bundle + legacy_port + upload_mode + daemon_tls=1` | **19/19** |
| `v1.2/invalid-*.txt` | — | opsi invalid | exit 2 / HTTP 400, pesan bersih |
| `v1.2/regression.txt` | — | regresi versi/form/API/target asli | semua lolos |
| `v1.2/regression-output.txt` | — | `-o` text output | tersimpan |

`.*` = `.json`, `.txt`, `.html` (kecuali disebut lain).

## D. Kontrak exit

- `0` = semua PASSED ( HTTPS mode 19/19 )
- `1` = ada FAILED ( HTTP mode 18/19, target publik 1/18 )
- `2` = input/opsi invalid atau error tes
- `400` = `/api/test` menerima opsi invalid dengan JSON `{"error": ...}`
