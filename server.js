/* Abalone-Server: statische Dateien, WebSocket-Räume (Online-Spiel), LLM-Proxy, optional Cloudflare-Tunnel. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const R = require('./shared/rules');

const PORT = +process.env.PORT || 3000;
const ROOT = __dirname;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
let publicUrl = process.env.PUBLIC_URL || '';

// Anfragen, die durch einen Tunnel/Proxy kommen, tragen diese Header -> nicht "lokal".
const isLocal = (req) => {
  const a = req.socket.remoteAddress || '';
  const loop = a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
  return loop && !['cf-connecting-ip', 'cf-ray', 'x-forwarded-for', 'x-forwarded-host'].some((h) => req.headers[h]);
};
const readBody = (req, max = 1e6) => new Promise((res, rej) => {
  let d = ''; req.on('data', (c) => { d += c; if (d.length > max) { rej(new Error('too large')); req.destroy(); } });
  req.on('end', () => res(d)); req.on('error', rej);
});
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/info') return json(res, 200, { publicUrl, local: isLocal(req) });
    if (url.pathname === '/api/public-url' && req.method === 'POST') {
      if (!isLocal(req)) return json(res, 403, { error: 'nur lokal' });
      const u = JSON.parse(await readBody(req)).url || '';
      publicUrl = /^https?:\/\//.test(u) ? u.replace(/\/+$/, '') : '';
      return json(res, 200, { publicUrl });
    }
    if (url.pathname === '/api/llm' && req.method === 'POST') return llmProxy(req, res);
    // statische Dateien
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/index.html';
    const base = p.startsWith('/shared/') ? ROOT : path.join(ROOT, 'public');
    const file = path.normalize(path.join(base, p));
    if (!file.startsWith(path.join(ROOT, 'public')) && !file.startsWith(path.join(ROOT, 'shared'))) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Nicht gefunden'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  } catch (e) { json(res, 500, { error: String(e.message || e) }); }
});

// LLM-Proxy (umgeht CORS). Nur für den lokalen Host, damit Tunnel-Gäste den Server nicht als Relay missbrauchen.
async function llmProxy(req, res) {
  if (!isLocal(req)) return json(res, 403, { error: 'LLM-Proxy ist nur für den Host verfügbar' });
  const { url, key, model, messages, temperature } = JSON.parse(await readBody(req));
  if (!/^https?:\/\//.test(url || '')) return json(res, 400, { error: 'Ungültige URL' });
  const target = url.replace(/\/+$/, '') + (/\/chat\/completions$/.test(url) ? '' : '/chat/completions');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    const up = await fetch(target, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) },
      body: JSON.stringify({ model, messages, temperature: temperature ?? 0.2 }),
    });
    const text = await up.text();
    res.writeHead(up.status, { 'Content-Type': up.headers.get('content-type') || 'application/json' });
    res.end(text);
  } catch (e) { json(res, 502, { error: 'Upstream-Fehler: ' + (e.name === 'AbortError' ? 'Timeout' : e.message) }); }
  finally { clearTimeout(timer); }
}

// ---------- Räume ----------
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => { let c; do { c = Array.from({ length: 5 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join(''); } while (rooms.has(c)); return c; };
const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

function roomView(room) {
  return { t: 'sync', room: room.code, layout: room.layout, state: R.serialize(room.state), history: room.history,
    players: { 1: !!(room.seats[1] && room.seats[1].ws), 2: !!(room.seats[2] && room.seats[2].ws) },
    over: room.over, rematch: room.rematch };
}
const broadcast = (room, o) => { for (const ws of room.sockets) send(ws, o); };
const sync = (room) => { for (const ws of room.sockets) send(ws, { ...roomView(room), color: ws.color }); };

function seat(room, ws, color, token) {
  room.seats[color] = { token, ws }; ws.color = color; ws.token = token;
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
wss.on('connection', (ws) => {
  ws.alive = true; ws.on('pong', () => { ws.alive = true; });
  ws.room = null; ws.color = 0;
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    try { handle(ws, m); } catch (e) { send(ws, { t: 'error', msg: String(e.message || e) }); }
  });
  ws.on('close', () => {
    const room = ws.room; if (!room) return;
    room.sockets.delete(ws);
    if (ws.color && room.seats[ws.color] && room.seats[ws.color].ws === ws) room.seats[ws.color].ws = null;
    room.touched = Date.now();
    sync(room);
  });
});

function handle(ws, m) {
  if (m.t === 'create') {
    const code = newCode();
    const color = m.color === 'w' ? 2 : m.color === 'b' ? 1 : (crypto.randomInt(2) + 1);
    const room = { code, layout: m.layout === 'belgian' ? 'belgian' : 'standard', seats: { 1: null, 2: null }, sockets: new Set(),
      state: null, history: [], over: null, rematch: {}, touched: Date.now() };
    room.state = R.setup(room.layout);
    rooms.set(code, room);
    room.sockets.add(ws); ws.room = room;
    const token = crypto.randomUUID();
    seat(room, ws, color, token);
    send(ws, { t: 'joined', token, color, room: code });
    return sync(room);
  }
  if (m.t === 'join') {
    const room = rooms.get(String(m.room || '').toUpperCase());
    if (!room) return send(ws, { t: 'error', code: 'noroom', msg: 'Raum nicht gefunden' });
    room.sockets.add(ws); ws.room = room;
    let color = 0, token = m.token;
    for (const c of [1, 2]) if (token && room.seats[c] && room.seats[c].token === token) {
      color = c;
      if (room.seats[c].ws && room.seats[c].ws !== ws) { room.seats[c].ws.color = 0; room.sockets.delete(room.seats[c].ws); }
    }
    if (!color) for (const c of [1, 2]) if (!room.seats[c]) { color = c; token = crypto.randomUUID(); break; }
    if (color) seat(room, ws, color, token || crypto.randomUUID());
    send(ws, { t: 'joined', token: color ? ws.token : null, color, room: room.code });
    return sync(room);
  }
  const room = ws.room; if (!room) return;
  if (m.t === 'move') {
    if (room.over || ws.color !== room.state.turn) return send(ws, { t: 'error', msg: 'Nicht am Zug' });
    if (!(room.seats[1] && room.seats[1].ws && room.seats[2] && room.seats[2].ws)) return send(ws, { t: 'error', msg: 'Gegner fehlt' });
    const marbles = (m.marbles || []).map(Number);
    const mv = R.findMove(room.state, marbles, +m.dir);
    if (!mv) return send(ws, { t: 'error', msg: 'Ungültiger Zug' });
    room.state = R.applyMove(room.state, mv);
    room.history.push({ marbles: mv.marbles, dir: mv.dir, by: ws.color });
    const w = R.winner(room.state);
    if (w) room.over = { winner: w, reason: 'captured' };
    room.touched = Date.now();
    broadcast(room, { t: 'move', marbles: mv.marbles, dir: mv.dir, by: ws.color, over: room.over });
    return;
  }
  if (m.t === 'resign' && ws.color && !room.over) {
    room.over = { winner: R.other(ws.color), reason: 'resign' };
    return sync(room);
  }
  if (m.t === 'rematch' && ws.color && room.over) {
    room.rematch[ws.color] = true;
    if (room.rematch[1] && room.rematch[2]) {
      room.state = R.setup(room.layout); room.history = []; room.over = null; room.rematch = {};
      const a = room.seats[1], b = room.seats[2];
      room.seats[1] = b; room.seats[2] = a;           // Farben tauschen
      if (b && b.ws) b.ws.color = 1; if (a && a.ws) a.ws.color = 2;
    }
    return sync(room);
  }
  if (m.t === 'chat' && ws.color) return broadcast(room, { t: 'chat', by: ws.color, text: String(m.text || '').slice(0, 200) });
}

setInterval(() => {
  for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); }
  for (const [c, r] of rooms) if (!r.sockets.size && Date.now() - r.touched > 3600e3) rooms.delete(c);
}, 30000);

server.listen(PORT, () => {
  console.log(`Abalone läuft auf http://localhost:${PORT}`);
  if (process.argv.includes('--tunnel')) startTunnel();
  else console.log('Für Online-Spiel mit Freunden: "npm run share" (benötigt cloudflared) oder eigenen Tunnel auf diesen Port zeigen lassen.');
});

function startTunnel() {
  const { spawn } = require('child_process');
  let child;
  try { child = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`]); }
  catch (e) { return noTunnel(); }
  child.on('error', noTunnel);
  const onData = (d) => {
    const mm = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(d));
    if (mm && publicUrl !== mm[0]) {
      publicUrl = mm[0];
      console.log('\n  Öffentliche URL: ' + publicUrl + '\n  (Raum-Links im Spiel nutzen diese Adresse automatisch.)\n');
    }
  };
  child.stdout.on('data', onData); child.stderr.on('data', onData);
  process.on('exit', () => child.kill());
  process.on('SIGINT', () => process.exit());
}
function noTunnel() {
  console.log('cloudflared nicht gefunden. Installation: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/\n' +
    'Alternativen: "ssh -R 80:localhost:' + PORT + ' nokey@localhost.run" oder "ngrok http ' + PORT + '" – die URL dann im Spiel unter "Öffentliche URL" eintragen.');
}
