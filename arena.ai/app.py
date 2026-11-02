#!/usr/bin/env python3
"""
1:1-ish local clone of https://www.speedtest.net/host-tester

No reCAPTCHA and no advertising/consent banners.  The original masthead,
navigation, footer, DOM structure, CSS and form are preserved; `?clean=1`
hides nav/footer for a test-only view.  The backend reproduces the checks performed by the real
Ookla Server Tester:

  OoklaServer / NetGauge TCP
    - raw TCP "HI" handshake -> "HELLO <major> (<version>) <build>"
    - WebSocket upgrade to /ws, masked "HI" frame -> HELLO frame
    - /crossdomain.xml on the OoklaServer port
    - strict HTTPS GET /hi on the OoklaServer port

  HTTP Legacy Fallback (port 80, derived from the hostname)
    - /crossdomain.xml
    - /speedtest/latency.txt
    - POST /speedtest/upload.php (516300-byte size response)
    - POST /speedtest/upload.php (1981500-byte max upload size response)
    - 10 random{WxW}.jpg files with exact byte sizes
    - HTTP Keep-Alive reuse check

Only Python standard library is required.
"""

from __future__ import annotations

import base64
import hashlib
import html
import http.client
import ipaddress
import json
import os
import re
import secrets
import socket
import ssl
import struct
import string
import tempfile
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CSS = (ROOT / "assets" / "inline.css").read_text(encoding="utf-8")
JAKARTA = timezone(timedelta(hours=7))

CHROME_TEMPLATE = (ROOT / "assets" / "chrome.html").read_text(encoding="utf-8")
FORM_TEMPLATE = (ROOT / "assets" / "form.html").read_text(encoding="utf-8")

USER_AGENT = "Mozilla/5.0 (compatible; OoklaServerTesterClone/1.0)"


IMAGE_SIZES = [
    (350, 245388), (500, 505544), (750, 1118012), (1000, 1986284),
    (1500, 4468241), (2000, 7907740), (2500, 12407926), (3000, 17816816),
    (3500, 24262167), (4000, 31625365),
]

USER_AGENT = "Mozilla/5.0 (compatible; OoklaServerTesterClone/1.0)"


def esc(value) -> str:
    return html.escape(str(value), quote=True)


def now_jakarta() -> str:
    return datetime.now(JAKARTA).strftime("%Y-%m-%d %H:%M:%S %Z (UTC%z)")


def detect_scheme(raw: str) -> str | None:
    """Return the scheme of a full URL, or None for host:port / bare host input.

    The official tester only accepts host:port, but this clone also accepts full
    URLs.  Keeping the scheme as metadata makes TLS behaviour explicit instead
    of silently discarding it.
    """
    s = (raw or "").strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in ("'", '"'):
        s = s[1:-1].strip()
    if "://" not in s:
        s = "//" + s
    try:
        return urllib.parse.urlsplit(s).scheme.lower() or None
    except ValueError:
        return None


def validate_ca_bundle(path: str) -> str:
    """Validate a caller-supplied PEM CA bundle before TLS verification uses it.

    Mirrors the official Speedtest CLI `--ca-certificate` semantics: a supplied
    bundle REPLACES the default trust store, so it must contain every CA needed.
    Never disables verification.
    """
    f = Path(path).expanduser()
    if not f.is_file():
        raise ValueError(f"ca_bundle is not a readable file: {path}")
    text = f.read_text(encoding="utf-8", errors="replace")
    if "-----BEGIN CERTIFICATE-----" not in text:
        raise ValueError(f"ca_bundle does not contain a PEM certificate: {path}")
    return str(f.resolve())


def wrap_tls(sock, host, ca_bundle=None):
    """Wrap an established socket with strict TLS (never unverified)."""
    ctx = (ssl.create_default_context(cafile=ca_bundle) if ca_bundle
           else ssl.create_default_context())
    return ctx.wrap_socket(sock, server_hostname=host)


def normalize_target(raw: str, default_port: int = 8080) -> tuple[str, str | None]:
    """Accept host:port, a bare hostname, or a full http(s) URL.

    Returns (normalized_host_port, optional_warning).  The official tester
    requires host:port; this clone intentionally also accepts the bare domain
    and full URL requested by the user.
    """
    s = (raw or "").strip()
    if not s:
        raise ValueError("Invalid hostname format")
    if len(s) >= 2 and s[0] == s[-1] and s[0] in ("'", '"'):
        s = s[1:-1].strip()
    if not s:
        raise ValueError("Invalid hostname format")
    if "://" not in s:
        s = "//" + s
    parsed = urllib.parse.urlsplit(s)
    if parsed.username or parsed.password:
        raise ValueError("Invalid hostname format")
    host = parsed.hostname
    if not host:
        raise ValueError("Invalid hostname format")
    try:
        port = parsed.port
    except ValueError:
        raise ValueError("Invalid hostname format")
    warning = None
    if port is None:
        port = default_port
        warning = f"no explicit port; using default {default_port}"
    if parsed.path not in ("", "/"):
        warning = (warning + "; " if warning else "") + f"ignored URL path {parsed.path!r}"
    if parsed.query or parsed.fragment:
        warning = (warning + "; " if warning else "") + "ignored query/fragment"
    target = f"[{host}]:{port}" if ":" in host else f"{host}:{port}"
    parse_host(target)
    return target, warning


def parse_host(value: str):
    value = (value or "").strip()
    if not value:
        raise ValueError("Invalid hostname format")
    if re.search(r"[\\/\s?#@]|://", value):
        raise ValueError("Invalid hostname format")

    m = re.fullmatch(r"\[([0-9A-Fa-f:]+)\]:(\d+)", value)
    if m:
        host, port_s = m.group(1), m.group(2)
        try:
            ipaddress.IPv6Address(host)
        except ValueError:
            raise ValueError("Invalid hostname format")
    else:
        m = re.fullmatch(r"([A-Za-z0-9.-]+):(\d+)", value)
        if not m:
            raise ValueError("Invalid hostname format")
        host, port_s = m.group(1), m.group(2)
        if host.startswith(".") or host.endswith(".") or ".." in host:
            raise ValueError("Invalid hostname format")
        for label in host.split("."):
            if not label or len(label) > 63 or label.startswith("-") or label.endswith("-"):
                raise ValueError("Invalid hostname format")
            if not re.fullmatch(r"[A-Za-z0-9-]+", label):
                raise ValueError("Invalid hostname format")
    port = int(port_s)
    if not (1 <= port <= 65535):
        raise ValueError("Invalid hostname format")
    return host, port


def resolve_host(host: str, port: int, allow_private: bool = False):
    try:
        infos = socket.getaddrinfo(host, port, 0, socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise ValueError(f"Could not resolve host: {exc}")
    out, seen = [], set()
    for family, _type, _proto, _canon, sockaddr in infos:
        ip = sockaddr[0]
        if ip in seen:
            continue
        seen.add(ip)
        addr = ipaddress.ip_address(ip.split("%")[0])
        out.append({
            "family": family,
            "sockaddr": sockaddr,
            "ip": ip,
            "version": 6 if family == socket.AF_INET6 else 4,
            "global": addr.is_global,
        })
    if not allow_private and not any(a["global"] for a in out):
        raise ValueError("Host does not resolve to a public IP address (use --allow-private for lab/local targets)")
    # IPv4 first: the original tester reaches public servers over IPv4/IPv6;
    # this runner may not have an IPv6 route, so prefer a working global IPv4.
    out.sort(key=lambda a: (not a["global"], a["version"] == 6))
    return out


def connect_first(addrinfos, timeout=6.0):
    errors = []
    for a in addrinfos:
        try:
            s = socket.socket(a["family"], socket.SOCK_STREAM)
            s.settimeout(timeout)
            s.connect(a["sockaddr"])
            s.settimeout(timeout)
            return s, a["ip"]
        except OSError as exc:
            errors.append(f'{a["ip"]}: {exc}')
            try:
                s.close()
            except Exception:
                pass
    raise OSError("; ".join(errors) or "no reachable address")


def recv_exact(sock, n: int) -> bytes:
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise EOFError("connection closed")
        buf += chunk
    return buf


def recv_line(sock, max_bytes=2048) -> bytes:
    buf = b""
    while b"\n" not in buf and len(buf) < max_bytes:
        chunk = sock.recv(1)
        if not chunk:
            break
        buf += chunk
    return buf.splitlines()[0] if buf else b""


def recv_until(sock, marker: bytes, max_bytes=8192) -> bytes:
    buf = b""
    while marker not in buf and len(buf) < max_bytes:
        chunk = sock.recv(1024)
        if not chunk:
            break
        buf += chunk
    return buf


def parse_hello(raw: str):
    m = re.search(r"HELLO\s+(\S+)\s+\((\S+)\)\s+(\S+)", raw, re.IGNORECASE)
    if not m:
        return None
    return {
        "major": m.group(1),
        "version": m.group(2),
        "build": m.group(3),
        "pretty": f"Version: {m.group(2)} Build Date: {m.group(3)}",
    }


def status_line(resp) -> str:
    ver = {9: "HTTP/0.9", 10: "HTTP/1.0", 11: "HTTP/1.1"}.get(resp.version, f"HTTP/{resp.version}")
    return f"{ver} {resp.status} {resp.reason}".strip()


def header_get(headers, name, default=""):
    for k, v in headers.items():
        if k.lower() == name.lower():
            return v
    return default


def read_body(resp, limit=None):
    chunks, total = [], 0
    while True:
        chunk = resp.read(65536)
        if not chunk:
            break
        total += len(chunk)
        if limit is None or len(b"".join(chunks)) < limit:
            chunks.append(chunk)
        if limit is not None and total > limit:
            break
    return b"".join(chunks), total


def raw_http(host, port, path, method="GET", body=None, extra_headers=None,
             use_ssl=False, verify=True, addrinfos=None, timeout=8.0, body_limit=None,
             host_header=None, ca_bundle=None):
    if addrinfos is None:
        addrinfos = resolve_host(host, port)
    sock, ip = connect_first(addrinfos, timeout)
    if use_ssl:
        if verify:
            sock = wrap_tls(sock, host, ca_bundle)
        else:
            sock = ssl._create_unverified_context().wrap_socket(sock, server_hostname=host)
    headers = {
        "Host": host_header or (host if port == 80 else f"{host}:{port}"),
        "User-Agent": USER_AGENT,
        "Accept": "*/*",
        "Connection": "close",
    }
    if body is not None:
        headers["Content-Length"] = str(len(body))
    if extra_headers:
        headers.update(extra_headers)
    req = [f"{method} {path} HTTP/1.1"]
    req += [f"{k}: {v}" for k, v in headers.items()]
    sock.sendall(("\r\n".join(req) + "\r\n\r\n").encode())
    if body is not None:
        sock.sendall(body)
    resp = http.client.HTTPResponse(sock, method=method)
    resp.begin()
    data, total = read_body(resp, body_limit)
    result = {
        "status": resp.status,
        "reason": resp.reason,
        "status_line": status_line(resp),
        "headers": dict(resp.getheaders()),
        "body": data,
        "body_length": total,
        "ip": ip,
        "version": resp.version,
    }
    try:
        resp.close()
    except Exception:
        pass
    try:
        sock.close()
    except Exception:
        pass
    return result


def compact_response(res, max_body=400):
    keys = ["Date", "Server", "Content-Length", "Content-Type", "Connection", "Cache-Control"]
    parts = [res["status_line"]]
    for k in keys:
        v = header_get(res["headers"], k)
        if v:
            parts.append(f"{k}: {v}")
    body = res["body"][:max_body].decode("utf-8", "replace").strip()
    if body:
        parts.append(body)
    return " ".join(parts)


def ssl_error_phrase(exc: Exception) -> str:
    text = str(exc)
    if "self-signed" in text.lower():
        return "SSL certificate problem: self-signed certificate"
    if "unable to get local issuer" in text.lower():
        return "SSL certificate problem: unable to get local issuer certificate"
    if "hostname mismatch" in text.lower() or "doesn't match" in text.lower():
        return "SSL certificate problem: subject name does not match target host name"
    return f"SSL certificate problem: {text}"


def cert_info(host, port, addrinfos):
    try:
        sock, _ = connect_first(addrinfos, 5.0)
        ctx = ssl._create_unverified_context()
        ss = ctx.wrap_socket(sock, server_hostname=host)
        der = ss.getpeercert(binary_form=True)
        ss.close()
        if not der:
            return "certificate details unavailable: empty DER"
        pem = ssl.DER_cert_to_PEM_cert(der)
        fd, path = tempfile.mkstemp(prefix="ookla-cert-", suffix=".pem")
        try:
            os.write(fd, pem.encode())
            os.close(fd)
            fd = None
            cert = ssl._ssl._test_decode_cert(path)
        finally:
            if fd is not None:
                os.close(fd)
            try:
                os.unlink(path)
            except OSError:
                pass
        def flatten(item):
            if isinstance(item, tuple):
                return ", ".join("=".join(pair) for rdn in item for pair in rdn)
            return str(item)
        subject = flatten(cert.get("subject", ""))
        issuer = flatten(cert.get("issuer", ""))
        return (f"subject: {subject}; issuer: {issuer}; "
                f"notBefore: {cert.get('notBefore','?')}; notAfter: {cert.get('notAfter','?')}")
    except Exception as exc:
        return f"certificate details unavailable: {exc}"


def netgauge_check(host, port, addrinfos, use_ssl=False, ca_bundle=None):
    try:
        sock, ip = connect_first(addrinfos, 6.0)
        if use_ssl:
            sock = wrap_tls(sock, host, ca_bundle)
        sock.sendall(b"HI\n")
        line = recv_line(sock).decode("utf-8", "replace").strip()
        try:
            sock.sendall(b"QUIT\n")
        except Exception:
            pass
        sock.close()
        parsed = parse_hello(line)
        if parsed:
            transport = "TLS" if use_ssl else "plain TCP"
            return row("netgauge", f"details : {parsed['pretty']}\nresponse : {line}\ntransport : {transport}\naddress : {ip}", "PASSED")
        return row("netgauge", f"details : Wrong response\nresponse : {line or '(empty)'}\naddress : {ip}", "FAILED")
    except Exception as exc:
        return row("netgauge", f"details : Connection failed\nerror : {exc}", "FAILED")


def ws_send_frame(sock, payload: bytes, opcode=0x1):
    mask = os.urandom(4)
    masked = bytes(c ^ mask[i % 4] for i, c in enumerate(payload))
    n = len(payload)
    if n < 126:
        head = bytes([0x80 | opcode, 0x80 | n])
    elif n < 65536:
        head = bytes([0x80 | opcode, 0x80 | 126]) + struct.pack(">H", n)
    else:
        head = bytes([0x80 | opcode, 0x80 | 127]) + struct.pack(">Q", n)
    sock.sendall(head + mask + masked)


def ws_recv_frame(sock):
    b1, b2 = recv_exact(sock, 2)
    fin = bool(b1 & 0x80)
    opcode = b1 & 0x0F
    length = b2 & 0x7F
    masked = bool(b2 & 0x80)
    if length == 126:
        length = struct.unpack(">H", recv_exact(sock, 2))[0]
    elif length == 127:
        length = struct.unpack(">Q", recv_exact(sock, 8))[0]
    mask = recv_exact(sock, 4) if masked else None
    payload = recv_exact(sock, length) if length else b""
    if mask:
        payload = bytes(c ^ mask[i % 4] for i, c in enumerate(payload))
    return fin, opcode, payload


def websocket_check(host, port, addrinfos, use_ssl=False, ca_bundle=None):
    try:
        sock, ip = connect_first(addrinfos, 6.0)
        if use_ssl:
            sock = wrap_tls(sock, host, ca_bundle)
        key = base64.b64encode(os.urandom(16)).decode()
        guid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
        expected = base64.b64encode(hashlib.sha1((key + guid).encode()).digest()).decode()
        req = (
            f"GET /ws HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            f"User-Agent: {USER_AGENT}\r\n"
            f"Accept: */*\r\n"
            f"Connection: Upgrade\r\n"
            f"Upgrade: websocket\r\n"
            f"Sec-WebSocket-Version: 13\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            f"Origin: https://www.speedtest.net\r\n\r\n"
        )
        sock.sendall(req.encode())
        head = recv_until(sock, b"\r\n\r\n")
        text = head.decode("latin1", "replace")
        if "101 Switching Protocols" not in text:
            sock.close()
            return row("websocket", f"details : Upgrade rejected\nresponse : {text.strip()[:300]}", "FAILED")
        if expected not in text:
            sock.close()
            return row("websocket", "details : Invalid Sec-WebSocket-Accept", "FAILED")
        ws_send_frame(sock, b"HI\n", 0x1)
        deadline = time.time() + 6
        hello = None
        while time.time() < deadline and hello is None:
            fin, opcode, payload = ws_recv_frame(sock)
            if opcode == 0x1:
                hello = payload.decode("utf-8", "replace").strip()
            elif opcode == 0x8:
                break
        try:
            ws_send_frame(sock, struct.pack(">H", 1000), 0x8)
        except Exception:
            pass
        sock.close()
        parsed = parse_hello(hello or "")
        if parsed:
            transport = "wss / TLS" if use_ssl else "ws / plain TCP"
            return row("websocket", f"details : {parsed['pretty']}\nhandshake : HTTP/1.1 101 Switching Protocols\ntransport : {transport}\nframe : {hello}\naddress : {ip}", "PASSED")
        return row("websocket", f"details : Wrong WebSocket HELLO response\nframe : {hello or '(empty)'}", "FAILED")
    except Exception as exc:
        return row("websocket", f"details : WebSocket test failed\nerror : {exc}", "FAILED")


def crossdomain_parse(body: bytes):
    text = body.decode("utf-8", "replace")
    domains = re.findall(r"<allow-access-from[^>]*\bdomain=[\"']([^\"']+)[\"']", text, re.I)
    ports = re.findall(r"\bto-ports=[\"']([^\"']+)[\"']", text, re.I)
    return domains, ports, text


def port_allowed(ports, port):
    for spec in ports:
        for part in spec.split(","):
            part = part.strip()
            if part in ("*", str(port)):
                return True
            if "-" in part:
                try:
                    lo, hi = map(int, part.split("-", 1))
                    if lo <= port <= hi:
                        return True
                except ValueError:
                    pass
    return False


def crossdomain_check(host, port, addrinfos, required, label="crossdomain", url=None,
                      check_port=True, use_ssl=False, ca_bundle=None):
    try:
        res = raw_http(host, port, "/crossdomain.xml", addrinfos=addrinfos, timeout=8,
                       host_header=(host if port == 80 else f"{host}:{port}"),
                       use_ssl=use_ssl, ca_bundle=ca_bundle)
        domains, ports, text = crossdomain_parse(res["body"])
        ok = res["status"] == 200 and bool(domains)
        missing = [d for d in required if d not in domains and "*" not in domains]
        ok = ok and not missing
        if check_port and ports and not port_allowed(ports, port):
            ok = False
        details = [
            f"details : count : {len(domains)}",
            f"domains : {', '.join(domains) if domains else '(none)'}",
        ]
        if ports:
            details.append(f"to-ports : {', '.join(ports)}")
        if url:
            details.append(f"crossdomain_url : {url}")
        details.append(f"http_status : {res['status']}")
        if missing:
            details.append(f"missing : {', '.join(missing)}")
        if res["status"] != 200:
            details.append(f"response : {compact_response(res, 180)}")
        return row(label, "\n".join(details), "PASSED" if ok else "FAILED")
    except Exception as exc:
        return row(label, f"details : Could not fetch crossdomain.xml\nerror : {exc}", "FAILED")


def https_check(host, port, addrinfos, ca_bundle=None):
    try:
        res = raw_http(host, port, "/hi", use_ssl=True, verify=True, addrinfos=addrinfos,
                       timeout=8, host_header=f"{host}:{port}", ca_bundle=ca_bundle)
        body = res["body"].decode("utf-8", "replace").strip()
        parsed = parse_hello(body)
        if res["status"] == 200 and parsed:
            trust = f"verified (CA bundle: {ca_bundle})" if ca_bundle else "verified (system trust store)"
            return row("https", f"details : Response: {body}\nstatus_line : {res['status_line']}\ncertificate : {trust}", "PASSED")
        return row("https", f"details : Response: {body or '(empty)'}\nstatus_line : {res['status_line']}", "FAILED")
    except ssl.SSLCertVerificationError as exc:
        phrase = ssl_error_phrase(exc)
        info = cert_info(host, port, addrinfos)
        try:
            insecure = raw_http(host, port, "/hi", use_ssl=True, verify=False, addrinfos=addrinfos,
                                timeout=6, host_header=f"{host}:{port}")
            insecure_body = insecure["body"].decode("utf-8", "replace").strip()
        except Exception as e2:
            insecure_body = f"(insecure probe failed: {e2})"
        details = (
            "details : Response: \n"
            f"Error: {phrase}\n"
            "tip: Connection over HTTPS failed.\n"
            f"certificate : {info}\n"
            f"insecure_response : {insecure_body}\n"
            "note: strict TLS verification is active and is never disabled. For a lab/private CA use --ca-bundle / ca_bundle=<PEM file>; the bundle replaces the default trust store, exactly like the official Speedtest CLI --ca-certificate."
        )
        return row("https", details, "FAILED")
    except Exception as exc:
        return row("https", f"details : Response: \nError: {exc}\ntip: Connection over HTTPS failed.", "FAILED")


def random_urlsafe(length: int) -> bytes:
    out = b""
    while len(out) < length:
        out += base64.urlsafe_b64encode(os.urandom(max(1024, length))).rstrip(b"=")
    return out[:length]


def upload_check(host, legacy_addrs, expected_size, key, label,
                 legacy_port=80, upload_mode="auto"):
    """POST /speedtest/upload.php and validate the size= response.

    Two real behaviours were verified against the official binaries:

      * legacy PHP fallback (port 80): 500 + len(key) + len(value) + 3
      * OoklaServer daemon (port 8080): raw POST Content-Length

    upload_mode: legacy | native | auto (accept either and report which matched).
    """
    value_len = expected_size - (500 + len("content1") + 3)
    body = b"content1=" + random_urlsafe(value_len)
    native_size = len(body)
    if upload_mode == "legacy":
        accepted = {expected_size}
    elif upload_mode == "native":
        accepted = {native_size}
    else:
        accepted = {expected_size, native_size}
    host_header = None if legacy_port == 80 else f"{host}:{legacy_port}"
    try:
        res = raw_http(host, legacy_port, "/speedtest/upload.php", method="POST", body=body,
                       extra_headers={"Content-Type": "application/x-www-form-urlencoded"},
                       addrinfos=legacy_addrs, timeout=15, host_header=host_header)
        text = res["body"].decode("utf-8", "replace").strip()
        m = re.fullmatch(r"size=(\d+)", text)
        got = int(m.group(1)) if m else None
        detected = ("legacy-php" if got == expected_size else
                    "native-daemon" if got == native_size else "unknown")
        ok = res["status"] == 200 and got in accepted
        details = (
            f"details : {compact_response(res, 200)}\n"
            f"expected : size={expected_size} (legacy PHP)\n"
            f"native_expected : size={native_size} (raw Content-Length)\n"
            f"actual : {text or '(empty)'}\n"
            f"detected_mode : {detected}\n"
            f"upload_mode : {upload_mode}\n"
            f"legacy_port : {legacy_port}\n"
            f"body_length : {native_size}"
        )
        return row(key, details, "PASSED" if ok else "FAILED")
    except BrokenPipeError as exc:
        return row(key, f"details : Connection closed while sending the {native_size}-byte POST\nerror : {exc}\nexpected : size={expected_size}\nactual : (no response)", "FAILED")
    except Exception as exc:
        return row(key, f"details : Upload request failed\nerror : {exc}\nexpected : size={expected_size}", "FAILED")


def image_checks(host, legacy_addrs, legacy_port=80):
    rows = []
    host_header = None if legacy_port == 80 else f"{host}:{legacy_port}"
    for i, (dim, expected) in enumerate(IMAGE_SIZES, 1):
        path = f"/speedtest/random{dim}x{dim}.jpg"
        try:
            res = raw_http(host, legacy_port, path, addrinfos=legacy_addrs, timeout=20,
                           body_limit=expected + 1, host_header=host_header)
            actual = res["body_length"]
            ctype = header_get(res["headers"], "Content-Type")
            jpeg = res["body"][:2] == b"\xff\xd8"
            ok = res["status"] == 200 and actual == expected and jpeg and ctype.lower().startswith("image/")
            detail = "File size matches" if actual == expected else "File size mismatch"
            rows.append(row(str(i), f"details : {detail}\nsize : {actual}\nexpected : {expected}\nfile : random{dim}x{dim}.jpg\nhttp_status : {res['status']}", "PASSED" if ok else "FAILED"))
        except Exception as exc:
            rows.append(row(str(i), f"details : File size mismatch\nsize : 0\nexpected : {expected}\nerror : {exc}", "FAILED"))
    return rows


def keepalive_check(host, legacy_addrs, legacy_port=80):
    try:
        sock, ip = connect_first(legacy_addrs, 6.0)
        host_header = host if legacy_port == 80 else f"{host}:{legacy_port}"
        req = (
            f"GET /speedtest/latency.txt HTTP/1.1\r\n"
            f"Host: {host_header}\r\nUser-Agent: {USER_AGENT}\r\nAccept: */*\r\n"
            f"Connection: keep-alive\r\n\r\n"
        )
        sock.sendall(req.encode())
        r1 = http.client.HTTPResponse(sock, method="GET")
        r1.begin()
        b1, _ = read_body(r1, 2048)
        h1 = dict(r1.getheaders())
        t0 = time.perf_counter()
        sock.sendall(req.encode())
        r2 = http.client.HTTPResponse(sock, method="GET")
        r2.begin()
        b2, _ = read_body(r2, 2048)
        elapsed = (time.perf_counter() - t0) * 1000
        h2 = dict(r2.getheaders())
        reused = not sock._closed
        conn1 = header_get(h1, "Connection", "").lower()
        conn2 = header_get(h2, "Connection", "").lower()
        ok = reused and "close" not in conn1 and "close" not in conn2 and elapsed < 2000
        sock.close()
        details = (
            f"details : {'Subsequent connections established quickly' if ok else 'Connection reuse failed or too slow'}\n"
            f"first : {status_line(r1)}\nsecond : {status_line(r2)}\n"
            f"connection_header : {conn1 or '(none)'} / {conn2 or '(none)'}\n"
            f"reused_socket : {'yes' if reused else 'no'}\nsecond_request_ms : {elapsed:.1f}\naddress : {ip}"
        )
        return row("keepalive", details, "PASSED" if ok else "FAILED")
    except Exception as exc:
        return row("keepalive", f"details : Subsequent connections established quickly\nerror : {exc}", "FAILED")


def row(key, details, status, subrows=None):
    out = {"key": key, "details": details, "status": status}
    if subrows is not None:
        out["subrows"] = subrows
    return out


def run_all_tests(host_input: str, allow_private: bool = False,
                  ca_bundle: str | None = None,
                  legacy_port: int = 80,
                  upload_mode: str = "auto",
                  daemon_tls: bool = False):
    """Run the 19 host-tester checks.

    Advanced options came from cross-validation against the official OoklaServer
    2.11.5.2 daemon and the official Speedtest CLI 1.2.0.84: real servers differ
    in legacy port, upload algorithm, TLS transport, and CA trust.
    """
    if not (1 <= legacy_port <= 65535):
        raise ValueError("legacy_port must be between 1 and 65535")
    if upload_mode not in ("auto", "legacy", "native"):
        raise ValueError("upload_mode must be auto, legacy, or native")
    if ca_bundle:
        ca_bundle = validate_ca_bundle(ca_bundle)

    target, normalization_note = normalize_target(host_input)
    host, port = parse_host(target)
    addrs = resolve_host(host, port, allow_private=allow_private)
    ipv4 = [a["ip"] for a in addrs if a["version"] == 4]
    ipv6 = [a["ip"] for a in addrs if a["version"] == 6]

    daemon_rows = [
        netgauge_check(host, port, addrs, use_ssl=daemon_tls, ca_bundle=ca_bundle),
        websocket_check(host, port, addrs, use_ssl=daemon_tls, ca_bundle=ca_bundle),
        crossdomain_check(host, port, addrs,
                          required=["*.ookla.com", "*.speedtest.net", "*.speedtestcustom.com"],
                          check_port=True, use_ssl=daemon_tls, ca_bundle=ca_bundle),
        https_check(host, port, addrs, ca_bundle=ca_bundle),
    ]

    port_suffix = "" if legacy_port == 80 else f":{legacy_port}"
    legacy_base = f"http://{host}{port_suffix}"
    legacy_url = f"{legacy_base}/speedtest/upload.php"
    try:
        legacy_addrs = resolve_host(host, legacy_port, allow_private=allow_private)
    except Exception:
        legacy_addrs = addrs
    legacy_rows = [
        crossdomain_check(host, legacy_port, legacy_addrs,
                          required=["*.speedtest.net", "*.ookla.com"],
                          url=f"{legacy_base}/crossdomain.xml", check_port=False),
    ]
    try:
        res = raw_http(host, legacy_port, "/speedtest/latency.txt", addrinfos=legacy_addrs,
                       timeout=8)
        text = res["body"].decode("utf-8", "replace").strip()
        ok = res["status"] == 200 and text == "test=test"
        legacy_rows.append(row("latency", f"details : {text or '(empty)'}\nlatency_url : {legacy_base}/speedtest/latency.txt\nhttp_status : {res['status']}\nresponse : {compact_response(res, 180)}", "PASSED" if ok else "FAILED"))
    except Exception as exc:
        legacy_rows.append(row("latency", f"details : Could not fetch latency.txt\nerror : {exc}\nlatency_url : {legacy_base}/speedtest/latency.txt", "FAILED"))

    legacy_rows.append(upload_check(host, legacy_addrs, 516300, "upload", "upload",
                                    legacy_port=legacy_port, upload_mode=upload_mode))
    max_row = upload_check(host, legacy_addrs, 1981500, "max_upload", "max_upload",
                           legacy_port=legacy_port, upload_mode=upload_mode)
    max_row["details"] += "\nsuccess : " + max_row["status"]
    legacy_rows.append(max_row)

    image_rows = image_checks(host, legacy_addrs, legacy_port=legacy_port)
    image_ok = all(r["status"] == "PASSED" for r in image_rows)
    legacy_rows.append(row(
        "image_sizes",
        f"details : {len(IMAGE_SIZES)} download image files checked against the official http_legacy_fallback.zip byte sizes\nlegacy_port : {legacy_port}",
        "PASSED" if image_ok else "FAILED",
        subrows=image_rows,
    ))
    legacy_rows.append(keepalive_check(host, legacy_addrs, legacy_port=legacy_port))

    all_rows = daemon_rows + legacy_rows
    flat_rows = []
    for r in all_rows:
        flat_rows.extend(r.get("subrows") or [r])
    passed = sum(1 for r in flat_rows if r["status"] == "PASSED")
    failed = len(flat_rows) - passed
    options = {
        "ca_bundle": ca_bundle,
        "legacy_port": legacy_port,
        "upload_mode": upload_mode,
        "daemon_tls": bool(daemon_tls),
        "allow_private": bool(allow_private),
    }
    return {
        "input": host_input,
        "normalized_input": target,
        "normalization_note": normalization_note,
        "input_scheme": detect_scheme(host_input),
        "host": host,
        "port": port,
        "timestamp": now_jakarta(),
        "resolved": {"ipv4": ipv4, "ipv6": ipv6},
        "legacy_url": legacy_url,
        "options": options,
        "sections": [
            {"title": "OOKLASERVER / NETGAUGE TCP", "rows": daemon_rows},
            {"title": "HTTP LEGACY FALLBACK", "url": legacy_url, "rows": legacy_rows},
        ],
        "summary": {"passed": passed, "failed": failed, "total": len(flat_rows)},
        "allow_private": bool(allow_private),
        "runner_note": "Checks are executed from this sandbox, not from Ookla's regional watchdog servers.",
        "cross_validation_note": "Endpoint semantics verified against official OoklaServer 2.11.5.2 and official Speedtest CLI 1.2.0.84 on localhost:8080.",
    }


def form_html(value="", clean=False):
    out = FORM_TEMPLATE.replace("__VALUE__", esc(value))
    if clean:
        out = out.replace("</form>", '<input type="hidden" name="clean" value="1"></form>')
    return out


def page(title, body, clean=False):
    return (CHROME_TEMPLATE
            .replace("__TITLE__", esc(title))
            .replace("__CSS__", CSS)
            .replace("__CLEAN__", "clean" if clean else "")
            .replace("__BODY__", body))


def render_index(value="", error="", clean=False):
    parts = []
    if error:
        parts.append(f'<div class="clone-alert">{esc(error)}</div>')
    parts.append(form_html(value, clean))
    return page("Speedtest | Ookla Server Tester", "\n".join(parts), clean)


def status_html(status):
    cls = "passed" if status == "PASSED" else "failed"
    return f'<span class="status {cls}">{esc(status)}</span>'


def result_rows_html(rows):
    out = []
    for r in rows:
        out.append(
            '<div class="result-row">'
            f'<div class="result-key">{esc(r["key"])}</div>'
            f'<pre class="result-details">{esc(r["details"])}</pre>'
            f'<div>{status_html(r["status"])}</div>'
            '</div>'
        )
        for sr in r.get("subrows") or []:
            out.append(
                '<div class="result-row result-subrow">'
                f'<div class="result-key">{esc(sr["key"])}</div>'
                f'<pre class="result-details">{esc(sr["details"])}</pre>'
                f'<div>{status_html(sr["status"])}</div>'
                '</div>'
            )
    return "\n".join(out)


def render_results(data, clean=False):
    s = data["summary"]
    note = data.get("normalization_note")
    meta = f'{esc(data["host"])} : {esc(data["port"])} &nbsp;|&nbsp; {esc(data["timestamp"])}'
    if note:
        meta += f' &nbsp;|&nbsp; {esc(note)}'
    if data.get("input") and data["input"] != data.get("normalized_input", f'{data["host"]}:{data["port"]}'):
        meta += f' &nbsp;|&nbsp; input: {esc(data["input"])}'
    parts = [
        '<div class="u-c results-content">',
        '<div class="results-header">'
        '<h2>Test results</h2>'
        f'<div class="results-meta">{meta}</div>'
        '</div>',
        '<div class="results-summary">'
        f'<span class="pill ok">{s["passed"]} PASSED</span>'
        f'<span class="pill bad">{s["failed"]} FAILED</span>'
        f'<span class="pill info">{s["total"]} checks</span>'
        '</div>',
        f'<div class="result-card"><h3>Resolved addresses</h3><div class="result-row"><div class="result-key">dns</div><pre class="result-details">A    : {esc(", ".join(data["resolved"]["ipv4"]) or "(none)")}\nAAAA : {esc(", ".join(data["resolved"]["ipv6"]) or "(none)")}</pre><div></div></div></div>',
    ]
    for sec in data["sections"]:
        parts.append('<div class="result-card">')
        parts.append(f'<h3>{esc(sec["title"])}</h3>')
        if sec.get("url"):
            parts.append(f'<span class="fallback-url">{esc(sec["url"])}</span>')
        parts.append(result_rows_html(sec["rows"]))
        parts.append('</div>')
    again = "/host-tester?clean=1" if clean else "/host-tester"
    parts.append(
        '<p class="result-foot">'
        f'{esc(data["runner_note"])} '
        f'The legacy fallback is tested on port {esc(str(data.get("options", {}).get("legacy_port", 80)))} of the hostname; the original tester derives port 80 from <code>host:8080</code>. '
        f'<a href="{again}">Start over</a>'
        '</p>'
    )
    parts.append('</div>')
    return page("Speedtest | Ookla Server Tester — Results", "\n".join(parts), clean)


def format_text(data, summary_only=False):
    """Plain-text rendering shared by the CLI and the saved .txt result."""
    s = data["summary"]
    lines = [
        "OOKLA SERVER TESTER — CLONE RESULT",
        f"Host    : {data['host']}:{data['port']}",
        f"Waktu   : {data['timestamp']}",
        f"Ringkas : {s['passed']} PASSED / {s['failed']} FAILED dari {s['total']} checks",
        f"Input   : {data.get('normalized_input', data['host'] + ':' + str(data['port']))}",
        f"Asli    : {data.get('input', data.get('normalized_input', ''))}",
        f"DNS A   : {', '.join(data['resolved']['ipv4']) or '(none)'}",
        f"DNS AAAA: {', '.join(data['resolved']['ipv6']) or '(none)'}",
    ]
    opt = data.get("options") or {}
    lines.append(
        f"Opsi   : legacy_port={opt.get('legacy_port', 80)}, "
        f"upload_mode={opt.get('upload_mode', 'auto')}, "
        f"daemon_tls={opt.get('daemon_tls', False)}, "
        f"ca_bundle={opt.get('ca_bundle') or '(system trust)'}"
    )
    if summary_only:
        return "\n".join(lines) + "\n"
    for sec in data["sections"]:
        lines.append("")
        lines.append(f"== {sec['title']} ==")
        if sec.get("url"):
            lines.append(f"URL: {sec['url']}")
        for r in sec["rows"]:
            lines.append(f"{r['key']} : {r['status']}")
            for line in r["details"].splitlines():
                lines.append("    " + line)
            for sr in r.get("subrows") or []:
                lines.append(f"  {sr['key']} : {sr['status']}")
                for line in sr["details"].splitlines():
                    lines.append("      " + line)
    return "\n".join(lines) + "\n"


def options_from_qs(qs):
    """Parse advanced options from query/POST without changing the 1:1 form."""
    def flag(name):
        return qs.get(name, [""])[0] in ("1", "true", "yes")
    def text(name):
        return qs.get(name, [""])[0].strip() or None
    raw_port = qs.get("legacy_port", [""])[0]
    try:
        legacy_port = int(raw_port) if raw_port else 80
    except ValueError:
        legacy_port = 80
    return {
        "allow_private": flag("allow_private"),
        "clean": flag("clean"),
        "ca_bundle": text("ca_bundle"),
        "legacy_port": legacy_port,
        "upload_mode": text("upload_mode") or "auto",
        "daemon_tls": flag("daemon_tls"),
    }


def test_options(opts):
    return {
        "allow_private": opts["allow_private"],
        "ca_bundle": opts["ca_bundle"],
        "legacy_port": opts["legacy_port"],
        "upload_mode": opts["upload_mode"],
        "daemon_tls": opts["daemon_tls"],
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "OoklaServerTesterClone/1.0"

    def _send(self, body: str, status=200, content_type="text/html; charset=utf-8", extra=None):
        raw = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        if extra:
            for k, v in extra.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(raw)

    def _redirect(self, location):
        self.send_response(302)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        if parsed.path in ("/", "/index.html"):
            return self._redirect("/host-tester")
        if parsed.path == "/favicon.ico":
            return self._send("", 204, "image/x-icon")
        if parsed.path == "/assets/inline.css":
            return self._send(CSS, 200, "text/css; charset=utf-8")
        if parsed.path == "/host-tester":
            opts = options_from_qs(qs)
            host_value = qs.get("ookla-server", qs.get("host", [""]))[0]
            clean = opts["clean"]
            if qs.get("run", [""])[0] in ("1", "true", "yes") and host_value:
                try:
                    data = run_all_tests(host_value, **test_options(opts))
                    return self._send(render_results(data, clean=clean))
                except ValueError as exc:
                    return self._send(render_index(host_value, str(exc), clean=clean))
            return self._send(render_index(host_value, clean=clean))
        if parsed.path == "/api/test":
            opts = options_from_qs(qs)
            host_value = qs.get("host", qs.get("ookla-server", [""]))[0]
            if not host_value:
                return self._send(json.dumps({"error": "missing host"}), 400, "application/json")
            try:
                data = run_all_tests(host_value, **test_options(opts))
                return self._send(json.dumps(data, indent=2), 200, "application/json")
            except ValueError as exc:
                return self._send(json.dumps({"error": str(exc)}), 400, "application/json")
        return self._send(render_index("", "Page not found"), 404)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/host-tester":
            return self._send(render_index("", "Page not found"), 404)
        length = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(min(length, 16384)).decode("utf-8", "replace")
        qs = urllib.parse.parse_qs(raw, keep_blank_values=True)
        opts = options_from_qs(qs)
        host_value = qs.get("ookla-server", qs.get("host", [""]))[0]
        clean = opts["clean"]
        try:
            data = run_all_tests(host_value, **test_options(opts))
            return self._send(render_results(data, clean=clean))
        except ValueError as exc:
            return self._send(render_index(host_value, str(exc), clean=clean))
        except Exception as exc:
            return self._send(render_index(host_value, f"Test error: {exc}", clean=clean), 500)

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)


def main():
    port = int(os.environ.get("PORT", "3000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    server.daemon_threads = True
    print(f"Host Tester clone listening on 0.0.0.0:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
