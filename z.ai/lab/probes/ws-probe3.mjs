// Explore netgauge protocol commands
const host = 'host.yapsidarussalam.or.id';
const port = 8080;

function run(cmds, label, waitMs = 6000) {
  return new Promise((resolve) => {
    const log = (m) => console.log(`  ${m}`);
    console.log(`=== ${label} ===`);
    let ws;
    const finish = () => { clearTimeout(done); try { ws?.close(); } catch {} setTimeout(resolve, 200); };
    const done = setTimeout(finish, waitMs);
    ws = new WebSocket(`ws://${host}:${port}/ws`);
    ws.binaryType = 'arraybuffer';
    let bytesRecv = 0, msgs = 0;
    ws.onopen = () => { ws.send('HI\n'); setTimeout(next, 600); };
    let i = 0;
    function next() {
      if (i >= cmds.length) return finish();
      const c = cmds[i++];
      try { ws.send(c); log('sent: ' + JSON.stringify(c)); } catch (e) { log('send err ' + e.message); }
      setTimeout(next, 1200);
    }
    ws.onmessage = (ev) => {
      msgs++;
      if (ev.data instanceof ArrayBuffer) {
        bytesRecv += ev.data.byteLength;
        if (msgs <= 3 || bytesRecv % 1000000 < 50000) log(`binary frame ${ev.data.byteLength}B (total ${bytesRecv}B) head: ${Buffer.from(ev.data).subarray(0, 20).toString('hex')}`);
      } else {
        log('text: ' + JSON.stringify(String(ev.data)));
      }
    };
    ws.onclose = (ev) => { log(`CLOSE code=${ev.code} reason=${JSON.stringify(ev.reason)} | total text/binary msgs=${msgs} bytes=${bytesRecv}`); finish(); };
    ws.onerror = () => log('ERROR event');
  });
}

await run(['PING 0 100\n', 'PING 1 100\n', 'PING 2 50 0\n'], 'PING variants');
await run(['DOWNLOAD 10000\n'], 'DOWNLOAD 10000');
await run(['UPLOAD 10000\n'], 'UPLOAD 10000 (no data sent)');
process.exit(0);
