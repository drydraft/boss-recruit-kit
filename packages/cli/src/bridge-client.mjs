/**
 * boss-kit CLI · 桥客户端
 *
 * 与本地桥（HTTP 8898）通信的最小封装。桥把请求经 WebSocket 转发给浏览器扩展的
 * content script，由扩展在页面里执行 DOM 操作后回传结果。
 *
 * 这里同时实现了**防重名的核心约束**（docs/PITFALLS.md C3）：
 *   1. 优先按会话 id 打开（id 唯一）；
 *   2. 打开后必须核对指纹（姓名 + 年龄 + 学历 + 年限 + 当前公司岗位）；
 *   3. 指纹不符即抛错中止，绝不"猜一个就发"。
 */
import { config } from './config.mjs';
import { norm, sleep, rnd } from './util.mjs';

export class BridgeError extends Error {
  constructor(message, detail) { super(message); this.name = 'BridgeError'; this.detail = detail; }
}

/** 调用桥命令；返回 data（失败抛 BridgeError） */
export async function call(cmd, args = {}, timeoutMs = config.timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${config.bridgeHttp}/cmd`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cmd, args }),
      signal: ac.signal,
    });
    const json = await res.json().catch(() => null);
    if (!json) throw new BridgeError(`桥返回了非 JSON 响应（${res.status}）`);
    if (json.ok !== true) throw new BridgeError(`命令失败：${cmd} → ${JSON.stringify(json).slice(0, 240)}`, json);
    return json.data ?? {};
  } catch (e) {
    if (e instanceof BridgeError) throw e;
    if (e.name === 'AbortError') throw new BridgeError(`命令超时（${timeoutMs}ms）：${cmd}`);
    throw new BridgeError(`无法连接本地桥 ${config.bridgeHttp}（${e.message}）—— 先运行：boss bridge start`);
  } finally {
    clearTimeout(timer);
  }
}

export async function status() {
  try {
    const res = await fetch(`${config.bridgeHttp}/status`, { signal: AbortSignal.timeout(5000) });
    return await res.json();
  } catch (e) {
    return { ok: false, extensionConnected: false, error: e.message };
  }
}

/** 指纹比对：want 里给了哪些字段就比哪些 */
export function fpMatch(snap, want) {
  if (!snap || !want) return false;
  if (want.name && snap.name !== want.name) return false;
  if (want.age != null && want.age !== '' && String(snap.age ?? '') !== String(want.age)) return false;
  if (want.edu && snap.edu && String(snap.edu) !== String(want.edu)) return false;
  if (want.years && snap.years && String(snap.years) !== String(want.years)) return false;
  if (want.workExp0 && norm((snap.workExp || [''])[0]) !== norm(want.workExp0)) return false;
  return true;
}

export function fingerprintOf(snap) {
  return {
    name: snap?.name ?? null,
    age: snap?.age ?? null,
    edu: snap?.edu ?? null,
    years: snap?.years ?? null,
    workExp0: (snap?.workExp || [])[0] ?? null,
  };
}

/**
 * 打开目标候选人并返回快照。
 * @param {{id?:string,name?:string,index?:number,want?:object,timeoutMs?:number}} o
 */
export async function openTarget(o) {
  const { id, name, index = 0, want } = o;
  const expect = want || (name ? { name } : null);

  await call('focusWindow', {}, 20000).catch(() => {});

  if (id) {
    const r = await call('chatOpenById', { id }, 90000);
    if (r.ok) {
      const t0 = Date.now();
      while (Date.now() - t0 < 15000) {
        const snap = await call('chatSnapshot', {}, 40000).catch(() => null);
        if (snap && snap.name && (!expect || fpMatch(snap, expect))) return { how: 'id', snap };
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
        const snap = await call('chatSnapshot', {}, 40000).catch(() => null);
        if (snap && (!expect || fpMatch(snap, expect))) return { how: `search#${i}`, snap };
        await sleep(900);
      }
      if ((sr.matched || 0) <= i + 1) break;
    }
  }

  throw new BridgeError(
    `未能定位到目标本人${name ? `（${name}）` : ''}：指纹不符即中止，避免同名错发。` +
    `若确认有多个同名，请用 --index N 指定第 N 个，或直接用会话 id。`);
}

/** 等简历画布渲染就绪（窗口不在前台会一直是 300×150 占位） */
export async function waitResumeCanvas(tries = 12) {
  for (let k = 0; k < tries; k++) {
    await sleep(1000);
    const c = await call('listResumeCanvases', {}, 40000).catch(() => null);
    const cv = c?.frames?.[0]?.canvases?.[0];
    if (cv) {
      const [w, h] = String(cv).split('x').map(Number);
      if (w >= 600 && h >= 300) return cv;
    }
  }
  throw new BridgeError(
    '简历画布未渲染（仍是占位尺寸）。最常见原因是浏览器窗口不在前台：' +
    'Chromium 会节流非前台窗口的渲染，而在线简历是 WASM 画布。请把窗口切到前台后重试（docs/PITFALLS.md B1）。');
}

/** 打开在线简历（开前先清僵尸弹层，避免叠层生成"幽灵窄栏浮窗"） */
export async function openResume() {
  await call('cleanupResumeDom', {}, 40000).catch(() => {});
  await call('chatOpenResume', {}, 45000);
  return waitResumeCanvas();
}

export async function closeResume() {
  await call('resumeClose', {}, 20000).catch(() => {});
  await call('cleanupResumeDom', {}, 40000).catch(() => {});
}

/** 等会话里出现某条自己发的消息（写操作的核验手段） */
export async function confirmMessage(pattern, tries = 5) {
  for (let k = 0; k < tries; k++) {
    await sleep(rnd(900, 1400));
    const snap = await call('chatSnapshot', {}, 40000).catch(() => null);
    const hit = (snap?.messages || []).find((m) => pattern.test(m.text));
    if (hit) return hit;
  }
  return null;
}
