// Probe OoklaServer netgauge websocket protocol with native WebSocket
const host = 'host.yapsidarussalam.or.id';
const port = 8080;

function probe(url) {
  return new Promise((resolve) => {
    const log = (m) => console.log(`[${url}] ${m}`);
    let ws;
    const done = setTimeout(() => { try { ws?.close(); } catch {} resolve('timeout'); }, 8000);
    try {
      ws = new WebSocket(url);
    } catch (e) {
      log('construct error: ' + e.message);
      clearTimeout(done);
      return resolve('error');
    }
    ws.onopen = () => {
      log('OPEN - waiting 1.5s for server greeting...');
      setTimeout(() => {
        try {
          ws.send('HI\n');
          log('sent: HI');
        } catch (e) { log('send err ' + e.message); }
      }, 1500);
    };
    ws.onmessage = (ev) => {
      let data = ev.data;
      if (data instanceof ArrayBuffer) {
        data = '<binary ' + data.byteLength + ' bytes> ' + Buffer.from(data).subarray(0, 40).toString('latin1');
      } else if (Array.isArray(data)) {
        data = '<blob array>';
      } else {
        data = JSON.stringify(String(data));
      }
      log('MSG: ' + data);
    };
    ws.onclose = (ev) => { log(`CLOSE code=${ev.code} reason=${ev.reason}`); clearTimeout(done); resolve('closed'); };
    ws.onerror = (ev) => { log('ERROR: ' + (ev?.message || ev?.error?.message || 'unknown')); };
  });
}

console.log('=== ws://' + host + ':' + port + '/ ===');
await probe(`ws://${host}:${port}/`);
console.log('\n=== wss://' + host + ':' + port + '/ ===');
await probe(`wss://${host}:${port}/`);
process.exit(0);
