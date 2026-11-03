#!/usr/bin/env bash
# =============================================================================
# Ookla Cross-Validation Kit
# Binary OoklaServer RESMI  x  Speedtest CLI RESMI 1.2.0  x  clone kita
# =============================================================================
# Metode "domain -> localhost" (trick /etc/hosts):
#   1. Unduh binary OoklaServer resmi (stable) + Speedtest CLI resmi 1.2.0.
#   2. `speedtest -L` -> ambil satu server publik Ookla (id + host:port;
#      dipilih otomatis entri port 8080, bisa di-override via SERVER_ID).
#   3. Petakan domain server itu ke 127.0.0.1 / ::1 di /etc/hosts (blok
#      bertanda, otomatis dipulihkan saat script selesai/kontrol-C).
#   4. `speedtest -s <id>` kini TIDAK SADAR mengetes OoklaServer resmi yang
#      berjalan di localhost: domain sama, id sama, koneksi jatuh ke daemon
#      lokal. Bukti: result.server.ip == 127.0.0.1 pada output JSON.
#   5. Jalankan clone (ookla_host_tester.py) ke localhost:8080.
#   6. Analisis silang otomatis -> crossval-report.md + verdict
#      KONSISTEN / BELUM LENGKAP.
#
# Catatan cross-agent (repo SpeedtestHost-Tester): Speedtest CLI resmi ke
# OoklaServer memakai protokol netgauge TCP murni (zero HTTP request),
# sehingga sertifikat self-signed TIDAK mengganggu CLI resmi.
#
# Kebutuhan: root/sudo (menulis /etc/hosts), wget atau curl, tar, openssl,
#            python3, Linux x86_64 atau aarch64.
#
# Pemakaian:
#   sudo bash ookla_cross_validate.sh
#   sudo SERVER_ID=1234 bash ookla_cross_validate.sh   # paksa server id
#   sudo KEEP_RUNNING=1 bash ookla_cross_validate.sh  # daemon dibiarkan hidup
#   sudo CLI_PY=/path/ookla_host_tester.py bash ookla_cross_validate.sh
#
# Env: PORT (8080), BASE_DIR ($HOME/ookla-sim), CV_DIR ($HOME/ookla-crossval),
#      CLI_PY, SERVER_ID, KEEP_RUNNING.
# =============================================================================
set -euo pipefail

PORT="${PORT:-8080}"
BASE_DIR="${BASE_DIR:-$HOME/ookla-sim}"
CV_DIR="${CV_DIR:-$HOME/ookla-crossval}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_ID="${SERVER_ID:-}"
KEEP_RUNNING="${KEEP_RUNNING:-0}"

if [ -z "${CLI_PY:-}" ]; then
  for c in "$SCRIPT_DIR/ookla_host_tester.py" \
           "$SCRIPT_DIR/../cli/ookla_host_tester.py" \
           "$SCRIPT_DIR/cli/ookla_host_tester.py"; do
    if [ -f "$c" ]; then CLI_PY="$c"; break; fi
  done
  CLI_PY="${CLI_PY:-$SCRIPT_DIR/ookla_host_tester.py}"
fi

HOSTS_BEGIN="# BEGIN ookla-crossval"
HOSTS_END="# END ookla-crossval"
DAEMON_PID=""

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[0;32m[ OK ]\033[0m %s\n' "$*"; }
warn() { printf '\033[0;33m[WARN]\033[0m %s\n' "$*"; }
fail() { printf '\033[0;31m[FAIL]\033[0m %s\n' "$*"; }

cleanup() {
  local rc=$?
  # WAJIB: pulihkan /etc/hosts walau KEEP_RUNNING (domain publik tidak boleh
  # tertinggal menunjuk ke localhost).
  if [ -f /etc/hosts ] && grep -q "BEGIN ookla-crossval" /etc/hosts 2>/dev/null; then
    if sed -i '/# BEGIN ookla-crossval/,/# END ookla-crossval/d' /etc/hosts 2>/dev/null; then
      ok "/etc/hosts dipulihkan (blok ookla-crossval dihapus)"
    else
      fail "GAGAL memulihkan /etc/hosts - hapus manual baris antara: $HOSTS_BEGIN dan $HOSTS_END"
    fi
  fi
  if [ "${KEEP_RUNNING:-0}" != "1" ] && [ -n "$DAEMON_PID" ] && kill -0 "$DAEMON_PID" 2>/dev/null; then
    kill "$DAEMON_PID" 2>/dev/null || true
    ok "daemon OoklaServer (pid $DAEMON_PID) dihentikan"
  fi
  exit "$rc"
}
trap cleanup EXIT INT TERM

# -----------------------------------------------------------------------------
# 0. Prasyarat
# -----------------------------------------------------------------------------
[ "$(id -u)" -eq 0 ] || { fail "Harus dijalankan sebagai root: sudo bash ookla_cross_validate.sh (perlu menulis /etc/hosts)."; exit 1; }

for c in tar openssl python3 getent; do
  command -v "$c" >/dev/null 2>&1 || { fail "Perintah $c tidak ditemukan."; exit 1; }
done
FETCH=""
if command -v wget >/dev/null 2>&1; then FETCH="wget"
elif command -v curl >/dev/null 2>&1; then FETCH="curl"
else fail "Butuh wget atau curl untuk mengunduh binary."; exit 1
fi

fetch() { # fetch <url> <output>
  if [ "$FETCH" = "wget" ]; then wget -q --show-progress -O "$2" "$1"
  else curl -fL --progress-bar -o "$2" "$1"; fi
}

probe_code() { # probe_code <path> -> HTTP status code (000 bila gagal)
  if [ "$FETCH" = "curl" ]; then
    curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$PORT$1"
  else
    if wget -q -O /dev/null --timeout=10 "http://127.0.0.1:$PORT$1"; then echo 200; else echo 000; fi
  fi
}

arch_detect() {
  case "$(uname -m)" in
    x86_64|amd64) echo "x86_64" ;;
    aarch64|arm64) echo "aarch64" ;;
    *) fail "Arsitektur tidak didukung: $(uname -m) (butuh x86_64 atau aarch64)."; exit 1 ;;
  esac
}

mkdir -p "$BASE_DIR" "$CV_DIR"

# -----------------------------------------------------------------------------
# 1. Binary resmi: OoklaServer (stable) + Speedtest CLI 1.2.0
# -----------------------------------------------------------------------------
ARCH="$(arch_detect)"
OOKLA_URL="https://install.speedtest.net/ooklaserver/stable/OoklaServer-linux-${ARCH}-static-musl.tgz"
CLI_URL="https://install.speedtest.net/app/cli/ookla-speedtest-1.2.0-linux-${ARCH}.tgz"

if [ ! -f "$BASE_DIR/OoklaServer" ]; then
  say "Mengunduh binary OoklaServer resmi ($ARCH)..."
  fetch "$OOKLA_URL" "$BASE_DIR/ooklaserver.tgz"
  tar -xzf "$BASE_DIR/ooklaserver.tgz" -C "$BASE_DIR"
  chmod +x "$BASE_DIR/OoklaServer" 2>/dev/null || true
fi
[ -f "$BASE_DIR/OoklaServer" ] || { fail "OoklaServer tidak ditemukan setelah ekstraksi."; exit 1; }
ok "Binary OoklaServer resmi siap: $BASE_DIR/OoklaServer"

if [ ! -f "$CV_DIR/speedtest" ]; then
  say "Mengunduh Speedtest CLI resmi 1.2.0 ($ARCH)..."
  fetch "$CLI_URL" "$CV_DIR/speedtest-cli.tgz"
  tar -xzf "$CV_DIR/speedtest-cli.tgz" -C "$CV_DIR"
  chmod +x "$CV_DIR/speedtest" 2>/dev/null || true
fi
[ -f "$CV_DIR/speedtest" ] || { fail "speedtest CLI tidak ditemukan setelah ekstraksi."; exit 1; }

"$CV_DIR/speedtest" --accept-license --accept-gdpr --version >/dev/null
ok "Speedtest CLI resmi siap: $("$CV_DIR/speedtest --version 2>/dev/null | head -n 1 || echo 1.2.0)"

# -----------------------------------------------------------------------------
# 2. Pilih server Ookla publik (id + domain) dari daftar resmi
# -----------------------------------------------------------------------------
say "Mengambil daftar server Ookla (speedtest -L)..."
"$CV_DIR/speedtest" -L -f json > "$CV_DIR/servers.json" 2> "$CV_DIR/servers.stderr"

PICK="$(python3 - "$CV_DIR/servers.json" "${SERVER_ID:-}" <<'PYEOF' || true
import json, sys

path, forced = sys.argv[1], sys.argv[2].strip()

def events(path):
    evs = []
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    evs.append(json.loads(line))
                except Exception:
                    pass
    except Exception:
        pass
    if not evs:
        try:
            with open(path) as f:
                evs = [json.load(f)]
        except Exception:
            pass
    return evs

servers = []
for e in events(path):
    if isinstance(e, dict) and isinstance(e.get("servers"), list):
        servers = e["servers"]
        break

def entry(s):
    host = str(s.get("host") or "")
    domain = host.rsplit(":", 1)[0] if ":" in host else host
    port = s.get("port")
    if port is None and ":" in host:
        port = host.rsplit(":", 1)[-1]
    try:
        port = int(port)
    except Exception:
        port = 0
    return str(s.get("id") or ""), host, domain, port

cands = [entry(s) for s in servers if isinstance(s, dict)]
if forced:
    for c in cands:
        if c[0] == forced:
            if c[3] != 8080:
                sys.stderr.write("Server id %s bukan port 8080 (port %s); daemon lokal hanya port 8080.\n" % (forced, c[3]))
                sys.exit(2)
            print(c[0], c[1], c[2], c[3])
            sys.exit(0)
    sys.stderr.write("Server id %s tidak ada di daftar Ookla.\n" % forced)
    sys.exit(2)

p8080 = [c for c in cands if c[3] == 8080 and c[2]]
if p8080:
    c = p8080[0]
    print(c[0], c[1], c[2], c[3])
    sys.exit(0)
sys.stderr.write("Tidak ada server port 8080 di daftar; set SERVER_ID=<id> manual.\n")
sys.exit(2)
PYEOF
)"

if [ -z "${PICK:-}" ]; then
  say "Parse JSON gagal - fallback ke output human-readable (-L)..."
  LINE="$("$CV_DIR/speedtest" -L 2>/dev/null | grep ':8080' | head -n 1 || true)"
  [ -n "$LINE" ] || { fail "Tidak ada server port 8080 yang bisa dipilih dari daftar Ookla."; exit 1; }
  SRV_ID="$(printf '%s' "$LINE" | awk '{print $1}' | tr -d ')')"
  SRV_HOST="$(printf '%s' "$LINE" | awk '{print $2}')"
  SRV_DOMAIN="${SRV_HOST%%:*}"
  SRV_PORT="${SRV_HOST##*:}"
else
  read -r SRV_ID SRV_HOST SRV_DOMAIN SRV_PORT <<<"$PICK"
fi

[ -n "${SRV_DOMAIN:-}" ] || { fail "Domain server tidak terdeteksi."; exit 1; }
[ "${SRV_PORT:-8080}" = "8080" ] || { fail "Server terpilih bukan port 8080 (port $SRV_PORT) - daemon lokal hanya port 8080. Set SERVER_ID=<id lain>."; exit 1; }
ok "Server Ookla terpilih: id=$SRV_ID host=$SRV_HOST (domain: $SRV_DOMAIN)"

# -----------------------------------------------------------------------------
# 3. Sertifikat self-signed + properties (hanya port 8080)
# -----------------------------------------------------------------------------
CERT="$BASE_DIR/cert.pem"
KEY="$BASE_DIR/key.pem"
NEED_CERT=1
if [ -f "$CERT" ] && [ -f "$KEY" ]; then
  if openssl x509 -in "$CERT" -noout -text 2>/dev/null | grep -q "DNS:$SRV_DOMAIN"; then
    NEED_CERT=0
    ok "Sertifikat lama sudah memuat SAN $SRV_DOMAIN - dipakai ulang"
  fi
fi
if [ "$NEED_CERT" -eq 1 ]; then
  say "Membuat sertifikat self-signed (SAN: localhost, $SRV_DOMAIN, 127.0.0.1, ::1)..."
  openssl req -x509 -newkey rsa:2048 -sha256 -days 825 -nodes \
    -keyout "$KEY" -out "$CERT" \
    -subj "/CN=$SRV_DOMAIN" \
    -addext "subjectAltName=DNS:localhost,DNS:$SRV_DOMAIN,IP:127.0.0.1,IP:::1" >/dev/null 2>&1
  ok "Sertifikat dibuat: $CERT"
fi

cat > "$BASE_DIR/OoklaServer.properties" <<PROP
OoklaServer.tcpPorts = $PORT
OoklaServer.udpPorts = $PORT
OoklaServer.useIPv6 = true
OoklaServer.allowedDomains = *
OoklaServer.ssl.useLetsEncrypt = false
OoklaServer.openSSL.server.certificateFile = cert.pem
OoklaServer.openSSL.server.privateKeyFile = key.pem
OoklaServer.openSSL.server.minimumTLSProtocol = 1.2
PROP
ok "OoklaServer.properties: hanya port $PORT (TCP+UDP), allowedDomains=*, TLS port sama"

# -----------------------------------------------------------------------------
# 4. Jalankan daemon resmi di localhost
# -----------------------------------------------------------------------------
OLD_PIDS="$(pgrep -f "OoklaServer" 2>/dev/null || true)"
if [ -n "$OLD_PIDS" ]; then
  warn "Mematikan daemon OoklaServer lama (pid: $OLD_PIDS)..."
  # shellcheck disable=SC2086
  kill $OLD_PIDS 2>/dev/null || true
  sleep 2
fi

say "Menjalankan binary OoklaServer RESMI di port $PORT..."
( cd "$BASE_DIR" && nohup ./OoklaServer > "$CV_DIR/daemon.log" 2>&1 & )
sleep 3
DAEMON_PID="$(pgrep -f "$BASE_DIR/OoklaServer" | head -n 1 || true)"
[ -n "$DAEMON_PID" ] || { fail "Daemon gagal start - lihat $CV_DIR/daemon.log"; exit 1; }
ok "Daemon berjalan (pid $DAEMON_PID)"

READY=0
for _ in $(seq 1 30); do
  CODE="$(probe_code /hi)"
  if [ "$CODE" = "200" ]; then READY=1; break; fi
  sleep 1
done
[ "$READY" -eq 1 ] || { fail "GET /hi tidak menjawab dalam 30 detik - lihat $CV_DIR/daemon.log"; exit 1; }

say "Ground-truth daemon resmi (HTTP di port $PORT):"
HI_BODY="$( { curl -s --max-time 10 "http://127.0.0.1:$PORT/hi" 2>/dev/null || wget -q -O - --timeout=10 "http://127.0.0.1:$PORT/hi" 2>/dev/null; } || true )"
ok "GET /hi -> ${HI_BODY:-<kosong>}"
for p in "/crossdomain.xml" "/latency.txt" "/speedtest/latency.txt" "/speedtest/upload.php" "/speedtest/random1000x1000.jpg"; do
  CODE="$(probe_code "$p")"
  if [ "$CODE" = "200" ]; then ok "GET $p -> 200"
  else warn "GET $p -> $CODE"; fi
done

# -----------------------------------------------------------------------------
# 5. Trick /etc/hosts: domain server Ookla -> localhost
# -----------------------------------------------------------------------------
say "Trick /etc/hosts: $SRV_DOMAIN -> 127.0.0.1 / ::1 (server id $SRV_ID)..."
cp /etc/hosts "$CV_DIR/hosts.backup"
if grep -q "BEGIN ookla-crossval" /etc/hosts 2>/dev/null; then
  sed -i '/# BEGIN ookla-crossval/,/# END ookla-crossval/d' /etc/hosts
fi
cat >> /etc/hosts <<HOSTS

$HOSTS_BEGIN
127.0.0.1 $SRV_DOMAIN
::1 $SRV_DOMAIN
$HOSTS_END
HOSTS
ok "Blok ditambahkan (backup: $CV_DIR/hosts.backup)"
RESOLVED="$(getent hosts "$SRV_DOMAIN" | head -n 1 || true)"
ok "Resolusi sekarang: ${RESOLVED:-<tidak terdeteksi>}"

# -----------------------------------------------------------------------------
# 6. Speedtest CLI resmi -> server id terpilih (domain kini = localhost)
# -----------------------------------------------------------------------------
say "Speedtest CLI resmi 1.2.0 -> server id $SRV_ID ($SRV_DOMAIN = localhost)..."
CLI_RC=0
timeout 300 "$CV_DIR/speedtest" --accept-license --accept-gdpr -s "$SRV_ID" -f json \
  > "$CV_DIR/cli-result.json" 2> "$CV_DIR/cli-result.stderr" || CLI_RC=$?
if [ "$CLI_RC" -eq 0 ]; then ok "Speedtest CLI selesai (exit 0)"
else warn "Speedtest CLI exit code $CLI_RC (lihat $CV_DIR/cli-result.stderr)"; fi

# -----------------------------------------------------------------------------
# 7. Clone kita -> daemon yang sama
# -----------------------------------------------------------------------------
if [ -f "$CLI_PY" ]; then
  say "Clone (ookla_host_tester.py v1.1) -> localhost:$PORT..."
  CLONE_RC=0
  python3 "$CLI_PY" "localhost:$PORT" --json --insecure \
    > "$CV_DIR/clone-result.json" 2> "$CV_DIR/clone-result.stderr" || CLONE_RC=$?
  if [ "$CLONE_RC" -eq 0 ]; then ok "Clone selesai (exit 0)"
  else warn "Clone exit code $CLONE_RC (lihat $CV_DIR/clone-result.stderr)"; fi
else
  warn "ookla_host_tester.py tidak ditemukan (CLI_PY=$CLI_PY) - analisis hanya dari sisi CLI resmi."
fi

# -----------------------------------------------------------------------------
# 8. Analisis silang -> crossval-report.md
# -----------------------------------------------------------------------------
say "Analisis silang 3-arah..."
python3 - "$CV_DIR" "$SRV_ID" "$SRV_DOMAIN" "$HI_BODY" <<'PYEOF'
import json, os, sys

cv, srv_id, domain, hi_body = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

def events(name):
    path = os.path.join(cv, name)
    evs = []
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    evs.append(json.loads(line))
                except Exception:
                    pass
    except Exception:
        pass
    if not evs:
        try:
            with open(path) as f:
                evs = [json.load(f)]
        except Exception:
            pass
    return evs

def find_result(evs):
    for e in evs:
        if isinstance(e, dict) and e.get("type") == "result":
            return e
    for e in evs:
        if isinstance(e, dict) and "server" in e and "download" in e:
            return e
    return None

cli = find_result(events("cli-result.json"))
clone = None
try:
    with open(os.path.join(cv, "clone-result.json")) as f:
        clone = json.load(f)
except Exception:
    clone = None

L = []
a = L.append
a("# Laporan Cross-Validation — OoklaServer resmi x Speedtest CLI resmi x clone")
a("")
a("- Server Ookla terpilih: id %s, domain %s (dipetakan ke localhost via /etc/hosts)" % (srv_id, domain))
a("- Daemon: binary OoklaServer RESMI (stable) di port 8080, http+tls satu port")
a("- Klien A: Speedtest CLI RESMI 1.2.0 (speedtest -s %s -f json)" % srv_id)
a("- Klien B: clone ookla_host_tester.py (localhost:8080 --json --insecure)")
a("- GET /hi daemon: %s" % (hi_body or "<kosong>"))
a("")

checks = []
def chk(name, cond, good, bad):
    checks.append((name, bool(cond), good, bad))

if cli:
    r = cli.get("result", cli)
    server = r.get("server", {}) if isinstance(r, dict) else {}
    chk("cli.server.id == %s" % srv_id,
        str(server.get("id")) == str(srv_id),
        "CLI mengetes server id yang dipilih (%s)" % server.get("id"),
        "id tidak cocok: %s" % server.get("id"))
    chk("cli.server.ip == 127.0.0.1 (BUKTI trick)",
        server.get("ip") == "127.0.0.1",
        "CLI tersambung ke daemon LOKAL (ip=%s, host=%s)" % (server.get("ip"), server.get("host")),
        "ip=%s - trick /etc/hosts tidak efektif" % server.get("ip"))
    ping = (r.get("ping") or {}).get("latency")
    chk("cli.ping.latency tercatat",
        isinstance(ping, (int, float)) and ping >= 0,
        "latency %s ms" % ping,
        "latency tidak tercatat: %s" % ping)
    dl = (r.get("download") or {}).get("bandwidth")
    ul = (r.get("upload") or {}).get("bandwidth")
    chk("cli.download.bandwidth > 0", isinstance(dl, (int, float)) and dl > 0,
        "download %s bytes/s" % dl, "download tidak tercatat: %s" % dl)
    chk("cli.upload.bandwidth > 0", isinstance(ul, (int, float)) and ul > 0,
        "upload %s bytes/s" % ul, "upload tidak tercatat: %s" % ul)
else:
    chk("cli-result.json valid", False, "", "JSON hasil CLI resmi tidak terbaca (CLI gagal?)")

if clone:
    sm = clone.get("summary", {})
    failed = sm.get("failed", -1)
    chk("clone.summary.failed == 0", failed == 0,
        "clone: %s/%s PASS, %s WARN, %s FAIL" % (sm.get("passed"), sm.get("total"), sm.get("warned"), failed),
        "clone punya %s check FAIL" % failed)
    ver_detail = (clone.get("checks", {}).get("version", {}) or {}).get("detail", "")
    ng_detail = (clone.get("checks", {}).get("netgauge", {}) or {}).get("detail", "")
    hi_token = (hi_body or "").split()[0] if (hi_body or "").split() else ""
    if hi_token:
        chk("versi /hi == versi di clone",
            (hi_token in ver_detail) or (hi_token in ng_detail),
            "versi daemon konsisten di kedua alat (%s)" % hi_token,
            "versi /hi (%s) tidak ditemukan di output clone" % hi_token)
else:
    chk("clone-result.json valid", False, "", "JSON hasil clone tidak terbaca")

a("## Analisis silang")
a("")
for name, okflag, good, bad in checks:
    mark = "PASS" if okflag else "GAGAL"
    a("- [%s] %s — %s" % (mark, name, good if okflag else bad))
a("")
a("## Hasil Speedtest CLI resmi")
a("")
if cli:
    r = cli.get("result", cli)
    server = r.get("server", {})
    a("- server: id=%s host=%s ip=%s port=%s" % (server.get("id"), server.get("host"), server.get("ip"), server.get("port")))
    a("- ping: %s ms | download: %s bytes/s | upload: %s bytes/s" % (
        (r.get("ping") or {}).get("latency"),
        (r.get("download") or {}).get("bandwidth"),
        (r.get("upload") or {}).get("bandwidth")))
    a("- result url: %s" % (r.get("result") or {}).get("url"))
else:
    a("- (tidak tersedia)")
a("")
a("## Hasil clone (ookla_host_tester.py)")
a("")
if clone:
    for name, res in clone.get("checks", {}).items():
        a("- %s: %s — %s" % (name, str(res.get("status")).upper(), res.get("detail")))
    a("- summary: %s" % json.dumps(clone.get("summary", {})))
else:
    a("- (tidak tersedia)")
a("")

all_ok = all(c[1] for c in checks)
a("## Kesimpulan")
a("")
if all_ok:
    a("**KONSISTEN** — Speedtest CLI resmi dan clone sama-sama berhasil mengetes")
    a("binary OoklaServer resmi di localhost:8080; hasil keduanya saling menguatkan")
    a("(clone konsep, teknis, infrastruktur, dan arsitektur project benar).")
else:
    a("**BELUM LENGKAP** — ada pemeriksaan yang gagal:")
    for name, okflag, good, bad in checks:
        if not okflag:
            a("- %s: %s" % (name, bad))
a("")
report = os.path.join(cv, "crossval-report.md")
with open(report, "w") as f:
    f.write("\n".join(L) + "\n")
print("\n".join(L))
print()
print("Laporan disimpan: %s" % report)
PYEOF

say "Selesai. Laporan: $CV_DIR/crossval-report.md"
if [ "${KEEP_RUNNING:-0}" = "1" ]; then
  warn "KEEP_RUNNING=1 - daemon (pid $DAEMON_PID) dibiarkan hidup; /etc/hosts tetap dipulihkan."
fi
