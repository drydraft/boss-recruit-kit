#!/usr/bin/env node
/**
 * boss-bridge 本地桥
 *   - WebSocket 8899：给浏览器扩展连（无依赖，自实现 RFC6455 最小实现）
 *   - HTTP   8898：给外部（curl / 脚本）下指令，同步等结果
 *   - 数据落盘：data/jobs-YYYYMMDD.jsonl、data/bridge.log
 *
 * 启动: node boss-bridge-server.cjs
 * 用法:
 *   curl -s http://127.0.0.1:8898/status
 *   curl -s -X POST http://127.0.0.1:8898/cmd -H "content-type: application/json" -d '{"cmd":"status"}'
 *   curl -s -X POST http://127.0.0.1:8898/scrape -H "content-type: application/json" -d '{"keyword":"Python","city":"101280600","pages":2}'
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const WS_PORT = Number(process.env.BRIDGE_WS_PORT || 8899);
const HTTP_PORT = Number(process.env.BRIDGE_HTTP_PORT || 8898);
const DATA = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA, { recursive: true });

const clients = new Set();
const pending = new Map();          // id -> {resolve, reject, timer}
let seq = 0;
let lastResult = null;

function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.join(' ')}`;
  console.log(line);
  try { fs.appendFileSync(path.join(DATA, 'bridge.log'), line + '\n'); } catch (e) { }
}
function todayFile() {
  return path.join(DATA, `jobs-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.jsonl`);
}

// ---------------------------------------------------------------- WebSocket
function wsAccept(key) {
  return crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
}
function encodeFrame(str) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2); header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4); header[1] = 126; header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10); header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x81;                              // FIN + text
  return Buffer.concat([header, payload]);
}
function makeClient(socket) {
  const c = { socket, buf: Buffer.alloc(0), frag: null, alive: true, info: null };
  socket.on('data', (chunk) => { c.buf = Buffer.concat([c.buf, chunk]); pump(c); });
  socket.on('close', () => { clients.delete(c); log('ws closed, clients=' + clients.size); });
  socket.on('error', () => { try { socket.destroy(); } catch (e) { } });
  return c;
}
function pump(c) {
  while (true) {
    const b = c.buf;
    if (b.length < 2) return;
    const opcode = b[0] & 0x0f;
    const masked = (b[1] & 0x80) === 0x80;
    let len = b[1] & 0x7f;
    let off = 2;
    if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
    let mask = null;
    if (masked) { if (b.length < off + 4) return; mask = b.slice(off, off + 4); off += 4; }
    if (b.length < off + len) return;
    let payload = b.slice(off, off + len);
    c.buf = b.slice(off + len);
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];

    if (opcode === 0x8) { try { c.socket.end(); } catch (e) { } return; }
    if (opcode === 0x9) { try { c.socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); } catch (e) { } continue; }
    if (opcode === 0xa) continue;
    if (opcode === 0x0) { if (c.frag) { c.frag = Buffer.concat([c.frag, payload]); } continue; }
    if (opcode === 0x1) { onWsText(c, payload.toString('utf8')); continue; }
  }
}
function onWsText(c, text) {
  let msg;
  try { msg = JSON.parse(text); } catch (e) { return; }
  if (msg.type === 'hello') { c.info = msg; log('hello from extension v' + msg.version); return; }
  if (msg.type === 'ping') return;
  if (msg.type === 'result') {
    const p = pending.get(msg.id);
    if (p) { clearTimeout(p.timer); pending.delete(msg.id); lastResult = msg; p.resolve(msg); }
    else log('orphan result id=' + msg.id);
    return;
  }
  if (msg.type === 'event') { log('event ' + JSON.stringify(msg).slice(0, 300)); return; }
}

const wsHttp = http.createServer((req, res) => { res.writeHead(426); res.end('upgrade required'); });
wsHttp.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + wsAccept(key) + '\r\n\r\n'
  );
  const c = makeClient(socket);
  clients.add(c);
  log('ws connected, clients=' + clients.size);
});

function firstClient() { return [...clients][0] || null; }

function sendCmd(cmd, args = {}, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const c = firstClient();
    if (!c) return reject(new Error('extension-not-connected: 浏览器里没连上桥（扩展没装/没加载？）'));
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('timeout: ' + cmd)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    try { c.socket.write(encodeFrame(JSON.stringify({ type: 'cmd', id, cmd, args }))); }
    catch (e) { clearTimeout(timer); pending.delete(id); reject(e); }
  });
}

// ---------------------------------------------------------------- HTTP 控制面
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scrape({ keyword, city, url, pages = 1, gapMs = [3000, 8000] }) {
  const out = { keyword, city, url, startedAt: new Date().toISOString(), pages: [], jobs: [], notes: [] };
  const first = url
    ? await sendCmd('open', { url }, 180000)
    : await sendCmd('search', { keyword, city }, 180000);
  if (first.ok === false) { out.notes.push('search failed: ' + JSON.stringify(first.data).slice(0, 200)); return out; }
  let page = first.data.page || {};
  let pageNo = 1;
  out.pages.push({ page: pageNo, url: page.url, count: (page.jobs || []).length });
  out.jobs.push(...(page.jobs || []));
  if (page.security && (page.security.envAbnormal || page.security.securityUrl)) out.notes.push('security-check detected on page 1');
  for (let i = 1; i < pages; i++) {
    if (out.notes.some((n) => n.startsWith('security-check'))) { out.notes.push('退避：出现安全校验，停止后续翻页'); break; }
    await sleep(gapMs[0] + Math.random() * (gapMs[1] - gapMs[0]));      // 拟人节奏
    const nx = await sendCmd('next', {}, 60000);
    if (nx.ok === false || !nx.data.ok) { out.notes.push('no-next at page ' + pageNo + ': ' + JSON.stringify(nx.data).slice(0, 160)); break; }
    pageNo++;
    const r = await sendCmd('collect', {}, 60000);
    const p = r.data || {};
    out.pages.push({ page: pageNo, url: p.url, count: (p.jobs || []).length });
    out.jobs.push(...(p.jobs || []));
    if (p.security && (p.security.envAbnormal || p.security.securityUrl)) { out.notes.push('security-check detected on page ' + pageNo); break; }
  }
  out.finishedAt = new Date().toISOString();
  out.total = out.jobs.length;
  const f = todayFile();
  for (const j of out.jobs) fs.appendFileSync(f, JSON.stringify({ ...j, _keyword: keyword, _city: city, _at: out.startedAt }) + '\n');
  log(`scrape done keyword=${keyword} pages=${out.pages.length} jobs=${out.total} -> ${f}`);
  return out;
}

const api = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const json = (code, obj) => {
    const body = JSON.stringify(obj, null, 2);
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  };
  const readBody = () => new Promise((resolve) => {
    let b = '';
    req.on('data', (d) => { b += d; if (b.length > 5e6) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { resolve({}); } });
  });

  (async () => {
    try {
      if (req.method === 'GET' && url === '/status') {
        return json(200, {
          ok: true,
          extensionConnected: clients.size > 0,
          clients: clients.size,
          hello: firstClient() ? firstClient().info : null,
          lastResult: lastResult ? { id: lastResult.id, ok: lastResult.ok, data: lastResult.data } : null,
          dataFile: todayFile(),
          jobsSavedToday: fs.existsSync(todayFile()) ? fs.readFileSync(todayFile(), 'utf8').split('\n').filter(Boolean).length : 0,
        });
      }
      if (req.method === 'GET' && url === '/jobs') {
        const f = todayFile();
        const rows = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
        return json(200, { ok: true, count: rows.length, rows });
      }
      if (req.method === 'POST' && url === '/cmd') {
        const body = await readBody();
        const r = await sendCmd(body.cmd, body.args || {}, body.timeoutMs || 180000);
        return json(200, r);
      }
      if (req.method === 'POST' && url === '/scrape') {
        const body = await readBody();
        const r = await scrape(body);
        return json(200, { ok: true, ...r, jobs: r.jobs.slice(0, 200) });
      }
      return json(404, { ok: false, error: 'not found', routes: ['GET /status', 'GET /jobs', 'POST /cmd', 'POST /scrape'] });
    } catch (e) {
      return json(500, { ok: false, error: String((e && e.message) || e) });
    }
  })();
});

wsHttp.listen(WS_PORT, '127.0.0.1', () => log(`ws bridge on ws://127.0.0.1:${WS_PORT}`));
api.listen(HTTP_PORT, '127.0.0.1', () => log(`http control on http://127.0.0.1:${HTTP_PORT}  (GET /status, POST /cmd, POST /scrape)`));
