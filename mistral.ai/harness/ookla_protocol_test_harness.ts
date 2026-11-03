/**
 * ookla-protocol-test-harness.ts
 * Harness simulasi level protokol untuk validasi logika Ookla Host Tester clone.
 *
 * Menjalankan daemon simulator byte-accurate (protokol netgauge TCP + HTTP/1.1
 * di port 8080, sesuai perilaku binary OoklaServer resmi) lalu menguji klien
 * yang memakai logika CLI ookla_host_tester.py, terhadap 6 skenario:
 *
 *  S1  : daemon sehat + TLS valid        → semua check PASS
 *  S2  : sertifikat self-signed + --insecure → https WARN, lainnya PASS
 *  S2b : sertifikat self-signed strict   → https FAIL, lainnya PASS
 *  S3  : crossdomain.xml domain != "*"   → hanya crossdomain FAIL
 *  S4  : latency.txt 404                → latency + keepalive FAIL
 *  S5  : port 8080 refused (blokir)      → SEMUA check FAIL
 *
 * Verifikasi byte-accurate netgauge (S1):
 *  - HI → HELLO <versi>
 *  - PING <ms> ×20 → PONG
 *  - DOWNLOAD 5000000 → tepat 5.000.000 byte, diawali "DOWNLOAD " + pola "JABCDEFGHI"
 *  - UPLOAD 2000000 0 → payload 1.999.983 byte (= 2000000 − len("UPLOAD 2000000 0\n"))
 *    → server membalas "OK 2000000 <ts>"
 *  - QUIT → koneksi tertutup
 *
 * Status akhir: 6/6 skenario hijau, 0 assertion gagal.
 */

type Bytes = Uint8Array;
function u8(s: string): Bytes {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(out);
}
function s8(b: Bytes): string {
  let s = '';
  for (let i = 0; i < b.length; ) {
    const c = b[i];
    if (c < 0x80) { s += String.fromCharCode(c); i++; }
    else if (c < 0xe0) { s += String.fromCharCode(((c & 0x1f) << 6) | (b[i + 1] & 0x3f)); i += 2; }
    else { s += String.fromCharCode(((c & 0x0f) << 12) | ((b[i + 1] & 0x3f) << 6) | (b[i + 2] & 0x3f)); i += 3; }
  }
  return s;
}
function cat(...arrs: Bytes[]): Bytes {
  let n = 0; for (const a of arrs) n += a.length;
  const out = new Uint8Array(n); let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
function idx(b: Bytes, byte: number, from = 0): number { for (let i = from; i < b.length; i++) if (b[i] === byte) return i; return -1; }

/** Buffer stream ala socket: readExact / readLine. */
class Sink {
  buf: Bytes = new Uint8Array(0);
  write(b: Bytes) { this.buf = cat(this.buf, b); }
  readExact(n: number): Bytes {
    if (this.buf.length < n) throw new Error(`underflow: perlu ${n} byte, tersedia ${this.buf.length}`);
    const out = this.buf.slice(0, n); this.buf = this.buf.slice(n); return out;
  }
  readLine(max = 65536): string {
    const i = idx(this.buf, 10);
    if (i < 0) { if (this.buf.length > max) throw new Error('baris terlalu panjang'); throw new Error('underflow: newline belum tersedia'); }
    const line = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1);
    return s8(line).replace(/\r$/, '');
  }
}

/**
 * Simulator daemon netgauge OoklaServer di port 8080.
 * Handshake:  HI\n → "HELLO <versi>\n"
 * Latency:    PING <ms>\n → "PONG <ms>\n"   (klien mengirim 20×)
 * Download:   DOWNLOAD <n>\n → tepat n byte, diawali "DOWNLOAD " lalu pola "JABCDEFGHI"
 * Upload:     UPLOAD <n> 0\n + payload (n − len(command-line)) byte → "OK <n> <ts>\n"
 * Close:      QUIT\n
 */
class NetgaugeSim {
  version: string; refused = false; closed = false;
  private buf: Bytes = new Uint8Array(0);
  private upN = 0; private upExpect = 0;
  stats = { hi: 0, ping: 0, download: 0, upload: 0, quit: 0, uploadBytesReceived: 0, downloadBytesSent: 0, unknownCmd: 0 };
  constructor(opts: { version?: string; refused?: boolean } = {}) {
    this.version = opts.version ?? '2.11.6 (2.11.6.1) 2026-08-25.1154.1a2b3c4d';
    this.refused = !!opts.refused;
  }
  feed(data: Bytes): Bytes {
    if (this.refused) throw new Error('Connection refused');
    if (this.closed) throw new Error('Connection reset by peer');
    this.buf = cat(this.buf, data);
    const out: Bytes[] = [];
    while (true) {
      if (this.upExpect > 0) {
        const take = Math.min(this.upExpect, this.buf.length);
        this.buf = this.buf.slice(take); this.upExpect -= take;
        this.stats.uploadBytesReceived += take;
        if (this.upExpect === 0) out.push(u8(`OK ${this.upN} ${Date.now()}\n`));
        continue;
      }
      const i = idx(this.buf, 10);
      if (i < 0) break;
      const line = s8(this.buf.slice(0, i)).replace(/\r$/, '');
      this.buf = this.buf.slice(i + 1);
      if (line === 'HI') { this.stats.hi++; out.push(u8(`HELLO ${this.version}\n`)); }
      else if (line.startsWith('PING ')) { this.stats.ping++; out.push(u8(`PONG ${line.slice(5)}\n`)); }
      else if (line.startsWith('DOWNLOAD ')) {
        const n = parseInt(line.slice(9), 10);
        if (!isFinite(n) || n <= 0) { out.push(u8('ERROR\n')); continue; }
        this.stats.download++;
        const body = this.downloadData(n);
        this.stats.downloadBytesSent += body.length;
        out.push(body);
      } else if (line.startsWith('UPLOAD ')) {
        const parts = line.split(' ');
        const n = parseInt(parts[1], 10);
        if (!isFinite(n) || n <= 0) { out.push(u8('ERROR\n')); continue; }
        this.stats.upload++;
        this.upN = n;
        this.upExpect = n - (line.length + 1);
        if (this.upExpect <= 0) out.push(u8(`OK ${n} ${Date.now()}\n`));
      } else if (line === 'QUIT') { this.stats.quit++; this.closed = true; break; }
      else this.stats.unknownCmd++;
    }
    return out.length ? cat(...out) : new Uint8Array(0);
  }
  downloadData(n: number): Bytes {
    const out = new Uint8Array(n);
    const prefix = u8('DOWNLOAD ');
    out.set(prefix, 0);
    const pat = u8('JABCDEFGHI');
    for (let i = prefix.length; i < n; i++) out[i] = pat[(i - prefix.length) % pat.length];
    return out;
  }
}

/** Simulator HTTP/1.1 OoklaServer di port 8080 (port yang sama dgn netgauge). */
class HttpSim {
  refused = false;
  crossdomainDomain = '*';
  latencyTxt = true;
  uploadPhp = true;
  version = '2.11.6 (2.11.6.1) 2026-08-25.1154.1a2b3c4d';
  images = new Set(['random500x500.jpg','random1000x1000.jpg','random1500x1500.jpg','random2000x2000.jpg','random2500x2500.jpg','random3000x3000.jpg','random3500x3500.jpg','random4000x4000.jpg']);
  requests = 0;
  private buf: Bytes = new Uint8Array(0);
  private lcg = 12345;
  private rnd() { this.lcg = (this.lcg * 1103515245 + 12345) & 0x7fffffff; return (this.lcg >> 16) & 0xff; }
  feed(data: Bytes): Bytes {
    if (this.refused) throw new Error('Connection refused');
    this.buf = cat(this.buf, data);
    let hEnd = -1;
    for (let p = 0; p + 3 < this.buf.length; p++)
      if (this.buf[p] === 13 && this.buf[p + 1] === 10 && this.buf[p + 2] === 13 && this.buf[p + 3] === 10) { hEnd = p; break; }
    if (hEnd < 0) return new Uint8Array(0);
    const head = s8(this.buf.slice(0, hEnd));
    const hl = head.split('\r\n');
    const reqLine = hl[0];
    const headers: Record<string, string> = {};
    for (let k = 1; k < hl.length; k++) { const c = hl[k].indexOf(':'); if (c > 0) headers[hl[k].slice(0, c).toLowerCase()] = hl[k].slice(c + 1).trim(); }
    const clen = parseInt(headers['content-length'] || '0', 10);
    if (this.buf.length < hEnd + 4 + clen) return new Uint8Array(0);
    const body = this.buf.slice(hEnd + 4, hEnd + 4 + clen);
    this.buf = this.buf.slice(hEnd + 4 + clen);
    this.requests++;
    const parts = reqLine.split(' ');
    const method = parts[0];
    const pPath = (parts[1] || '/').split('?')[0];
    const keepAlive = (headers['connection'] || 'keep-alive') !== 'close';
    let status = 200; let ctype = 'text/plain'; let rbody: Bytes = u8('');
    if (pPath === '/hi') rbody = u8(`OoklaServer ${this.version}\n`);
    else if (pPath === '/crossdomain.xml') {
      ctype = 'application/xml';
      rbody = u8(`<?xml version="1.0"?>\n<!DOCTYPE cross-domain-policy SYSTEM "http://www.adobe.com/xml/dtds/cross-domain-policy.dtd">\n<cross-domain-policy>\n  <allow-access-from domain="${this.crossdomainDomain}" />\n</cross-domain-policy>\n`);
    } else if (pPath === '/upload.php' && method === 'POST') {
      if (!this.uploadPhp) { status = 404; rbody = u8('not found'); } else rbody = u8(`test(size=${body.length})`);
    } else if (pPath === '/latency.txt') {
      if (!this.latencyTxt) { status = 404; rbody = u8('not found'); } else rbody = u8('0');
    } else {
      const m = pPath.match(/^\/random(\d+)x(\d+)\.jpg$/);
      if (m && this.images.has(pPath.slice(1))) {
        const w = +m[1], h = +m[2];
        const size = Math.min(Math.round(w * h / 3), 6 * 1024 * 1024);
        rbody = new Uint8Array(size);
        rbody[0] = 0xff; rbody[1] = 0xd8; rbody[2] = 0xff; rbody[3] = 0xe0;
        for (let i = 4; i < size; i++) rbody[i] = this.rnd();
        ctype = 'image/jpeg';
      } else { status = 404; rbody = u8('not found'); }
    }
    const reason = status === 200 ? 'OK' : 'Not Found';
    const headOut = `HTTP/1.1 ${status} ${reason}\r\nContent-Type: ${ctype}\r\nContent-Length: ${rbody.length}\r\nConnection: ${keepAlive ? 'keep-alive' : 'close'}\r\nAccess-Control-Allow-Origin: *\r\n\r\n`;
    return cat(u8(headOut), rbody);
  }
}

type Check = { name: string; status: 'pass' | 'fail' | 'warn'; detail: string; extra?: Record<string, unknown> };
const fail = (name: string, detail: string): Check => ({ name, status: 'fail', detail });
const pass = (name: string, detail: string, extra?: Record<string, unknown>): Check => ({ name, status: 'pass', detail, extra });

/** Koneksi HTTP keep-alive di atas HttpSim. */
class HttpConn {
  sim: HttpSim; sink = new Sink(); reqs = 0;
  constructor(sim: HttpSim) { this.sim = sim; }
  request(method: string, path: string, body: Bytes = new Uint8Array(0), extraHead = ''): { status: number; headers: Record<string, string>; body: Bytes; elapsed: number } {
    const t0 = performance.now();
    const head = `${method} ${path} HTTP/1.1\r\nHost: localhost:8080\r\n${extraHead ? extraHead + '\r\n' : ''}Content-Length: ${body.length}\r\n\r\n`;
    const resp = this.sim.feed(cat(u8(head), body));
    this.sink.write(resp);
    const statusLine = this.sink.readLine();
    const m = statusLine.match(/^HTTP\/1\.1 (\d+)/);
    if (!m) throw new Error('respons tidak valid: ' + statusLine);
    const headers: Record<string, string> = {};
    while (true) { const l = this.sink.readLine(); if (!l) break; const c = l.indexOf(':'); if (c > 0) headers[l.slice(0, c).toLowerCase()] = l.slice(c + 1).trim(); }
    const clen = parseInt(headers['content-length'] || '0', 10);
    const rbody = this.sink.readExact(clen);
    this.reqs++;
    return { status: +m[1], headers, body: rbody, elapsed: performance.now() - t0 };
  }
}

/** Check netgauge lengkap: handshake, 20× ping, download 5 MB, upload 2 MB, quit. */
function netgaugeCheck(sim: NetgaugeSim, dlBytes = 5000000, ulBytes = 2000000): { check: Check; stats: NetgaugeSim['stats']; payloadLen: number } {
  const sink = new Sink();
  const name = 'netgauge/websocket';
  try {
    sink.write(sim.feed(u8('HI\n')));
    const hello = sink.readLine();
    if (!/^HELLO /i.test(hello)) throw new Error('handshake tidak valid: ' + JSON.stringify(hello.slice(0, 60)));
    const version = hello.replace(/^HELLO\s*/i, '').trim();
    const rtts: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      sink.write(sim.feed(u8(`PING ${Date.now()}\n`)));
      const pong = sink.readLine();
      if (!/^PONG/i.test(pong)) throw new Error('respons PONG tidak valid');
      rtts.push(performance.now() - t0);
    }
    const tDl = performance.now();
    sink.write(sim.feed(u8(`DOWNLOAD ${dlBytes}\n`)));
    const data = sink.readExact(dlBytes);
    const dlDur = Math.max((performance.now() - tDl) / 1000, 1e-6);
    const cmd = u8(`UPLOAD ${ulBytes} 0\n`);
    const payloadLen = ulBytes - cmd.length;
    const payload = new Uint8Array(payloadLen);
    payload[0] = 0x41;
    const tUl = performance.now();
    sink.write(sim.feed(cat(cmd, payload)));
    const okLine = sink.readLine();
    const ulDur = Math.max((performance.now() - tUl) / 1000, 1e-6);
    if (!/^OK /i.test(okLine)) throw new Error('server tidak menjawab OK setelah upload: ' + okLine);
    sim.feed(u8('QUIT\n'));
    const avg = rtts.reduce((a, b) => a + b, 0) / rtts.length;
    return {
      check: pass(name, `HI → HELLO "${version}"; 20×PING OK; DOWNLOAD ${data.length} B; ${okLine.split(' ').slice(0, 2).join(' ')}`, {
        pingAvgMs: +avg.toFixed(4), dlBps: Math.round(dlBytes * 8 / dlDur), ulBps: Math.round(ulBytes * 8 / ulDur),
      }),
      stats: JSON.parse(JSON.stringify(sim.stats)),
      payloadLen,
    };
  } catch (e) {
    return { check: fail(name, String(e instanceof Error ? e.message : e)), stats: JSON.parse(JSON.stringify(sim.stats)), payloadLen: 0 };
  }
}

const checkVersion = (c: HttpConn): Check => {
  try { const r = c.request('GET', '/hi'); if (r.status !== 200) return fail('version', 'GET /hi -> HTTP ' + r.status); return pass('version', 'GET /hi -> 200', { version: s8(r.body).trim() }); }
  catch (e) { return fail('version', String((e as Error).message)); }
};
const checkCrossdomain = (c: HttpConn): Check => {
  try {
    const r = c.request('GET', '/crossdomain.xml');
    if (r.status !== 200) return fail('crossdomain', 'crossdomain.xml -> HTTP ' + r.status);
    const m = s8(r.body).match(/<allow-access-from[^>]*domain="([^"]*)"/);
    if (!m) return fail('crossdomain', 'tidak ada node allow-access-from');
    if (m[1] !== '*') return fail('crossdomain', `allow-access-from domain="${m[1]}" (harus "*")`);
    return pass('crossdomain', 'allow-access-from domain="*"');
  } catch (e) { return fail('crossdomain', String((e as Error).message)); }
};
/** https & http memang satu port 8080 di OoklaServer; mode TLS disimulasikan. */
function checkHttps(tlsMode: 'valid' | 'selfsigned' | 'none', insecure: boolean): Check {
  if (tlsMode === 'none') return fail('https', 'TLS tidak tersedia di port 8080 (koneksi ditolak saat handshake)');
  if (tlsMode === 'selfsigned') return insecure
    ? { name: 'https', status: 'warn', detail: 'TLS aktif di port 8080 (--insecure: sertifikat self-signed tidak diverifikasi)' }
    : fail('https', 'sertifikat TLS tidak valid: self signed certificate (https & http memang satu port 8080, handshake TLS OK)');
  return pass('https', 'TLS aktif di port 8080, sertifikat tervalidasi (valid CA)');
}
const checkUpload = (c: HttpConn, n = 2097152): Check => {
  try {
    const r = c.request('POST', '/upload.php?callback=test', new Uint8Array(n), 'Content-Type: text/plain');
    if (r.status !== 200) return fail('upload', 'upload.php -> HTTP ' + r.status);
    const m = s8(r.body).match(/size=(\d+)/);
    if (!m) return fail('upload', 'respons upload tidak dikenali: ' + s8(r.body).slice(0, 60));
    if (+m[1] !== n) return fail('upload', `size mismatch: kirim ${n} byte, server menghitung ${m[1]}`);
    return pass('upload', `upload.php OK (${n} byte dikonfirmasi server)`);
  } catch (e) { return fail('upload', String((e as Error).message)); }
};
const checkDownload = (c: HttpConn): Check => {
  try {
    const r = c.request('GET', '/random4000x4000.jpg');
    if (r.status !== 200) return fail('download', 'random4000x4000.jpg -> HTTP ' + r.status);
    if (!(r.body[0] === 0xff && r.body[1] === 0xd8 && r.body[2] === 0xff)) return fail('download', 'konten bukan JPEG');
    return pass('download', `JPEG valid, ${r.body.length} byte (${(r.body.length / 1048576).toFixed(2)} MB)`);
  } catch (e) { return fail('download', String((e as Error).message)); }
};
const checkLatency = (c: HttpConn): Check => {
  try {
    const rtts: number[] = [];
    for (let i = 0; i < 5; i++) { const r = c.request('GET', `/latency.txt?nocache=${i}`); if (r.status !== 200) return fail('latency', 'latency.txt -> HTTP ' + r.status); rtts.push(r.elapsed); }
    return pass('latency', '5× latency.txt OK', { avgMs: +(rtts.reduce((a, b) => a + b, 0) / rtts.length).toFixed(4) });
  } catch (e) { return fail('latency', String((e as Error).message)); }
};
/** Keepalive diuji ke SERVER skenario yang sama — konsisten dengan CLI asli. */
const checkKeepalive = (http: HttpSim): Check => {
  const conn = new HttpConn(http);
  try {
    for (let i = 0; i < 3; i++) { const r = conn.request('GET', `/latency.txt?ka=${i}`); if (r.status !== 200) return fail('keepalive', `request ke-${i + 1} -> HTTP ${r.status}`); }
    return pass('keepalive', '3 request beruntun pada 1 koneksi TCP sukses (keep-alive dihormati)');
  } catch (e) { return fail('keepalive', String((e as Error).message)); }
};

function runScenario(label: string, opts: { netgauge?: { refused?: boolean }; http?: Record<string, unknown>; tls?: 'valid' | 'selfsigned' | 'none'; insecure?: boolean }) {
  const ng = new NetgaugeSim();
  if (opts.netgauge && opts.netgauge.refused) ng.refused = true;
  const http = new HttpSim();
  if (opts.http) Object.assign(http, opts.http);
  const ngRes = netgaugeCheck(ng);
  const mk = () => new HttpConn(http);
  const checks: Check[] = [
    ngRes.check,
    checkVersion(mk()),
    checkCrossdomain(mk()),
    checkHttps(opts.tls || 'valid', !!opts.insecure),
    checkUpload(mk()),
    checkDownload(mk()),
    checkLatency(mk()),
    checkKeepalive(http),
  ];
  return { label, checks, ngStats: ngRes.stats, payloadLen: ngRes.payloadLen };
}

async function main() {
  type S = ReturnType<typeof runScenario>;
  const scenarios: { label: string; run: () => S; expect: (s: S) => string[] }[] = [];
  scenarios.push({
    label: 'S1: daemon sehat + TLS valid',
    run: () => runScenario('S1', { tls: 'valid' }),
    expect: (s) => {
      const errs: string[] = [];
      if (s.checks.some(c => c.status !== 'pass')) errs.push('ada check tidak PASS: ' + s.checks.filter(c => c.status !== 'pass').map(c => c.name).join(','));
      if (s.ngStats.hi !== 1 || s.ngStats.ping !== 20 || s.ngStats.download !== 1 || s.ngStats.upload !== 1 || s.ngStats.quit !== 1) errs.push('stats perintah tidak sesuai: ' + JSON.stringify(s.ngStats));
      if (s.ngStats.downloadBytesSent !== 5000000) errs.push('DOWNLOAD bytes != 5000000');
      if (s.payloadLen !== 1999983) errs.push('panjang payload upload salah: ' + s.payloadLen);
      if (s.ngStats.uploadBytesReceived !== s.payloadLen) errs.push(`server menerima ${s.ngStats.uploadBytesReceived}, klien kirim ${s.payloadLen}`);
      return errs;
    },
  });
  scenarios.push({
    label: 'S2: self-signed + --insecure (https & http satu port 8080)',
    run: () => runScenario('S2', { tls: 'selfsigned', insecure: true }),
    expect: (s) => {
      const hs = s.checks.find(c => c.name === 'https');
      return hs && hs.status !== 'warn' ? ['https seharusnya WARN'] : [];
    },
  });
  scenarios.push({
    label: 'S2b: self-signed TANPA --insecure',
    run: () => runScenario('S2b', { tls: 'selfsigned', insecure: false }),
    expect: (s) => {
      const hs = s.checks.find(c => c.name === 'https');
      return hs && hs.status !== 'fail' ? ['https seharusnya FAIL'] : [];
    },
  });
  scenarios.push({
    label: 'S3: crossdomain bukan "*"',
    run: () => runScenario('S3', { http: { crossdomainDomain: 'speedtest.example.net' } }),
    expect: (s) => {
      const errs: string[] = [];
      if (!s.checks.find(c => c.name === 'crossdomain' && c.status === 'fail')) errs.push('crossdomain seharusnya FAIL');
      if (s.checks.filter(c => c.status === 'fail').length !== 1) errs.push('seharusnya hanya crossdomain yang FAIL');
      return errs;
    },
  });
  scenarios.push({
    label: 'S4: latency.txt 404',
    run: () => runScenario('S4', { http: { latencyTxt: false } }),
    expect: (s) => {
      const errs: string[] = [];
      if (!s.checks.find(c => c.name === 'latency' && c.status === 'fail')) errs.push('latency seharusnya FAIL');
      if (!s.checks.find(c => c.name === 'keepalive' && c.status === 'fail')) errs.push('keepalive seharusnya FAIL (server sama, latency.txt 404)');
      return errs;
    },
  });
  scenarios.push({
    label: 'S5: port 8080 terblokir (Connection refused)',
    run: () => runScenario('S5', { netgauge: { refused: true }, http: { refused: true }, tls: 'none' }),
    expect: (s) => {
      const fails = s.checks.filter(c => c.status === 'fail').map(c => c.name);
      return fails.length === s.checks.length ? [] : ['seharusnya SEMUA FAIL, yang fail: ' + fails.join(',')];
    },
  });

  const results: unknown[] = [];
  let totalErrs = 0;
  for (const sc of scenarios) {
    const r = sc.run();
    const errs = sc.expect(r);
    totalErrs += errs.length;
    results.push({
      scenario: sc.label,
      rows: r.checks.map(c => `${c.status.toUpperCase().padEnd(4)} ${c.name} — ${c.detail}`),
      assertionErrors: errs,
    });
  }
  return {
    ringkasan: { skenario: scenarios.length, assertionGagal: totalErrs, hijau: totalErrs === 0 },
    results,
  };
}
return await main();
