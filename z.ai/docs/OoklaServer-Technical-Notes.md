# Catatan Teknis — Lab OoklaServer Resmi & Host Tester

> Basis pengetahuan project **Speedtest Host Tester** (clone Ookla Server Tester + CLI).
> Disusun dari verifikasi langsung terhadap **binary OoklaServer resmi** yang dijalankan
> di lingkungan lab, bukan tebakan. Diperbarui: 2026-11-02.

---

## 1. Ringkasan

| Item | Nilai |
| --- | --- |
| Tujuan lab | Validasi engine Host Tester terhadap daemon OoklaServer **resmi** |
| Metode | Download binary official → konfigurasi → jalankan di `localhost:8080` → test via CLI & web |
| Hasil akhir | **10/10 cek PASS** (CLI & web, IPv4 & IPv6) — `Server is publicly available and properly configured.` |
| Kendala lab | Hanya port **8080** yang dapat diuji (TCP/UDP/HTTP/HTTPS/WS semuanya di port itu) |

---

## 2. Artefak Resmi (Binary)

| Variabel | Nilai |
| --- | --- |
| Channel | `stable` |
| URL x86_64 | `https://install.speedtest.net/ooklaserver/stable/OoklaServer-linux-x86_64-static-musl.tgz` |
| URL ARM64 | `https://install.speedtest.net/ooklaserver/stable/OoklaServer-linux-aarch64-static-musl.tgz` |
| Versi daemon | **2.11.5.2** build **2026-06-04.1737.7d0993d** |
| SHA256 tgz | `ce180aa3ed9b3c099713cf37ea2ded48c1f799f47c534ab732e21cea61598159` |
| Ukuran tgz | 4.911.401 bytes |
| Ukuran binary | 15.550.832 bytes (static musl, mandiri — tanpa dependensi sistem) |
| Isi paket | `OoklaServer` (binary) + `OoklaServer.properties.default` (contoh config resmi) |

**Penting:** build `2026-06-04.1737.7d0993d` ini **identik** dengan yang berjalan di
`host.yapsidarussalam.or.id:8080` dan di server produksi Ookla Hong Kong
(`1010.hkspeedtest.com.prod.hosts.ooklaserver.net`) — hasil handshake `HELLO` keduanya sama.
Artinya hasil lab ini merepresentasikan perilaku server produksi Anda saat ini.

---

## 3. Instalasi Lab

```
/home/z/my-project/ooklaserver/
├── OoklaServer                            # binary resmi (executable)
├── OoklaServer.properties                 # config aktif lab (dibaca dari CWD)
├── OoklaServer.properties.default         # contoh config resmi (REFERENSI)
├── OoklaServer-linux-x86_64-static-musl.tgz
├── cert.pem                               # sertifikat self-signed (TLS)
├── key.pem                                # private key
├── ooklaserver.log                        # log daemon (rotasi 10 MB)
└── ooklaserver.pid                        # PID parent
```

Daemon membaca `OoklaServer.properties` dari direktori kerja saat dijalankan.

---

## 4. Konfigurasi — Kamus Variabel Lengkap

### 4.1 Config aktif lab

```properties
OoklaServer.tcpPorts = 8080
OoklaServer.udpPorts = 8080
OoklaServer.useIPv6 = true
OoklaServer.clientAuthToken.denyInvalid = true
OoklaServer.enableAutoUpdate = false        # lab; produksi default true
openSSL.server.certificateFile = ${application.dir}/cert.pem
openSSL.server.privateKeyFile = ${application.dir}/key.pem
openSSL.server.minimumTLSProtocol = 1.2
# logging: ConsoleChannel + FileChannel (ooklaserver.log, rotasi 10 MB, kompres, simpan 10)
```

### 4.2 Kamus semua variabel (dari `OoklaServer.properties.default` resmi)

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `OoklaServer.tcpPorts` | `5060,8080` | Port TCP netgauge + HTTP + HTTPS + WS (multiplex di port yang sama). Wajib minimal 1. Port 5060 & 8080 wajib untuk server speedtest.net |
| `OoklaServer.udpPorts` | `5060,8080` | Port UDP netgauge |
| `OoklaServer.useIPv6` | `true` | Dengarkan IPv6 ([::]) selain IPv4 |
| `OoklaServer.allowedDomains` | `*` (semua) | Batasi akses per domain, mis. `*.ookla.com, *.speedtest.net` |
| `OoklaServer.userAgentFilterEnabled` | nonaktif | Filter user-agent "buruk". **Aktif di server produksi Ookla** — klien tanpa UA di-reset (terverifikasi empiris) |
| `OoklaServer.workerThreadPool.capacity` | `30000` | Kapasitas thread pool (maks `ulimit -n -H`) |
| `OoklaServer.workerThreadPool.stackSizeBytes` | `102400` | Stack size per thread |
| `OoklaServer.enableAutoUpdate` | `true` | Auto-update binary dari Ookla |
| `OoklaServer.ipTracking.gcIntervalMinutes` | `5` | Interval GC statistik IP |
| `OoklaServer.ipTracking.maxIdleAgeMinutes` | `35` | Maksimum umur statistik IP idle |
| `OoklaServer.ipTracking.slidingWindowBucketLengthMinutes` | `5` | Ukuran bucket jendela statistik |
| `OoklaServer.ipTracking.metricTopIpCount` | `5` | Jumlah IP teratas saat upload metrik |
| `OoklaServer.ipTracking.maxConnPerIp` | `500` | Maks koneksi bersamaan per IP (min 50, maks 10% kapasitas thread pool) |
| `OoklaServer.ipTracking.maxConnPerBucketPerIp` | `20000` | Maks upaya koneksi per bucket per IP (min efektif 200/menit) — **kemungkinan mekanisme pembatas yang perlu diwaspadai saat test berulang** |
| `OoklaServer.clientAuthToken.denyInvalid` | `true` | Tolak token klien invalid/expired; klien legacy **tanpa** token tetap boleh |
| `OoklaServer.websocket.frameSizeLimitBytes` | `5242880` (5 MB) | Batas ukuran frame websocket |
| `OoklaServer.http.maxHeadersSize` | `65536` | Batas total ukuran header HTTP(S) |
| `OoklaServer.ssl.useLetsEncrypt` | `true` | Generate sertifikat Let's Encrypt otomatis (butuh domain publik) |
| `openSSL.server.certificateFile` | — | Path sertifikat custom (menonaktifkan Let's Encrypt) |
| `openSSL.server.privateKeyFile` | — | Path private key |
| `openSSL.server.minimumTLSProtocol` | `1.2` | TLS minimum: `1.3`, `1.2`, `1.1`, `1.0` |
| `logging.loggers.*` | ConsoleChannel | Logging Poco: Console/FileChannel, level, rotasi, archive, compress, purgeCount |
| `logging.loggers.access.*` | nonaktif | Access log HTTP/WS (format: client, session, status, size, referer, useragent) |

---

## 5. Sertifikat TLS Self-Signed (Lab)

Perintah generate:

```bash
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 825 -nodes \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:0:0:0:0:0:0:0:1"
```

| Properti | Nilai |
| --- | --- |
| Subject | `CN=localhost` |
| SAN | `DNS:localhost, IP:127.0.0.1, IP:::1` |
| Masa berlaku | 2026-11-02 s.d. 2029-02-04 (825 hari) |
| SHA256 fingerprint | `E7:95:D5:56:18:A2:5C:B7:55:86:06:51:B2:2C:F4:1B:68:8B:17:A6:ED:1B:92:EE:2B:D8:5C:F7:B8:74:D6:14` |
| Catatan | Host Tester memakai `rejectUnauthorized:false` (verifikasi fungsionalitas TLS, bukan kepercayaan CA) — sama seperti perilaku "proceed anyway" browser / tester Ookla |

---

## 6. Menjalankan Daemon (Lab)

```bash
cd /home/z/my-project/ooklaserver

# start (background)
nohup ./OoklaServer > /tmp/ooklaserver-stdout.log 2>&1 & echo $! > ooklaserver.pid

# cek status / log
tail -f ooklaserver.log

# stop
kill $(cat ooklaserver.pid)          # daemon double-fork: parent + worker
pkill -f "OoklaServer"               # cara pamungkas
```

Perilaku start (hasil observasi):
- Daemon **double-fork** (PID parent 3626 → worker 3634), RSS ± 8,5 MB (sangat ringan).
- Membaca `OoklaServer.properties` dari CWD; tanpa file → `No config file found; using defaults`.
- Generate **2.097.152 bytes (2 MB) data random** untuk perintah `DOWNLOAD` netgauge.
- Mendengarkan `0.0.0.0:8080` + `[::]:8080` (TCP & UDP).
- Log periodik: `TCP port: 8080 - current/queued/blocked/queueFull/concurrent/currentThreads`.

> ⚠️ Proses di sandbox **tidak persisten antar sesi** — jika daemon mati, jalankan ulang
> perintah start di atas. Config, cert, dan binary tersimpan permanen.

---

## 7. Endpoint & Protokol Terverifikasi (Empiris)

### 7.1 HTTP (semua di port 8080)

| Endpoint | Metode | Respons | Catatan |
| --- | --- | --- | --- |
| `/` | GET | 200 `OoklaServer … It worked!` (109 B, text/html) | Identifikasi daemon |
| `/speedtest/latency.txt` | GET | 200 `test=test` (10 B, text/plain) | File latency legacy |
| `/speedtest/random{n}x{n}.jpg` | GET/HEAD | 200 image/jpeg + Content-Length | n = 350…4000 |
| `/speedtest/upload.php` | POST | 200 `size=<jumlah byte body>` | **GET → 404** (hanya POST) |
| `/speedtest/server.php` | GET | 404 | Tidak ada di daemon modern (legacy PHP saja) |
| `/crossdomain.xml` | GET | 200 policy XML | `allow-access-from domain="*"` |
| `/favicon.ico` | GET | 404 | Tidak dilayani daemon |
| `/ws` | WS upgrade | `101 Switching Protocols` | Endpoint netgauge websocket |
| Header umum | — | `Connection: Keep-Alive`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, CSP ketat | |

### 7.2 Ukuran file random (DETERMINISTIK per versi — identik di lab, server user, dan produksi HK)

| File | Bytes |
| --- | --- |
| random350x350.jpg | 245.388 |
| random500x500.jpg | 505.544 |
| random750x750.jpg | 1.118.012 |
| random1000x1000.jpg | 1.986.284 |
| random1500x1500.jpg | 4.468.241 |
| random2000x2000.jpg | 7.907.740 |
| random2500x2500.jpg | 12.407.926 |
| random3000x3000.jpg | 17.816.816 |
| random3500x3500.jpg | 24.262.167 |
| random4000x4000.jpg | 31.625.365 |

> Konsekuensi: ukuran file bisa dipakai sebagai **sidik jari versi daemon**. Jika Ookla
> merilis versi baru dan ukuran berubah, daftar ini perlu di-update.

### 7.3 Protokol netgauge (WebSocket `/ws`)

| Perintah (teks) | Respons | Keterangan |
| --- | --- | --- |
| `HI\n` | `HELLO 2.11 (2.11.5) 2026-06-04.1737.7d0993d` | Handshake + **versi daemon** |
| `PING 0 100\n` | `PONG <epoch-ms server>` | Latency RTT |
| `DOWNLOAD <n>\n` | frame biner tepat n byte (prefix `DOWNLOAD `) | Uji download netgauge |
| `UPLOAD <n>\n` + n byte biner | `OK <bytes> <epoch-ms>` | Uji upload netgauge |
| perintah tak dikenal | `ERROR` | |

- WS dan WSS **sama-sama diterima di port 8080** (multiplex protokol HTTP/TLS/WS pada satu port).
- Client→server wajib masked frame (RFC 6455); server→client unmasked.

---

## 8. Hasil Simulasi Host Tester (terhadap binary resmi di localhost:8080)

### 8.1 CLI (`speedtest-host-tester.mjs`)

```
✔ Hostname resolution ......................... PASS   ::1 / 127.0.0.1
✔ OoklaServer daemon connection ............... PASS   OoklaServer daemon detected (HTTP 200)
✔ OoklaServer daemon version .................. PASS   2.11 (2.11.5) 2026-06-04.1737.7d0993d
✔ Netgauge / WebSocket (port 8080) ............ PASS   wss://localhost:8080/ws · HI→HELLO, PING→PONG ok
✔ HTTPS functionality ......................... PASS   HTTPS 200 · TLSv1.3, CN=localhost, valid 825d
✔ Keep-Alive .................................. PASS   Connection: Keep-Alive
✔ Latency file (speedtest/latency.txt) ........ PASS   HTTP 200 · "test=test"
✔ Download image files (random*.jpg) .......... PASS   10/10 files (240 KB – 30.2 MB)
✔ Legacy HTTP upload script (upload.php) ...... PASS   HTTP 200 · size=265
✔ Crossdomain settings (crossdomain.xml) ...... PASS   HTTP 200 · policy found

Ping      0.1–0.2 ms (netgauge WebSocket PING)
Download  ±10.200 Mbps (4 thread, random4000x4000.jpg, 5,92 GB / 5,1 s — loopback)
Upload    ±2.400 Mbps (4 thread, chunk 4 MB, 2,71 GB / 5,1 s)
Verdict: ✔ Server is publicly available and properly configured.  (exit 0)
```

- `localhost:8080` → resolve **::1 (IPv6)**; `127.0.0.1:8080` → IPv4. Keduanya PASS.
- Mode `--json` valid untuk otomasi: `verdict.ok:true`.

### 8.2 Web UI

- Form → `localhost:8080` → semua cek hijau, verdict "All checks passed",
  metrik PING/DOWNLOAD/UPLOAD tampil, tabel 10 baris PASS. Tanpa error console.
- Screenshot acuan: `/tmp/ui-local-daemon.png` (sesi 2026-11-02).

### 8.3 Pembanding produksi (bukan lab)

`1010.hkspeedtest.com.prod.hosts.ooklaserver.net:8080` (Ookla HK): **10/10 PASS**,
download 613–780 Mbps, upload 270–285 Mbps, netgauge `wss://`, versi daemon sama.

---

## 9. Temuan Perilaku Penting (hasil penelusuran langsung)

1. **Filter User-Agent di produksi** — server produksi Ookla **me-reset koneksi** (ECONNRESET)
   dari klien WebSocket/HTTP tanpa header `User-Agent`. Server user (config default) tidak.
   → Host Tester selalu mengirim UA browser. Jika suatu saat server user mengaktifkan
   `userAgentFilterEnabled`, klien test non-browser tanpa UA akan gagal.
2. **Ukuran file random.jpg deterministik** per versi daemon (lihat 7.2) — cocok untuk
   fingerprinting versi.
3. **HTTP + HTTPS + WS multiplex di port yang sama** (8080) — daemon mendeteksi protokol
   per koneksi. Tidak ada `openHttpPort`/`openHttpsPort` terpisah di versi 2.11.
4. **Rate limit IP bawaan**: `maxConnPerIp=500`, `maxConnPerBucketPerIp=20000`,
   bucket 5 menit. Test berulang dari satu IP (mis. monitoring tiap menit) bisa tersangkut
   bucket limit — jika server tiba-tiba menolak setelah test masal, cek metrik ini.
5. **`upload.php` hanya menerima POST**; GET → 404. Respons `size=N` = panjang body.
6. Daemon **double-fork** saat start; `enableAutoUpdate=false` wajib di lab agar tidak
   menarik versi baru yang tidak terdokumentasi.
7. `clientAuthToken.denyInvalid=true` (default) tidak mengganggu klien legacy tanpa token.
8. Server user memakai **DDNS MikroTik** (`e1d80d9415dc.sn.mynetname.net`, A=125.164.215.24,
   ada AAAA Telkomsel). Saat sesi 2026-11-02 server sempat online (semua endpoint sehat)
   lalu **koneksi ditolak** — konsisten dengan pergantian IP dinamis/CGNAT, bukan salah
   konfigurasi daemon. Saat online kembali, semua cek diprediksi PASS (versi & perilaku
   identik dengan lab).
9. Sandbox lab **tidak punya rute IPv6 keluar** — server yang hanya terjangkau via AAAA
   tidak bisa diuji dari web app di sandbox (gunakan CLI dari jaringan yang sesuai).

---

## 10. Infrastruktur & Peta Project

```
/home/z/my-project/
├── src/
│   ├── lib/host-tester.ts            # ENGINE test (1134 baris) — semua cek + metodologi ukur
│   ├── lib/host-tester-types.ts      # tipe & konstanta bersama (daftar ukuran file, dll.)
│   ├── app/page.tsx                  # UI web (clone Ookla Server Tester)
│   ├── app/api/host-test/route.ts    # endpoint streaming NDJSON (?target=&ds=&us=&ls=)
│   └── cli/main.ts                   # sumber CLI
├── download/
│   ├── speedtest-host-tester.mjs     # CLI standalone (bundle engine, zero-dep, Node ≥18)
│   ├── README.md                     # panduan CLI
│   └── OoklaServer-Technical-Notes.md# dokumen ini
├── ooklaserver/                      # LAB: binary resmi + config + cert + log
└── scripts/
    ├── mock-ooklaserver.mjs          # mock daemon (untuk test tanpa binary resmi)
    ├── ws-probe*.mjs                 # skrip penelusuran protokol
    └── ws-debug-prod.mjs
```

- Web app: Next.js 16 (dev server port 3000, dijalankan otomatis environment).
- API test: `GET /api/host-test?target=localhost:8080&ds=10&us=10&ls=10`
  (NDJSON stream: `start|ip|check|phase|speed|ping-sample|log|done|error`).
- CLI: `node download/speedtest-host-tester.mjs <host[:port]> [--json] [--download s] [--upload s] [--samples n] [--timeout s]`
  exit code `0` = semua pass, `1` = ada gagal, `2` = salah pakai.

---

## 11. Checklist "Yang Perlu Di-update Nanti"

- [ ] **Upgrade binary OoklaServer** — cek `https://install.speedtest.net/ooklaserver/stable/`
      secara berkala; bandingkan SHA256 & versi `HELLO` saat handshake. Jika versi baru:
      ulangi prosedur lab (download → extract → jalankan → test) dan perbarui tabel 7.2.
- [ ] **Ukuran file random*.jpg** — jika berubah di versi baru, perbarui
      `SPEEDTEST_IMAGE_SIZES`/dokumentasi (engine tidak bergantung ukuran, hanya verifikasi keberadaan).
- [ ] **Sertifikat lab** — `cert.pem` kedaluwarsa **2029-02-04**; regenerate sebelum itu.
- [ ] **Server produksi user** — saat `host.yapsidarussalam.or.id:8080` online kembali,
      jalankan ulang CLI untuk hasil nyata; verifikasi versi `HELLO` masih 2.11.5.2.
- [ ] **DDNS/CGNAT** — pertimbangkan menyarankan user memasang DDNS-update yang benar
      (record A/AAAA selaras) atau IP statis agar host stabil.
- [ ] **Perubahan protokol** — jika Ookla mengubah perintah netgauge / endpoint legacy
      (mis. `upload.php` dihapus), update `src/lib/host-tester.ts` lalu rebuild CLI:
      `bun build src/cli/main.ts --target=node --format=esm --outfile=download/speedtest-host-tester.mjs`.
- [ ] **Filter UA** — jika user mengaktifkan `userAgentFilterEnabled`, pastikan UA browser
      tetap dikirim (sudah default di engine).

---

## 12. Cheat Sheet

```bash
# --- daemon lab ---
cd /home/z/my-project/ooklaserver
nohup ./OoklaServer > /tmp/ooklaserver-stdout.log 2>&1 &   # start
tail -f ooklaserver.log                                      # log
pkill -f OoklaServer                                         # stop

# --- test cepat ---
node download/speedtest-host-tester.mjs localhost:8080
node download/speedtest-host-tester.mjs localhost:8080 --json | jq '.verdict, .download.mbps, .upload.mbps'

# --- probe manual ---
curl -s http://localhost:8080/speedtest/latency.txt
curl -sI http://localhost:8080/speedtest/random4000x4000.jpg | grep -i content-length
curl -s -X POST -d "content1=abc" http://localhost:8080/speedtest/upload.php
curl -sk -o /dev/null -w "%{http_code}\n" https://localhost:8080/
curl -s -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
     -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" -H "Sec-WebSocket-Version: 13" \
     http://localhost:8080/ws | head -2

# --- rebuild CLI setelah edit engine ---
bun build src/cli/main.ts --target=node --format=esm --outfile=download/speedtest-host-tester.mjs
```

---

## 13. Cross-Validation dengan Client Resmi (2026-11-02, malam)

> Laporan lengkap + bukti mentah: `../cross-validation/README.md`.

**Client resmi** Ookla Speedtest CLI **1.2.0.84** (`ookla-speedtest-1.2.0-linux-x86_64.tgz`,
SHA256 `5690596c…d5cfeeb7`) diarahkan ke daemon lab via trik *domain→localhost*:
`/etc/hosts` tidak bisa ditulis di sandbox (tanpa root), jadi redirect dilakukan
di level config — entri server `1010.hkspeedtest.com:8080` (id 43356, pilihan
utama client sendiri) di-rewrite menjadi `localhost:8080` oleh proxy lokal,
dengan config asli yang diambil live memakai query string milik client
(license tetap genuine & lolos validasi).

### 13.1 Temuan utama

1. **Client resmi menyelesaikan test penuh** vs daemon lab: idle latency
   0,06 ms (jitter 0,01), download **67.478 Mbps** (89,1 GB), upload
   **45.092 Mbps** (55,7 GB), packet loss **0,0%**.
2. **Client resmi TIDAK menyentuh HTTP sama sekali** — access log kosong (0
   permintaan). Pure netgauge TCP/TLS + UDP (loaded latency). Daemon stdout:
   6–9 koneksi TCP konkuren. → Konsumen speedtest = netgauge; host tester =
   permukaan HTTP legacy + netgauge. Dua-duanya terbukti pada binary resmi
   yang sama oleh client asli masing-masing.
3. **Parameter engine asli (live)** dari `cli.speedtest.net/api/cli/config`
   (`../cross-validation/official-cli/engine-config-redacted.json`):
   `testDurationSeconds=15`, `threadCount=4`, `packetSizeBytes=32 MB`,
   `pingCount=5`, download `maxConnections=32` + scaling, `stableStop`
   aktif (phase download berhenti di 3,8 detik karena stabil), statistik
   latency = **IQM** + low/high/jitter.
4. **Bug nyata ditemukan & diperbaiki (engine v1.0.1):** target IPv6 literal
   (`[::1]:8080`) gagal 5 cek dengan `ERR_INVALID_URL` — URL HTTP dibangun
   tanpa bracket IPv6 (`http://::1:8080/…` invalid). Fix: helper `urlHost`
   yang membungkus literal IPv6 dengan `[…]` di semua konstruksi URL.
   Setelah fix: 10/10 PASS + regression battery hijau (127.0.0.1,
   localhost, full URL, input sampah → exit 2, host unreachable → JSON
   valid + exit 1).

### 13.2 Pola permintaan z.ai Host Tester (access log daemon, 2 run)

| Jumlah | Permintaan (URL-decoded) |
| ---: | --- |
| 2.758 | `POST /speedtest/upload.php?ck=<rand>` (chunk upload, cache-buster) |
| 800 | `GET /speedtest/random<N>x<N>.jpg?ck=<rand>` (chunk download) |
| 20 | `HEAD /speedtest/random350..4000.jpg` (cek 10 ukuran; Content-Length cocok tabel §7.2) |
| 20 | `GET /speedtest/latency.txt?ck=<rand>` (sampel latency HTTP) |
| 10 | frame WS netgauge `PING 0 100` |
| 2 | `HI` → `HELLO 2.11 (2.11.5) …` (deteksi versi) |
| 2 | `GET /ws` → `101` (upgrade WebSocket) |
| 8 | `GET /`, `GET /speedtest/latency.txt`, `POST /speedtest/upload.php`, `GET /crossdomain.xml` (cek) |

Semua permintaan mengirim User-Agent browser (syarat produksi, §9.1).

---

## 14. Round 4 (2026-11-03) — temuan lab baru (audit independen, engine v1.1.0)

> Bukti: `../lab/results/probe-protocol-8080.json`, `probe-cors-upload.json`,
> matriks lengkap di `../validation/PROTOCOL_MATRIX.md`.

1. **`GET /hi`** → `hello 2.11 (2.11.5) 2026-06-04.1737.7d0993d` (44 B) —
   endpoint versi via HTTP polos (adopsi: fallback deteksi versi di engine v1.1.0).
2. **HTTP tanpa header `User-Agent` → 500 Internal Server Error** (perilaku inti
   daemon, BUKAN filter opsional `userAgentFilterEnabled`; UA kosong `User-Agent:`
   tetap 200). Konsekuensi: UA wajib selalu dikirim — kini terverifikasi lebih kuat.
3. **Redirect nama-kanonik 307**: setiap GET HTTP-polos yang `Host`-nya tidak
   cocok dengan SAN sertifikat (port dibuang, bracket TIDAK dibuang) dijawab
   `307 → https://<nama-kanonik-cert>:<port>/`. `Host: [::1]:8080` → 307 meski
   `IP::1` ada di SAN. Upgrade WS `/ws` tetap jalan untuk Host tidak-cocok.
   Implikasi: target IPv6-literal/hostname-salah TIDAK bisa mencapai endpoint
   HTTP legacy di daemon 2.11 — engine v1.1.0 melaporkannya dengan penjelasan
   redirect, bukan error DNS menyesatkan (bug v1.0.1, FINDINGS Z-4.1).
4. **CORS**: `Origin: <nilai>` → `Access-Control-Allow-Origin: <nilai>` (reflektif,
   permissif); `Origin: null` / tanpa Origin → tanpa ACAO.
5. **`Range:` diabaikan** — GET random350 dengan `Range: bytes=0-1023` tetap
   mengembalikan body utuh 245.388 B tanpa `Content-Range`.
6. **Lantai TLS 1.2 dipaksakan server** — penawaran TLS 1.0/1.1 (SECLEVEL=0)
   ditolak `alert protocol version`; 1.2/1.3 diterima; verifikasi ketat
   (CA+hostname) terbukti lulus/gagal sesuai skenario sertifikat
   (valid/kedaluwarsa/hostname-salah — PKI lab `lab/scripts/gen-certs.sh`).
7. **UDP netgauge**: probe teks/binary naif tidak mendapat respons (protokol
   biner proprietary), namun CLI resmi mencatat `packetLoss: 0` ke daemon yang
   sama → jalur UDP hidup dengan framing yang benar (OBSERVASI).
8. **Netgauge TCP**: `DOWNLOAD 100000` = tepat 100.000 byte (prefix ASCII
   `DOWNLOAD ` 9 byte TERMASUK payload); `UPLOAD 2048` → `OK 2048 <epoch-ms>`
   (payload boleh satu burst maupun tertunda); `upload.php` → `size=` = jumlah
   byte body PERSIS (1009 → 1009).
9. **WS path-sensitive**: hanya `/ws` (dan `/ws/`) yang di-upgrade (101,
   accept-key valid); `/` → 200; path lain → 404 (case-sensitive).
10. **Cross-validation non-publishing (Round 4)**: CLI resmi 1.2.0.84
    menyelesaikan test penuh ke daemon lab (exit 0, server `localhost:8080`,
    latensi idle 0,053 ms, DL ≈64,8 Gbps, UL ≈47,9 Gbps, loss 0%) dengan
    **submission ke results.speedtest.net DIBLOKIR proxy** — tidak ada data
    artifisial yang dikirim publik. Delta access log = 0 (murni netgauge).
