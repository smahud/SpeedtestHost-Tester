# Ringkasan simulasi & cross-validation OoklaServer official

Dokumen lengkap: [`ooklaserver/sim/SIMULASI.md`](ooklaserver/sim/SIMULASI.md)  
Cross-analysis CLI resmi: [`ooklaserver/sim/CROSS_VALIDATION.md`](ooklaserver/sim/CROSS_VALIDATION.md)  
Variabel mesin: [`ooklaserver/sim/manifest.json`](ooklaserver/sim/manifest.json)  
Hasil 19/19: [`ooklaserver/sim/results/v1.2/https-ca-bundle.html`](ooklaserver/sim/results/v1.2/https-ca-bundle.html)

## Ringkas

- Binary official x86_64 + aarch64 static-musl diunduh dari dua URL yang diberikan user; SHA-256 dan versi `2.11.5.2` / build `2026-06-04.1737.7d0993d` dicatat.
- Binary x86_64 dijalankan dengan `-d` dari `ooklaserver/sim/http` atau `.../https`; config benar terbaca dari working directory.
- Daemon hanya di `127.0.0.1:8080` TCP+UDP. Port 5060/80/443 tidak dipakai daemon.
- Target diarahkan ke `localhost:8080`; `allow_private` dipakai karena loopback.
- Sertifikat CA + server dibuat sendiri; CA dipercaya via system trust dan `SSL_CERT_FILE`; verifikasi TLS **tidak** dimatikan.
- Terverifikasi: port 8080 melayani HTTP, raw NetGauge, WebSocket, HTTPS, dan WSS **sekaligus** saat custom cert aktif.
- Control server terpisah di port 80 menyajikan `http_legacy_fallback.zip` untuk 10 legacy checks.
- **Cross-validation:** official Speedtest CLI `1.2.0.84` → `./speedtest -L` memberi `myspeed.gorge.net:8080` → `/etc/hosts` memetakan domain itu ke `127.0.0.1` → CLI speedtest penuh ke daemon lokal, 4 variasi **exit 0**, `server.ip=127.0.0.1`. `cli.speedtest.net` / `results.speedtest.net` sengaja tidak dialihkan.
- Hasil clone: mode HTTP **18/19**, mode HTTPS **19/19 PASSED** (exit 0), lewat CLI dan `/api/test` — sebelum dan sesudah v1.2.0.

## Status code v1.2.0 (semua sudah diimplementasikan)

| Temuan dari cross-analysis | Implementasi |
| --- | --- |
| CLI resmi punya `--ca-certificate` yang menggantikan trust store | `--ca-bundle FILE` / `ca_bundle=` dengan validasi PEM, verifikasi tidak pernah dimatikan |
| Daemon 8080 juga menyajikan `/speedtest/*` | `--legacy-port N` / `legacy_port=` (default 80) |
| Daemon `size=Content-Length`, legacy PHP `+502` | `--upload-mode auto\|legacy\|native` + `detected_mode` |
| WSS bekerja di port sama | `--daemon-tls` / `daemon_tls=1` (`wss`) |
| Scheme `https://` hilang saat normalisasi | `input_scheme` metadata + `options{}` di JSON hasil |

Form 1:1 tidak berubah — hash halaman sebelum/sesudah patch identik `25e17aa35ba498ea79e30f1be61e2c7994a5de7af6645c816f58770909a5436d`. Regresi versi, invalid input, API, `-o`, target publik asli, dan HTML statis semuanya lolos.

## Yang masih terbuka / operasional

1. Implementasi internal `POST https://www.speedtest.net/host-tester` tetap tertutup reCAPTCHA; watchdog regional Ookla tidak bisa direproduksi.
2. Redirect `/etc/hosts` berada di luar workspace snapshot; jalankan `ooklaserver/sim/scripts/add-hosts-redirect.sh` lagi setelah restart sandbox.
3. `--ca-certificate` / `--ca-bundle` menggantikan trust store: untuk CLI resmi pakai `ooklaserver/sim/certs/ca-bundle-cli.pem` (CA publik + CA lab).
4. `OoklaServer -d` kadang mengabaikan SIGTERM; `stop-all.sh` fallback `kill -KILL`.
5. Push GitHub berikutnya butuh PAT baru; token disposable sebelumnya sudah dihapus.
