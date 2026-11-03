# Infrastruktur, Kendala Lingkungan & Hal yang Perlu Di-update

## Target produksi
- Server speedtest: `host.yapsidarussalam.or.id:8080` (domain organisasi yapsidarussalam.or.id, akun/org Huda: smahud).
- Port yang bisa dites dari luar: **hanya 8080** (TCP; daemon juga layani TLS di port yang sama).
- Status test produksi (per 2 Nov 2026): **belum ada hasil** — jaringan keluar Vibe melewati proxy yang menolak koneksi ke port 8080 eksternal ("Access Denied", squid). Test ke server produksi harus dijalankan dari sisi Huda (CLI dari server itu sendiri paling akurat, untuk memisahkan masalah firewall).

## Kendala lingkungan agent Vibe (penting untuk sesi berikutnya)
- Sandbox bash Vibe = virtual filesystem saja: TIDAK ada `wget`/`curl`/`tar`/`python`/`node`/network → **binary OoklaServer tidak bisa diunduh/dijalankan di lingkungan agent**; simulasi harus dijalankan Huda via kit.
- `open_url` hanya bisa mengambil teks halaman; proxy egress memblokir port non-standar/8080 eksternal.
- Karena itu validasi "real" dilakukan lewat `ookla_local_sim.sh` di mesin Huda.

## Kit simulasi lokal (cara validasi resmi, tanpa menebak)
1. Deteksi arsitektur → unduh binary stable resmi (URL di protocol-reference.md).
2. Sertifikat self-signed `cert.pem`/`key.pem` (CN=localhost, SAN: localhost, 127.0.0.1, ::1; 10 tahun).
3. `OoklaServer.properties`: hanya port 8080 (TCP+UDP), `useIPv6=true`, `allowedDomains=*`, autoUpdate off, `ssl.useLetsEncrypt=false`, `openSSL.server.certificateFile/privateKeyFile` → cert custom.
4. Start `./OoklaServer --daemon`, tunggu `/hi` menjawab.
5. Ground-truth manual: `curl /hi`, `curl /crossdomain.xml`, `curl -k https://localhost:8080/hi`, handshake `HI` via `/dev/tcp`, cek status HTTP endpoint legacy di 8080.
6. Jalankan `python3 ookla_host_tester.py localhost:8080 --insecure` (self-signed → baris https = WARN; TANPA `--insecure` baris https = FAIL, sama seperti tester resmi menolak self-signed — itu perilaku benar).
7. Halaman web HTML juga bisa dites ke `localhost:8080` (buka file lokal / via http://).
- Variabel kit: `PORT`, `BASE_DIR` (default `$HOME/ookla-sim`), `CLI_PY`, `INSECURE=1|0`, `KEEP_RUNNING`.

## Hasil validasi — simulasi level protokol (dieksekusi agent, 2 Nov 2026)
Harness simulasi byte-accurate (canvas `ookla-protocol-test-harness`, TypeScript): simulator daemon netgauge TCP + HTTP/1.1 di satu port 8080 (perilaku sesuai binary resmi), dikombinasikan dengan logika klien CLI. **6/6 skenario hijau, 0 assertion gagal:**

- **S1 daemon sehat + TLS valid** → semua 8 check PASS. Stats terverifikasi: `hi=1`, `ping=20`, `download=1`, `upload=1`, `quit=1`; `DOWNLOAD 5000000` → server mengirim **tepat 5.000.000 byte**; `UPLOAD 2000000 0` → payload klien **1.999.983 byte** (2000000 − 17 byte command-line "UPLOAD 2000000 0\n"), server menerima persis sama dan menjawab `OK 2000000 <ts>`.
- **S2 self-signed + `--insecure`** → hanya baris https = WARN (TLS aktif di 8080, sertifikat dilewati); lainnya PASS. Konsisten desain: https & http satu port 8080.
- **S2b self-signed strict** → https = FAIL ("self signed certificate"); ini perilaku benar (tester resmi juga menolak self-signed tanpa opsi lewati).
- **S3 crossdomain ≠ `*`** → hanya crossdomain FAIL, 7 lainnya PASS (deteksi granularity benar).
- **S4 latency.txt 404** → latency FAIL **dan** keepalive FAIL (keepalive menguji server skenario yang sama). Bug harness ditemukan & diperbaiki: awalnya `checkKeepalive` memakai sim server baru sehingga S4/S5 salah PASS — bukti harness benar-benar menangkap regresi wiring.
- **S5 port 8080 refused/blokir** → SEMUA check FAIL dengan pesan `Connection refused`.

**Pembuktian empiris lingkungan agent** (jangan probe ulang): bash Vibe = emulasi `just-bash` tanpa tar/wget/curl/python/node/openssl, `/dev/tcp` stub (connect "sukses" tapi tidak pernah ada data), tanpa eksekusi ELF; `run_typescript` tanpa network/fs dan tanpa TextEncoder/TextDecoder (UTF-8 codec harus hand-rolled); egress `open_url` (proxy squid) menolak port 8080 eksternal. Kesimpulan: **binary resmi tidak bisa diunduh/dijalankan di lingkungan agent** → validasi "real" wajib via kit lokal di mesin Huda.

## Ground-truth yang masih menunggu kit lokal Huda (binary resmi)
- [ ] netgauge TCP: versi `HELLO` persisnya? (simulasi memakai `2.11.6 (2.11.6.1) 2026-08-25...` sebagai placeholder)
- [ ] WebSocket: framing text vs binary mana yang dijawab daemon? (eksperimen CLI: coba text dulu, lalu binary)
- [ ] `/hi`, `/crossdomain.xml` di 8080: isi persisnya?
- [ ] Endpoint legacy (upload.php, latency.txt, random*.jpg) di 8080: diserve daemon atau 404? → menentukan apakah alat test perlu diarahkan ke port 80 untuk baris legacy.
- [ ] TLS self-signed di 8080: https aktif di port sama? (simulasi mengasumsikan ya, sesuai dokumentasi OoklaServer)
- [ ] Hasil CLI lengkap vs ground-truth: baris mana yang tidak cocok → update CLI/HTML.

## Kit cross-validation 3-arah dengan Speedtest CLI resmi (3 Nov 2026)
- Metode "domain -> localhost" (trick /etc/hosts): `speedtest -L -f json` → pilih server publik port 8080 (env `SERVER_ID` override; fallback parse human `-L` via grep `:8080`) → petakan domain server itu ke `127.0.0.1`/`::1` di `/etc/hosts` (blok bertanda `# BEGIN/END ookla-crossval`, otomatis dipulihkan via trap) → `speedtest -s <id>` kini TIDAK SADAR mengetes OoklaServer resmi di localhost.
- Ekspektasi bukti (selaras temuan z.ai & arena.ai): `result.server.ip == 127.0.0.1` di JSON output CLI; CLI resmi pure netgauge TCP (zero HTTP request) → sertifikat self-signed TIDAK mengganggu CLI resmi; full test sukses di loopback (z.ai: 0.06 ms / 67 Gbps).
- Script: canvas `ookla-cross-validation-kit` (`ookla_cross_validate.sh`): unduh OoklaServer resmi + Speedtest CLI 1.2.0 (x86_64/aarch64), cert self-signed SAN localhost + domain terpilih (regen bila SAN kurang), properties port-8080-only, ground-truth probe root + `/speedtest/`, `timeout 300 speedtest -s <id> -f json`, clone `--json --insecure`, analisis silang python3 → `crossval-report.md` (verdict KONSISTEN/BELUM LENGKAP). Env: `PORT BASE_DIR CV_DIR CLI_PY SERVER_ID KEEP_RUNNING`. Wajib `sudo` (tulis /etc/hosts).
- Status: **menunggu dijalankan Huda** (agent tidak bisa eksekusi ELF/network). Output yang perlu ditempel balik: log console + `crossval-report.md`.

## Perbaikan CLI v1.1 dari cross-analysis antar-agent (3 Nov 2026)
- WebSocket client via `getaddrinfo` → fix target IPv6-literal `[::1]:8080` (bug kelas sama dengan temuan z.ai di engine mereka).
- Header `User-Agent` realistis di semua request HTTP + upgrade WebSocket (server produksi Ookla mereset klien tanpa UA — temuan z.ai).
- File legacy (latency.txt, upload.php, random*.jpg) dicoba di `/` lalu fallback `/speedtest/` (daemon resmi menyajikan file legacy di /speedtest/ — temuan z.ai); keepalive tetap 1 koneksi TCP; download mem-verifikasi file di kedua base via Range probe. Kit simulasi ikut di-update (ground-truth 8 path).
- Fix ini BELUM tervalidasi langsung vs binary resmi oleh agent (tidak bisa eksekusi ELF) → divalidasi lewat kit cross-validation di mesin Huda.

## Repo GitHub arena perbandingan multi-agent (per 3 Nov 2026)
- Repo: `https://github.com/smahud/SpeedtestHost-Tester` (public, default branch `main`; dibuat oleh agent arena.ai via PAT). Struktur: `README.md` root = indeks perbandingan antar agent; `arena.ai/` (lengkap: app Python + CLI + audit + simulasi binary resmi, https 19/19 PASS); `z.ai/` (lengkap: CLI Node zero-dep + Next.js + lab + cross-validation dengan Speedtest CLI resmi 1.2.0); `mistral.ai/` (submission agent ini).
- Submission mistral.ai = **9 file** (README laporan, docs/protocol-reference.md, docs/infra-and-tools.md, web/ookla-host-tester.html, cli/ookla_host_tester.py v1.1, simulation/ookla_local_sim.sh, harness/ookla_protocol_test_harness.ts, cross-validation/README.md, cross-validation/ookla_cross_validate.sh) + update README root terarget (baris tabel layout mistral.ai → complete, catatan placeholder dihapus, section "Submission: mistral.ai/" sebelum checklist).
- **Kendala connector GitHub Vibe**: GitHub App connector hanya bisa BACA repo ini; SEMUA operasi tulis ditolak `403 Resource not accessible by integration` (push_files, create_or_update_file, create_repository) — bahkan setelah repo ditambahkan ke repository access instalasi. Push harus via PAT dari mesin user.
- Solusi: canvas **"Pusher Submission mistral.ai ke GitHub (via PAT)" v2** — script Python stdlib self-contained berisi semua file (base64) yang push **10 commit** sekaligus (9 file submission + update README root terarget). Jalankan: `GITHUB_TOKEN=<PAT> python3 push_mistral_submission.py`. Idempoten (file existing diupdate via SHA; edit README root memakai replacement terarget + retry konflik 409). v2 menambahkan CLI v1.1, kit simulasi ground-truth 8 path, dan directory cross-validation.
- Temuan lintas-agent dari repo (untuk merge final): daemon resmi `2.11.5.2` build `2026-06-04.1737.7d0993d`; port 8080 terverifikasi melayani HTTP+TLS simultan; `random*.jpg` punya fingerprint ukuran deterministik per versi; target produksi `host.yapsidarussalam.or.id:8080` sempat online full-pass lalu ECONNREFUSED lagi (DDNS/CGNAT MikroTik) — jadi hasil test produksi bersifat fluktuatif, bukan bug alat.

## Next steps / perlu di-update nanti
- Terjemahkan hasil ground-truth daemon resmi → sesuaikan CLI (terutama baris websocket & download/upload legacy) bila ada mismatch.
- Cek AAAA record `host.yapsidarussalam.or.id` (IPv6 wajib untuk host publik Ookla).
- Produksi: pastikan port 5060 juga terbuka (syarat host publik), full-chain sertifikat di `openSSL.server.certificateFile`, dan `OoklaServer.allowedDomains = *`.
- Setelah server disetujui Ookla: aktifkan kembali `OoklaServer.ssl.useLetsEncrypt = true` (provision otomatis).
