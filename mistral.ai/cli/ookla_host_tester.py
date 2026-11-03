#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ookla Server Tester - CLI
=========================

Replika cara kerja https://www.speedtest.net/host-tester (Ookla Server Tester)
dalam bentuk CLI. Semua test berjalan dari mesin Anda langsung ke server target,
tanpa captcha, tanpa banner.

Cara pakai:
    python3 ookla_host_tester.py host.yapsidarussalam.or.id:8080
    python3 ookla_host_tester.py host.example.com            (port default: 8080)
    python3 ookla_host_tester.py http://host.example.com:8080 (URL juga diterima)
    python3 ookla_host_tester.py host.example.com:8080 --json (output machine-readable)
    python3 ookla_host_tester.py host.example.com:8080 --insecure (jangan verifikasi sertifikat TLS)

Exit code: 0 = semua check PASS (WARN diperbolehkan), 1 = ada FAIL.

Pemeriksaan yang dijalankan (identik dengan tester resmi Ookla):
  1. dns/ipv6        - resolusi A / AAAA (Ookla mensyaratkan IPv4 + IPv6)
  2. netgauge        - protokol TCP OoklaServer di port 8080:
                      HI -> "HELLO <versi daemon>", 20x PING/PONG (latency),
                      DOWNLOAD <n> (kecepatan unduh), UPLOAD <n> 0 (kecepatan unggah), QUIT
  3. websocket       - netgauge via WebSocket (RFC 6455) di port yang sama
  4. version         - HTTP GET /hi (versi daemon)
  5. crossdomain     - HTTP GET /crossdomain.xml (harus allow-access-from domain="*")
  6. https           - TLS di port 8080 + validitas sertifikat
  7. upload          - legacy HTTP upload script: POST /upload.php?callback=test
  8. download        - file gambar legacy random*.jpg (validasi JPEG + kecepatan)
  9. latency         - file latency.txt (RTT berulang)
 10. keepalive       - koneksi persisten HTTP/1.1 (beberapa request pada 1 koneksi)

Hanya memakai pustaka standar Python 3.7+.

Riwayat versi:
    1.0 - rilis awal (10 check; lulus simulasi protokol 6/6 skenario).
    1.1 - hasil cross-analysis antar-agent (repo SpeedtestHost-Tester):
          * WebSocket: dukungan target IPv6-literal (mis. [::1]:8080) via
            getaddrinfo - bug kelas yang sama dengan yang ditemukan agent
            z.ai di engine mereka (IPv6 literal gagal di URL construction).
          * Header User-Agent realistis di semua request HTTP + upgrade
            WebSocket - server produksi Ookla mereset klien tanpa UA
            (temuan z.ai dari daemon produksi).
          * File legacy (latency.txt, upload.php, random*.jpg) dicoba di "/"
            lalu fallback "/speedtest/" - z.ai memverifikasi daemon resmi
            menyajikan file legacy di bawah /speedtest/.
"""

import argparse
import base64
import json
import os
import socket
import ssl
import struct
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime

try:
    from http.client import HTTPConnection, HTTPSConnection, HTTPResponse
except ImportError:  # pragma: no cover
    from httplib import HTTPConnection, HTTPSConnection, HTTPResponse  # py2 fallback (tidak didukung penuh)

__version__ = "1.1"

DEFAULT_PORT = 8080
DL_FILES = [
    "random500x500.jpg", "random1000x1000.jpg", "random1500x1500.jpg",
    "random2000x2000.jpg", "random2500x2500.jpg", "random3000x3000.jpg",
    "random3500x3500.jpg", "random4000x4000.jpg",
]
SPEED_FILE = "random4000x4000.jpg"
# Server produksi Ookla diketahui mereset klien tanpa User-Agent (temuan
# cross-agent z.ai); UA realistis wajib dikirim di semua request.
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
# Base path file legacy: daemon resmi dapat menyajikannya di "/" (akar)
# maupun di "/speedtest/" (terverifikasi agent z.ai vs binary resmi).
LEGACY_BASES = ["", "/speedtest"]


# ----------------------------------------------------------------------------
# Util
# ----------------------------------------------------------------------------
class TestError(Exception):
    pass


def eprint(*a, **kw):
    print(*a, file=sys.stderr, **kw)


class Colors:
    def __init__(self, enabled):
        self.enabled = enabled

    def wrap(self, code, s):
        return "\033[%sm%s\033[0m" % (code, s) if self.enabled else s

    def green(self, s):
        return self.wrap("0;32", s)

    def red(self, s):
        return self.wrap("0;31", s)

    def yellow(self, s):
        return self.wrap("0;33", s)

    def cyan(self, s):
        return self.wrap("0;36", s)

    def bold(self, s):
        return self.wrap("0;1", s)


def fmt_speed(bps):
    if bps is None or bps <= 0:
        return "n/a"
    if bps >= 1e9:
        return "%.2f Gbps" % (bps / 1e9)
    if bps >= 1e6:
        return "%.2f Mbps" % (bps / 1e6)
    return "%.2f Kbps" % (bps / 1e3)


def fmt_bytes(n):
    if n >= 1048576:
        return "%.2f MB" % (n / 1048576.0)
    if n >= 1024:
        return "%.2f KB" % (n / 1024.0)
    return "%d B" % n


def parse_target(raw):
    """Terima domain, domain:port, [ipv6], [ipv6]:port, atau URL lengkap."""
    s = (raw or "").strip()
    if not s:
        raise TestError("host tidak boleh kosong")
    if "://" in s:
        s = s.split("://", 1)[1]
    s = s.split("/", 1)[0].split("?", 1)[0].split("#", 1)[0]
    if "@" in s:
        s = s.rsplit("@", 1)[1]
    host, port = s, DEFAULT_PORT
    if s.startswith("["):
        end = s.find("]")
        if end == -1:
            raise TestError("Invalid hostname format")
        host = s[1:end]
        rest = s[end + 1:]
        if rest.startswith(":"):
            port = int(rest[1:])
    else:
        if s.count(":") == 1:
            h, p = s.split(":", 1)
            if p.isdigit() and 1 <= int(p) <= 65535:
                host, port = h, int(p)
        elif ":" in s:  # IPv6 telanjang
            host = s
    if not host:
        raise TestError("Invalid hostname format")
    if not (1 <= port <= 65535):
        raise TestError("Invalid port")
    return host, port


# ----------------------------------------------------------------------------
# Netgauge TCP (protokol OoklaServer): HI / PING / DOWNLOAD / UPLOAD / QUIT
# ----------------------------------------------------------------------------
class NetgaugeTCP(object):
    def __init__(self, host, port, family, timeout):
        self.host = host
        self.port = port
        self.family = family
        self.timeout = timeout
        self.sock = None
        self.buf = b""

    # -- dasar ---------------------------------------------------------------
    def connect(self):
        addr = (self.host, self.port)
        if self.host and ":" not in self.host:  # hostname: pakai getaddrinfo utk family
            try:
                infos = socket.getaddrinfo(self.host, self.port, self.family,
                                          socket.SOCK_STREAM, socket.IPPROTO_TCP)
                addr = infos[0][4]
            except socket.gaierror:
                raise TestError("DNS lookup gagal untuk %s" % self.host)
        self.sock = socket.socket(self.family, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        try:
            self.sock.connect(addr)
        except socket.error as e:
            self.close()
            raise TestError("TCP connect %s:%d gagal: %s" % (self.host, self.port, e))

    def close(self):
        try:
            if self.sock:
                self.sock.close()
        except Exception:
            pass
        self.sock = None

    def send(self, data):
        self.sock.sendall(data)

    def recv_exact(self, n):
        out = self.buf
        self.buf = b""
        while len(out) < n:
            chunk = self.sock.recv(min(65536, n - len(out)))
            if not chunk:
                raise TestError("koneksi terputus (menerima %d/%d byte)" % (len(out), n))
            out += chunk
        return out

    def recv_line(self, max_len=4096):
        while b"\n" not in self.buf:
            if len(self.buf) > max_len:
                raise TestError("baris respons terlalu panjang")
            chunk = self.sock.recv(4096)
            if not chunk:
                raise TestError("koneksi terputus saat menunggu respons")
            self.buf += chunk
        line, self.buf = self.buf.split(b"\n", 1)
        return line.decode("utf-8", "replace").rstrip("\r")

    # -- langkah protokol ----------------------------------------------------
    def handshake(self):
        self.send(b"HI\n")
        line = self.recv_line()
        if not line.upper().startswith("HELLO"):
            raise TestError("handshake tidak valid: %r" % line[:80])
        return line.split(None, 1)[1].strip() if " " in line else line

    def ping(self, count=20):
        rtts = []
        for _ in range(count):
            t0 = time.perf_counter()
            self.send(b"PING %d\n" % int(time.time() * 1000))
            line = self.recv_line()
            if not line.upper().startswith("PONG"):
                raise TestError("respons PONG tidak valid: %r" % line[:80])
            rtts.append((time.perf_counter() - t0) * 1000.0)
        return rtts

    def download(self, nbytes):
        self.send(b"DOWNLOAD %d\n" % nbytes)
        t0 = time.perf_counter()
        data = self.recv_exact(nbytes)  # server mengirim tepat nbytes byte
        dur = time.perf_counter() - t0
        return {
            "bytes": len(data),
            "duration": dur,
            "bps": (len(data) * 8) / dur if dur > 0 else None,
        }

    def upload(self, nbytes):
        cmd = ("UPLOAD %d 0\n" % nbytes).encode("ascii")
        payload_len = nbytes - len(cmd)  # sesuai protokol: panjang payload = N - panjang command
        head = os.urandom(min(64, payload_len))
        payload = head + b"\x00" * max(0, payload_len - len(head))
        t0 = time.perf_counter()
        self.send(cmd)
        self.sock.sendall(payload)
        line = self.recv_line()
        dur = time.perf_counter() - t0
        if not line.upper().startswith("OK"):
            raise TestError("server tidak merespons OK setelah upload: %r" % line[:80])
        return {
            "bytes": nbytes,
            "server_response": line,
            "duration": dur,
            "bps": (nbytes * 8) / dur if dur > 0 else None,
        }

    def quit(self):
        try:
            self.send(b"QUIT\n")
        except Exception:
            pass
        self.close()


# ----------------------------------------------------------------------------
# WebSocket client minimal (RFC 6455) untuk netgauge via ws://
# ----------------------------------------------------------------------------
class WebSocketClient(object):
    def __init__(self, host, port, use_tls, timeout):
        self.host = host
        self.port = port
        self.use_tls = use_tls
        self.timeout = timeout
        self.sock = None
        self.buf = b""

    def connect(self, path="/"):
        # v1.1: dukungan IPv6-literal ([::1]:8080) via getaddrinfo
        try:
            infos = socket.getaddrinfo(self.host, self.port, 0, socket.SOCK_STREAM)
            family, addr = infos[0][0], infos[0][4]
        except socket.gaierror:
            family = socket.AF_INET6 if ":" in self.host else socket.AF_INET
            addr = (self.host, self.port)
        raw = socket.socket(family, socket.SOCK_STREAM)
        raw.settimeout(self.timeout)
        raw.connect(addr)
        if self.use_tls:
            ctx = ssl._create_unverified_context()
            raw = ctx.wrap_socket(raw, server_hostname=self.host)
        self.sock = raw
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        req = (
            "GET %s HTTP/1.1\r\n"
            "Host: %s:%d\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            "Sec-WebSocket-Key: %s\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            "User-Agent: %s\r\n"
            "\r\n" % (path, self.host, self.port, key, UA)
        )
        self.sock.sendall(req.encode("ascii"))
        # baca sampai akhir header
        while b"\r\n\r\n" not in self.buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise TestError("koneksi terputus saat WebSocket upgrade")
            self.buf += chunk
        head, self.buf = self.buf.split(b"\r\n\r\n", 1)
        status_line = head.split(b"\r\n", 1)[0].decode("latin1")
        if " 101 " not in status_line + " ":
            raise TestError("server tidak menerima upgrade WebSocket: %s" % status_line.strip())

    def close(self):
        try:
            if self.sock:
                self.sock.close()
        except Exception:
            pass
        self.sock = None

    def _read_exact(self, n):
        out = self.buf
        self.buf = b""
        while len(out) < n:
            chunk = self.sock.recv(n - len(out))
            if not chunk:
                raise TestError("koneksi websocket terputus")
            out += chunk
        return out

    def send_frame(self, payload, opcode=0x1):
        # frame client->server wajib di-mask
        mask = os.urandom(4)
        n = len(payload)
        header = bytes([0x80 | opcode])
        if n < 126:
            header += bytes([0x80 | n])
        elif n < 65536:
            header += bytes([0x80 | 126]) + struct.pack(">H", n)
        else:
            header += bytes([0x80 | 127]) + struct.pack(">Q", n)
        masked = bytes(bytearray(b ^ mask[i % 4] for i, b in enumerate(bytearray(payload))))
        self.sock.sendall(header + mask + masked)

    def recv_frame(self):
        (b1, b2) = bytearray(self._read_exact(2))
        opcode = b1 & 0x0F
        masked = b2 & 0x80
        n = b2 & 0x7F
        if n == 126:
            n = struct.unpack(">H", self._read_exact(2))[0]
        elif n == 127:
            n = struct.unpack(">Q", self._read_exact(8))[0]
        if masked:
            raise TestError("frame server tidak boleh di-mask (protokol salah)")
        payload = self._read_exact(n)
        return opcode, payload


def netgauge_ws_probe(host, port, timeout, use_tls):
    """Koneksi WebSocket + handshake HI -> HELLO. Coba frame teks, lalu binary."""
    last_err = None
    for opcode, label in ((0x1, "text frame"), (0x2, "binary frame")):
        ws = WebSocketClient(host, port, use_tls, timeout)
        try:
            ws.connect("/")
            ws.send_frame(b"HI\n", opcode=opcode)
            t0 = time.time()
            while time.time() - t0 < timeout:
                op, payload = ws.recv_frame()
                text = payload.decode("utf-8", "replace").strip()
                if "HELLO" in text.upper():
                    return text
                if op == 0x8:  # close
                    break
            last_err = "handshake HI via %s tidak menghasilkan HELLO" % label
        except Exception as e:
            last_err = str(e)
        finally:
            ws.close()
    raise TestError(last_err or "websocket gagal")


# ----------------------------------------------------------------------------
# HTTP helpers
# ----------------------------------------------------------------------------
def http_req(host, port, method, path, headers=None, body=None,
             timeout=10, use_tls=False, verify_tls=True):
    """Satu request HTTP. Mengembalikan (status, headers, body, elapsed, conn)."""
    t0 = time.perf_counter()
    if use_tls:
        ctx = ssl.create_default_context()
        if not verify_tls:
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        conn = HTTPSConnection(host, port, timeout=timeout, context=ctx)
    else:
        conn = HTTPConnection(host, port, timeout=timeout)
    try:
        h = dict(headers or {})
        h.setdefault("User-Agent", UA)
        conn.request(method, path, body=body, headers=h)
        resp = conn.getresponse()
        data = resp.read()
        elapsed = time.perf_counter() - t0
        return resp.status, dict(resp.getheaders()), data, elapsed, conn
    except Exception:
        conn.close()
        raise


def cert_days_left(host, port, timeout, verify_tls):
    """Handshake TLS murni untuk membaca sertifikat."""
    ctx = ssl.create_default_context()
    if not verify_tls:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    raw = socket.create_connection((host, port), timeout=timeout)
    try:
        s = ctx.wrap_socket(raw, server_hostname=host)
        cert = s.getpeercert() or {}
        not_after = cert.get("notAfter")
        days = None
        if not_after:
            try:
                exp = datetime.strptime(not_after, "%b %d %H:%M:%S %Y %Z")
                days = (exp - datetime.now()).days
            except ValueError:
                pass
        return cert, days
    finally:
        try:
            raw.close()
        except Exception:
            pass


# ----------------------------------------------------------------------------
# Checks - setiap fungsi mengembalikan dict:
#   {"status": "pass"|"fail"|"warn", "detail": str, + metrik bebas}
# ----------------------------------------------------------------------------
def check_dns(host, port):
    try:
        infos = socket.getaddrinfo(host, port, 0, socket.SOCK_STREAM, socket.IPPROTO_TCP)
    except socket.gaierror as e:
        return {"status": "fail", "detail": "DNS lookup gagal: %s" % e}
    v4 = sorted({i[4][0] for i in infos if i[0] == socket.AF_INET})
    v6 = sorted({i[4][0] for i in infos if i[0] == socket.AF_INET6})
    det = "A: %s" % (", ".join(v4) if v4 else "-")
    det += " | AAAA: %s" % (", ".join(v6[:3]) if v6 else "-")
    if not v4:
        return {"status": "fail", "detail": det + " - tidak ada record A"}
    if not v6:
        return {"status": "warn", "detail": det + " - tidak ada record AAAA (Ookla mensyaratkan IPv6)",
                "ipv4": v4, "ipv6": v6}
    return {"status": "pass", "detail": det, "ipv4": v4, "ipv6": v6}


def check_netgauge(host, port, timeout, dl_bytes, ul_bytes):
    """Coba via IPv4 dulu, lalu IPv6 (seperti curl -4 / curl -6 pada tester resmi)."""
    last_err = None
    for family, label in ((socket.AF_INET, "IPv4"), (socket.AF_INET6, "IPv6")):
        ng = NetgaugeTCP(host, port, family, timeout)
        try:
            ng.connect()
            version = ng.handshake()
            rtts = ng.ping(20)
            dl = ng.download(dl_bytes)
            ul = ng.upload(ul_bytes)
            ng.quit()
        except (TestError, socket.error) as e:
            ng.quit()
            last_err = "%s: %s" % (label, e)
            continue
        rtt_avg = sum(rtts) / len(rtts)
        return {
            "status": "pass",
            "detail": 'handshake HI -> HELLO "%s" via %s; 20x PING sukses' % (version, label),
            "version": version,
            "family": label,
            "ping_avg": rtt_avg,
            "ping_max": max(rtts),
            "download_bps": dl["bps"],
            "upload_bps": ul["bps"],
            "download_bytes": dl["bytes"],
            "upload_bytes": ul["bytes"],
        }
    return {"status": "fail", "detail": "protokol netgauge TCP gagal - %s" % last_err}


def check_websocket(host, port, timeout, use_tls=False):
    try:
        hello = netgauge_ws_probe(host, port, timeout, use_tls)
        return {"status": "pass", "detail": 'upgrade WebSocket OK, HI -> "%s"' % hello}
    except Exception as e:
        return {"status": "fail", "detail": "WebSocket netgauge gagal: %s" % e}


def check_version(host, port, timeout):
    try:
        status, _, body, _, _ = http_req(host, port, "GET", "/hi", timeout=timeout)
    except Exception as e:
        return {"status": "fail", "detail": "GET /hi gagal: %s" % e}
    if status != 200:
        return {"status": "fail", "detail": "GET /hi -> HTTP %d" % status}
    ver = body.decode("utf-8", "replace").strip().splitlines()
    ver = ver[0] if ver else ""
    return {"status": "pass", "detail": "GET /hi -> 200", "version": ver}


def check_crossdomain(host, port, timeout):
    try:
        status, _, body, _, _ = http_req(host, port, "GET", "/crossdomain.xml", timeout=timeout)
    except Exception as e:
        return {"status": "fail", "detail": "GET /crossdomain.xml gagal: %s" % e}
    if status != 200:
        return {"status": "fail", "detail": "crossdomain.xml -> HTTP %d" % status}
    try:
        root = ET.fromstring(body)
        nodes = root.findall(".//allow-access-from")
        if not nodes:
            return {"status": "fail", "detail": "tidak ada node allow-access-from"}
        domains = {n.get("domain") for n in nodes}
        if "*" not in domains:
            return {"status": "fail", "detail": 'allow-access-from domain="%s" (harus "*")' % ", ".join(sorted(domains))}
        return {"status": "pass", "detail": 'allow-access-from domain="*" (%s)' % fmt_bytes(len(body))}
    except ET.ParseError as e:
        return {"status": "fail", "detail": "crossdomain.xml bukan XML valid: %s" % e}


def check_https(host, port, timeout, verify_tls):
    # 1) handshake + sertifikat
    try:
        cert, days = cert_days_left(host, port, timeout, verify_tls)
    except ssl.SSLCertVerificationError as e:
        return {"status": "fail", "detail": "sertifikat TLS tidak valid: %s" % e.verify_message if hasattr(e, "verify_message") else str(e)}
    except Exception as e:
        return {"status": "fail", "detail": "TLS tidak tersedia di %d: %s" % (port, e)}
    # 2) request https di port yang sama
    try:
        status, _, body, _, _ = http_req(host, port, "GET", "/hi", timeout=timeout,
                                         use_tls=True, verify_tls=verify_tls)
        req_ok = status == 200
    except Exception as e:
        return {"status": "fail", "detail": "HTTPS request di port %d gagal: %s" % (port, e)}
    if not verify_tls:
        return {"status": "warn", "detail": "TLS aktif (--insecure: verifikasi sertifikat dilewati)"}
    exp = " kadaluarsa dalam %d hari" % days if days is not None else ""
    if not req_ok:
        return {"status": "warn", "detail": "TLS aktif, sertifikat valid%s, tetapi GET /hi via HTTPS -> HTTP %d" % (exp, status)}
    return {"status": "pass", "detail": "TLS aktif, sertifikat tervalidasi%s" % exp,
            "expires_days": days}


def check_upload(host, port, timeout, ul_bytes):
    n = ul_bytes
    head = os.urandom(min(64, n))
    payload = head + b"\x00" * max(0, n - len(head))
    status, body, elapsed, base_used = None, None, None, None
    last_err = None
    for base in LEGACY_BASES:
        try:
            status, _, body, elapsed, _ = http_req(
                host, port, "POST", base + "/upload.php?callback=test",
                headers={"Content-Type": "text/plain"},
                body=payload, timeout=max(timeout, 30))
            if status == 200:
                base_used = base
                break
        except Exception as e:
            last_err = e
    if base_used is None:
        if last_err is not None:
            return {"status": "fail", "detail": "POST upload.php gagal: %s" % last_err}
        return {"status": "fail",
                "detail": "upload.php -> HTTP %s (dicoba di / dan /speedtest/)" % status}
    text = body.decode("utf-8", "replace").strip()
    bps = (n * 8) / elapsed if elapsed > 0 else None
    size_ok = ("size=%d" % n) in text
    detail = "script upload merespons (%s, path: %s/upload.php)%s" % (
        fmt_bytes(n), base_used or "",
        " - size=%d dikonfirmasi" % n if size_ok else " - respons: %r" % text[:60] if text else "")
    return {"status": "pass", "detail": detail, "upload_bps": bps, "bytes": n}


def check_download(host, port, timeout):
    # a) file untuk pengukuran kecepatan (coba "/" lalu "/speedtest/")
    status, body, elapsed, base_used = None, None, None, None
    for base in LEGACY_BASES:
        try:
            status, _, body, elapsed, _ = http_req(host, port, "GET", base + "/" + SPEED_FILE,
                                                   timeout=max(timeout, 30))
            if status == 200:
                base_used = base
                break
        except Exception:
            continue
    if base_used is None:
        return {"status": "fail",
                "detail": "%s tidak ditemukan di / maupun /speedtest/ (HTTP terakhir: %s)"
                          % (SPEED_FILE, status)}
    is_jpeg = body[:3] == b"\xff\xd8\xff"
    bps = (len(body) * 8) / elapsed if elapsed > 0 else None
    missing = []
    # b) verifikasi keberadaan file gambar legacy lainnya (ranged GET, kedua base)
    for f in DL_FILES:
        if f == SPEED_FILE:
            continue
        found = False
        for base in LEGACY_BASES:
            try:
                st, _, _, _, _ = http_req(host, port, "GET", base + "/" + f,
                                          headers={"Range": "bytes=0-0"}, timeout=timeout)
                if st in (200, 206):
                    found = True
                    break
            except Exception:
                continue
        if not found:
            missing.append(f)
    detail = "%s (%s, %s) via HTTP (path: %s/%s)" % (
        SPEED_FILE, fmt_bytes(len(body)), "JPEG valid" if is_jpeg else "BUKAN JPEG",
        base_used or "", SPEED_FILE)
    if missing:
        detail += " | file tidak ditemukan: %s" % ", ".join(missing)
    status = "pass" if is_jpeg and not missing else ("warn" if is_jpeg else "fail")
    if not is_jpeg:
        detail += " - konten bukan gambar JPEG"
    return {"status": status, "detail": detail, "download_bps": bps, "bytes": len(body)}


def check_latency(host, port, timeout):
    # v1.1: cari base path yang benar ("/" atau "/speedtest/") dengan 1 sample,
    # lalu lanjutkan 4 sample berikutnya pada koneksi yang sama (keep-alive).
    rtts = []
    conn = None
    base_used = None
    for base in LEGACY_BASES:
        c = HTTPConnection(host, port, timeout=timeout)
        try:
            t0 = time.perf_counter()
            c.request("GET", base + "/latency.txt?nocache=%d" % time.time_ns(),
                      headers={"User-Agent": UA})
            resp = c.getresponse()
            resp.read()
            if resp.status == 200:
                rtts.append((time.perf_counter() - t0) * 1000.0)
                conn = c
                base_used = base
                break
        except Exception:
            pass
        finally:
            if conn is None:
                try:
                    c.close()
                except Exception:
                    pass
    if conn is None:
        return {"status": "fail",
                "detail": "latency.txt tidak ditemukan di / maupun /speedtest/"}
    try:
        for i in range(4):
            path = base_used + "/latency.txt?nocache=%d%d" % (time.time_ns(), i)
            t0 = time.perf_counter()
            conn.request("GET", path, headers={"User-Agent": UA})
            resp = conn.getresponse()
            resp.read()
            rtts.append((time.perf_counter() - t0) * 1000.0)
    except Exception as e:
        conn.close()
        return {"status": "fail", "detail": "latency.txt gagal: %s" % e}
    conn.close()
    return {
        "status": "pass",
        "detail": "5 permintaan latency.txt sukses (path: %s/latency.txt)" % (base_used or ""),
        "latency_avg": sum(rtts) / len(rtts),
        "latency_min": min(rtts),
        "latency_max": max(rtts),
    }


def check_keepalive(host, port, timeout):
    conn = HTTPConnection(host, port, timeout=timeout)
    header_info = ""
    base_used = None
    try:
        # v1.1: tentukan base path ("/" atau "/speedtest/") pada koneksi yang sama
        for base in LEGACY_BASES:
            conn.request("GET", base + "/latency.txt?ka=probe", headers={"User-Agent": UA})
            resp = conn.getresponse()
            resp.read()
            if resp.status == 200:
                base_used = base
                break
        if base_used is None:
            conn.close()
            return {"status": "fail",
                    "detail": "latency.txt tidak ditemukan (dicoba / dan /speedtest/)"}
        for i in range(3):
            conn.request("GET", base_used + "/latency.txt?ka=%d" % i,
                         headers={"User-Agent": UA})
            resp = conn.getresponse()
            resp.read()
            if i == 0:
                header_info = resp.getheader("Connection", "(tidak disebutkan)")
    except Exception as e:
        conn.close()
        return {"status": "fail",
                "detail": "keep-alive tidak stabil (request gagal pada koneksi yang sama): %s" % e}
    conn.close()
    return {"status": "pass",
            "detail": "3 request beruntun pada 1 koneksi TCP sukses (path: %s/latency.txt); header Connection: %s"
                      % (base_used or "", header_info)}


# ----------------------------------------------------------------------------
# Orchestration & output
# ----------------------------------------------------------------------------
CHECK_ORDER = ["dns", "netgauge", "websocket", "version", "crossdomain",
               "https", "upload", "download", "latency", "keepalive"]


def run_all(host, port, args):
    results = {}
    timeout = args.timeout
    dl_bytes = args.download_bytes
    ul_bytes = args.upload_bytes

    def put(name, r):
        results[name] = r
        return r

    put("dns", check_dns(host, port))
    put("netgauge", check_netgauge(host, port, timeout, dl_bytes, ul_bytes))
    put("websocket", check_websocket(host, port, timeout))
    put("version", check_version(host, port, timeout))
    put("crossdomain", check_crossdomain(host, port, timeout))
    put("https", check_https(host, port, timeout, not args.insecure))
    put("upload", check_upload(host, port, timeout, min(ul_bytes, 4 * 1024 * 1024)))
    put("download", check_download(host, port, timeout))
    put("latency", check_latency(host, port, timeout))
    put("keepalive", check_keepalive(host, port, timeout))

    # status gabungan netgauge/websocket seperti tester resmi
    ng, ws = results["netgauge"], results["websocket"]
    if ng["status"] == "pass" and ws["status"] == "fail":
        results["netgauge_combined"] = {
            "status": "warn",
            "detail": "TCP netgauge OK; %s (klien modern memakai WS, cek juga hasil baris websocket)" % ws["detail"],
        }
    else:
        results["netgauge_combined"] = {
            "status": ng["status"] if ng["status"] == "fail" else ws["status"],
            "detail": (ng.get("detail", "") + " | " + ws.get("detail", "")).strip(" |"),
        }
    return results


def print_report(host, port, results, c):
    print()
    print(c.bold("  OOKLA SERVER TESTER (CLI)  %s:%d" % (host, port)))
    print(c.cyan("  " + "-" * 66))
    labels = {
        "dns": "dns / A+AAAA",
        "netgauge_combined": "netgauge/websocket",
        "version": "version",
        "crossdomain": "crossdomain",
        "https": "https",
        "upload": "upload",
        "download": "download",
        "latency": "latency",
        "keepalive": "keepalive",
    }
    for name in ["dns", "netgauge_combined", "version", "crossdomain",
                 "https", "upload", "download", "latency", "keepalive"]:
        r = results[name]
        st = r["status"]
        badge = {"pass": c.green("PASS"), "warn": c.yellow("WARN"), "fail": c.red("FAIL")}[st]
        print("  [%s] %s" % (badge, c.bold(labels[name])))
        print("         %s" % r["detail"])
        if st == "pass" or name == "netgauge_combined":
            if name == "netgauge_combined":
                ng = results["netgauge"]
                if ng.get("ping_avg") is not None:
                    print("         ping rata-rata: %.1f ms (max %.1f ms)" % (ng["ping_avg"], ng["ping_max"]))
                if ng.get("download_bps"):
                    print("         download: %s | upload: %s" %
                          (fmt_speed(ng["download_bps"]), fmt_speed(ng["upload_bps"])))
            if name == "upload" and r.get("upload_bps"):
                print("         kecepatan upload: %s" % fmt_speed(r["upload_bps"]))
            if name == "download" and r.get("download_bps"):
                print("         kecepatan download: %s" % fmt_speed(r["download_bps"]))
            if name == "latency" and r.get("latency_avg") is not None:
                print("         RTT rata-rata: %.1f ms (min %.1f / max %.1f)" %
                      (r["latency_avg"], r["latency_min"], r["latency_max"]))
        print()
    order = ["dns", "netgauge_combined", "version", "crossdomain", "https",
             "upload", "download", "latency", "keepalive"]
    total = len(order)
    npass = sum(1 for n in order if results[n]["status"] == "pass")
    nfail = sum(1 for n in order if results[n]["status"] == "fail")
    nwarn = sum(1 for n in order if results[n]["status"] == "warn")
    line = "  %d/%d checks passed" % (npass, total)
    if nwarn:
        line += ", %d warning" % nwarn
    if nfail:
        print(c.red(c.bold(line)) + c.red(" - ada %d kegagalan" % nfail))
    else:
        print(c.green(c.bold(line)))
        if not nwarn:
            print(c.green("  Server Anda dikonfigurasi dengan baik."))
    return nfail


def main():
    p = argparse.ArgumentParser(
        prog="ookla_host_tester",
        description="Ookla Server Tester CLI - replika host-tester speedtest.net "
                    "(input cukup host/domain, port default 8080)")
    p.add_argument("target", help="host, host:port, atau URL (mis. host.contoh.or.id:8080)")
    p.add_argument("--json", action="store_true", help="output JSON (machine-readable)")
    p.add_argument("--timeout", type=float, default=10.0, help="timeout per operasi dalam detik (default 10)")
    p.add_argument("--download-bytes", type=int, default=5_000_000,
                   help="ukuran test download netgauge (default 5000000)")
    p.add_argument("--upload-bytes", type=int, default=2_000_000,
                   help="ukuran test upload netgauge (default 2000000)")
    p.add_argument("--insecure", action="store_true",
                   help="lewati verifikasi sertifikat TLS (hanya untuk debug)")
    p.add_argument("--no-color", action="store_true", help="matikan warna ANSI")
    p.add_argument("--version", action="version", version="%(prog)s " + __version__)
    args = p.parse_args()

    use_color = (not args.no_color) and sys.stdout.isatty() and os.environ.get("NO_COLOR") is None
    c = Colors(use_color)

    try:
        host, port = parse_target(args.target)
    except (TestError, ValueError) as e:
        eprint("Error: %s" % e)
        return 2

    if not args.json:
        print(c.cyan("  Menguji %s:%d ..." % (host, port)))

    try:
        results = run_all(host, port, args)
    except KeyboardInterrupt:
        eprint("\nDibatalkan.")
        return 130

    if args.json:
        checks = {
            "dns": results["dns"],
            "netgauge": results["netgauge"],
            "websocket": results["websocket"],
            "version": results["version"],
            "crossdomain": results["crossdomain"],
            "https": results["https"],
            "upload": results["upload"],
            "download": results["download"],
            "latency": results["latency"],
            "keepalive": results["keepalive"],
        }
        out = {
            "target": {"host": host, "port": port},
            "timestamp": datetime.now().isoformat(),
            "checks": checks,
            "summary": {
                "total": len(checks),
                "passed": sum(1 for v in checks.values() if v["status"] == "pass"),
                "warned": sum(1 for v in checks.values() if v["status"] == "warn"),
                "failed": sum(1 for v in checks.values() if v["status"] == "fail"),
            },
        }
        print(json.dumps(out, indent=2, default=str))
        # exit code: websocket dihitung non-fatal bila netgauge TCP tetap PASS
        nfail = 0
        for name, v in checks.items():
            if v["status"] == "fail":
                if name == "websocket" and checks["netgauge"]["status"] == "pass":
                    continue
                nfail += 1
    else:
        nfail = print_report(host, port, results, c)

    return 0 if nfail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
