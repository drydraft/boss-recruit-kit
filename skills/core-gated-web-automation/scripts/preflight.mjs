#!/usr/bin/env node
/**
 * preflight.mjs — Phase 0 readiness gate for gated web automation.
 *
 * Portable: it only assumes (a) a local command bridge that answers over HTTP,
 * and (b) a bridge command that can enumerate the current view. Command names and
 * the bridge URL are configurable, so the same script works for any application
 * that exposes an equivalent bridge.
 *
 * Usage:
 *   node preflight.mjs [--bridge http://127.0.0.1:8898] [--expect-origin https://example.com]
 *                      [--list-cmd chatList] [--canvas-cmd listResumeCanvases] [--json]
 *
 * Exit code 0 = every check PASS (safe to proceed). 1 = at least one FAIL.
 */
const args = process.argv.slice(2);
const flag = (name, fallback = undefined) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const BRIDGE = flag('bridge') || process.env.AUTOMATION_BRIDGE_HTTP || 'http://127.0.0.1:8898';
const EXPECT_ORIGIN = flag('expect-origin') || process.env.AUTOMATION_EXPECT_ORIGIN || '';
const LIST_CMD = flag('list-cmd') || process.env.AUTOMATION_LIST_CMD || 'chatList';
const CANVAS_CMD = flag('canvas-cmd') || process.env.AUTOMATION_CANVAS_CMD || 'listResumeCanvases';
const AS_JSON = has('json');
const TIMEOUT = Number(flag('timeout') || 20000);

const results = [];
const record = (name, ok, detail, hint = '') => results.push({ name, ok, detail, hint });

async function getJson(url, ms = TIMEOUT) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
  return res.json();
}

async function cmd(name, payload = {}, ms = TIMEOUT) {
  const res = await fetch(`${BRIDGE}/cmd`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cmd: name, args: payload }),
    signal: AbortSignal.timeout(ms),
  });
  const json = await res.json();
  if (json.ok !== true) throw new Error(JSON.stringify(json).slice(0, 160));
  return json.data ?? {};
}

// 1. Bridge reachable
let status = null;
try {
  status = await getJson(`${BRIDGE}/status`);
  record('bridge reachable', status.ok !== false, `${BRIDGE}`, status.ok === false ? 'start the bridge' : '');
} catch (e) {
  record('bridge reachable', false, e.message, `start the bridge, or pass --bridge <url>`);
}

// 2. Extension connected
if (status) {
  const clients = status.clients ?? 0;
  record('extension connected', !!status.extensionConnected, `clients=${clients}`,
    status.extensionConnected ? '' : 'open the browser with the extension loaded, then reload the tab');
  record('single client (no zombie sockets)', clients === 1, `clients=${clients}`,
    clients > 1 ? 'restart the bridge: stale sockets swallow commands' : '');
}

// 3. View enumerable + origin check
let view = null;
if (status?.extensionConnected) {
  try {
    view = await cmd(LIST_CMD, { limit: 1 });
    record('current view readable', true, `${LIST_CMD} answered`);
  } catch (e) {
    record('current view readable', false, e.message, 'confirm the tab is on the target page and logged in');
  }
}

if (view && EXPECT_ORIGIN) {
  const url = view.url || view.urlBefore || '';
  const ok = String(url).startsWith(EXPECT_ORIGIN);
  record('tab on expected origin', ok, String(url).slice(0, 80), ok ? '' : `expected ${EXPECT_ORIGIN}`);
}

// 4. Window focus (required before any canvas read or click)
if (view && typeof view.windowFocused === 'boolean') {
  record('window focused', view.windowFocused, `focused=${view.windowFocused}`,
    view.windowFocused ? '' : 'focus the window; background windows do not repaint canvases');
}

// 5. Canvas sanity (only when the app renders into a canvas)
if (status?.extensionConnected) {
  try {
    const info = await cmd(CANVAS_CMD, {}, TIMEOUT);
    const frames = info.frames || [];
    if (!frames.length) {
      record('canvas present', true, 'no canvas in current view (ok if the app is DOM-only)');
    } else {
      const sizes = frames.flatMap((f) => f.canvases || []);
      const placeholder = sizes.every((s) => {
        const [w, h] = String(s).split('x').map(Number);
        return w <= 320 && h <= 160;
      });
      record('canvas sized plausibly', !placeholder, sizes.join(', ') || 'none',
        placeholder ? 'looks like the default placeholder: focus the window, then re-read' : '');
    }
  } catch {
    record('canvas present', true, 'canvas command unavailable (ok if the app is DOM-only)');
  }
}

if (AS_JSON) {
  console.log(JSON.stringify({ ok: results.every((r) => r.ok), bridge: BRIDGE, checks: results }, null, 2));
} else {
  const width = Math.max(...results.map((r) => r.name.length));
  console.log(`preflight — ${BRIDGE}\n`);
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(width)}  ${r.detail}${r.hint ? `\n${' '.repeat(6 + width + 2)}→ ${r.hint}` : ''}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${failed === 0 ? 'All checks PASS — safe to proceed (Phase 0 postcondition met).' : `${failed} check(s) FAILED — fix before touching the page.`}`);
}

process.exit(results.every((r) => r.ok) ? 0 : 1);
