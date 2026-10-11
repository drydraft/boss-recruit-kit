/**
 * boss-kit CLI · 通用工具：参数解析、输出、等待。
 * 设计原则：命令输出默认给人看（表格/短句），加 --json 时输出机器可读 JSON，方便脚本串联。
 */

const C = {
  reset: '\u001b[0m', bold: '\u001b[1m', dim: '\u001b[2m',
  red: '\u001b[31m', green: '\u001b[32m', yellow: '\u001b[33m', cyan: '\u001b[36m',
};
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
export const color = new Proxy(C, {
  get: (t, k) => (useColor ? t[k] : ''),
});

/** 解析 argv：支持 --flag / --key=value / --key value / --no-flag，其余为位置参数 */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { out._.push(...argv.slice(i + 1)); break; }
    if (!a.startsWith('--')) { out._.push(a); continue; }
    let key = a.slice(2);
    let val;
    if (key.startsWith('no-')) { key = key.slice(3); out[key] = false; continue; }
    const eq = key.indexOf('=');
    if (eq >= 0) { val = key.slice(eq + 1); key = key.slice(0, eq); }
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) { val = argv[++i]; }
    else { val = true; }
    out[key] = val;
  }
  return out;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const rnd = (a, b) => a + Math.random() * (b - a);

/** 归一化公司/岗位字符串，用于指纹比对（容忍空白与"有限公司/科技/信息"等噪声） */
export function norm(s) {
  return String(s ?? '').replace(/[\s有限公司科技信息·（）()]/g, '').slice(0, 10);
}

/** 打印表格（列宽自适应，中文按 2 字宽计算） */
export function table(rows, headers) {
  const w = (s) => [...String(s ?? '')].reduce((n, ch) => n + (/[\u4e00-\u9fa5\uff00-\uffef]/.test(ch) ? 2 : 1), 0);
  const pad = (s, n) => String(s ?? '') + ' '.repeat(Math.max(0, n - w(s)));
  const cols = headers.map((h) => Math.max(w(h.label), ...rows.map((r) => w(r[h.key]))));
  const line = headers.map((h, i) => pad(h.label, cols[i])).join('  ');
  const out = [`${color.bold}${line}${color.reset}`, `${color.dim}${'-'.repeat(w(line))}${color.reset}`];
  for (const r of rows) out.push(headers.map((h, i) => pad(r[h.key], cols[i])).join('  '));
  return out.join('\n');
}

export function ok(msg) { console.log(`${color.green}✓${color.reset} ${msg}`); }
export function warn(msg) { console.log(`${color.yellow}!${color.reset} ${msg}`); }
export function fail(msg) { console.error(`${color.red}✗${color.reset} ${msg}`); }
export function info(msg) { console.log(`${color.dim}${msg}${color.reset}`); }

/** 统一的命令返回：--json 时打印 JSON，否则交给 render */
export function emit(args, data, render) {
  if (args.json) { console.log(JSON.stringify(data, null, 2)); return; }
  if (render) console.log(render(data));
  else console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

/** 把 dataURL 写成文件 */
export async function saveDataUrl(dataUrl, file) {
  const { writeFile, mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl || '');
  if (!m) throw new Error('invalid-data-url');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(m[2], 'base64'));
  return file;
}

export const pad3 = (n) => String(n).padStart(3, '0');
