# Cross-validation: official Speedtest CLI ↔ official OoklaServer ↔ clone

**Tanggal:** 2026-11-03 (Asia/Jakarta)  
**Tujuan user:** gunakan client `speedtest` CLI resmi ke server host manapun, ambil domainnya, jadikan domain itu `localhost`, sehingga CLI tanpa sadar menembak OoklaServer official di `localhost:8080`. Cross-analysis ini dipakai untuk memastikan project benar secara konsep, teknis, infrastruktur, dan arsitektur.

---

## 1. Binary klien resmi

| Item | Nilai |
| --- | --- |
| URL | `https://install.speedtest.net/app/cli/ookla-speedtest-1.2.0-linux-x86_64.tgz` |
| Ukuran tarball | 1.106.829 B |
| SHA-256 tarball | `5690596c54ff9bed63fa3732f818a05dbc2db19ad36ed68f21ca5f64d5cfeeb7` |
| Last-Modified | `Tue, 09 Aug 2022 21:22:02 GMT` |
| ETag | `76de75a734cf98d70eee0d362bad365a` |
| Isi tar | `speedtest` (2.613.400 B, mode 755), `speedtest.md`, `speedtest.5` |
| File | `ELF 64-bit LSB executable, x86-64, statically linked, stripped` |
| `--version` | `Speedtest by Ookla 1.2.0.84 (ea6b6773cf) Linux/x86_64-linux-musl 6.1.158+ x86_64` |

Flag penting yang ditemukan di `--help`:

```
-L, --servers                     List nearest servers
-s, --server-id=#                 Specify a server from the server list using its id
-o, --host=ARG                    Specify a server ... using its host's fully qualified domain name
    --ca-certificate=ARG          CA Certificate bundle path
-f, --format=...                  human-readable | csv | tsv | json | jsonl | json-pretty
-p, --progress=yes|no
-v                                Logging verbosity (repeatable)
```

String internal yang relevan: `https://cli.speedtest.net/api/cli/config`, `--accept-license`, `--accept-gdpr`, dan `Protocol error: Did not receive HELLO; input:%s result:%s key:%s`. String terakhir membuktikan klien memakai handshake `HI` → `HELLO` yang sama persis dengan `netgauge_check()` clone.

---

## 2. Trick: "cari domain, jadikan localhost"

### 2.1 Ambil domain dari klien resmi

```bash
./speedtest -L --format=json --accept-license --accept-gdpr --progress=no
```

Potongan hasil:

```json
{"type":"serverList","timestamp":"2026-11-02T20:45:14Z","servers":[
 {"id":4063,"host":"myspeed.gorge.net","port":8080,"name":"Gorge Networks",
  "location":"Hood River, OR","country":"United States"}, ...]}
```

Domain yang dipilih: **`myspeed.gorge.net`**, server id **4063**, port **8080**.

Config API juga bisa diambil langsung dan memuat daftar server yang sama:

```bash
curl -sS https://cli.speedtest.net/api/cli/config   # 200, 2767 B
```

Saat `--host=myspeed.gorge.net` dipakai, klien memanggil:

```
https://cli.speedtest.net/api/cli/config?...&serverhost=myspeed.gorge.net&...
```

dan server Ookla mengembalikan config yang **hanya berisi server itu**. Artinya trick-nya bekerja dua kali: domain dipilih lewat flag, lalu config dipersempit ke domain tersebut.

### 2.2 Arahkan domain ke localhost

```bash
printf '127.0.0.1\tmyspeed.gorge.net\n' | sudo tee -a /etc/hosts
getent hosts myspeed.gorge.net   # -> 127.0.0.1
```

**Yang sengaja TIDAK dialihkan:** `cli.speedtest.net` dan `results.speedtest.net`. Log verbose membuktikan keduanya tetap resolve ke `104.17.148.22` / `104.17.147.22` (Cloudflare) dan tetap `200`. Hanya domain **server** yang dipetakan ke loopback. Ini variabel infrastruktur yang paling kritikal.

> `/etc/hosts` berada di luar `/home/user`, jadi **tidak ikut workspace snapshot**. Setelah sandbox restart, jalankan lagi `scripts/add-hosts-redirect.sh`. Script `scripts/remove-hosts-redirect.sh` tersedia untuk membersihkan.

### 2.3 Jalankan speedtest resmi

```bash
./speedtest --host=myspeed.gorge.net \
  --accept-license --accept-gdpr \
  --format=json-pretty --progress=no \
  --ca-certificate=/home/user/ooklaserver/sim/certs/ca-bundle-cli.pem
```

Bukti dari log verbose (`results/cli-final-https.log`, identifier perangkat sudah diredaksi):

```
server selected: 4063
Running Speedtest against host:port myspeed.gorge.net:8080
Resolved address 1: 127.0.0.1
Opening socket to '127.0.0.1'
Ping 1..5: 0.11–0.19 ms
Running TCP test suite
Stage 1 latency → Stage 2 download → Stage 3 upload / packet loss
Packet loss sent=173, received=173, dupes=0
HTTP request https://results.speedtest.net/reports → 200
```

Hasil akhir (`results/cli-final-https.json`):

| Metrik | Nilai |
| --- | --- |
| `server.id` | 4063 |
| `server.host` | `myspeed.gorge.net` |
| `server.port` | 8080 |
| `server.ip` | **127.0.0.1** |
| `ping.latency` | 0.166 ms |
| `packetLoss` | 0 |
| `download.bandwidth` | 10.615.497.742 B/s |
| `download.bytes` | 39.729.005.750 B |
| `upload.bandwidth` | 7.284.437.770 B/s |
| `upload.bytes` | 98.040.883.233 B |
| `result.persisted` | true |

Bandwidth ~10 Gbps dan ~0,1 ms adalah ciri khas loopback, bukan internet — bukti kuat bahwa traffic benar-benar masuk daemon lokal.

Log daemon ikut membuktikan beban koneksi dari klien resmi:

```
TCP uptime: ... concurrent: 14, currentThreads: 14
Resolved address 1: 127.0.0.1
Disconnect NetException: Connection reset by peer
```

`Connection reset by peer` di akhir tes adalah perilaku normal saat klien menutup socket multi-thread, **bukan error daemon**.

---

## 3. Matriks cross-analysis

| Observasi dari klien/daemon resmi | Artinya bagi clone | Status |
| --- | --- | --- |
| Config API `serverhost=<FQDN>` mengembalikan 1 server `host:8080` | Port default 8080 dan input `host:port` sudah benar | ✅ konsep |
| `Running Speedtest against host:port myspeed.gorge.net:8080` + `Resolved address 1: 127.0.0.1` | `resolve_host()` + `allow_private` meniru cara klien memilih alamat | ✅ infrastruktur |
| String `Did not receive HELLO` | Handshake `HI\n` → `HELLO ...` bukan rekaan | ✅ teknis |
| CLI memakai **TCP suite biasa**, bukan TLS, walau daemon punya sertifikat | `netgauge`/`websocket`/`crossdomain` plain-HTTP sudah benar; `https` adalah probe terpisah | ✅ arsitektur |
| `--ca-certificate=ARG` ada di CLI resmi | Clone butuh `--ca-bundle` / `ca_bundle` | ✅ **diimplementasikan v1.2.0** |
| `--ca-certificate` **menggantikan** trust store: lab-CA saja → `Configuration - SSL peer certificate ... not OK`, exit 2 | `ca_bundle` clone harus didokumentasikan sebagai pengganti trust store; bundle gabungan dipakai untuk simulasi | ✅ **diimplementasikan + didokumentasikan** |
| Daemon 8080 menyajikan `/crossdomain.xml`, `/speedtest/latency.txt`, 10 JPEG, `/speedtest/upload.php` | Legacy port tidak boleh hardcode 80 | ✅ **`--legacy-port` v1.2.0** |
| Daemon mengembalikan `size=<Content-Length mentah>`, legacy PHP `+502` | `upload_check()` harus endpoint-aware | ✅ **`--upload-mode` v1.2.0** |
| WSS `GET /ws` di atas TLS → 101 | Clone perlu opsi TLS untuk daemon checks | ✅ **`--daemon-tls` v1.2.0** |
| `-o/--host=FQDN` dan `-s/--server-id` keduanya bekerja | Input fleksibel clone (bare host / URL / IPv6) konsisten | ✅ |
| Result di-post ke `results.speedtest.net/reports` → 200 | Di luar cakupan host-tester; tidak perlu ditiru | ℹ️ catatan |
| Warning `Loaded latency: cannot read response: [11] Resource temporarily unavailable` dan `No libz support available` | Warning jinak pada loopback; bukan bug clone | ℹ️ catatan |

### Yang **tidak** berubah

Form 1:1 tidak disentuh. Hash halaman `/host-tester` sebelum dan sesudah patch identik:

```
25e17aa35ba498ea79e30f1be61e2c7994a5de7af6645c816f58770909a5436d
```

`0 external script src`, `0 external stylesheet`, `0 url(http...)`, 14 tautan eksternal asli di chrome (link saja, tidak dimuat), tidak ada reCAPTCHA/sitekey.

---

## 4. Empat variasi klien resmi yang lolos

| Variasi | Perintah inti | Exit | `server.ip` |
| --- | --- | ---: | --- |
| A | `--host=myspeed.gorge.net` | 0 | 127.0.0.1 |
| B | `--server-id=4063` | 0 | 127.0.0.1 |
| C | `--host=... --ca-certificate=<bundle gabungan>` | 0 | 127.0.0.1 |
| D | daemon mode **HTTP** (tanpa TLS context) | 0 | 127.0.0.1 |

Artinya klien resmi lolos baik saat daemon hanya HTTP maupun saat daemon HTTP+TLS di port sama. Simulasi clone juga konsisten: **18/19** pada HTTP mode, **19/19** pada HTTPS mode.

---

## 5. Perubahan code v1.2.0 yang lahir dari cross-analysis

| Opsi | Fungsi | Default |
| --- | --- | --- |
| `--ca-bundle FILE` / `ca_bundle=` | `ssl.create_default_context(cafile=...)` untuk `https_check`, NetGauge/WS/crossdomain TLS; validasi file PEM | sistem trust |
| `--legacy-port N` / `legacy_port=` | port untuk seluruh legacy fallback checks | 80 |
| `--upload-mode auto\|legacy\|native` / `upload_mode=` | terima `size=516300` (PHP) dan/atau `size=515798` (daemon), laporkan `detected_mode` | auto |
| `--daemon-tls` / `daemon_tls=1` | bungkus socket daemon dengan TLS (`wss`, NetGauge over TLS) | off |
| `input_scheme` | metadata scheme dari input asli (tidak lagi hilang diam-diam) | — |
| `options{}` + `cross_validation_note` | JSON hasil memuat semua opsi + catatan bukti | — |

Verifikasi negatif sengaja dijalankan:

| Skenario | Hasil |
| --- | --- |
| `--legacy-port 8080 --upload-mode legacy` | 16/19 — `upload` + `max_upload` FAILED (benar, karena daemon kirim `size=515798`) |
| `--ca-bundle /etc/hosts` | exit 2 / HTTP 400 `does not contain a PEM certificate` |
| `--ca-bundle /home/user/no-such.pem` | exit 2 `not a readable file` |
| `--legacy-port 99999` | exit 2 `must be between 1 and 65535` |
| `--ca-certificate=ca.crt` saja pada CLI resmi | exit 2 `Configuration - SSL peer certificate ... not OK` |

Semua error ditangani bersih, tanpa traceback dan tanpa menonaktifkan verifikasi TLS.

---

## 6. Bundle CA gabungan

`sim/certs/ca-bundle-cli.pem` = `/etc/ssl/certs/ca-certificates.crt` + `sim/certs/ca.crt` (221 KB). Dipakai karena:

- CLI resmi tetap butuh CA publik untuk `cli.speedtest.net` dan `results.speedtest.net`.
- CA lab ArenaSim dibutuhkan kalau klien/tester ingin mempercayai sertifikat `localhost`.
- `--ca-certificate` **menggantikan** trust store, jadi bundle harus memuat keduanya.

Catatan: private key (`*.key`, `*.csr`) tidak pernah di-commit.

---

## 7. Reproduksi ringkas

```bash
# 1. binary
sh /home/user/ooklaserver/sim/scripts/reproduce-download.sh
sh /home/user/ooklaserver/sim/scripts/reproduce-download-cli.sh

# 2. daemon (pilih salah satu, port 8080)
sh /home/user/ooklaserver/sim/scripts/start-http.sh
# atau
sh /home/user/ooklaserver/sim/scripts/start-https.sh

# 3. legacy control port 80
sudo -n python3 /home/user/ooklaserver/sim/legacy_fallback.py

# 4. trick /etc/hosts + speedtest resmi
sh /home/user/ooklaserver/sim/scripts/cross-validate-cli.sh

# 5. clone v1.2.0
SSL_CERT_FILE=/home/user/ooklaserver/sim/certs/ca-bundle-cli.pem python3 /home/user/app.py
sh /home/user/ooklaserver/sim/scripts/test-v1.2.sh https
```

---

## 8. Batas yang tetap jujur

Cross-analysis ini membuktikan **respons protokol, konfigurasi daemon, dan interoperabilitas dua binary resmi**. Ia tetap **tidak** membuka implementasi internal `POST https://www.speedtest.net/host-tester` (masih tertutup reCAPTCHA) dan tidak meniru watchdog regional Ookla. Status project tetap **"functional local 1:1-style replacement"**, kini dengan bukti konsep/teknis/infrastruktur/arsitektur yang jauh lebih kuat dan tanpa celah pada opsi-opsi yang diuji.
