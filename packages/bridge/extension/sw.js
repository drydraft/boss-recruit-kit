// boss-bridge service worker（MV3）
// 职责：连本地 WebSocket 桥 → 收指令 → 转发给 zhipin 标签页的 content script → 回传结果。
// 注意：本文件**不接触页面上下文、不改任何原生对象**，因此不会触发 zpAegis / disable-devtool 的自检。

const WS_URL = 'ws://127.0.0.1:8899';
const VERSION = '1.0.0';

let ws = null;
let backoffMs = 500;
let pingTimer = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function connect() {
  try {
    ws = new WebSocket(WS_URL);
  } catch (e) {
    scheduleReconnect();
    return;
  }
  ws.onopen = () => {
    backoffMs = 500;
    console.log('[boss-bridge] connected', WS_URL);
    send({ type: 'hello', version: VERSION, ua: navigator.userAgent });
    // 心跳：既保活 SW，也让桥知道扩展还在
    clearInterval(pingTimer);
    pingTimer = setInterval(() => send({ type: 'ping', t: Date.now() }), 20000);
  };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.type !== 'cmd') return;
    handleCmd(msg)
      .then((res) => send({ type: 'result', id: msg.id, ok: res.ok !== false, data: res }))
      .catch((e) => send({ type: 'result', id: msg.id, ok: false, data: { ok: false, error: String(e && e.message || e) } }));
  };
  ws.onclose = () => { clearInterval(pingTimer); scheduleReconnect(); };
  ws.onerror = () => { try { ws.close(); } catch (e) { } };
}

function scheduleReconnect() {
  const wait = backoffMs;
  backoffMs = Math.min(30000, backoffMs * 2);
  setTimeout(connect, wait);
}

async function zhipinTab() {
  const tabs = await chrome.tabs.query({ url: 'https://www.zhipin.com/*' });
  return tabs.find((t) => t.active) || tabs[0] || null;
}

async function callContent(tabId, msg, { tries = 12, gap = 700 } = {}) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, msg);
      if (res) return res;
    } catch (e) { lastErr = e; }
    await sleep(gap);
  }
  throw new Error('content-unreachable: ' + (lastErr && lastErr.message));
}

// 导航并等待页面就绪：
//   关键修正1：比较全量 URL（同前缀也必须真的导航）
//   关键修正2：必须等"URL 已变成目标页"再收数据，否则会读到上一页的 DOM（导航竞态）
async function navigate(url, { expectCards = false, urlMatch = null, timeoutMs = 35000, minCards = 5 } = {}) {
  let tab = await zhipinTab();
  if (!tab) {
    tab = await chrome.tabs.create({ url, active: true });
  } else if (tab.url !== url) {
    await chrome.tabs.update(tab.id, { url });
  }
  await chrome.tabs.update(tab.id, { active: true });

  const t0 = Date.now();
  let last = null, best = null, urlOk = false, cardsOk = false;
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await chrome.tabs.sendMessage(tab.id, { cmd: expectCards ? 'collect' : 'ping' });
      last = r;
      if (r && r.ok) {
        urlOk = !urlMatch || (r.url || '').includes(urlMatch);
        const n = (r.jobs || []).length;
        if (expectCards && n > (best ? (best.jobs || []).length : 0)) best = r;
        cardsOk = !expectCards || n >= minCards;
        if (urlOk && cardsOk) return { tab, page: r, urlOk, cardsOk };
      }
    } catch (e) { }
    await sleep(700);
  }
  const page = (best && (best.jobs || []).length >= (last ? (last.jobs || []).length : 0)) ? best : last;
  return { tab, page, urlOk, cardsOk };
}

// 搜索：先像真人一样在首页搜索框里输入（最可靠，能得到 ?query= 真实结果页）；
// 失败再退化为 URL 直连 + 等 URL 命中的方式。
async function doSearch(keyword, city) {
  const tab0 = await zhipinTab();
  if (tab0) {
    try {
      await navigate('https://www.zhipin.com/', { expectCards: false, timeoutMs: 25000 });
      let inPage = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        inPage = await callContent(tab0.id, { cmd: 'searchInPage', args: { keyword } }, { tries: 2, gap: 500 }).catch(() => null);
        if (inPage && inPage.ok) break;
        await sleep(1200);            // 首页搜索框可能还没渲染出来 → 重试
      }
      if (inPage && inPage.ok) {
        const t0 = Date.now();
        let last = null, best = null;
        while (Date.now() - t0 < 30000) {
          const r = await chrome.tabs.sendMessage(tab0.id, { cmd: 'collect' }).catch(() => null);
          if (r && r.ok) { last = r; if ((r.jobs || []).length > (best ? (best.jobs || []).length : 0)) best = r; }
          if (r && r.ok && (r.jobs || []).length >= 5) break;   // 等到结果真出来（≥5 张）
          await sleep(700);
        }
        const finalPage = last && (last.jobs || []).length >= 5 ? last : (best || last);
        if (finalPage && finalPage.ok) return { ok: true, via: 'in-page', url: finalPage.url, page: finalPage };
      }
    } catch (e) { /* 落到下面的 URL 方案 */ }
  }

  const direct = 'https://www.zhipin.com/web/geek/jobs?query=' + encodeURIComponent(keyword || '') + (city ? '&city=' + encodeURIComponent(city) : '');
  const marker = 'query=' + encodeURIComponent(keyword || '');
  const nav = await navigate(direct, { expectCards: true, urlMatch: marker, timeoutMs: 25000 });
  return { ok: !!(nav.page && nav.page.ok), via: 'url', url: nav.page && nav.page.url, page: nav.page || { ok: false, error: 'no-page' } };
}

async function handleCmd(msg) {
  const { cmd, args = {} } = msg;

  if (cmd === 'status') {
    const tab = await zhipinTab();
    if (!tab) return { ok: true, connected: true, tab: null, note: '未打开 zhipin 标签页' };
    const page = await callContent(tab.id, { cmd: 'status' }, { tries: 3 }).catch(() => null);
    return { ok: true, connected: true, tab: { id: tab.id, url: tab.url, title: tab.title }, page };
  }

  if (cmd === 'search') {
    const r = await doSearch(args.keyword, args.city);
    return { ...r, page: r.page || { ok: false, error: 'no-page' } };
  }

  if (cmd === 'searchInPage') {
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    return callContent(tab.id, { cmd: 'searchInPage', args });
  }

  if (cmd === 'open') {
    const url = args.url;
    const isDetail = /\/job_detail\//.test(url || '');
    const { tab, page, urlOk, cardsOk } = await navigate(url, { expectCards: !isDetail, timeoutMs: isDetail ? 25000 : 35000 });
    return { ok: !!page && page.ok !== false, url: (page && page.url) || url, tabUrl: tab.url, urlOk, cardsOk, page: page || { ok: false, error: 'no-response' } };
  }

  if (cmd === 'collect') {
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    const pages = Math.max(1, Math.min(20, Number(args.pages) || 1));
    const all = [];
    const perPage = [];
    for (let i = 0; i < pages; i++) {
      const r = await callContent(tab.id, { cmd: 'collect' });
      perPage.push({ page: i + 1, url: r.url, count: (r.jobs || []).length });
      all.push(...(r.jobs || []));
      if (i < pages - 1) {
        const nx = await callContent(tab.id, { cmd: 'next' }, { tries: 6 });
        if (!nx.ok) { perPage.push({ page: i + 2, error: nx.error || 'no-next' }); break; }
      }
    }
    return { ok: true, total: all.length, perPage, jobs: all };
  }

  if (cmd === 'scroll') {
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    return callContent(tab.id, { cmd: 'scroll', args }, { tries: 3 });
  }

  if (cmd === 'clickables' || cmd === 'lightScroll' || cmd === 'domQuery' || cmd === 'scrollContainer'
    || cmd === 'resumeSnapshot' || cmd === 'resumeClose' || cmd === 'resumeFrameSnapshot') {
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    return callContent(tab.id, { cmd, args }, { tries: 2, gap: 400 });
  }

  if (cmd === 'domType') {
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    return callContent(tab.id, { cmd: 'domType', args }, { tries: 2, gap: 400 });
  }

  if (cmd === 'frameScrollables') {
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    return callContent(tab.id, { cmd: 'frameScrollables', args }, { tries: 1, gap: 400 });
  }

  if (cmd === 'captureResumeFull') {
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    return callContent(tab.id, { cmd: 'captureResumeFull', args }, { tries: 1, gap: 500 });
  }

  if (cmd === 'resumeShiftCapture') {
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    return callContent(tab.id, { cmd: 'resumeShiftCapture', args }, { tries: 1, gap: 500 });
  }

  if (cmd === 'pressKey' || cmd === 'listResumeCanvases') {
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    return callContent(tab.id, { cmd, args }, { tries: 1, gap: 400 });
  }

  if (cmd === 'captureResumeMultiPage') {
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    return callContent(tab.id, { cmd: 'captureResumeMultiPage', args }, { tries: 1, gap: 500 });
  }

  if (cmd === 'searchOpenByName') {
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    return callContent(tab.id, { cmd: 'searchOpenByName', args }, { tries: 1, gap: 400 });
  }

  if (cmd === 'modalScrollables') {
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    return callContent(tab.id, { cmd: 'modalScrollables', args }, { tries: 1, gap: 400 });
  }

  // 只读取证探针（probePoint / shadowScan / frameEnum / deepTextSearch / canvasCropAt）
  if (cmd === 'probePoint' || cmd === 'shadowScan' || cmd === 'frameEnum'
    || cmd === 'deepTextSearch' || cmd === 'canvasCropAt') {
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    return callContent(tab.id, { cmd, args }, { tries: 2, gap: 400 });
  }

  if (cmd === 'resumePageCapture') {
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    return callContent(tab.id, { cmd: 'resumePageCapture', args }, { tries: 1, gap: 400 });
  }

  if (cmd === 'expandResumeCapture') {
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    return callContent(tab.id, { cmd: 'expandResumeCapture', args }, { tries: 1, gap: 400 });
  }

  if (cmd === 'resumeTile') {
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    return callContent(tab.id, { cmd: 'resumeTile', args }, { tries: 1, gap: 300 });
  }

  // 把浏览器窗口置前并把标签页设为活动（否则 Chromium 会节流渲染，WASM 画布不重绘）
  if (cmd === 'focusWindow') {
    try {
      const tab = await zhipinTab();
      if (tab) await chrome.tabs.update(tab.id, { active: true });
      const win = await chrome.windows.getLastFocused();
      if (win && win.id != null) await chrome.windows.update(win.id, { focused: true, state: 'normal' });
      const all = await chrome.windows.getAll();
      for (const w of all) { try { await chrome.windows.update(w.id, { focused: true }); } catch (e) { } }
      return { ok: true, windowId: win && win.id, windows: all.length };
    } catch (e) { return { ok: false, error: String(e.message) }; }
  }

  if (cmd === 'frameClickAt') {
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    return callContent(tab.id, { cmd: 'frameClickAt', args }, { tries: 1, gap: 300 });
  }

  if (cmd === 'expandAllLinks') {
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    return callContent(tab.id, { cmd: 'expandAllLinks', args }, { tries: 1, gap: 300 });
  }

  if (cmd === 'cleanupResumeDom') {
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    return callContent(tab.id, { cmd: 'cleanupResumeDom', args }, { tries: 1, gap: 300 });
  }

  if (cmd === 'canvasColorStats') {
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    return callContent(tab.id, { cmd: 'canvasColorStats', args }, { tries: 1, gap: 300 });
  }

  if (cmd === 'dismissPopups') {
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    return callContent(tab.id, { cmd: 'dismissPopups', args }, { tries: 1, gap: 300 });
  }

  if (cmd === 'favoriteResume') {
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    return callContent(tab.id, { cmd: 'favoriteResume', args }, { tries: 1, gap: 300 });
  }

  if (cmd === 'chatSendText' || cmd === 'requestResume') {
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    return callContent(tab.id, { cmd, args }, { tries: 1, gap: 300 });
  }

  if (cmd === 'chatOpenById' || cmd === 'favoriteState') {
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    return callContent(tab.id, { cmd, args }, { tries: 1, gap: 300 });
  }

  // 附件简历下载：用 chrome.downloads 落盘到 下载/boss-resumes/<filename>
  if (cmd === 'downloadResume') {
    const rawUrl = args && args.url;
    if (!rawUrl) throw new Error('url-required');
    const url = /^https?:/.test(rawUrl) ? rawUrl : 'https://www.zhipin.com' + (rawUrl.startsWith('/') ? '' : '/') + rawUrl;
    const filename = (args && args.filename) || ('resume-' + Date.now() + '.pdf');
    const id = await chrome.downloads.download({ url, filename: 'boss-resumes/' + filename, conflictAction: 'overwrite' });
    // 等下载完成
    const t0 = Date.now();
    let item = null;
    while (Date.now() - t0 < 60000) {
      const list = await chrome.downloads.search({ id });
      item = list && list[0];
      if (item && (item.state === 'complete' || item.state === 'interrupted')) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    return { ok: !!(item && item.state === 'complete'), id, state: item && item.state, filename: item && item.filename, bytes: item && item.fileSize, error: item && item.error };
  }

  if (cmd === 'openAttachResume' || cmd === 'getAttachUrl' || cmd === 'closeAttachResume') {
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    return callContent(tab.id, { cmd, args }, { tries: 1, gap: 300 });
  }

  // 简历逐页抓取（单次调用内部完成多屏滚动）
  if (cmd === 'captureResumePages') {
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    return callContent(tab.id, { cmd: 'captureResumePages', args }, { tries: 1, gap: 500 });
  }

  // 批量抓简历：单次调用内部连续处理多人（长任务，1 次往返）
  if (cmd === 'batchCaptureResumes') {
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    return callContent(tab.id, { cmd: 'batchCaptureResumes', args }, { tries: 1, gap: 500 });
  }

  // 简历画布导出（可能返回很大的 base64）
  if (cmd === 'resumeFrameCapture') {
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    return callContent(tab.id, { cmd: 'resumeFrameCapture', args }, { tries: 2, gap: 600 });
  }

  // 兜底：整屏截图（需要 activeTab 权限）
  if (cmd === 'captureVisibleTab') {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    return { ok: true, png: dataUrl, pngLen: (dataUrl || '').length };
  }

  // 招聘端：列表/打开会话/快照（耗时较长，给足重试）
  if (cmd === 'chatList' || cmd === 'chatScroll' || cmd === 'chatSnapshot' || cmd === 'chatExpand'
    || cmd === 'chatOpenResume') {
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    return callContent(tab.id, { cmd, args }, { tries: 3, gap: 600 });
  }

  if (cmd === 'chatOpen') {
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    return callContent(tab.id, { cmd: 'chatOpen', args }, { tries: 2, gap: 600 });
  }

  if (cmd === 'domClick') {
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    const r = await callContent(tab.id, { cmd: 'domClick', args }, { tries: 2, gap: 400 });
    await sleep(800);
    return { ...r, url: tab.url };
  }

  if (cmd === 'clickIndex') {
    const tabsBefore = await chrome.tabs.query({ url: 'https://www.zhipin.com/*' });
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    const dispatched = await callContent(tab.id, { cmd: 'clickIndex', args }, { tries: 3, gap: 400 });
    if (dispatched.ok === false) return dispatched;

    // 点击后再取一次状态（此时可能已经导航过，content script 是新的）
    await sleep(1500);
    const tabsAfter = await chrome.tabs.query({ url: 'https://www.zhipin.com/*' });
    const cur = (await chrome.tabs.query({ url: 'https://www.zhipin.com/*' })).find((t) => t.active) || tabsAfter[0];
    let post = null;
    try { post = await chrome.tabs.sendMessage(cur.id, { cmd: 'status' }); } catch (e) { await sleep(800); try { post = await chrome.tabs.sendMessage(cur.id, { cmd: 'status' }); } catch (e2) { } }
    return {
      ...dispatched,
      url: (post && post.url) || (cur && cur.url),
      title: post && post.title,
      cards: post && post.cards,
      security: post && post.security,
      loggedIn: post && post.loggedIn,
      navigated: !!post && post.url !== dispatched.urlBefore,
      zhipinTabsBefore: tabsBefore.length,
      zhipinTabsAfter: tabsAfter.length,
      openedNewTab: tabsAfter.length > tabsBefore.length,
    };
  }

  if (cmd === 'next' || cmd === 'back') {
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    return callContent(tab.id, { cmd });
  }

  if (cmd === 'evalDom') {
    const tab = await zhipinTab();
    if (!tab) throw new Error('no-zhipin-tab');
    return callContent(tab.id, { cmd: 'evalDom', args });
  }

  throw new Error('unknown-cmd: ' + cmd);
}

connect();
chrome.runtime.onInstalled.addListener(() => console.log('[boss-bridge] installed v' + VERSION));

// MV3 保活：周期性调用扩展 API，避免长任务（如简历画布导出）期间 SW 被回收，
// 导致 pending 的 message 响应丢失（表现为 HTTP 端超时）。
setInterval(() => {
  try { chrome.runtime.getPlatformInfo(() => { }); } catch (e) { }
}, 15000);






