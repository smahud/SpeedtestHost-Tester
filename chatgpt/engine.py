"""Host tester engine, derived from arena.ai/app.py (see ATTRIBUTION.md).
ChatGPT fork: bounded transports, strict TLS, pinned public DNS, protocol validation.
"""
from __future__ import annotations

import base64
import hashlib
import http.client
import ipaddress
import os
import re
import socket
import ssl
import struct
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path


JAKARTA = timezone(timedelta(hours=7))


USER_AGENT = "Mozilla/5.0 (compatible; ChatGPTHostTester/1.0)"


IMAGE_SIZES = [
    (350, 245388), (500, 505544), (750, 1118012), (1000, 1986284),
    (1500, 4468241), (2000, 7907740), (2500, 12407926), (3000, 17816816),
    (3500, 24262167), (4000, 31625365),
]


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
    if any(ord(c) < 32 or ord(c) == 127 for c in (raw or "")):
        raise ValueError("Control characters are not allowed in targets")
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
    if parsed.scheme not in ("", "http", "https"):
        raise ValueError("Only HTTP and HTTPS URLs are supported")
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
    if not allow_private:
        out = [a for a in out if a["global"]]
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


def parse_hello(raw: str):
    m = re.fullmatch(r"HELLO\s+(\S+)\s+\((\S+)\)\s+(\S+)", raw.strip(), re.IGNORECASE)
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
    # Count streaming bytes, retaining only a diagnostic prefix. Never buffer images.
    maximum = 65536 if limit is None else limit
    prefix = bytearray()
    total = 0
    while True:
        chunk = resp.read(min(65536, maximum + 1 - total))
        if not chunk:
            break
        total += len(chunk)
        prefix.extend(chunk[:max(0, 4096 - len(prefix))])
        if total > maximum:
            raise ValueError(f"Response exceeds {maximum} bytes")
    return bytes(prefix), total


def authority(host, port=None):
    host = f"[{host}]" if ":" in host else host
    return host if port is None else f"{host}:{port}"


def raw_http(host, port, path, method="GET", body=None, extra_headers=None,
             use_ssl=False, verify=True, addrinfos=None, timeout=8.0, body_limit=None,
             host_header=None, ca_bundle=None):
    if not verify:
        raise ValueError("Unverified TLS is not supported")
    if addrinfos is None:
        addrinfos = resolve_host(host, port)
    sock, ip = connect_first(addrinfos, timeout)
    resp = None
    try:
        if use_ssl:
            sock = wrap_tls(sock, host, ca_bundle)
        headers = {"Host": authority(host, port), "User-Agent": USER_AGENT,
                   "Accept": "*/*", "Connection": "close"}
        if body is not None:
            headers["Content-Length"] = str(len(body))
        if extra_headers:
            headers.update(extra_headers)
        req = [f"{method} {path} HTTP/1.1"] + [f"{k}: {v}" for k,v in headers.items()]
        sock.sendall(("\r\n".join(req) + "\r\n\r\n").encode())
        if body is not None:
            sock.sendall(body)
        resp = http.client.HTTPResponse(sock, method=method)
        resp.begin()
        data, total = read_body(resp, body_limit)
        return {"status": resp.status, "reason": resp.reason,
                "status_line": status_line(resp), "headers": dict(resp.getheaders()),
                "body": data, "body_length": total, "ip": ip, "version": resp.version}
    finally:
        if resp is not None:
            resp.close()
        sock.close()


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


def netgauge_check(host, port, addrinfos, use_ssl=False, ca_bundle=None):
    sock = None
    try:
        sock, ip = connect_first(addrinfos, 6.0)
        if use_ssl:
            sock = wrap_tls(sock, host, ca_bundle)
        sock.sendall(b"HI\n")
        line = recv_line(sock).decode("utf-8", "replace").strip()
        ok = bool(parse_hello(line))
        return row("netgauge", f"response : {line}\naddress : {ip}", "PASSED" if ok else "FAILED")
    except Exception as exc:
        return row("netgauge", f"error : {exc}", "FAILED")
    finally:
        if sock is not None:
            sock.close()


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
    fin, opcode = bool(b1 & 128), b1 & 15
    if b1 & 112 or b2 & 128:
        raise ValueError("Invalid reserved bits or masked server frame")
    length = b2 & 127
    if length == 126:
        length = struct.unpack(">H", recv_exact(sock, 2))[0]
    elif length == 127:
        length = struct.unpack(">Q", recv_exact(sock, 8))[0]
    if length > 65536 or (opcode >= 8 and (not fin or length > 125)):
        raise ValueError("Oversize or invalid WebSocket frame")
    return fin, opcode, recv_exact(sock, length)


def websocket_check(host, port, addrinfos, use_ssl=False, ca_bundle=None):
    sock = None
    try:
        sock, ip = connect_first(addrinfos, 6.0)
        if use_ssl:
            sock = wrap_tls(sock, host, ca_bundle)
        key = base64.b64encode(os.urandom(16)).decode()
        expected = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
        sock.sendall((f"GET /ws HTTP/1.1\r\nHost: {authority(host, port)}\r\n"
                      f"User-Agent: {USER_AGENT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                      f"Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: {key}\r\n"
                      "Origin: https://www.speedtest.net\r\n\r\n").encode())
        # Bytewise header read preserves a coalesced first frame in the socket.
        head = bytearray()
        while not head.endswith(b"\r\n\r\n"):
            head.extend(recv_exact(sock, 1))
            if len(head) > 8192:
                raise ValueError("Oversize WebSocket handshake")
        lines = head.decode("latin1").split("\r\n")
        headers = {}
        for line in lines[1:]:
            if line:
                k,v = line.split(":",1)
                headers[k.lower()] = v.strip()
        if (lines[0].split()[:2] != ["HTTP/1.1", "101"] or
            headers.get("sec-websocket-accept") != expected or
            headers.get("upgrade", "").lower() != "websocket" or
            "upgrade" not in [v.strip().lower() for v in headers.get("connection", "").split(",")]):
            raise ValueError("Invalid WebSocket upgrade headers")
        ws_send_frame(sock, b"HI\n")
        message = bytearray()
        started = False
        for _ in range(32):
            fin, opcode, payload = ws_recv_frame(sock)
            if opcode == 9:
                ws_send_frame(sock, payload, 10)
                continue
            if opcode == 10:
                continue
            if opcode not in (0, 1) or (opcode == 0 and not started) or (opcode == 1 and started):
                raise ValueError("Unexpected WebSocket opcode")
            started = True
            message.extend(payload)
            if len(message) > 65536:
                raise ValueError("Oversize WebSocket message")
            if fin:
                break
        else:
            raise ValueError("Too many WebSocket frames")
        hello = message.decode("utf-8").strip()
        return row("websocket", f"response : {hello}\naddress : {ip}", "PASSED" if parse_hello(hello) else "FAILED")
    except Exception as exc:
        return row("websocket", f"error : {exc}", "FAILED")
    finally:
        if sock is not None:
            sock.close()


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
    import xml.etree.ElementTree as ET
    try:
        res = raw_http(host, port, "/crossdomain.xml", addrinfos=addrinfos,
                       use_ssl=use_ssl, ca_bundle=ca_bundle, body_limit=4096)
        if b"<!DOCTYPE" in res["body"].upper() and b"<!ENTITY" in res["body"].upper():
            raise ValueError("XML entities are not supported")
        root = ET.fromstring(res["body"])
        rules = root.findall("allow-access-from")
        def permits(domain):
            return any(r.get("domain") in ("*", domain) and
                       (not check_port or not r.get("to-ports") or port_allowed([r.get("to-ports")], port)) for r in rules)
        ok = res["status"] == 200 and root.tag == "cross-domain-policy" and all(permits(d) for d in required)
        return row(label, f"http_status : {res['status']}\npolicy : {res['body'].decode('utf-8', 'replace')}", "PASSED" if ok else "FAILED")
    except Exception as exc:
        return row(label, f"error : {exc}", "FAILED")


def https_check(host, port, addrinfos, ca_bundle=None):
    try:
        res = raw_http(host, port, "/hi", use_ssl=True, addrinfos=addrinfos, ca_bundle=ca_bundle)
        body = res["body"].decode("utf-8", "replace").strip()
        ok = res["status"] == 200 and bool(parse_hello(body))
        return row("https", f"certificate : strictly verified\nresponse : {body}", "PASSED" if ok else "FAILED")
    except Exception as exc:
        return row("https", f"error : {exc}", "FAILED")


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
    sock = None
    try:
        sock, ip = connect_first(legacy_addrs, 6.0)
        request = (f"GET /speedtest/latency.txt HTTP/1.1\r\nHost: {authority(host, legacy_port)}\r\n"
                   f"User-Agent: {USER_AGENT}\r\nConnection: keep-alive\r\n\r\n").encode()
        for _ in range(2):
            sock.sendall(request)
            response = http.client.HTTPResponse(sock)
            try:
                response.begin()
                body, _ = read_body(response, 2048)
                if response.status != 200 or body.strip() != b"test=test" or response.will_close:
                    raise ValueError("KeepAlive requires two valid latency responses on one persistent socket")
            finally:
                response.close()
        return row("keepalive", f"Two valid responses on the same socket; address : {ip}", "PASSED")
    except Exception as exc:
        return row("keepalive", f"error : {exc}", "FAILED")
    finally:
        if sock is not None:
            sock.close()


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

    daemon_tls = daemon_tls or detect_scheme(host_input) == "https"
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
    legacy_base = f"http://{authority(host)}{port_suffix}"
    legacy_url = f"{legacy_base}/speedtest/upload.php"
    # Reuse the vetted DNS snapshot; change only the service port.
    legacy_addrs = [dict(a, sockaddr=(a["sockaddr"][0], legacy_port, *a["sockaddr"][2:])) for a in addrs]
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
        "cross_validation_note": "Protocol expectations adapted from arena.ai; see this submission audit for independently executed validation.",
    }


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
