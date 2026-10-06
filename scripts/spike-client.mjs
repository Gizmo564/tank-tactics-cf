// Simulates N players on one game over WebSocket; prints counts + latency.
const N = +(process.argv[2] || 5), BASE = process.argv[3] || 'http://127.0.0.1:8787';
const WS = BASE.replace('http', 'ws') + '/api/game/demo/ws';
let alarms = 0, updates = 0, lat = [];
const socks = await Promise.all(Array.from({ length: N }, (_, i) => new Promise((res, rej) => {
  const ws = new WebSocket(WS);
  ws.onopen = () => res(ws); ws.onerror = e => rej(e);
  ws.onmessage = ev => { const m = JSON.parse(ev.data);
    if (m.type === 'alarm') alarms++;
    if (m.type === 'state') { updates++; if (ws._t) { lat.push(Date.now() - ws._t); ws._t = 0; } } };
})));
await fetch(BASE + '/api/game/demo/arm-alarm');
for (let r = 0; r < 10; r++) for (const ws of socks) { ws._t = Date.now(); ws.send(JSON.stringify({ type: 'act' })); await new Promise(r => setTimeout(r, 20)); }
await new Promise(r => setTimeout(r, 6500));
const st = await (await fetch(BASE + '/api/game/demo/state')).json();
lat.sort((a, b) => a - b);
console.log(JSON.stringify({ players: N, updatesReceived: updates, alarmsReceived: alarms, p50ms: lat[lat.length >> 1], p95ms: lat[Math.floor(lat.length * .95)], server: st }));
socks.forEach(s => s.close());
