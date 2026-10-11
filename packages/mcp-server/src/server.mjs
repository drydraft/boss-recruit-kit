#!/usr/bin/env node
/**
 * Boss 直聘招聘自动化 MCP 服务器（stdio，零外部依赖）
 *
 * 为什么不用官方 SDK：MCP SDK v2 只提供 Streamable HTTP 传输，stdio 需要自行实现；
 * 而 stdio 上的 MCP 本质就是「按行分隔的 JSON-RPC 2.0」，实现量很小。
 * 零依赖带来两个好处：使用者不需要 npm install；离线环境可直接运行。
 *
 * 支持的方法：
 *   initialize / notifications/initialized / ping / tools/list / tools/call
 *
 * 工具面（与 CLI 语义一致）：
 *   list, snapshot, cleanup, capture_resume, download_resume,
 *   send_message, request_resume, favorite, audit
 *
 * 环境变量：
 *   BOSS_BRIDGE_HTTP   桥地址，默认 http://127.0.0.1:8898
 *   BOSS_TOOL_TIMEOUT  单次桥调用超时(ms)，默认 180000
 */
import { createInterface } from 'node:readline';

const BRIDGE = process.env.BOSS_BRIDGE_HTTP || 'http://127.0.0.1:8898';
const TIMEOUT = Number(process.env.BOSS_TOOL_TIMEOUT || 180000);
const PROTOCOL = '2025-06-18';
const SERVER_INFO = { name: 'boss-recruit-kit', version: '0.1.0' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s ?? '').replace(/[\s有限公司科技信息·（）()]/g, '').slice(0, 10);
const asText = (o) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o, null, 1) }] });

/** ---------------- 桥调用 ---------------- */
async function call(cmd, args = {}, timeoutMs = TIMEOUT) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${BRIDGE}/cmd`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cmd, args }),
      signal: ac.signal,
    });
    const json = await res.json();
    if (json?.ok !== true) throw new Error(`bridge-error: ${JSON.stringify(json).slice(0, 200)}`);
    return json.data ?? {};
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`bridge-timeout(${timeoutMs}ms): ${cmd}`);
    throw new Error(`bridge-unreachable(${BRIDGE}): ${e.message} —— 请先启动本地桥（npm run bridge）并让浏览器带着扩展打开 Boss 页面`);
  } finally {
    clearTimeout(timer);
  }
}

/** ---------------- 防重名定位（PITFALLS C3） ---------------- */
function fpMatch(snap, want) {
  if (!snap || !want) return false;
  if (want.name && snap.name !== want.name) return false;
  if (want.age != null && String(snap.age ?? '') !== String(want.age)) return false;
  if (want.workExp0 != null && norm((snap.workExp || [''])[0]) !== norm(want.workExp0)) return false;
  return true;
}

async function openTarget({ id, name, index = 0, want }) {
  const expect = want || (name ? { name } : null);
  await call('focusWindow', {}, 20000).catch(() => {});
  if (id) {
    const o = await call('chatOpenById', { id }, 90000);
    if (o.ok) {
      const t0 = Date.now();
      while (Date.now() - t0 < 15000) {
        const s = await call('chatSnapshot', {}, 40000).catch(() => null);
        if (s?.name && (!expect || fpMatch(s, expect))) return { how: 'id', snap: s };
        await sleep(900);
      }
    }
  }
  if (name) {
    for (let i = index; i < index + 3; i++) {
      const sr = await call('searchOpenByName', { name, index: i }, 60000);
      if (!sr.ok) break;
      const t0 = Date.now();
      while (Date.now() - t0 < 12000) {
        const s = await call('chatSnapshot', {}, 40000).catch(() => null);
        if (s && (!expect || fpMatch(s, expect))) return { how: `search#${i}`, snap: s };
        await sleep(900);
      }
      if ((sr.matched || 0) <= i + 1) break;
    }
  }
  throw new Error('open-target-failed: 未能定位目标本人（指纹不符即中止，避免同名错发）。有同名请指定 index，或直接传会话 id。');
}

/** 写操作核验：等会话里出现目标消息 */
async function confirm(pattern, tries = 5) {
  for (let k = 0; k < tries; k++) {
    await sleep(1200);
    const s = await call('chatSnapshot', {}, 40000).catch(() => null);
    const hit = (s?.messages || []).find((m) => pattern.test(m.text));
    if (hit) return true;
  }
  return false;
}

/** ---------------- 工具定义 ---------------- */
const PERSON_PROPS = {
  id: { type: 'string', description: '会话 id（唯一标识，优先使用；可从 list 获得）' },
  name: { type: 'string', description: '姓名（仅在不知道 id 时使用；会做指纹核对）' },
  index: { type: 'integer', minimum: 0, description: '同名候选人中的第 N 个（从 0 开始）' },
};

const TOOLS = [
  {
    name: 'list',
    description: '列出 Boss 沟通列表会话（会话 id / 姓名 / 职位 / 时间 / 未读 / 预览）。',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 500, description: '返回条数，默认 40' } } },
    handler: async ({ limit = 40 }) => {
      const r = await call('chatList', { limit }, 60000);
      const items = (r.items || r.list || []).slice(0, limit);
      return { count: items.length, items };
    },
  },
  {
    name: 'snapshot',
    description: '打开某位候选人并返回快照：指纹（姓名/年龄/学历/年限/当前公司岗位）、是否有附件简历、最近若干条消息。用于确认"打开的是本人"。',
    inputSchema: { type: 'object', properties: PERSON_PROPS },
    handler: async ({ id, name, index }) => {
      const { how, snap } = await openTarget({ id, name, index });
      return {
        how,
        fingerprint: { name: snap.name, age: snap.age, edu: snap.edu, years: snap.years, workExp0: (snap.workExp || [])[0] },
        resumeButtons: snap.resumeBtns,
        messages: (snap.messages || []).slice(-8),
      };
    },
  },
  {
    name: 'cleanup',
    description: '清理僵尸/屏幕外简历弹层。出现"页面中部一条窄窄的文字浮窗"时用这个（根因见 docs/PITFALLS.md B4）。',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => call('cleanupResumeDom', {}, 40000),
  },
  {
    name: 'capture_resume',
    description: '抓取某人的在线简历：必要时先展开"查看全部"，再按屏分块导出图片。注意在线简历是 WASM 画布，输出是图片而不是文本。',
    inputSchema: {
      type: 'object',
      properties: {
        ...PERSON_PROPS,
        outDir: { type: 'string', description: '图片输出目录（绝对路径）' },
        screens: { type: 'integer', minimum: 1, maximum: 60, description: '最多抓几屏，默认 12' },
        expandAll: { type: 'boolean', description: '是否先点开所有"查看全部"，默认 true' },
        scale: { type: 'number', description: '导出缩放，0.4–1.6，默认 1（原生分辨率）' },
      },
    },
    handler: async ({ id, name, index, screens = 12, expandAll = true, scale = 1 }) => {
      const { snap } = await openTarget({ id, name, index });
      await call('cleanupResumeDom', {}, 40000);
      await call('chatOpenResume', {}, 45000);
      let ready = false;
      for (let k = 0; k < 12 && !ready; k++) {
        await sleep(1000);
        const c = await call('listResumeCanvases', {}, 40000);
        const cv = c?.frames?.[0]?.canvases?.[0];
        if (cv) { const [w, h] = String(cv).split('x').map(Number); if (w >= 600 && h >= 300) ready = true; }
      }
      if (!ready) throw new Error('resume-canvas-not-rendered: 窗口可能不在前台（Chromium 会节流非前台窗口的渲染，而简历是 WASM 画布）');
      if (expandAll) await call('expandAllLinks', { max: 8 }, 150000).catch(() => {});
      let tiles = 0, pages = 0;
      for (let p = 0; p < screens; p++) {
        if (p > 0) {
          const sc = await call('resumePageCapture', {}, 90000).catch(() => ({ ok: false }));
          if (sc.ok === false || sc.atBottom) break;
        } else {
          await call('resumePageCapture', { reset: true }, 90000).catch(() => {});
        }
        const c = await call('listResumeCanvases', {}, 40000);
        const [cw, ch] = String(c?.frames?.[0]?.canvases?.[0] || '734x749').split('x').map(Number);
        const hw = Math.floor(cw / 2), hh = Math.floor(ch / 2);
        for (const [x, y, w, h] of [[0, 0, hw, hh], [hw, 0, cw - hw, hh], [0, hh, hw, ch - hh], [hw, hh, cw - hw, ch - hh]]) {
          const t = await call('resumeTile', { x, y, w, h, scale }, 90000).catch(() => null);
          if (t?.png) tiles++;
        }
        pages++;
      }
      await call('resumeClose', {}, 20000).catch(() => {});
      await call('cleanupResumeDom', {}, 40000).catch(() => {});
      return { person: snap.name, pages, tiles, note: '分块图片；语义理解请配合多模态，不要指望 OCR 文本' };
    },
  },
  {
    name: 'download_resume',
    description: '下载某人的附件简历 PDF：点开"附件简历"预览 → 解析真实下载地址 → 交浏览器落盘。',
    inputSchema: { type: 'object', properties: { ...PERSON_PROPS, filename: { type: 'string', description: '落盘文件名，默认 <姓名>.pdf' } } },
    handler: async ({ id, name, index, filename }) => {
      const { snap } = await openTarget({ id, name, index });
      if (!snap.resumeBtns?.file) return `${snap.name}：暂无附件简历（可先 send_message 催一下）`;
      await call('cleanupResumeDom', {}, 40000);
      const o = await call('openAttachResume', {}, 60000);
      if (!o.viewerOpened) throw new Error('preview-not-opened: 附件简历预览没打开（界面可能改版）');
      const u = await call('getAttachUrl', {}, 40000);
      if (!u.ok) throw new Error(`attach-url-not-found: ${u.error}`);
      const f = String(filename || `${snap.name}.pdf`).replace(/[\\/:*?"<>|]/g, '_');
      const d = await call('downloadResume', { url: u.url, filename: f }, 180000);
      await call('closeAttachResume', {}, 30000).catch(() => {});
      return { person: snap.name, ok: !!d.ok, file: d.filename, bytes: d.bytes };
    },
  },
  {
    name: 'send_message',
    description: '给某人发消息。返回的 confirmed 表示"会话里确实出现了这条消息"（真正的成功判据）。dryRun=true 时只预演不发送。',
    inputSchema: {
      type: 'object',
      properties: { ...PERSON_PROPS, text: { type: 'string', description: '消息内容' }, dryRun: { type: 'boolean' } },
      required: ['text'],
    },
    handler: async ({ id, name, index, text, dryRun }) => {
      const { snap } = await openTarget({ id, name, index });
      if (dryRun) return { person: snap.name, dryRun: true, wouldSend: text };
      const r = await call('chatSendText', { text }, 60000);
      const confirmed = await confirm(new RegExp(text.slice(0, 8).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      return { person: snap.name, sent: !!r.ok, confirmed, hint: confirmed ? '' : '未确认：见 docs/TROUBLESHOOTING.md「发送无反应」' };
    },
  },
  {
    name: 'request_resume',
    description: '点"求简历"（两步确认）。返回的 confirmed 表示系统消息"简历请求已发送"出现。',
    inputSchema: { type: 'object', properties: PERSON_PROPS },
    handler: async ({ id, name, index }) => {
      const { snap } = await openTarget({ id, name, index });
      const r = await call('requestResume', {}, 60000);
      const confirmed = await confirm(/简历请求已发送/);
      return { person: snap.name, requested: !!r.ok, confirmed };
    },
  },
  {
    name: 'favorite',
    description: '收藏某人。先读当前状态，已是"已收藏"就不会再点（避免把收藏点成取消）。',
    inputSchema: { type: 'object', properties: PERSON_PROPS },
    handler: async ({ id, name, index }) => {
      const { snap } = await openTarget({ id, name, index });
      await call('cleanupResumeDom', {}, 40000);
      await call('chatOpenResume', {}, 45000);
      await sleep(2500);
      const st = await call('favoriteState', {}, 30000);
      if (st.favorited) {
        await call('resumeClose', {}, 20000).catch(() => {});
        return { person: snap.name, favorite: '已收藏', changed: false };
      }
      const f = st.mixed ? { favorited: false } : await call('favoriteResume', { settleMs: 1500 }, 40000);
      await call('resumeClose', {}, 20000).catch(() => {});
      await call('cleanupResumeDom', {}, 40000).catch(() => {});
      return { person: snap.name, favorited: !!f.favorited, warning: st.mixed ? '按钮状态不明确，已跳过以免误取消' : undefined };
    },
  },
  {
    name: 'audit',
    description: '逐人核验：指纹是否一致 + 开场话术是否已发 + 求简历是否已发 + 收藏状态。people 里建议都带 id。',
    inputSchema: {
      type: 'object',
      properties: {
        people: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, name: { type: 'string' }, age: { type: ['string', 'number'] }, workExp0: { type: 'string' } },
            required: ['name'],
          },
        },
      },
      required: ['people'],
    },
    handler: async ({ people }) => {
      const rows = [];
      for (const p of people) {
        const rec = { name: p.name, fp: null, msg: null, request: null, favorite: null, error: null };
        try {
          const { snap } = await openTarget({ id: p.id, name: p.name, want: { name: p.name, age: p.age, workExp0: p.workExp0 } });
          rec.fp = 'ok';
          rec.msg = (snap.messages || []).some((m) => m.dir === 'me' && /方便发一份.*简历吗/.test(m.text));
          rec.request = (snap.messages || []).some((m) => /简历请求已发送/.test(m.text));
          await call('cleanupResumeDom', {}, 40000);
          await call('chatOpenResume', {}, 45000);
          await sleep(2200);
          const st = await call('favoriteState', {}, 30000);
          rec.favorite = st.favorited ? '已收藏' : (st.states || []).join('/');
          await call('resumeClose', {}, 20000).catch(() => {});
          await call('cleanupResumeDom', {}, 40000).catch(() => {});
        } catch (e) { rec.error = e.message; }
        rows.push(rec);
        await sleep(800);
      }
      return { ok: rows.every((r) => !r.error), rows };
    },
  },
];

const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

/** ---------------- JSON-RPC over stdio ---------------- */
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handle(msg) {
  const { id, method, params } = msg;
  const reply = (result) => { if (id !== undefined) send({ jsonrpc: '2.0', id, result }); };
  const error = (code, message) => { if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code, message } }); };

  switch (method) {
    case 'initialize':
      reply({
        protocolVersion: params?.protocolVersion || PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          'Boss 直聘招聘自动化工具集。铁律：① 涉及具体候选人时优先用会话 id（唯一），用姓名会做指纹核对，不符即中止；' +
          '② 写操作以返回的 confirmed 为准（会话里真的出现了消息），不要只看 sent/requested；' +
          '③ 在线简历是 WASM 画布，抓取结果是图片分块；' +
          '④ 出现"窄栏文字浮窗"时调用 cleanup。详见 docs/PITFALLS.md。',
      });
      return;
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return;
    case 'ping':
      reply({});
      return;
    case 'tools/list':
      reply({ tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
      return;
    case 'tools/call': {
      const tool = TOOL_MAP.get(params?.name);
      if (!tool) { error(-32602, `unknown tool: ${params?.name}`); return; }
      try {
        const out = await tool.handler(params.arguments || {});
        reply(asText(out));
      } catch (e) {
        // 工具级失败用 isError 表达，便于模型自我纠正
        reply({ ...asText(`执行失败：${e.message}`), isError: true });
      }
      return;
    }
    default:
      error(-32601, `method not found: ${method}`);
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
let queue = Promise.resolve();
rl.on('line', (line) => {
  const s = line.trim();
  if (!s) return;
  let msg;
  try { msg = JSON.parse(s); } catch { return; }
  // 串行处理，避免并发操作浏览器导致互相打断
  queue = queue.then(() => handle(msg)).catch((e) => {
    try { send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String(e.message || e) } }); } catch { /* ignore */ }
  });
});
// stdin 关闭（客户端退出）时，先把已排队的调用跑完再退出，避免截断进行中的浏览器操作
rl.on('close', () => { queue.finally(() => process.exit(0)); });
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
