# Simulasi OoklaServer official — `localhost:8080`

**Tanggal:** 2026-11-03 (Asia/Jakarta)  
**Tujuan:** menggantikan dugaan tentang backend `/host-tester` dengan observasi nyata dari binary OoklaServer official yang dijalankan di sandbox.  
**Prinsip user:** jalankan OoklaServer di environment, pakai config benar, arahkan URL ke `localhost`, hanya port **8080** untuk daemon, sertifikat boleh dibuat sendiri, HTTP dan HTTPS bisa dilayani di port yang sama.  
**Status akhir:** simulasi HTTPS + legacy fallback control menghasilkan **19 PASSED / 0 FAILED / 19 checks** lewat CLI dan web API clone.

Dokumen ini menyimpan **semua variabel teknis, infrastruktur, dan informasi penting** supaya update berikutnya tidak lagi menebak. Data mesin lengkap ada di `manifest.json`.

---

## 1. Binary official yang diunduh

| Arsitektur | URL | Tarball | SHA-256 tarball | Binary | SHA-256 binary |
| --- | --- | ---: | --- | ---: | --- |
| Linux x86_64 static-musl | `https://install.speedtest.net/ooklaserver/stable/OoklaServer-linux-x86_64-static-musl.tgz` | 4.911.401 B | `ce180aa3ed9b3c099713cf37ea2ded48c1f799f47c534ab732e21cea61598159` | 15.550.832 B | `f19e5ed240dc185bcaf6ca96e0fa40d5ee53e3a543f4c562082ac0d8d92f027a` |
| Linux aarch64 static-musl | `https://install.speedtest.net/ooklaserver/stable/OoklaServer-linux-aarch64-static-musl.tgz` | 5.270.518 B | `c72b4f4380f5fed6d43a6a1460055de0d43149cba178c0ebde7ba6af12061615` | 13.824.464 B | `f7fd93c377ac4b7640a8b1ddba1f87254cd731e6d0d73111588a6dda9780edaa` |

Header HTTP keduanya: `Last-Modified: Thu, 18 Jun 2026 21:46:26 GMT`, `Content-Type: application/x-tar`. ETag x86_64 `edf490f4a7a2d204e3989d1e9c368a3f`, aarch64 `ea7c713f97a9ebe0666d6785ae3fef22`.

Isi tiap tarball hanya 2 file: `OoklaServer` (mode 755) dan `OoklaServer.properties.default` (5.869 B, mode 644). Binary x86_64: `ELF 64-bit LSB pie executable, x86-64, static-pie linked, stripped`, `ldd` → `statically linked`. Binary aarch64 sama tetapi ARM aarch64. Sandbox adalah **x86_64**, jadi yang dijalankan adalah binary x86_64; aarch64 disimpan untuk referensi/perbandingan.

---

## 2. Identitas daemon

```
./OoklaServer --version
No config file found; using defaults
2.11.5.2 2026-06-04.1737.7d0993d

./OoklaServer --help
usage: OoklaServer OPTIONS
The Ookla Daemon - Build 2026-06-04.1737.7d0993d
  --daemon   --umask=mask   --pidfile=path
  -h/--help  -v/--version   -d/--develop (disable forking and updates)
```

Log startup:

```
OoklaServer version 2.11 (2.11.5.2) build number 2026-06-04.1737.7d0993d
OoklaServer instance ID 47c99578-...   (HTTP run)
OoklaServer instance ID 294480e3-...   (HTTPS run)
Generating 2097152 bytes of download data
Listening on TCP socket: 127.0.0.1:8080
Listening on UDP socket: 127.0.0.1:8080
Server updates were disabled.
```

Respon protokol:

- Raw TCP `HI\n` → `HELLO 2.11 (2.11.5) 2026-06-04.1737.7d0993d\n`
- `GET /hi` → `hello 2.11 (2.11.5) 2026-06-04.1737.7d0993d\n` (44 B, `text/plain; charset=UTF-8`)
- `GET /` → 109 B HTML `It worked!`
- `GET /crossdomain.xml` → 115 B, `<allow-access-from domain="*" to-ports="8080"/>`
- `GET /ws` + Upgrade + masked `HI\n` → `101 Switching Protocols`, frame `HELLO ...`
- `GET /speedtest/latency.txt` → `test=test\n` (10 B)

Catatan: target publik lama `host.yapsidarussalam.or.id:8080` sebelumnya melaporkan versi `2.11.5` dengan build sama, jadi binary ini sangat dekat dengan target.

---

## 3. Infrastruktur sandbox

| Variabel | Nilai |
| --- | --- |
| Kernel | `Linux e2b.local 6.1.158+ x86_64 GNU/Linux` |
| Arsitektur | x86_64 |
| User | `user` (sudo tanpa password tersedia) |
| OpenSSL | `OpenSSL 3.5.7 9 Jun 2026` |
| App clone | `0.0.0.0:3000` |
| OoklaServer | `127.0.0.1:8080` TCP + UDP |
| Legacy control | `127.0.0.1:80` TCP (server Python terpisah) |
| Port 5060 | **sengaja tidak dipakai** |
| Port 80/443 untuk daemon | **tidak dipakai**; port 80 hanya control legacy |
| Preview proxy Arena | `169.254.0.21:8080` muncul di daftar port platform, tetapi daemon sendiri bind `127.0.0.1` |
| Env app saat HTTPS | `SSL_CERT_FILE=/home/user/ooklaserver/sim/certs/ca.crt` |

Proses dijalankan dengan `-d` (develop mode) supaya tidak fork dan tidak auto-update. `stop_process` sekali tidak mematikan daemon (SIGTERM diabaikan), sehingga diperlukan `kill -TERM 7207` lalu `kill -KILL 7207`. Ini dicatat sebagai variabel operasional.

---

## 4. Konfigurasi `OoklaServer.properties`

File diletakkan **di working directory** binary; `--version` dari direktori tersebut mencetak `Loaded config file: .../OoklaServer.properties`. Nama file harus persis `OoklaServer.properties`, bukan `.default`.

### Mode HTTP — `sim/http/OoklaServer.properties`

```properties
OoklaServer.tcpPorts = 8080
OoklaServer.udpPorts = 8080
OoklaServer.httpPorts = 8080
OoklaServer.useIPv4 = true
OoklaServer.useIPv6 = false
OoklaServer.addresses = 127.0.0.1
OoklaServer.allowedDomains = *
OoklaServer.enableAutoUpdate = false
OoklaServer.ssl.useLetsEncrypt = false
OoklaServer.clientAuthToken.denyInvalid = true
OoklaServer.websocket.frameSizeLimitBytes = 5242880
OoklaServer.http.maxHeadersSize = 65536
openSSL.server.minimumTLSProtocol = 1.2
logging.loggers.app.name = Application
logging.loggers.app.channel.class = ConsoleChannel
logging.loggers.app.channel.pattern = %Y-%m-%d %H:%M:%S [%P - %I] [%p] %t
logging.loggers.app.level = information
```

### Mode HTTPS — `sim/https/OoklaServer.properties`

Sama seperti HTTP, ditambah:

```properties
openSSL.server.certificateFile = /home/user/ooklaserver/sim/certs/fullchain.pem
openSSL.server.privateKeyFile = /home/user/ooklaserver/sim/certs/server.key
```

Log HTTPS:

```
Initializing TLS context with provided certificate '/home/user/ooklaserver/sim/certs/fullchain.pem'
Successfully loaded certificate chain with 1 intermediate certificate(s)
Initializing TLS context with provided key '/home/user/ooklaserver/sim/certs/server.key'
Server is configured to require minimum TLS version of 1.2
CA bundle is empty; skipping
TLS context initialized using user-defined certificate <0a:c0:6f:87:...>
```

Log HTTP mode justru: `CA bundle is empty; skipping` dan saat ada koneksi TLS masuk: `Can't accept TLS connection; TLS context is not initialized`.

### Variabel config penting dari `OoklaServer.properties.default`

- Default `OoklaServer.tcpPorts = 5060,8080`, `OoklaServer.udpPorts = 5060,8080`.
- `OoklaServer.useIPv6 = true` sudah aktif di default 2.11; simulasi memaksa `false` karena route IPv6 sandbox terbatas.
- `OoklaServer.allowedDomains` default `*` (komentar menyarankan `*.ookla.com, *.speedtest.net`).
- `OoklaServer.enableAutoUpdate = true` default; simulasi `false`.
- `OoklaServer.ssl.useLetsEncrypt = true` default; simulasi `false` karena tidak ada registrasi host Ookla.
- `openSSL.server.certificateFile` / `privateKeyFile` menonaktifkan Let's Encrypt.
- `openSSL.server.minimumTLSProtocol = 1.2` (opsi `1.3|1.2|1.1|1.0`).
- `OoklaServer.clientAuthToken.denyInvalid = true`; klien legacy tanpa token tetap boleh.
- `OoklaServer.websocket.frameSizeLimitBytes = 5242880` (5 MB).
- `OoklaServer.http.maxHeadersSize = 65536`.
- Key lain yang terlihat di binary: `OoklaServer.addresses`, `OoklaServer.httpPorts`, `OoklaServer.useIPv4`, `OoklaServer.excludeDefaultDomains`, `OoklaServer.ipTracking.*`, `OoklaServer.workerThreadPool.*`, `OoklaServer.ssl.letsEncryptRetry*`, `OoklaServer.host.id/password`, `OoklaServer.apiUrl`, `OoklaServer.hostApiUrl`, `OoklaServer.resultEndpointUrl`, `OoklaServer.adminPassword`, `OoklaServer.performTraceroutes`, `OoklaServer.maxConnectionSeconds`, `OoklaServer.sendStatsInterval`, `OoklaServer.updateRequest*`.

Dokumentasi Ookla yang dipakai: [HTTPS/TLS support](https://support.ookla.com/hc/en-us/articles/44460782741649-How-do-I-enable-HTTPS-TLS-support), [Required protocols/ports](https://support.ookla.com/hc/en-us/articles/44460767382289-Which-Protocols-and-Ports-am-I-Required-to-Use), [Properties options](https://support.ookla.com/hc/en-us/articles/44460781345169-OoklaServer-Properties-Options), [Basic config](https://support.ookla.com/hc/en-us/articles/44460805417361-Basic-Server-Daemon-Configuration-Options), [Advanced config](https://support.ookla.com/hc/en-us/articles/44460770473745-Advanced-Server-Daemon-Configuration). Artikel lama `234577948` sudah 404; URL penggantinya di atas.

---

## 5. Sertifikat lokal

Dibuat CA sendiri + server cert, bukan Let's Encrypt.

| Item | Nilai |
| --- | --- |
| CA | `C=ID, ST=East Java, L=Malang, O=ArenaSim, OU=OoklaServer Simulation, CN=ArenaSim Root CA` |
| Server | `C=ID, ST=East Java, L=Malang, O=ArenaSim, OU=OoklaServer Simulation, CN=localhost` |
| SAN | `DNS:localhost, IP:127.0.0.1, IP:::1` |
| Validitas | 2026-11-02 19:41:37 GMT → 2029-02-04 19:41:37 GMT |
| Key | RSA 2048, `server.key` |
| Chain | `fullchain.pem = server.crt + ca.crt` |
| Trust | `sudo cp ca.crt /usr/local/share/ca-certificates/ooklaserver-sim.crt && sudo update-ca-certificates` |
| Env | `SSL_CERT_FILE=/home/user/ooklaserver/sim/certs/ca.crt` untuk app dan CLI |
| Hasil `openssl s_client` | `TLSv1.3`, `TLS_AES_256_GCM_SHA384`, `Verify return code: 0 (ok)` |

Clone memakai `ssl.create_default_context()`; env `SSL_CERT_FILE` dan CA sistem membuat `https_check` **PASSED** tanpa mematikan verifikasi. Ini penting: kita tidak menonaktifkan TLS verification, kita hanya menambahkan CA lab ke trust store.

### Temuan penting: HTTP + HTTPS di port yang sama

Dengan custom cert, `127.0.0.1:8080` menerima **dua-duanya secara bersamaan**:

- Plain HTTP `GET /hi` → 200
- TLS `GET /hi` → 200
- Raw TCP NetGauge `HI\n` → `HELLO ...`
- Plain WebSocket `GET /ws` → 101
- WSS `GET /ws` di atas TLS → 101, frame `HELLO ...`, cipher `TLS_AES_256_GCM_SHA384`
- HTTPS `GET /crossdomain.xml`, `/speedtest/latency.txt`, `/speedtest/random*.jpg` → 200

Artinya OoklaServer melakukan protocol sniffing pada byte pertama di socket 8080. Ini menjawab kalimat user: "Bisa http atau https dilayani di port yang sama".

---

## 6. HTTP Legacy Fallback — control server port 80

User membatasi **daemon** hanya di 8080. Tetapi clone kita, mengikuti skema hasil publik Scribd, selalu mem-probe legacy fallback di **port 80 hostname**. Supaya simulasi bisa mencapai hasil penuh, saya jalankan **server kontrol terpisah** di `127.0.0.1:80` yang menyajikan paket official `http_legacy_fallback.zip`. Ini bukan OoklaServer dan bukan pelanggaran batas port 8080 untuk daemon.

| Variabel | Nilai |
| --- | --- |
| URL zip | `http://speedtest.lungit.com/http_legacy_fallback.zip` |
| Ukuran zip | 98.914.155 B |
| SHA-256 zip | `e77a8fc73dbf725c6d529b389e2fa0af61fbad9be2240d79dc6db078f245463d` |
| Uncompressed | 102.345.454 B / 16 file |
| Lokasi | `/home/user/.cache/http_legacy_fallback.zip` (`.cache` excluded dari snapshot) |
| Manifest | `sim/legacy/legacy-files.sha256` |
| Server | `sim/legacy_fallback.py`, `ThreadingHTTPServer`, `HTTP/1.1`, keep-alive |
| Bind | `127.0.0.1:80` via `sudo -n python3 ...` |
| crossdomain | `*.speedtest.net`, `*.ookla.com` |
| latency | `test=test` |
| upload.php | `size = 500 + Σ(strlen(key)+strlen(value)+3)` |
| JPEG | 10 file `random{WxW}.jpg` dengan ukuran persis sama seperti skema Scribd |

Bukti upload.php control:

```
body 10 B        -> size=512
body 515.798 B   -> size=516300   (dipakai clone untuk `upload`)
body 1.980.998 B -> size=1981500  (dipakai clone untuk `max_upload`)
```

Skema hasil publik: [Scribd Ookla Server Tester](https://www.scribd.com/document/719336642/Ookla-Server-Tester) — `http://<bare-host>/speedtest/upload.php`, `size=516300`, `size=1981500`, sepuluh `image_sizes`, `keepalive`.

### Perbedaan endpoint upload: WAJIB dicatat

| Endpoint | Perilaku `size=` |
| --- | --- |
| Legacy PHP di port 80 | `500 + len(key)+len(value)+3`; body 515798 → `size=516300` |
| OoklaServer daemon di port 8080 | mengembalikan **Content-Length mentah**; body 515798 → `size=515798`, body 516300 → `size=516300` |

Clone saat ini memakai algoritma legacy PHP karena menembak port 80. Itu benar untuk control server, tetapi **berbeda** jika suatu hari legacy fallback diarahkan ke port 8080. Ini salah satu hal yang perlu di-update.

---

## 7. Hasil simulasi terhadap clone

### Mode HTTP (daemon tanpa TLS) + legacy control

| Kanal | Hasil | Exit |
| --- | --- | ---: |
| CLI `./host-tester localhost:8080 --allow-private --json` | **18 PASSED / 1 FAILED / 19** | 1 |
| Web `/api/test?host=localhost:8080&allow_private=1` | **18 PASSED / 1 FAILED / 19** | 200 |
| Full URL `http://localhost:8080/path?x=1` | 18/1/19, path/query dicatat lalu diabaikan | 1 |

Yang gagal hanya `https`: daemon tidak punya TLS context, log `Can't accept TLS connection; TLS context is not initialized`. Semua 18 check lain lolos, termasuk 10 subrow `image_sizes`, `upload`, `max_upload`, dan `keepalive`.

### Mode HTTPS (daemon + custom cert, CA dipercaya) + legacy control

| Kanal | Hasil | Exit |
| --- | --- | ---: |
| CLI `https://localhost:8080/` + `SSL_CERT_FILE` | **19 PASSED / 0 FAILED / 19** | 0 |
| CLI `localhost:8080` (tanpa scheme) | **19 PASSED / 0 FAILED / 19** | 0 |
| Web `/api/test?host=localhost:8080&allow_private=1` | **19 PASSED / 0 FAILED / 19** | 200 |

Ini adalah simulasi "real" pertama yang memberi hasil sempurna tanpa melemahkan verifikasi TLS.

Artefak:

- `results/http-cli.json`, `.txt`, `.html`, `.err`
- `results/http-api.json`
- `results/http-fullurl.txt`
- `results/https-cli.json`, `.txt`, `.html`, `.err`
- `results/https-api.json`
- `results/https-hostport.txt`
- `results/direct-8080-probes.json` — probe langsung HTTP ke daemon 8080
- `results/direct-8080-https-probes.json` — probe langsung HTTPS/WSS ke daemon 8080

---

## 8. Daftar hal yang perlu di-update nantinya

1. **Scheme/TLS hint hilang saat normalisasi.** `normalize_target()` membuang `https://`, sehingga `netgauge`, `websocket`, dan `crossdomain` selalu memakai plain HTTP. Untuk server yang benar-benar TLS-only, ini akan gagal. Perlu flag seperti `--tls-daemon` atau menyimpan scheme sebagai metadata.
2. **Legacy fallback port hardcoded 80.** OoklaServer 2.11 ternyata juga menyajikan `/crossdomain.xml`, `/speedtest/latency.txt`, `/speedtest/upload.php`, dan sepuluh JPEG di **8080**. Skema Scribd memakai port 80. Perlu opsi `legacy_port` / probe keduanya, bukan hardcoded.
3. **Algoritma upload berbeda per endpoint.** Legacy PHP `+502`; daemon `size=Content-Length`. `upload_check()` harus tahu endpoint mana yang ditembak.
4. **CA bundle untuk lab.** Tambahkan `--ca-bundle` / `SSL_CERT_FILE` eksplisit ke CLI dan dokumentasi web, supaya tidak bergantung pada `update-ca-certificates` sistem.
5. **WSS.** Clone baru menguji `ws://`; padahal daemon mendukung `wss://` di port sama. Perlu probe keduanya saat TLS aktif.
6. **`allow_private` wajib untuk localhost.** Sudah ada, tapi harus tetap dipanggil dalam semua script CI/simulasi.
7. **Auto-update & Let's Encrypt harus mati di lab.** Jika tidak, binary mencoba `host-api.speedtest.net` dan dapat mengganti dirinya sendiri.
8. **Lifecycle proses.** `-d` lebih aman, tetapi SIGTERM kadang diabaikan; script stop harus fallback ke `kill -KILL`.
9. **Ukuran artefak.** Zip legacy 95 MB dan browser headless 681 MB tidak boleh masuk repo perbandingan; simpan di `.cache`/`/tmp` atau unduh ulang.
10. **Versi binary.** `2.11.5.2` / build `2026-06-04.1737.7d0993d` adalah baseline. Jika `stable` berganti, bandingkan SHA-256, `--version`, dan `HELLO` sebelum memperbarui ekspektasi tester.

---

## 9. Cara reproduksi

```bash
# 1. Unduh dua binary official
cd /home/user/ooklaserver && ./sim/scripts/reproduce-download.sh

# 2. CA + server cert sudah ada di sim/certs; jika ulang:
#    openssl req ... ; sudo update-ca-certificates

# 3. Jalankan legacy control (port 80)
sudo -n python3 /home/user/ooklaserver/sim/legacy_fallback.py

# 4. Jalankan daemon HTTP atau HTTPS (port 8080)
cd /home/user/ooklaserver/sim/http  && /home/user/ooklaserver/x86_64/OoklaServer -d
# atau
cd /home/user/ooklaserver/sim/https && /home/user/ooklaserver/x86_64/OoklaServer -d

# 5. Jalankan app clone dengan CA lab
SSL_CERT_FILE=/home/user/ooklaserver/sim/certs/ca.crt python3 /home/user/app.py

# 6. Uji
./host-tester localhost:8080 --allow-private --json
curl 'http://127.0.0.1:3000/api/test?host=localhost:8080&allow_private=1'
```

Script pendek ada di `scripts/`. Log kunci startup ada di `results/server-logs.md`.

---

## 10. Sumber

- Binary x86_64/aarch64 static-musl: `https://install.speedtest.net/ooklaserver/stable/...`
- `OoklaServer.properties.default` dari tarball official
- Ookla Support: HTTPS/TLS, required ports, properties options, basic/advanced daemon config (URL di bagian 4)
- Scribd `719336642` untuk skema hasil `Test results`
- `http://speedtest.lungit.com/http_legacy_fallback.zip` untuk paket legacy
- Observasi langsung: `strings`, `--version`, `--help`, `ss`, `openssl s_client`, raw socket, WebSocket/WSS, `curl`, CLI clone, `/api/test` clone
