// Debug wsConnect against production OoklaServer
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";

const host = "1010.hkspeedtest.com.prod.hosts.ooklaserver.net";
const port = 8080;

function tryUpgrade(secure) {
  return new Promise((resolve) => {
    const key = crypto.randomBytes(16).toString("base64");
    const mod = secure ? https : http;
    const options = {
      host,
      port,
      path: "/ws",
      method: "GET",
      timeout: 8000,
      headers: {
        Host: `${host}:${port}`,
        Upgrade: "websocket",
        Connection: "Upgrade",
        "Sec-WebSocket-Key": key,
        "Sec-WebSocket-Version": "13",
      },
      ...(secure ? { rejectUnauthorized: false, servername: host } : {}),
    };
    const req = mod.request(options);
    req.on("timeout", () => { console.log(`[${secure ? "wss" : "ws"}] TIMEOUT`); req.destroy(); resolve(); });
    req.on("error", (e) => { console.log(`[${secure ? "wss" : "ws"}] req error:`, e.code, e.message); resolve(); });
    req.on("response", (res) => { console.log(`[${secure ? "wss" : "ws"}] got response:`, res.statusCode); res.resume(); resolve(); });
    req.on("upgrade", (res, socket, head) => {
      console.log(`[${secure ? "wss" : "ws"}] UPGRADED 101`);
      socket.on("data", (d) => console.log(`[${secure ? "wss" : "ws"}] data:`, JSON.stringify(d.toString("latin1")).slice(0, 80)));
      socket.on("error", (e) => console.log(`[${secure ? "wss" : "ws"}] socket error:`, e.message));
      socket.on("close", () => { console.log(`[${secure ? "wss" : "ws"}] socket closed`); resolve(); });
      // send masked HI frame
      const payload = Buffer.from("HI\n");
      const mask = crypto.randomBytes(4);
      const masked = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i & 3];
      const frame = Buffer.concat([Buffer.from([0x81]), Buffer.from([0x80 | payload.length]), mask, masked]);
      socket.write(frame);
      console.log(`[${secure ? "wss" : "ws"}] sent HI`);
      setTimeout(() => { socket.destroy(); resolve(); }, 3000);
    });
    req.end();
  });
}

console.log("--- wss first ---");
await tryUpgrade(true);
console.log("--- ws ---");
await tryUpgrade(false);
process.exit(0);
