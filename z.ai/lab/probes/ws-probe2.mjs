// Probe OoklaServer netgauge websocket protocol on /ws
const host = 'host.yapsidarussalam.or.id';
const port = 8080;

function probe(url, actions) {
  return new Promise((resolve) => {
    const tag = url.replace(/^[a-z]+:\/\/[^/]+/, '');
    const log = (m) => console.log(`[${tag}] ${m}`);
    let ws;
    const finish = () => { clearTimeout(done); try { ws?.close(); } catch {} resolve(); };
    const done = setTimeout(finish, 10000);
    ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      log('OPEN - waiting 1s for server greeting...');
      setTimeout(() => actions.length && step(0), 1000);
    };
    let t = 0;
    function step(i) {
      if (i >= actions.length) { log('no more actions'); return finish(); }
      const [delay, send] = actions[i];
      t = setTimeout(() => {
        try { ws.send(send); log('sent: ' + JSON.stringify(send)); } catch (e) { log('send err ' + e.message); }
        step(i + 1);
      }, delay);
    }
    ws.onmessage = (ev) => {
      let data = ev.data;
      if (data instanceof ArrayBuffer) {
        data = '<binary ' + data.byteLength + 'B> ' + Buffer.from(data).subarray(0, 60).toString('latin1');
      } else {
        data = JSON.stringify(String(data));
      }
      log('MSG: ' + data);
    };
    ws.onclose = (ev) => { log(`CLOSE code=${ev.code} reason=${JSON.stringify(ev.reason)}`); clearTimeout(t); finish(); };
    ws.onerror = () => { log('ERROR event'); };
  });
}

console.log('=== A: wait greeting, then HI ===');
await probe(`ws://${host}:${port}/ws`, [
  [1500, 'HI\n'],
  [2500, 'PING\n'],
  [2000, 'VERSION\n'],
]);
process.exit(0);
