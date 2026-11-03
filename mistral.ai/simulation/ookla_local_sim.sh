#!/usr/bin/env bash
# =============================================================================
# OoklaServer Local Simulation & Validation Kit
# =============================================================================
# Menjalankan binary OFFICIAL OoklaServer (stable) di lokal + menvalidasi
# alat test kita (CLI / halaman web) terhadap daemon asli - bukan tebakan.
#
# Skenario (sesuai ketentuan):
#   - Hanya port 8080 (TCP+UDP) yang dipakai / diuji.
#   - HTTP dan HTTPS (TLS) dilayani di PORT YANG SAMA (8080) oleh OoklaServer.
#   - Sertifikat self-signed dibuat otomatis (untuk pengujian https).
#
# Kebutuhan: Linux x86_64 atau aarch64, wget/curl, tar, openssl, python3.
#
# Pemakaian:
#   bash ookla_local_sim.sh                  # unduh, setup, jalankan, test
#   INSECURE=0 bash ookla_local_sim.sh       # https diverifikasi ketat
#                                             # (self-signed => expected FAIL,
#                                             #  sama perilaku tester resmi)
#   KEEP_RUNNING=1 bash ookla_local_sim.sh   # jangan matikan daemon di akhir
#
# Letakkan file ookla_host_tester.py (CLI) di direktori yang sama agar
# otomatis ikut dijalankan; jika tidak ada, kit tetap menjalankan daemon
# dan menampilkan pemeriksaan ground-truth manual.
# =============================================================================
set -euo pipefail

PORT="${PORT:-8080}"
BASE_DIR="${BASE_DIR:-$HOME/ookla-sim}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_PY="${CLI_PY:-$SCRIPT_DIR/ookla_host_tester.py}"
INSECURE="${INSECURE:-1}"          # 1 = jalankan CLI dengan --insecure (self-signed)
KEEP_RUNNING="${KEEP_RUNNING:-0}"

BANNER="\033[1;36m"; OK="\033[0;32m"; BAD="\033[0;31m"; WARN="\033[0;33m"; OFF="\033[0m"
say()  { printf "${BANNER}>>${OFF} %s\n" "$*"; }
ok()   { printf "   ${OK}[OK]${OFF} %s\n" "$*"; }
bad()  { printf "   ${BAD}[GAGAL]${OFF} %s\n" "$*"; }
note() { printf "   ${WARN}[catatan]${OFF} %s\n" "$*"; }

command -v wget >/dev/null 2>&1 && FETCH="wget -O" || FETCH="curl -fL -o"
have() { command -v "$1" >/dev/null 2>&1; }
for c in tar openssl python3; do
  have "$c" || { echo "Perintah '$c' tidak ditemukan. Install dulu."; exit 1; }
done

# -----------------------------------------------------------------------------
# 1) Pilih binary official sesuai arsitektur
# -----------------------------------------------------------------------------
case "$(uname -m)" in
  x86_64|amd64)
    TARBALL_URL="https://install.speedtest.net/ooklaserver/stable/OoklaServer-linux-x86_64-static-musl.tgz" ;;
  aarch64|arm64)
    TARBALL_URL="https://install.speedtest.net/ooklaserver/stable/OoklaServer-linux-aarch64-static-musl.tgz" ;;
  *)
    echo "Arsitektur $(uname -m) tidak didukung (butuh x86_64 atau aarch64)."; exit 1 ;;
esac

mkdir -p "$BASE_DIR"
cd "$BASE_DIR"

# -----------------------------------------------------------------------------
# 2) Unduh & ekstrak binary resmi (idempotent)
# -----------------------------------------------------------------------------
BIN=""
find_bin() {
  BIN="$(find "$BASE_DIR" -type f -name OoklaServer -perm -u+x 2>/dev/null | head -n1)"
  [ -n "$BIN" ] || BIN="$(find "$BASE_DIR" -type f -name OoklaServer 2>/dev/null | head -n1)"
}

find_bin
if [ -z "$BIN" ]; then
  say "Mengunduh binary resmi OoklaServer (stable): $TARBALL_URL"
  $FETCH ooklaserver.tgz "$TARBALL_URL"
  tar xzf ooklaserver.tgz
  find_bin
  [ -n "$BIN" ] || { echo "Binary OoklaServer tidak ditemukan setelah ekstraksi."; exit 1; }
  chmod +x "$BIN"
  ok "Binary resmi terpasang: $BIN"
else
  ok "Binary resmi sudah ada: $BIN"
fi
BIN_DIR="$(dirname "$BIN")"
cd "$BIN_DIR"

# -----------------------------------------------------------------------------
# 3) Sertifikat self-signed (https di port yang sama dengan http: 8080)
#    SAN: localhost, 127.0.0.1, ::1
# -----------------------------------------------------------------------------
if [ ! -f cert.pem ] || [ ! -f key.pem ]; then
  say "Membuat sertifikat self-signed (CN=localhost, SAN localhost/127.0.0.1/::1)"
  cat > san.cnf <<'EOF'
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = localhost
[ext]
subjectAltName = @alt
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
[alt]
DNS.1 = localhost
IP.1 = 127.0.0.1
IP.2 = ::1
EOF
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -keyout key.pem -out cert.pem -config san.cnf >/dev/null 2>&1
  ok "cert.pem & key.pem dibuat (self-signed, 10 tahun)"
fi

# -----------------------------------------------------------------------------
# 4) OoklaServer.properties - config resmi, port 8080 saja
# -----------------------------------------------------------------------------
say "Menulis OoklaServer.properties (hanya port $PORT, TLS di port sama)"
cat > OoklaServer.properties <<EOF
# === Konfigurasi simulasi lokal (kit) ===
# Port: hanya 8080 (TCP + UDP) sesuai skenario pengujian
OoklaServer.tcpPorts = $PORT
OoklaServer.udpPorts = $PORT

# Bind IPv6 juga (::1) - set false bila daemon gagal start karena IPv6
OoklaServer.useIPv6 = true

# Izinkan semua domain (khas server publik; crossdomain.xml akan berisi domain="*")
OoklaServer.allowedDomains = *

# Simulasi: matikan auto-update
OoklaServer.enableAutoUpdate = false

# --- TLS (https/wss di PORT YANG SAMA dengan http/ws) ---
# Gunakan sertifikat custom (mematikan provision Let's Encrypt otomatis):
# Let's Encrypt otomatis hanya aktif setelah server disetujui Ookla.
OoklaServer.ssl.useLetsEncrypt = false
openSSL.server.certificateFile = cert.pem
openSSL.server.privateKeyFile = key.pem
openSSL.server.minimumTLSProtocol = 1.2

# --- Logging ke console (terlihat di foreground mode / nohup log) ---
logging.loggers.app.name = Application
logging.loggers.app.channel.class = ConsoleChannel
logging.loggers.app.channel.pattern = %Y-%m-%d %H:%M:%S [%P - %I] [%p] %t
logging.loggers.app.level = information
EOF
ok "OoklaServer.properties siap (openSSL.server.certificateFile = cert.pem)"

# -----------------------------------------------------------------------------
# 5) Start daemon
# -----------------------------------------------------------------------------
say "Menjalankan OoklaServer di port $PORT ..."
# matikan instance kit sebelumnya (hanya proses di direktori sim ini)
pkill -f "$BIN_DIR/OoklaServer" 2>/dev/null || true
sleep 1

nohup "$BIN" --daemon > "$BASE_DIR/ooklaserver-console.log" 2>&1 &
DAEMON_PID=$!

# tunggu daemon siap (GET /hi harus menjawab)
READY=0
for i in $(seq 1 20); do
  if curl -fsS -m 3 "http://localhost:$PORT/hi" >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
if [ "$READY" != "1" ]; then
  bad "Daemon belum menjawab di http://localhost:$PORT/hi setelah 20 detik."
  echo "----- log -----"; tail -n 30 "$BASE_DIR/ooklaserver-console.log" || true
  echo "---------------"
  note "Coba: OoklaServer.useIPv6 = false, atau cek 'ss -lntp | grep $PORT'."
  exit 1
fi
ok "Daemon UP di port $PORT (HTTP) — tes: curl http://localhost:$PORT/hi"

# -----------------------------------------------------------------------------
# 6) Ground truth langsung dari daemon resmi
# -----------------------------------------------------------------------------
say "Ground-truth pemeriksaan manual (perilaku asli daemon):"

echo; echo "--- [1] GET /hi (versi daemon, via HTTP) ---"
curl -fsS "http://localhost:$PORT/hi" || bad "GET /hi gagal"; echo

echo "--- [2] GET /crossdomain.xml ---"
curl -fsS "http://localhost:$PORT/crossdomain.xml" || bad "crossdomain gagal"; echo

echo "--- [3] HTTPS di port yang sama (self-signed -> pakai -k) ---"
curl -fkSs "https://localhost:$PORT/hi" || bad "TLS di port $PORT gagal"; echo

echo "--- [4] Netgauge TCP mentah: handshake HI (harus dijawab HELLO <versi>) ---"
if exec 3<>/dev/tcp/127.0.0.1/$PORT; then
  printf 'HI\n' >&3
  LINE=""
  for _ in 1 2 3; do IFS= read -r -t 5 LINE <&3 && break || LINE=""; done
  exec 3<&- 3>&- || true
  case "$LINE" in
    HELLO*) ok "Daemon menjawab: $LINE" ;;
    *)      bad "Jawaban HI tidak terduga: '$LINE' (cek manual: printf 'HI\\n' | nc localhost $PORT)" ;;
  esac
else
  bad "Tidak bisa membuka /dev/tcp/127.0.0.1/$PORT"
fi

echo "--- [5] Endpoint legacy di port 8080 (upload.php / latency.txt / random*.jpg) ---"
for p in "latency.txt" "speedtest/latency.txt" "upload.php" "speedtest/upload.php" "random1000x1000.jpg" "speedtest/random1000x1000.jpg" "random4000x4000.jpg" "speedtest/random4000x4000.jpg"; do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' -m 5 "http://localhost:$PORT/$p" || echo 000)"
  case "$CODE" in
    200|206) ok "/$p -> HTTP $CODE" ;;
    *)       note "/$p -> HTTP $CODE (jika 404: daemon versi ini tidak menyajikan file legacy di 8080 - berarti di produksi file legacy dilayani webserver port 80)" ;;
  esac
done
echo

# -----------------------------------------------------------------------------
# 7) Jalankan CLI tester kita terhadap daemon resmi
# -----------------------------------------------------------------------------
if [ -f "$CLI_PY" ]; then
  say "Menjalankan CLI tester (ookla_host_tester.py) terhadap localhost:$PORT"
  if [ "$INSECURE" = "1" ]; then
    note "Mode --insecure aktif (sertifikat self-signed tidak diverifikasi ketat)."
    python3 "$CLI_PY" "localhost:$PORT" --insecure || true
  else
    note "Verifikasi TLS ketat: baris https DIPREDIKSI FAIL (self-signed) - ini perilaku yang benar."
    python3 "$CLI_PY" "localhost:$PORT" || true
  fi
else
  note "ookla_host_tester.py tidak ditemukan di samping kit - daemon sudah siap, silakan test manual:"
  note "  python3 ookla_host_tester.py localhost:$PORT --insecure"
fi

# -----------------------------------------------------------------------------
# 8) Halaman web
# -----------------------------------------------------------------------------
say "Halaman web (canvas 'Ookla Server Tester - Clone Halaman Test') juga bisa dipakai:"
note "Unduh HTML-nya, buka di browser, masukkan: localhost:$PORT"
note "(dibuka via file:// atau http://, koneksi ke localhost tidak diblokir)."

# -----------------------------------------------------------------------------
# 9) Selesai
# -----------------------------------------------------------------------------
if [ "$KEEP_RUNNING" = "1" ]; then
  say "Daemon dibiarkan berjalan (PID $DAEMON_PID). Matikan dengan: pkill -f '$BIN_DIR/OoklaServer'"
else
  say "Daemon dibiarkan berjalan agar bisa dipakai halaman web."
  note "Matikan manual dengan: pkill -f '$BIN_DIR/OoklaServer'"
fi
say "Simulasi selesai. Bandingkan baris PASS/FAIL CLI dengan ground-truth di atas."
