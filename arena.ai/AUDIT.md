# Audit end-to-end — Ookla Server Tester clone

**Tanggal audit:** 2026-11-03 (Asia/Jakarta)  
**Target:** `https://www.speedtest.net/host-tester`  
**Host uji:** `host.yapsidarussalam.or.id:8080`  
**Status aplikasi:** berjalan di `0.0.0.0:3000` (Arena live preview), `app.py` + `cli.py` v1.1.0

---

## 1. Ringkasan eksekutif

Audit menemukan bahwa versi sebelumnya **belum layak disebut 1:1**: tombol Submit masih memakai style default browser, font/ukuran/spacing form meleset, nav/footer asli hilang, dan web form masih menolak domain tanpa port. Semua itu sudah diperbaiki dan diverifikasi ulang dengan browser headless.

Hasil akhir:

- **Form page sekarang identik secara DOM, CSS, geometri, tipografi, warna, dan posisi** dengan halaman asli untuk semua elemen yang diukur (`masthead`, logo, `h1`, paragraf, legend, label, input, note, tombol, form, section). Perbandingan computed style: **0 perbedaan** dari 10 selector × 10 properti. Bukti: `audit/computed-styles.json`, `audit/comparison.png`.
- **Masthead, nav, footer, dan SVG icon set asli dipulihkan.** Default tampilan sekarang benar-benar menyerupai situs asli. Mode `?clean=1` tetap disediakan untuk interpretasi lama "hanya halaman test saja".
- **reCAPTCHA, widget, sitekey, `api.js`, privacy modal, iklan, GTM/analytics, dan semua resource eksternal dihapus.** Verifikasi Playwright: hanya 1 request (`/host-tester`), 0 console error, 0 script/link eksternal, 0 `url(http...)` dan 0 `url(/...)` pada CSS, `recaptchaDiv=false`, `recaptchaScript=false`.
- **Domain saja dan URL penuh kini diterima di web maupun CLI**, bukan hanya `host:port`.
- **Backend probe tetap rekonstruksi**, bukan salinan biner dari server Ookla. Karena halaman hasil resmi berada di balik reCAPTCHA dan tidak ada API publik, "1:1 penuh" terhadap implementasi server-side tidak dapat dibuktikan. Lihat bagian 5.

**Kesimpulan jujur:** clone ini dapat menjadi **pengganti lokal 1:1-style yang fungsional** untuk halaman test, dengan batas-batas yang didokumentasikan. Klaim "1:1 penuh secara menyeluruh" tidak dapat dipertahankan secara teknis.

---

## 2. Yang diubah pada audit ini

| Sebelum | Sesudah | Bukti |
| --- | --- | --- |
| Template HTML buatan sendiri, struktur `.clone-main` / `.clone-form` | Template dari DOM asli: `.pre-fold`, `.masthead-dark`, `.content`, `.section-light`, `.container`, `.pure-g`, `<footer>`, 60 SVG symbol | `assets/chrome.html`, `assets/form.html` |
| Tombol Submit abu-abu default browser | Tombol biru `#0077c3`, radius 100px, padding dan font asli; lebar disamakan sampai 103.78125 px | `audit/computed-styles.json`, `audit/clone-form-full.png` |
| `h1` 20 px, label 7.6 px, input 9.5 px | Mengikuti CSS asli: `h1` 32.402 px, label 12.707 px, input 15.248 px | `audit/computed-styles.json` |
| Form dibatasi `max-width: 980px` | Form mengikuti grid asli, lebar 1170 px dengan konten 1130 px | `audit/computed-styles.json` |
| Nav/footer hilang | Nav/footer asli dipulihkan; `?clean=1` menyembunyikannya | `audit/clone-form-full.png`, `audit/clone-form-clean.png` |
| reCAPTCHA dihapus sehingga tombol naik ke y=432 | Spacer tak terlihat 147.44 px + catatan consent statis dipertahankan; tombol kembali ke y=579.8125, form height 623.5156, section height 684.48 | `audit/computed-styles.json` |
| Web `parse_host()` hanya `host:port` | `normalize_target()` dipakai bersama web + CLI: bare domain, URL penuh, IPv6, default port 8080 | E2E di bagian 4 |
| CLI punya normalizer duplikat | Normalizer dipindah ke `app.py`, CLI meng-importnya; `input` asli dan `normalization_note` ikut tersimpan | `app.py`, `cli.py`, `hasil-cli.json` |
| Hasil HTML memakai template lama | `hasil-test.html` dan `hasil-test-clean.html` diregenerasi dengan shell asli, tetap self-contained | `static-result.png`, verifikasi `file://` 0 request eksternal |

---

## 3. Matriks pemenuhan target

| Kriteria user | Status | Bukti / catatan |
| --- | --- | --- |
| 1:1 clone dari `speedtest.net/host-tester` | **Exact untuk form page**, **approximation untuk result page** | DOM, CSS, computed style, dan geometri form cocok. Hasil resmi tidak teramati karena reCAPTCHA; layout hasil memakai skema publik dari Scribd + styling Speedtest. |
| Tanpa captcha | **Terpenuhi** | Tidak ada `.g-recaptcha`, `data-sitekey`, atau `google.com/recaptcha/api.js`. Spacer kosong menggantikan area widget agar layout tetap 1:1. |
| Tanpa banner | **Terpenuhi** | Privacy/cookie modal, iklan, promo image, GTM, OneTrust, analytics dihapus. Catatan "Terms of Use / Privacy Policy" statis dipertahankan karena bukan banner dan bagian dari form asli. |
| Hanya halaman test saja | **Terpenuhi lewat `?clean=1`** | Default sekarang full chrome untuk akurasi 1:1; `?clean=1` menyembunyikan nav/footer dan menyisakan form/test. Tidak ada halaman lain. |
| Cukup memasukkan domain saja | **Terpenuhi, disengaja menyimpang dari official** | `host.yapsidarussalam.or.id` → `:8080`. Dokumen Ookla menyatakan bare hostname/full URL tidak valid; clone sengaja lebih permisif sesuai permintaan user. |
| `host.yapsidarussalam.or.id:8080` diterima | **Terpenuhi** | Format asli tetap bekerja di web, API, dan CLI. |
| Cara kerja test sama persis di balik layar | **Rekonstruksi dekat, bukan dapat dibuktikan identik** | Urutan probe mengikuti dokumentasi Ookla + bundle `OoklaServer.tgz` + `http_legacy_fallback.zip` + observasi protokol langsung. Implementasi server Ookla tertutup. |
| Kirim hasilnya | **Terpenuhi** | `hasil-test.html/json/txt`, `hasil-cli.json/txt/summary.txt`, `hasil-test-clean.html`. |
| Test dengan host tersebut | **Terpenuhi pada delivery awal** | 4 PASSED / 15 FAILED / 19 checks. Saat re-audit port 8080 target mulai reset; hasil live baru 1 PASSED / 18 FAILED. |
| CLI cukup input URL, tanpa buka page | **Terpenuhi** | `./host-tester 'https://host...:8080/path?x=1' --json -o file` berjalan, exit 1 karena ada FAILED, bukan karena error. |

### Klasifikasi kejujuran

| Kelas | Isi |
| --- | --- |
| **Exact / terverifikasi** | `POST /host-tester`, `method=post`, `name/id="ookla-server"`, `pure-form pure-form-stacked`, label `Host`, note `test.yourhost.net:8080`, legend `OoklaServer / Netgauge TCP`, tombol `Submit`, CSS asli, font embedded, computed style, geometri, tidak ada resource eksternal, normalisasi input, CLI flag/exit code, hasil probe aktual terhadap target. |
| **Approximation** | Halaman hasil: judul `Test results`, keys `netgauge`, `websocket`, `crossdomain`, `https`, `latency`, `upload`, `max_upload`, `image_sizes` 1–10, `keepalive`, `details`, `status PASSED/FAILED`, `crossdomain_url`, `latency_url`, `size`, `success` — dari skema publik Scribd, bukan DOM resmi. Detail teks, warna kartu, dan tata letak hasil adalah interpretasi. |
| **Intentional deviation** | reCAPTCHA dihapus; banner/ads/analytics dihapus; nav/footer bisa disembunyikan; bare domain + full URL diterima; port default 8080; TLS verification ketat; `--allow-private`; runner dari sandbox, bukan watchdog Ookla; nav/footer link masih menunjuk ke path/site asli secara visual. |
| **Unverifiable** | Implementasi backend resmi, halaman hasil resmi, kriteria HTTPS/chain, algoritma KeepAlive timing, body POST legacy persis, legacy `content1`/`file_box` resmi, perilaku watchdog regional, apakah Ookla memakai IP/UA/urutan yang sama persis. |

---

## 4. Verifikasi end-to-end yang dijalankan

### 4.1 Visual / DOM

- Sumber asli diambil ulang dengan browser-UA `curl` karena `fetch_page` mendapat 403: `/tmp/orig.html` 67.297 byte, `/tmp/orig.css` 257.774 byte.
- Playwright Chromium 156 headless dipasang untuk screenshot dan computed style.
- `audit/original-form.png` dari thum.io, `audit/original-live.png` dari Playwright langsung (status 200).
- `audit/clone-form-full.png`, `audit/clone-form-clean.png`, `audit/clone-results-full.png`, `audit/comparison.png`.
- Upaya submit ke official dengan reCAPTCHA otomatis gagal pada challenge (tidak dibypass). POST dengan token kosong menghasilkan 500 `Something went wrong. Homepage 500`; tidak ada XHR/API hasil yang tersembunyi. Ini yang membuat result page resmi tidak dapat diamati.

### 4.2 Computed style

Playwright membandingkan original live vs clone lokal pada viewport 1200×900. Selector: `masthead`, `logo`, `h1`, `lead`, `legend`, `label`, `input`, `note`, `button`, `form`, `section`. Properti: `x`, `y`, `w`, `h`, `fontSize`, `color`, `bg`, `border`, `radius`, `padding`, `margin`, `weight`, `transform`, `display`, `family`.

**Hasil akhir: 0 diff.** Satu perbedaan 1 px pada lebar tombol dikompensasi `letter-spacing: -0.011em` pada font Montserrat embedded.

### 4.3 Input normalization

```
'host.yapsidarussalam.or.id'                      -> ('host.yapsidarussalam.or.id:8080', 'no explicit port; using default 8080')
'host.yapsidarussalam.or.id:8080'                 -> ('host.yapsidarussalam.or.id:8080', None)
'https://host.yapsidarussalam.or.id:8080/foo?x=1' -> ('host.yapsidarussalam.or.id:8080', "ignored URL path '/foo'; ignored query/fragment")
'[::1]:8080'                                      -> ('[::1]:8080', None)
'ftp://bad host:99999'                            -> ERR Invalid hostname format
''                                                -> ERR Invalid hostname format
```

### 4.4 HTTP E2E terhadap server lokal

| Request | HTTP | Hasil |
| --- | ---: | --- |
| `POST ookla-server=host.yapsidarussalam.or.id` | 200 | Results, note `no explicit port; using default 8080` |
| `POST ookla-server=https://...:8080/foo?x=1` | 200 | Results, path/query diabaikan |
| `POST ookla-server=bad host` | 200 | Form + `clone-alert: Invalid hostname format` |
| `POST ...&clean=1` | 200 | `body class="body-dark clean"` |
| `GET /api/test?host=host.yapsidarussalam.or.id` | 200 | JSON dengan `normalized_input`, `normalization_note` |
| `GET /host-tester` | 200 | `form action="/host-tester" method="post"`, `name/id="ookla-server"` |

Verifikasi Playwright pada form: `recaptchaDiv=false`, `recaptchaScript=false`, `nav=block`, `footer=block`, `buttonBg=rgb(0,119,195)`, `buttonY=580`, requests hanya `http://127.0.0.1:3000/host-tester`, console errors `[]`. Clean mode: `nav=none`, `footer=none`.

### 4.5 CLI E2E

| Perintah | Exit | Catatan |
| --- | ---: | --- |
| `./host-tester host.yapsidarussalam.or.id --summary --no-color -q` | 1 | Bare domain diterima; 1 PASSED / 18 FAILED saat re-audit |
| `./host-tester 'https://...:8080/path?x=1' --json -q -o /tmp/cli-url.json` | 1 | URL penuh diterima; `input` asli + `normalization_note` tersimpan |
| `./host-tester 'ftp://bad host:99999'` | 2 | Input invalid ditolak |
| `./host-tester localhost:8080 --allow-private --summary` | 1 | Private host diizinkan |
| `./host-tester --version` | 0 | `host-tester 1.1.0` |

### 4.6 Static deliverable

`file:///home/user/hasil-test.html` dibuka di Playwright: title benar, summary `4 PASSED / 15 FAILED / 19 checks`, requests hanya file itu sendiri, 0 console error. Dua `url(/s/images/...)` sisa dari CSS asli juga sudah dinetralkan menjadi `none`, jadi HTML hasil benar-benar self-contained dan aman untuk preview tanpa jaringan.

---

## 5. Batas teknis yang tidak bisa ditutup

1. **Official result page tidak teramati.** `POST https://www.speedtest.net/host-tester` membutuhkan token reCAPTCHA valid. Upaya automasi berhenti di challenge; tidak dilakukan bypass. POST kosong → 500, POST token dummy → 403. Tidak ada endpoint JSON alternatif yang terlihat di network capture.
2. **Backend Ookla tertutup.** Sebelum simulasi, yang tersedia hanyalah dokumentasi support, binary `OoklaServer.tgz`, paket `http_legacy_fallback.zip`, dan observasi langsung ke daemon target. Addendum 2026-11-03 menambahkan bukti dari binary static-musl official yang dijalankan lokal, sehingga respons daemon port 8080/80 bukan lagi dugaan. Implementasi internal `/host-tester`, timeout, UA, header, dan kriteria pass/fail persis tetap tidak bisa dibuktikan.
3. **Watchdog regional berbeda.** Ookla menjalankan pengecekan dari banyak server regional; clone ini dari satu sandbox. Hasil bisa berbeda walau probe identik.
4. **HTTPS/KeepAlive/legacy POST detail tidak pasti.** URL HTTPS probe, kriteria chain validation resmi, field POST legacy, dan timing KeepAlive merupakan interpretasi terbaik. Simulasi membuktikan clone dapat membuat `https` PASSED dengan CA lab yang dipercaya tanpa mematikan verifikasi; ini membuktikan mekanisme verifikasi, bukan identitas dengan kriteria CA resmi Ookla.
5. **Literal "1:1 penuh" mustahil** karena user sendiri meminta reCAPTCHA dan banner dihapus. Menghapus itu otomatis membuat DOM tidak byte-identical. Yang dicapai adalah kesetaraan pada level halaman test yang diminta.

---

## 6. Hasil uji target

### Delivery awal — 2026-11-03 01:36 UTC+07

**4 PASSED / 15 FAILED / 19 flat checks**

PASSED: daemon `netgauge`, `websocket`, `crossdomain`, legacy `keepalive`.  
FAILED: daemon `https` (sertifikat self-signed `C=US,O=OoklaServer,CN=localhost`), legacy `crossdomain`, `latency`, `upload`, `max_upload`, `image_sizes` + 10 subrow.

Detail: `hasil-test.html`, `hasil-test.json`, `hasil-test.txt`, `hasil-cli.json`, `hasil-cli.txt`, `hasil-cli-summary.txt`.

### Re-audit — 2026-11-03 01:50–01:55 UTC+07

Port 8080 target mulai menolak koneksi: TCP connect berhasil, lalu `Connection reset by peer` untuk `HI\n`, HTTP `/hi`, dan WebSocket. Port 80 masih merespons (RouterOS) dan `https://r.jina.ai/http://host.yapsidarussalam.or.id/` berhasil di-fetch dari luar, sedangkan port 8080 timeout dari layanan itu juga. Fresh live run karenanya menjadi **1 PASSED / 18 FAILED**. Ini perubahan kondisi target, bukan regresi clone: normalisasi, routing, render, dan CLI tetap lolos semua E2E.

---

## 7. Kesimpulan

Target project **terpenuhi pada cakupan yang diminta**: halaman test 1:1-style tanpa captcha/banner, input domain saja, probe server-side yang meniru urutan resmi, hasil dikirim, target diuji, dan CLI URL-only tanpa browser.

Yang **tidak boleh diklaim**: kesetaraan penuh dengan backend/halaman hasil resmi Ookla. Bagian itu tertutup di balik reCAPTCHA dan watchdog regional. Status paling tepat: **"functional local 1:1-style replacement with documented, unavoidable limits"** — bukan "1:1 penuh tanpa caveat". Simulasi binary official di section 8 memperkuat bukti protokol, tetapi tidak mengubah batas ini.

---

## 8. Addendum — simulasi OoklaServer official (2026-11-03)

User meminta agar dugaan dihentikan: unduh binary official dari dua URL yang diberikan, jalankan dengan config benar, arahkan target ke `localhost`, dan simpan semua variabel teknis. Hasilnya ada di [`ooklaserver/sim/SIMULASI.md`](ooklaserver/sim/SIMULASI.md), [`ooklaserver/sim/manifest.json`](ooklaserver/sim/manifest.json), dan [`ooklaserver/sim/results/`](ooklaserver/sim/results/).

### 8.1 Yang sekarang terverifikasi, bukan lagi dugaan

| Area | Bukti |
| --- | --- |
| Binary | x86_64 + aarch64 static-musl tarball, SHA-256, `--version 2.11.5.2`, build `2026-06-04.1737.7d0993d` |
| Config | `OoklaServer.properties` terbaca dari working directory; `tcpPorts/udpPorts/httpPorts=8080`, `addresses=127.0.0.1`, auto-update dan Let's Encrypt dimatikan |
| Binding | TCP + UDP `127.0.0.1:8080`; port 5060/80/443 tidak dipakai daemon |
| NetGauge | Raw TCP `HI\n` → `HELLO ...` |
| WebSocket | `GET /ws` → 101 + frame `HELLO ...`; WSS di atas TLS juga 101 |
| HTTP | `/`, `/hi`, `/crossdomain.xml`, `/speedtest/latency.txt`, 10 JPEG, KeepAlive |
| TLS | CA lokal + server cert SAN `localhost`, `TLSv1.3`, `TLS_AES_256_GCM_SHA384`, `openssl verify 0 (ok)` |
| Port sama | Saat custom cert aktif, 8080 melayani plain HTTP **dan** HTTPS/WSS sekaligus |
| Legacy | Control server port 80 menyajikan `http_legacy_fallback.zip`; `upload.php` menghasilkan `size=516300` dan `size=1981500` |
| Perbedaan upload | Daemon 8080 mengembalikan `size=<Content-Length mentah>`, legacy PHP memakai `+502` |

### 8.2 Hasil clone terhadap target lokal

| Mode | CLI | API | Kegagalan |
| --- | --- | --- | --- |
| HTTP | 18 PASSED / 1 FAILED / 19, exit 1 | 18/1/19 | hanya `https` |
| HTTPS + CA dipercaya | **19 PASSED / 0 FAILED / 19, exit 0** | **19/0/19** | tidak ada |

Ini membuktikan pipeline web/CLI/input normalization/19 checks bekerja end-to-end terhadap server Ookla yang sesungguhnya.

### 8.3 Dampak pada matriks audit

- Section 1/3/4 tetap berlaku untuk form, DOM, CSS, dan E2E web/CLI.
- Section 5 butir 2 dan 4 diperbarui: respons daemon sudah teramati, tetapi backend `/host-tester` resmi tetap tertutup.
- Temuan baru yang **belum diperbaiki di kode** dicatat sebagai utang teknis: scheme `https://` hilang saat normalisasi; legacy port hardcoded 80; algoritma upload belum endpoint-aware; WSS dan `--ca-bundle` belum ada. Daftar lengkap ada di `SIMULASI.md` section 8.
- Kesimpulan section 7 tidak berubah: tetap **1:1-style replacement**, kini dengan bukti protokol yang jauh lebih kuat.
