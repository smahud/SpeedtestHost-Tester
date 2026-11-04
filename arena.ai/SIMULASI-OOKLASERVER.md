# Laboratorium OoklaServer official — ringkasan & cross-validation

> **Status 2026-11-04 (v1.3.0).** Struktur laboratorium dipindah dari
> `ooklaserver/sim/` ke [`lab/`](lab/), biner proprietary tidak lagi
> di-commit, dan seluruh cross-validation diulang dari nol.
> Dokumentasi otoritatif ada di **[`validation/`](validation/)**.

| Dokumen | Isi |
| --- | --- |
| [`validation/PROTOCOL_MATRIX.md`](validation/PROTOCOL_MATRIX.md) | perilaku daemon resmi yang diamati (HTTP, HTTPS, NetGauge, WebSocket, upload, gambar) |
| [`validation/CROSS_VALIDATION.md`](validation/CROSS_VALIDATION.md) | CLI resmi ↔ daemon resmi ↔ clone, per layer |
| [`validation/TEST_MATRIX.md`](validation/TEST_MATRIX.md) | setiap tes + hasil nyata |
| [`validation/REPRODUCE.md`](validation/REPRODUCE.md) | cara mengulang semuanya |
| [`lab/binaries/MANIFEST.md`](lab/binaries/MANIFEST.md) | provenance + SHA-256 biner OoklaServer |
| [`lab/cli/MANIFEST.md`](lab/cli/MANIFEST.md) | provenance + SHA-256 Speedtest CLI |
| Arsip sesi sebelumnya | [`lab/results/previous-session/`](lab/results/previous-session/) |

## Ringkas

- Binary official x86_64 + aarch64 static-musl diunduh dari URL resmi; SHA-256, ukuran, `Last-Modified` dan ETag dicatat, lalu **diperiksa ulang** pada 2026-11-04 (nilai tidak berubah).
- Binary **tidak di-commit**: `sh lab/scripts/download-official.sh` mengunduh dan menolak berjalan bila SHA-256 tidak cocok.
- Daemon dijalankan dengan `-d` dari `lab/runtime/http/` atau `lab/runtime/https/`; config dibaca dari working directory.
- Daemon hanya di `127.0.0.1:8080` TCP+UDP. Port 5060/80/443 tidak dipakai daemon.
- CA + sertifikat lab dibuat oleh `lab/scripts/make-certs.sh`, termasuk **tiga sertifikat negatif** (wrong-host, expired, untrusted).
- Terverifikasi: port 8080 melayani HTTP, raw NetGauge, WebSocket, HTTPS, dan WSS **sekaligus** saat custom cert aktif; TLSv1.3 / `TLS_AES_256_GCM_SHA384`, `Verify return code: 0`.
- Daemon **tidak menjawab** datagram NetGauge di UDP → tidak ada cek UDP (akan menghasilkan false negative).
- Control server mandiri di port 80 (`lab/scripts/legacy_control.py`) menyajikan 10 ukuran gambar + formula `size = 500 + len(key)+len(value)+3` + `test=test` + crossdomain — **tanpa** mirror pihak ketiga 95 MB.
- **Cross-validation:** official Speedtest CLI `1.2.0.84` → server list resmi memberi `myspeed.gorge.net:8080` (id 4063) → diarahkan ke `127.0.0.1` → CLI speedtest penuh ke daemon lokal, **exit 0**, `server.ip=127.0.0.1`, `persisted: false`.
- **Tidak ada hasil yang dipublikasikan:** `results.speedtest.net` diarahkan ke stub lokal yang mencatat upload lalu menjawab **HTTP 503**.
- Hasil clone terhadap daemon resmi: **19 PASSED / 0 FAILED** (exit 0) pada mode TLS dengan CA lab dipercaya.

## Status code v1.3.0

| Temuan | Implementasi |
| --- | --- |
| CLI resmi punya `--ca-certificate` yang **mengganti** trust store | `--ca-bundle FILE` / `ca_bundle=` dengan validasi PEM; verifikasi tidak pernah dimatikan |
| Daemon 8080 juga menyajikan `/speedtest/*` | `--legacy-port N` / `legacy_port=` (default 80) |
| Daemon `size=Content-Length`, legacy PHP `500+len(key)+len(value)+3` | `--upload-mode auto\|legacy\|native` + `detected_mode` |
| WSS bekerja di port yang sama | `--daemon-tls` / `--no-daemon-tls` / `daemon_tls=1|0`; `https://` otomatis memakai TLS |
| CLI resmi punya batas waktu global | `--timeout SECONDS` (default 180) + deadline per request (`contextvars`) |
| Server flirt bisa dialihkan ke alamat privat | non-global address dibuang saat resolusi; `--allow-private` jadi opt-in eksplisit |

## Yang masih terbuka / operasional

1. Implementasi internal `POST https://www.speedtest.net/host-tester` tetap tertutup reCAPTCHA; watchdog regional Ookla tidak bisa direproduksi.
2. Redirect `/etc/hosts` berada di luar workspace snapshot; jalankan `sh lab/scripts/cross-validate-cli.sh https real` lagi setelah restart sandbox (script sudah memasang dan menghapus entry otomatis lewat `trap`).
3. `--ca-certificate` / `--ca-bundle` menggantikan trust store: untuk CLI resmi pakai `lab/certs/ca-bundle-cli.pem` (CA lab; memuat sertifikat daemon **dan** sertifikat control-plane).
4. `OoklaServer -d` **mengabaikan SIGTERM**; `sh lab/scripts/stop-daemon.sh` sudah punya fallback `kill -KILL`. `start-daemon.sh` sekarang menolak start bila port 8080 sudah dipakai (daemon memakai `SO_REUSEPORT`, sehingga dua instance berbagi port secara acak).
5. Scope `isolated` (namespace jaringan penuh) berakhir dengan exit **2** `LICENSE_ERROR` — license key pada dokumen konfigurasi terikat pada konteks device/ISP. Ini **limitasi terdokumentasi**, bukan bug.
