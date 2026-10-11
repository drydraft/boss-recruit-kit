// boss-bridge content script v1.1
// 纪律（很重要，直接决定会不会被反爬命中）：
//   1) 绝不 hook / 覆盖任何原生函数或原型（zpAegis 会回读 parseInt/trim/Symbol/Function.prototype.toString 的源码）
//   2) 绝不伪造 document / body / documentElement（Bm() 会用 toString.call + instanceof 双验）
//   3) 只做 DOM 读取、真实事件派发、拟人节奏

(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const abs = (h) => { try { return new URL(h, location.href).href; } catch (e) { return h; } };
  const cls = (el) => (el && el.className && typeof el.className === 'string') ? el.className : '';

  const CARD_SELECTORS = ['.job-card-wrapper', '.job-card-box', 'li.job-card-wrapper', '.job-list-box li', '.job-list-container li'];
  function cards() {
    for (const s of CARD_SELECTORS) {
      const n = document.querySelectorAll(s);
      if (n.length) return [...n];
    }
    // 兜底：由职位详情链接反推卡片容器
    const seen = new Set(), out = [];
    for (const a of document.querySelectorAll('a[href*="/job_detail/"]')) {
      let el = a;
      for (let i = 0; i < 6 && el && el.parentElement; i++) {
        el = el.parentElement;
        if (el.querySelectorAll('a[href*="/job_detail/"]').length === 1 && el.innerText.length > 20) break;
      }
      if (el && !seen.has(el)) { seen.add(el); out.push(el); }
    }
    return out;
  }

  function pick(card, needles) {
    for (const n of needles) {
      const el = card.querySelector(n);
      if (el && clean(el.innerText)) return clean(el.innerText);
    }
    // 类名模糊匹配
    for (const el of card.querySelectorAll('[class]')) {
      const c = cls(el).toLowerCase();
      if (needles.some((n) => c.includes(n.replace(/^\./, '').replace(/\s+/g, '')))) {
        const t = clean(el.innerText);
        if (t) return t;
      }
    }
    return null;
  }

  // SEO 列表页结构（/shenzhen/、/web/geek/jobs）：div.sub-li > a.job-info(p.name/p.salary/p.job-text) + a.user-info(.name)
  function extractSeo(card) {
    const jobA = card.querySelector('a[href*="/job_detail/"]');
    const compA = card.querySelector('a[href*="/gongsi/"]');
    const spans = [...card.querySelectorAll('p.job-text span')].map((s) => clean(s.innerText)).filter(Boolean);
    const info = card.querySelector('.sub-li-bottom-commany-info');
    return {
      title: clean(jobA && jobA.querySelector('p.name') ? jobA.querySelector('p.name').innerText : (card.querySelector('p.name') || {}).innerText) || null,
      salary: clean((card.querySelector('p.salary') || {}).innerText) || null,
      company: clean(compA && compA.querySelector('.name') ? compA.querySelector('.name').innerText : null) || null,
      area: spans[0] || null,
      tags: spans.slice(1),
      industry: info ? clean((info.querySelector('.type') || {}).innerText) || null : null,
      stage: info ? clean((info.querySelector('.level') || {}).innerText) || null : null,
      href: jobA ? abs(jobA.getAttribute('href')) : null,
      companyHref: compA ? abs(compA.getAttribute('href')) : null,
      rawText: clean(card.innerText).slice(0, 160),
    };
  }

  function extract(card) {
    if (card.classList && card.classList.contains('sub-li')) return extractSeo(card);
    const text = clean(card.innerText);
    const link = card.querySelector('a[href*="/job_detail/"]');
    const title = pick(card, ['.job-name', '.job-title', '[class*="job-name"]', '[class*="job-title"]'])
      || (link ? clean(link.innerText) : null);
    let salary = pick(card, ['.salary', '.job-salary', '[class*="salary"]']);
    if (!salary) { const m = text.match(/\d+(\.\d+)?\s*[-~]\s*\d+(\.\d+)?\s*[Kk]|\d+(\.\d+)?\s*[Kk]\s*[-~]\s*\d+(\.\d+)?\s*[Kk]|\d+\s*[-~]\s*\d+\s*元\/[天月]|\d+\s*元\/[天月]/); salary = m ? clean(m[0]) : null; }
    const company = pick(card, ['.company-name', '[class*="company-name"]', 'a[href*="/gongsi/"]']);
    const area = pick(card, ['.job-area', '[class*="job-area"]', '.job-area-wrapper']);
    const tags = [...card.querySelectorAll('[class*="tag"] li, [class*="tag"] span')]
      .map((x) => clean(x.innerText)).filter((t) => t && t.length < 20).slice(0, 8);
    return {
      title,
      salary,
      company,
      area,
      tags: [...new Set(tags)],
      href: link ? abs(link.getAttribute('href')) : null,
      rawText: text.slice(0, 160),
    };
  }

  function nextButton() {
    const byText = (el) => {
      const t = clean(el.innerText);
      return t === '>' || t === '→' || t === '下一页' || t === '下页' || /next/i.test(cls(el));
    };
    const pool = [
      ...document.querySelectorAll('.options-pages a, .options-pages span'),
      ...document.querySelectorAll('a[ka*="page"], a[ka*="next"], [ka*="page-next"]'),
      ...document.querySelectorAll('.ui-icon-arrow-right, .icon-arrow-right, [class*="arrow-right"]'),
      ...document.querySelectorAll('a[href*="page="], a[href*="&p="]'),
    ];
    for (const el of pool) {
      const a = el.tagName === 'A' ? el : (el.closest('a') || el);
      if (!a || /disabled/.test(cls(a)) || a.getAttribute('aria-disabled') === 'true') continue;
      if (byText(el) || byText(a) || /pagination|page-next/.test(cls(a))) return a;
    }
    return null;
  }

  function humanClick(el) {
    try { el.scrollIntoView({ block: 'center' }); } catch (e) { }
    const r = el.getBoundingClientRect();
    const x = r.left + r.width * rnd(0.35, 0.65);
    const y = r.top + r.height * rnd(0.35, 0.65);
    const b = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1 };
    el.dispatchEvent(new PointerEvent('pointerover', b));
    el.dispatchEvent(new MouseEvent('mouseover', b));
    el.dispatchEvent(new PointerEvent('pointerdown', b));
    el.dispatchEvent(new MouseEvent('mousedown', b));
    el.dispatchEvent(new PointerEvent('pointerup', { ...b, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...b, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('click', { ...b, buttons: 0 }));
  }

  function loginState() {
    const t = document.body ? document.body.innerText.slice(0, 600) : '';
    const hasLoginEntry = /登录\/注册/.test(t);
    const hasUserSigns = /简历/.test(t) && /消息/.test(t);      // 登录后头部会出现「消息 / 简历」
    const nameEl = document.querySelector('.nav-figure .user-name, [class*="user-name"], [class*="user-nav"] [class*="name"]');
    return { loggedIn: (!hasLoginEntry && hasUserSigns) || !!nameEl, hint: clean(t).slice(0, 60) };
  }
  function securityCheck() {
    const t = document.body ? document.body.innerText.slice(0, 2000) : '';
    return {
      securityUrl: /\/web\/passport\/zp\/security\.html/.test(location.href),
      envAbnormal: /环境存在异常|安全验证|请完成验证|操作过于频繁/.test(t),
      code37InUrl: /code=37/.test(location.href),
      securityCheckParam: /_security_check=/.test(location.href),
    };
  }

  async function waitListChange(prevHref, timeoutMs = 25000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const first = document.querySelector('a[href*="/job_detail/"]');
      const href = first ? first.getAttribute('href') : null;
      if (href && href !== prevHref) return true;
      await sleep(400);
    }
    return false;
  }

  async function doNext() {
    const first = document.querySelector('a[href*="/job_detail/"]');
    const prev = first ? first.getAttribute('href') : null;
    const btn = nextButton();
    if (!btn) return { ok: false, error: 'no-next-button', url: location.href, hint: '匿名态可能只有 15 条，登录后才有分页' };
    await sleep(rnd(900, 2400));
    humanClick(btn);
    const changed = await waitListChange(prev);
    if (changed) await sleep(rnd(1200, 2800));
    window.scrollTo({ top: 0 });
    return { ok: changed, url: location.href, cards: cards().length, note: changed ? 'page-changed' : 'list-not-changed' };
  }

  // 站内搜索框真实输入（比拼 URL 可靠：SEO 页/登录态的搜索入口 URL 会重定向）
  async function searchInPage(keyword) {
    const before = location.href;
    const input = document.querySelector('input[name="query"], input[placeholder*="搜索职位"], input[placeholder*="搜索"], .search-input input, .ipt-wrap input, input[type="text"]');
    if (!input) return { ok: false, error: 'no-search-input', url: location.href };
    input.focus();
    input.value = keyword;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(rnd(300, 800));
    const btn = (input.closest('form') && input.closest('form').querySelector('button, [class*="search-btn"], .btn-search'))
      || document.querySelector('.search-btn, .btn-search, [ka*="search"] button, button[type="submit"]');
    if (btn) humanClick(btn);
    else {
      for (const type of ['keydown', 'keypress', 'keyup']) {
        input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      }
    }
    const t0 = Date.now();
    while (Date.now() - t0 < 18000) { if (location.href !== before) break; await sleep(400); }
    await sleep(rnd(1200, 2400));
    return { ok: location.href !== before, url: location.href, changedFrom: before, usedButton: !!btn };
  }

  // 拟人滚动 + 边滚边抓（应对无限滚动列表）
  async function scrollAndCollect(a = {}) {
    const steps = Math.max(1, Math.min(60, Number(a.steps) || 10));
    const maxMs = Math.max(2000, Math.min(60000, Number(a.maxMs) || 25000));
    const doCollect = a.collect !== false;
    const collected = [];
    const seen = new Set();
    const grab = () => {
      if (!doCollect) return;
      for (const j of cards().map(extract)) {
        const key = j.href || j.title;
        if (key && !seen.has(key)) { seen.add(key); collected.push(j); }
      }
    };
    const startY = Math.round(window.scrollY);
    grab();
    const t0 = Date.now();
    let rounds = 0, bottomHits = 0;
    while (rounds < steps && Date.now() - t0 < maxMs) {
      rounds++;
      const dy = Math.round(rnd(280, 900));
      try { window.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, deltaMode: 0, bubbles: true, cancelable: true })); } catch (e) { }
      try { document.documentElement.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, deltaMode: 0, bubbles: true })); } catch (e) { }
      window.scrollBy(0, dy);
      await sleep(rnd(260, 780));
      grab();
      const atBottom = (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - 60);
      if (atBottom) { bottomHits++; await sleep(rnd(900, 1800)); grab(); if (bottomHits >= 3) break; }
    }
    const atBottom = (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - 60);
    return {
      ok: true, url: location.href,
      startY, endY: Math.round(window.scrollY), docHeight: document.body.scrollHeight,
      rounds, bottomHits, atBottom,
      newCards: collected.length, jobs: collected,
      totalOnPage: cards().length, next: !!nextButton(),
    };
  }

  // ---- 真人式交互：可点击元素清单 / 按索引点击 / 轻量滚动 ----
  const CLICK_BLOCK = /退出|登录|注销|删除|举报|屏蔽|拉黑|投递|立即沟通|打招呼|发简历|申请职位|充值|支付|购买|开通|解绑|注销账号/;
  const CLICK_ALLOW = /职位|公司|校园|海归|推荐|热招|深圳|城市|切换|经验|学历|薪资|融资|行业|规模|更多|加载更多|下一页|下一页|筛选|全部|最新|综合|排序|Python|Java|前端|Go|数据分析|运维|测试|产品|运营|设计|收起|展开/;

  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05 && r.top > -200 && r.top < window.innerHeight + 400;
  }
  function cssPath(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let cur = el;
    for (let i = 0; i < 4 && cur && cur.nodeType === 1 && cur !== document.documentElement; i++) {
      let part = cur.tagName.toLowerCase();
      if (cur.classList.length) part += '.' + [...cur.classList].slice(0, 2).map((c) => CSS.escape(c)).join('.');
      const parent = cur.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === cur.tagName && c.className === cur.className);
        if (same.length > 1) part += ':nth-of-type(' + ([...parent.children].indexOf(cur) + 1) + ')';
      }
      parts.unshift(part);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  function clickableList(limit = 40) {
    const sel = 'a, button, [role="button"], [class*="tag"], [class*="tab"], [class*="filter"] li, [class*="menu"] li, [class*="chip"]';
    const out = [];
    const seen = new Set();
    for (const el of document.querySelectorAll(sel)) {
      if (out.length >= limit) break;
      if (!visible(el)) continue;
      const text = clean(el.innerText || el.getAttribute('title') || '');
      if (!text || text.length > 24) continue;
      if (CLICK_BLOCK.test(text)) continue;
      if (!CLICK_ALLOW.test(text)) continue;
      const key = text + '|' + cls(el).slice(0, 30);
      if (seen.has(key)) continue;
      seen.add(key);
      const r = el.getBoundingClientRect();
      out.push({
        i: out.length, text, tag: el.tagName, cls: cls(el).slice(0, 40),
        href: el.getAttribute && el.getAttribute('href'),
        target: el.getAttribute && el.getAttribute('target'),
        path: cssPath(el),
        y: Math.round(r.top + window.scrollY),
      });
    }
    return out;
  }
  function prepareClick(i) {
    const list = clickableList(60);
    const item = list.find((x) => x.i === Number(i));
    if (!item) return { ok: false, error: 'index-not-found', candidates: list.length };
    let el = null;
    if (item.path) { try { el = document.querySelector(item.path); } catch (e) { } }
    if (!el) {
      const sel = 'a, button, [role="button"], [class*="tag"], [class*="tab"], [class*="filter"] li, [class*="menu"] li, [class*="chip"]';
      el = [...document.querySelectorAll(sel)].filter((e) => clean(e.innerText || '') === item.text && visible(e) && !CLICK_BLOCK.test(item.text))[0];
    }
    if (!el) return { ok: false, error: 'element-gone', text: item.text };
    return { ok: true, el, text: item.text, cls: item.cls, path: item.path, target: item.target, urlBefore: location.href };
  }
  async function lightScroll(a = {}) {
    const rounds = Math.max(1, Math.min(6, Number(a.rounds) || 3));
    const gain = Math.max(150, Math.min(1200, Number(a.gain) || 500));
    const startY = Math.round(window.scrollY);
    for (let i = 0; i < rounds; i++) {
      const dy = Math.round(gain * rnd(0.7, 1.3));
      try { window.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, deltaMode: 0, bubbles: true, cancelable: true })); } catch (e) { }
      window.scrollBy(0, dy);
      await sleep(rnd(350, 900));
    }
    return { ok: true, url: location.href, startY, endY: Math.round(window.scrollY), docHeight: document.body.scrollHeight, atBottom: (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - 60), cards: cards().length };
  }

  // ---- 通用只读/通用点击（招聘端侦察用：不预设站点结构，靠 CSS 选择器现场摸索）----
  function domQuery(a = {}) {
    const sel = a.selector;
    if (!sel) return { ok: false, error: 'selector-required' };
    const max = Math.max(1, Math.min(40, Number(a.max) || 10));
    const cut = Math.max(80, Math.min(6000, Number(a.cut) || 600));
    let nodes = [];
    try { nodes = [...document.querySelectorAll(sel)]; } catch (e) { return { ok: false, error: 'bad-selector: ' + e.message }; }
    const items = nodes.slice(a.offset || 0, (a.offset || 0) + max).map((el, k) => {
      const r = el.getBoundingClientRect();
      const out = {
        i: (a.offset || 0) + k, tag: el.tagName, cls: cls(el).slice(0, 80),
        text: clean(el.innerText || '').slice(0, cut),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      };
      if (a.html) out.html = (el.outerHTML || '').replace(/\s+/g, ' ').slice(0, cut);
      if (a.attrs) out.attrs = Object.fromEntries(a.attrs.map((n) => [n, el.getAttribute && el.getAttribute(n)]));
      return out;
    });
    return { ok: true, url: location.href, matched: nodes.length, offset: a.offset || 0, items };
  }

  function domClick(a = {}) {
    const sel = a.selector;
    if (!sel) return { ok: false, error: 'selector-required' };
    let nodes = [];
    try { nodes = [...document.querySelectorAll(sel)]; } catch (e) { return { ok: false, error: 'bad-selector: ' + e.message }; }
    const el = nodes[Number(a.index) || 0];
    if (!el) return { ok: false, error: 'not-found', matched: nodes.length };
    const info = { text: clean(el.innerText || '').slice(0, 120), cls: cls(el).slice(0, 80), urlBefore: location.href };
    setTimeout(() => { try { el.scrollIntoView({ block: 'center' }); humanClick(el); } catch (e) { } }, Math.round(rnd(120, 400)));
    return { ok: true, dispatched: true, matched: nodes.length, ...info };
  }

  function scrollContainer(a = {}) {
    const sel = a.selector;
    let el = sel ? document.querySelector(sel) : null;
    if (sel && !el) return { ok: false, error: 'not-found' };
    const target = el || window;
    const rounds = Math.max(1, Math.min(40, Number(a.rounds) || 5));
    const gain = Math.max(100, Math.min(3000, Number(a.gain) || 800));
    const before = el ? el.scrollTop : window.scrollY;
    return new Promise((resolve) => {
      let i = 0;
      const tick = () => {
        try { target.scrollBy ? target.scrollBy(0, Math.round(gain * rnd(0.8, 1.2))) : (target.scrollTop += gain); } catch (e) { }
        i++;
        if (i >= rounds) {
          setTimeout(() => resolve({
            ok: true, url: location.href,
            scrollTop: el ? Math.round(el.scrollTop) : Math.round(window.scrollY),
            scrollHeight: el ? el.scrollHeight : document.body.scrollHeight,
            clientHeight: el ? el.clientHeight : window.innerHeight,
            atBottom: el ? (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) : ((window.innerHeight + window.scrollY) >= document.body.scrollHeight - 40),
            before,
          }), 900);
        } else setTimeout(tick, Math.round(rnd(300, 800)));
      };
      tick();
    });
  }

  // ================= 招聘端（沟通/在线简历）=================
  // 列表行：.user-list .geek-item-wrap  →  内层 .geek-item[id][data-id]，含 .geek-name/.source-job/.time/.badge-count
  function chatList(a = {}) {
    const rows = [...document.querySelectorAll('.user-list .geek-item-wrap')];
    const items = rows.map((w) => {
      const item = w.querySelector('.geek-item') || w;
      const q = (s) => w.querySelector(s);
      const badge = q('.badge-count');
      return {
        id: item.getAttribute('data-id') || item.id || null,
        name: clean((q('.geek-name') || {}).innerText) || null,
        job: clean((q('.source-job') || {}).innerText) || null,
        time: clean((q('.time') || {}).innerText) || null,
        unread: badge ? (clean(badge.innerText) || '0') : (q('.badge') ? '1' : '0'),
        preview: clean(w.innerText).slice(0, 200),
        selected: (item.className || '').includes('selected'),
        y: Math.round(w.getBoundingClientRect().top + (document.querySelector('.user-list') || { scrollTop: 0 }).scrollTop),
      };
    });
    const ul = document.querySelector('.user-list');
    return {
      ok: true, url: location.href, count: items.length, items,
      scrollTop: ul ? Math.round(ul.scrollTop) : null,
      scrollHeight: ul ? ul.scrollHeight : null,
      clientHeight: ul ? ul.clientHeight : null,
      atBottom: ul ? (ul.scrollTop + ul.clientHeight >= ul.scrollHeight - 30) : null,
    };
  }

  function chatScroll(a = {}) {
    const ul = document.querySelector('.user-list') || document.scrollingElement;
    if (!ul) return { ok: false, error: 'no-list' };
    const rounds = Math.max(1, Math.min(30, Number(a.rounds) || 6));
    const gain = Math.max(120, Math.min(2000, Number(a.gain) || 700));
    const dir = a.up ? -1 : 1;
    const before = Math.round(ul.scrollTop);
    return new Promise((resolve) => {
      let i = 0;
      const tick = () => {
        // 真实滚轮事件（有些虚拟列表只认 wheel，不认 scrollTop 赋值）
        try {
          ul.dispatchEvent(new WheelEvent('wheel', { deltaY: dir * gain, deltaMode: 0, bubbles: true, cancelable: true }));
          ul.dispatchEvent(new WheelEvent('mousewheel', { deltaY: dir * gain, bubbles: true, cancelable: true }));
        } catch (e) { }
        ul.scrollTop = ul.scrollTop + dir * Math.round(gain * rnd(0.75, 1.25));
        i++;
        if (i >= rounds) setTimeout(() => resolve({
          ok: true, scrollTop: Math.round(ul.scrollTop), scrollHeight: ul.scrollHeight,
          clientHeight: ul.clientHeight, atBottom: ul.scrollTop + ul.clientHeight >= ul.scrollHeight - 30, before,
        }), 1400);
        else setTimeout(tick, Math.round(rnd(280, 700)));
      };
      tick();
    });
  }

  async function chatOpen(id) {
    const el = document.querySelector(`.user-list .geek-item[data-id="${id}"]`) || document.querySelector(`.user-list [data-id="${id}"]`);
    if (!el) return { ok: false, error: 'row-not-found', id };
    const wrap = el.closest('.geek-item-wrap') || el;
    const name = clean((wrap.querySelector('.geek-name') || {}).innerText);
    el.scrollIntoView({ block: 'center' });
    await sleep(rnd(250, 600));
    humanClick(el);
    // 等到右侧确实切换到这个候选人
    const t0 = Date.now();
    let okName = null;
    while (Date.now() - t0 < 12000) {
      const cur = document.querySelector('.conversation-box .base-name .name-box, .conversation-box .base-name');
      const ct = clean(cur && cur.innerText);
      if (ct && name && ct === name) { okName = ct; break; }
      if (ct && !name) { okName = ct; break; }
      await sleep(400);
    }
    await sleep(rnd(600, 1400));
    return { ok: !!okName, id, name, panelName: okName, url: location.href };
  }

  function chatSnapshot() {
    const q = (s, root) => [...(root || document).querySelectorAll(s)];
    const tx = (el) => clean(el && (el.innerText || el.textContent));
    const box = document.querySelector('.conversation-box');
    if (!box) return { ok: false, error: 'no-conversation-open' };

    const header = document.querySelector('.base-info-single-container');
    const name = tx(header && header.querySelector('.base-name .name-box')) || tx(header && header.querySelector('.base-name'));
    const activeTime = tx(header && header.querySelector('.active-time'));
    const infoRaw = header ? q('.base-info-single-detial > div', header).map(tx).filter(Boolean).filter((s) => s !== '更换职位') : [];
    const age = infoRaw.find((s) => /^\d+\s*岁$/.test(s)) || null;
    const years = infoRaw.find((s) => /年|应届|在校/.test(s) && s.length <= 8) || null;
    const edu = infoRaw.find((s) => /本科|大专|硕士|博士|中专|高中|MBA|EMBA/.test(s)) || null;

    const times = q('.experience-content.time-list .time-content li').map((li) => ({ t: tx(li.querySelector('.time')), edu: !!li.querySelector('.icon.shool') }));
    const details = q('.experience-content.detail-list .work-content li').map((li) => ({ v: tx(li.querySelector('.value')), edu: !!li.querySelector('.icon.shool') }));
    const experience = times.map((x, i) => ({ period: x.t, org: details[i] ? details[i].v : null, isEdu: x.edu || (details[i] ? details[i].edu : false) }));
    const workExp = experience.filter((e) => !e.isEdu).map((e) => e.org).filter(Boolean);
    const eduExp = experience.filter((e) => e.isEdu).map((e) => e.org).filter(Boolean);

    const commJob = tx(document.querySelector('.position-content .job-content .position-name')) || null;
    const expect = tx(document.querySelector('.position-content .position-item.expect .value')) || null;

    const onlineBtn = document.querySelector('.resume-btn-online');
    const fileBtn = document.querySelector('.resume-btn-file');
    const resumeBtns = {
      online: !!onlineBtn,
      file: !!fileBtn && !(fileBtn.className || '').includes('disabled'),
      fileDisabled: !!fileBtn && (fileBtn.className || '').includes('disabled'),
    };

    const msgs = q('.conversation-message .message-item').map((mi) => {
      const time = tx(mi.querySelector('.message-time .time'));
      const friend = mi.querySelector('.item-friend .text-content');
      const myself = mi.querySelector('.item-myself .text-content, .item-boss .text-content, .item-me .text-content');
      const sysT = mi.querySelector('.item-resume .message-card-top-title, .item-system .message-card-top-title, .message-card-top-title');
      const dir = friend ? 'candidate' : (myself ? 'me' : (sysT ? 'system' : 'unknown'));
      const textEl = friend || myself || sysT || mi;
      const truncated = !!mi.querySelector('[class*="more"],[class*="expand"],[class*="unfold"],[class*="ellipsis"]');
      return { time, dir, text: tx(textEl), truncated };
    }).filter((m) => m.text);

    return {
      ok: true, url: location.href, name, activeTime, age, years, edu, infoRaw,
      workExp, eduExp, experience, commJob, expect, resumeBtns,
      messages: msgs,
      candidateMessages: msgs.filter((m) => m.dir === 'candidate').map((m) => m.text),
      candidateMessageCount: msgs.filter((m) => m.dir === 'candidate').length,
      systemMessages: msgs.filter((m) => m.dir === 'system').map((m) => m.text),
      truncatedCount: msgs.filter((m) => m.truncated).length,
    };
  }

  // 展开折叠块（默认最多点 2 次，避免慢）
  async function chatExpand(a = {}) {
    const maxClicks = Math.max(0, Math.min(6, Number(a.maxClicks) || 2));
    const sels = (a.sels && a.sels.length) ? a.sels : ['.conversation-main .slide-icon', '.conversation-message [class*="text-more"]'];
    let clicks = 0;
    for (const sel of sels) {
      if (clicks >= maxClicks) break;
      for (const el of [...document.querySelectorAll(sel)].slice(0, 3)) {
        if (clicks >= maxClicks) break;
        if (el.offsetParent === null) continue;
        try { humanClick(el); clicks++; } catch (e) { }
        await sleep(rnd(300, 700));
      }
    }
    return { ok: true, clicks };
  }

  // 在线简历在同源 iframe（/web/frame/c-resume/）里：直接读 contentDocument
  function resumeFrameSnapshot(a = {}) {
    const cut = Math.max(1000, Math.min(40000, Number(a.cut) || 20000));
    const frames = [...document.querySelectorAll('iframe')];
    const cands = frames.filter((f) => /c-resume|\/frame\//.test(f.getAttribute('src') || ''));
    const pool = cands.length ? cands : frames;
    const vis = pool.filter((f) => { const r = f.getBoundingClientRect(); return r.width > 300 && r.height > 200 && r.bottom > 60 && r.top < window.innerHeight - 60; });
    const pick = (vis.length ? vis : pool).slice().sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0];
    if (!pick) return { ok: false, error: 'no-resume-iframe', frames: frames.map((f) => f.getAttribute('src')) };
    let doc = null;
    try { doc = pick.contentDocument || (pick.contentWindow && pick.contentWindow.document); } catch (e) { return { ok: false, error: 'frame-access-denied: ' + e.message }; }
    if (!doc || !doc.body) return { ok: false, error: 'frame-doc-empty' };
    const txt = clean(doc.body.innerText || '');
    const cls = new Set();
    for (const el of doc.querySelectorAll('[class]')) (el.className || '').toString().split(/\s+/).forEach((c) => c && cls.add(c));
    return {
      ok: true, frameSrc: pick.getAttribute('src'), frameW: pick.clientWidth, frameH: pick.clientHeight,
      text: txt.slice(0, cut), textLen: txt.length,
      classes: [...cls].slice(0, 150),
      html: a.html ? (doc.documentElement.outerHTML || '').replace(/\s+/g, ' ').slice(0, Math.min(cut, 30000)) : null,
    };
  }

  // 在线简历是 canvas（WASM 渲染）：把画布导出成 PNG，交给看图的人读
  async function resumeFrameCapture(a = {}) {
    const frames = [...document.querySelectorAll('iframe')];
    const cands = frames.filter((f) => /c-resume|\/frame\//.test(f.getAttribute('src') || ''));
    const pool = cands.length ? cands : frames;
    const vis = pool.filter((f) => { const r = f.getBoundingClientRect(); return r.width > 300 && r.height > 200 && r.bottom > 60 && r.top < window.innerHeight - 60; });
    const pick = (vis.length ? vis : pool).slice().sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0];
    if (!pick) return { ok: false, error: 'no-resume-iframe' };
    let doc = null, win = null;
    try { doc = pick.contentDocument || (pick.contentWindow && pick.contentWindow.document); win = pick.contentWindow; } catch (e) { return { ok: false, error: 'frame-access-denied: ' + e.message }; }
    if (!doc) return { ok: false, error: 'frame-doc-empty' };

    // 可选：先在 iframe 内滚动到指定位置（长简历要分页截）
    if (a.scrollY != null) {
      try {
        const sc = doc.scrollingElement || doc.documentElement;
        sc.scrollTop = Number(a.scrollY) || 0;
        if (win) win.scrollTo(0, Number(a.scrollY) || 0);
        await sleep(900);
      } catch (e) { }
    }

    const all = [...doc.querySelectorAll('canvas')];
    const info = all.map((c, i) => ({ i, w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight }));
    if (a.list) return { ok: true, frameW: pick.clientWidth, frameH: pick.clientHeight, canvases: info, bodyTextLen: clean(doc.body.innerText || '').length, scrollTop: doc.scrollingElement ? doc.scrollingElement.scrollTop : null, scrollHeight: doc.scrollingElement ? doc.scrollingElement.scrollHeight : null };

    if (!all.length) return { ok: false, error: 'no-canvas', frameW: pick.clientWidth, frameH: pick.clientHeight };
    const area = (c) => (c.clientWidth || c.width) * (c.clientHeight || c.height);
    const target = all.slice().sort((x, y) => area(y) - area(x))[0];
    const scale = Math.max(0.3, Math.min(1, Number(a.scale) || 0.75));
    const fmt = (a.format === 'jpeg' || a.format === 'jpg') ? 'image/jpeg' : 'image/png';
    const quality = Math.max(0.4, Math.min(1, Number(a.quality) || 0.85));
    let dataUrl = null, how = null, err = null;
    const sw = Math.round((target.width || target.clientWidth || 730) * scale);
    const sh = Math.round((target.height || target.clientHeight || 749) * scale);
    try {
      // 先拷进新画布再导出（WASM 画布直接 toDataURL 有时拿到空白）
      const out = doc.createElement('canvas');
      out.width = sw; out.height = sh;
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, sw, sh);
      ctx.drawImage(target, 0, 0, sw, sh);
      dataUrl = out.toDataURL(fmt, quality);
      how = 'copy';
    } catch (e) { err = e.message; }
    if (!dataUrl) {
      try { dataUrl = target.toDataURL(fmt, quality); how = 'direct'; } catch (e) { err = (err || '') + ' | ' + e.message; }
    }
    if (!dataUrl) return { ok: false, error: 'canvas-export-failed: ' + err, canvases: info };
    return {
      ok: true, how, fmt, scale, canvases: info, w: sw, h: sh,
      srcW: target.width, srcH: target.height, cssW: target.clientWidth, cssH: target.clientHeight,
      frameW: pick.clientWidth, frameH: pick.clientHeight,
      png: dataUrl, pngLen: dataUrl.length,
    };
  }

  async function chatOpenResume() {
    const btn = document.querySelector('.resume-btn-online');
    if (!btn) return { ok: false, error: 'no-online-resume-btn' };
    humanClick(btn);
    const t0 = Date.now();
    while (Date.now() - t0 < 9000) {
      if (document.querySelector('.resume-detail, .resume-box, [class*="resume-detail"], .dialog-wrap, [class*="modal"], iframe[src*="resume"]')) break;
      await sleep(500);
    }
    await sleep(rnd(800, 1600));
    return { ok: true, url: location.href };
  }

  // 在线简历（弹层/iframe）通用快照：文本 + 结构 class 直方图，先看清再写精确解析
  function resumeSnapshot(a = {}) {
    const cut = Math.max(500, Math.min(20000, Number(a.cut) || 8000));
    const cands = ['.resume-detail', '.resume-box', '[class*="resume-detail"]', '.dialog-wrap', '[class*="dialog"]', '[class*="modal"]', '.geek-resume', '[class*="resume"]'];
    let host = null, hostSel = null;
    for (const s of cands) { const el = document.querySelector(s); if (el && clean(el.innerText).length > 60) { host = el; hostSel = s; break; } }
    const txt = host ? clean(host.innerText) : clean(document.body.innerText);
    const classes = new Set();
    if (host) for (const el of host.querySelectorAll('[class]')) (el.className || '').split(/\s+/).forEach((c) => c && classes.add(c));
    return {
      ok: !!host, hostSel, classes: [...classes].slice(0, 120),
      text: txt.slice(0, cut), textLen: txt.length,
      iframes: [...document.querySelectorAll('iframe')].map((f) => ({ src: f.getAttribute('src'), cls: f.className, w: f.clientWidth, h: f.clientHeight })).filter((f) => f.w > 100),
      html: host ? (host.outerHTML || '').replace(/\s+/g, ' ').slice(0, Math.min(cut, 12000)) : null,
    };
  }

  async function resumeClose() {
    for (const sel of ['.dialog-wrap .close', '[class*="dialog"] [class*="close"]', '[class*="modal"] [class*="close"]', '.icon-close', '[class*="icon-close"]', '.ui-icon-close']) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) { humanClick(el); await sleep(600); return { ok: true, via: sel }; }
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    await sleep(400);
    return { ok: true, via: 'escape' };
  }

  // 通用输入：往指定输入框写文本（可选回车提交）
  async function domType(a = {}) {
    const sel = a.selector || 'input';
    const el = document.querySelector(sel);
    if (!el) return { ok: false, error: 'input-not-found', selector: sel };
    el.focus();
    try { el.select && el.select(); } catch (e) { }
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const text = String(a.text == null ? '' : a.text);
    // 逐字符输入，触发完整键盘事件链（Vue/React 的受控输入更认这个）
    for (const ch of text) {
      el.value += ch;
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
      await sleep(rnd(40, 120));
    }
    if (a.enter !== false) {
      for (const type of ['keydown', 'keypress', 'keyup']) {
        el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      }
    }
    await sleep(rnd(800, 1600));
    return { ok: true, value: el.value, url: location.href };
  }

  // 页面内批量抓简历：一条指令连续处理多人，避免大量桥往返
  function findResumeCanvas() {
    const frames = [...document.querySelectorAll('iframe')];
    const cands = frames.filter((f) => /c-resume|\/frame\//.test(f.getAttribute('src') || ''));
    const pool = cands.length ? cands : frames;
    const vis = pool.filter((f) => { const r = f.getBoundingClientRect(); return r.width > 300 && r.height > 200 && r.bottom > 60 && r.top < window.innerHeight - 60; });
    const pick = (vis.length ? vis : pool).slice().sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0];
    if (!pick) return null;
    let doc = null;
    try { doc = pick.contentDocument || (pick.contentWindow && pick.contentWindow.document); } catch (e) { return null; }
    if (!doc) return null;
    const all = [...doc.querySelectorAll('canvas')];
    if (!all.length) return null;
    const target = all.slice().sort((x, y) => (y.clientWidth || y.width) * (y.clientHeight || y.height) - (x.clientWidth || x.width) * (x.clientHeight || x.height))[0];
    if (!target) return null;
    // 必须是真正渲染出来的简历画布（初始占位画布是 300x150）
    if ((target.width || 0) < 600 || (target.height || 0) < 400) return null;
    try {
      const scale = 0.78;
      const w = Math.round((target.width || target.clientWidth) * scale);
      const h = Math.round((target.height || target.clientHeight) * scale);
      const out = doc.createElement('canvas');
      out.width = w; out.height = h;
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(target, 0, 0, w, h);
      return { png: out.toDataURL('image/jpeg', 0.86), w, h, srcW: target.width, srcH: target.height };
    } catch (e) { return null; }
  }

  function panelNameNow() {    const el = document.querySelector('.conversation-box .base-name .name-box') || document.querySelector('.conversation-box .base-name');
    return clean(el && el.innerText);
  }

  function closeAnyDialog() {
    for (const sel of ['.boss-popup__wrapper:not(.deactive) .close-btn', '.dialog-wrap:not(.deactive) .close-btn']) {
      const el = document.querySelector(sel);
      if (el) { try { humanClick(el); } catch (e) { } }
    }
    if (!document.querySelector('.boss-popup__wrapper:not(.deactive), .dialog-wrap:not(.deactive)')) return true;
    return false;
  }

  async function batchCaptureResumes(a = {}) {
    const ids = (a.ids || []).slice(0, Math.max(1, Math.min(12, Number(a.per) || 8)));
    const results = [];
    const list = document.querySelector('.user-list');
    // 目标按列表顺序给出：先回到顶部，再顺序往下找
    if (list && a.resetToTop !== false) {
      list.scrollTop = 0;
      await sleep(1200);
    }
    for (const id of ids) {
      const t0 = Date.now();
      const rec = { id, name: null, ok: false, error: null, ms: 0, w: 0, h: 0, png: null };
      try {
        closeAnyDialog();
        // 找不到行就往下滚（列表按时间序，目标按序给出）
        let row = document.querySelector(`.user-list .geek-item[data-id="${id}"]`);
        for (let s = 0; s < (Number(a.maxScrollSteps) || 30) && !row; s++) {
          if (!list) break;
          list.scrollTop += Number(a.scrollStep) || 1200;
          await sleep(rnd(350, 700));
          row = document.querySelector(`.user-list .geek-item[data-id="${id}"]`);
        }
        if (!row) throw new Error('row-not-in-dom');
        const wrap = row.closest('.geek-item-wrap') || row;
        rec.name = clean((wrap.querySelector('.geek-name') || {}).innerText);
        row.scrollIntoView({ block: 'center' });
        await sleep(rnd(250, 600));
        humanClick(row);
        // 等右侧面板切到该候选人
        let switched = false;
        for (let i = 0; i < 30; i++) {
          const n = panelNameNow();
          if (n && (!rec.name || n === rec.name)) { switched = true; break; }
          await sleep(350);
        }
        if (!switched) throw new Error('panel-not-switched');
        await sleep(rnd(500, 1100));
        const btn = document.querySelector('.resume-btn-online');
        if (!btn) throw new Error('no-resume-btn');
        humanClick(btn);
        // 逐页抓取：长简历靠键盘翻页取多屏
        let pr;
        if (a.singlePage !== false) {
          // 稳定优先：先只抓首屏（长简历后续单独翻页补抓）
          let one = null;
          for (let attempt = 0; attempt < 12 && !one; attempt++) { one = findResumeCanvas(); if (!one) await sleep(700); }
          pr = one ? { pages: [{ p: 1, w: one.w, h: one.h, srcW: one.srcW, srcH: one.srcH, png: one.png }] } : { pages: [], error: 'no-canvas' };
        } else {
          pr = await captureResumeMultiPage({ maxPages: Number(a.maxPages) || 4, settleMs: Number(a.dwellMs) || 1600, scale: Number(a.scale) || 0.9 });
        }
        if (!pr.pages || !pr.pages.length) throw new Error(pr.error || 'resume-not-rendered');
        rec.pages = pr.pages;
        rec.pageCount = pr.pages.length;
        rec.w = pr.pages[0].w; rec.h = pr.pages[0].h;
        rec.ok = true;
      } catch (e) {
        rec.error = String(e.message || e);
      }
      closeAnyDialog();
      await sleep(rnd(300, 800));
      rec.ms = Date.now() - t0;
      results.push(rec);
    }
    return { ok: true, url: location.href, count: results.length, results };
  }

  // 找简历 iframe（同源，可直接读）
  function findResumeFrame() {
    const frames = [...document.querySelectorAll('iframe')];
    const cands = frames.filter((f) => /c-resume|\/frame\//.test(f.getAttribute('src') || ''));
    const pool = cands.length ? cands : frames;
    const vis = pool.filter((f) => { const r = f.getBoundingClientRect(); return r.width > 300 && r.height > 200 && r.bottom > 60 && r.top < window.innerHeight - 60; });
    const pick = (vis.length ? vis : pool).slice().sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0];
    if (!pick) return null;
    let doc = null, win = null;
    try { doc = pick.contentDocument || (pick.contentWindow && pick.contentWindow.document); win = pick.contentWindow; } catch (e) { return null; }
    if (!doc) return null;
    return { iframe: pick, doc, win };
  }
  const frameScrollTop = (f) => {
    try {
      const cands = scrollablesIn(f);
      return cands.length ? Math.max(...cands.map((el) => Math.round(el.scrollTop || 0))) : 0;
    } catch (e) { return 0; }
  };
  function scrollablesIn(f) {
    const out = [];
    try {
      const sc = f.doc.scrollingElement || f.doc.documentElement;
      if (sc && sc.scrollHeight > sc.clientHeight + 10) out.push(sc);
      for (const el of f.doc.querySelectorAll('div,main,section,article')) {
        if (el.scrollHeight > el.clientHeight + 20 && el.clientHeight > 200) out.push(el);
      }
    } catch (e) { }
    return out;
  }
  const setFrameScrollTop = (f, y) => {
    let moved = false;
    try {
      if (f.win) f.win.scrollTo(0, y);
      for (const el of scrollablesIn(f)) {
        const before = el.scrollTop;
        el.scrollTop = Math.min(y, el.scrollHeight);
        if (el.scrollTop > before) moved = true;
      }
    } catch (e) { }
    return moved;
  };
  function frameScrollables(a = {}) {
    const f = findResumeFrame();
    if (!f) return { ok: false, error: 'no-frame' };
    const list = scrollablesIn(f).map((el, i) => ({
      i, tag: el.tagName, cls: (el.className || '').toString().slice(0, 60),
      scrollTop: Math.round(el.scrollTop), scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
    }));
    return { ok: true, frameH: f.iframe.clientHeight, docScroll: Math.round((f.doc.scrollingElement || f.doc.documentElement).scrollTop || 0), scrollables: list };
  }

  // 逐页抓：整份简历都渲染在一张 canvas 上（高度=简历长度），按高度切片导出，保证看全且清晰
  async function captureResumePagesInner(a = {}) {
    const maxSlices = Math.max(1, Math.min(12, Number(a.maxPages) || 8));
    const f = findResumeFrame();
    if (!f) return { pages: [], error: 'no-frame' };
    // 等"真画布"（占位画布是 300x150）
    let meta = null;
    for (let k = 0; k < 18 && !meta; k++) {
      meta = findResumeCanvasMeta();
      if (!meta) await sleep(700);
    }
    if (!meta) return { pages: [], error: 'no-canvas' };
    const { doc, cvs } = meta;
    const srcW = cvs.width || 0, srcH = cvs.height || 0;
    if (srcW < 600 || srcH < 300) return { pages: [], error: `canvas-too-small ${srcW}x${srcH}` };
    const sliceSrcH = Math.max(700, Math.min(1400, Number(a.sliceSrcH) || 1100));
    const scale = Math.max(0.6, Math.min(1.2, Number(a.scale) || 0.9));
    const pages = [];
    for (let y = 0, i = 1; y < srcH && i <= maxSlices; y += sliceSrcH, i++) {
      const sh = Math.min(sliceSrcH, srcH - y);
      try {
        const out = doc.createElement('canvas');
        out.width = Math.round(srcW * scale);
        out.height = Math.round(sh * scale);
        const ctx = out.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, out.width, out.height);
        ctx.drawImage(cvs, 0, y, srcW, sh, 0, 0, out.width, out.height);
        pages.push({ p: i, y, srcW, srcH, w: out.width, h: out.height, png: out.toDataURL('image/jpeg', 0.92) });
      } catch (e) { break; }
    }
    return { pages, canvas: { srcW, srcH }, slices: pages.length };
  }

  // 长简历整份抓取：PageUp 回到顶 → 每抓一屏就 PageDown 翻页，直到内容重复（实测简历帧认键盘翻页）

  const wheelInFrame = async (dy, times, settle = 200) => {
    const f = findResumeFrame();
    for (let i = 0; i < times; i++) {
      // 1) 找到"简历内容区"的真实坐标（滚动条左边的区域）
      let pt = null;
      try {
        const r = f && f.iframe ? f.iframe.getBoundingClientRect() : null;
        const box = (r && r.width > 200) ? r : (document.querySelector('.boss-popup__wrapper:not(.deactive) .boss-popup__content') || {}).getBoundingClientRect?.();
        if (box && box.width > 200) pt = { x: Math.round(box.left + box.width * 0.45), y: Math.round(box.top + box.height * 0.5) };
      } catch (e) { }
      // 2) 把鼠标"移动"过去，再滚
      if (pt) {
        const el = document.elementFromPoint(pt.x, pt.y) || document.body;
        for (const type of ['mouseover', 'mouseenter', 'mousemove']) {
          try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y, view: window })); } catch (e) { }
        }
        for (const type of ['wheel', 'mousewheel']) {
          try { el.dispatchEvent(new WheelEvent(type, { deltaY: dy, deltaMode: 0, bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y, view: window })); } catch (e) { }
        }
      }
      // 3) 帧内也滚一遍（含坐标）
      if (f) {
        const cvs = f.doc.querySelector('canvas');
        for (const el of [cvs, f.doc.body, f.doc.documentElement]) {
          if (!el) continue;
          try { el.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, deltaMode: 0, bubbles: true, cancelable: true, view: f.win })); } catch (e) { }
        }
        try { if (f.win) f.win.scrollBy(0, dy); } catch (e) { }
      }
      // 4) 顶层弹层容器直接推进 scrollTop
      for (const sel of ['.boss-popup__wrapper:not(.deactive) .boss-popup__content',
        '.boss-popup__wrapper:not(.deactive) .boss-dialog__body',
        '.boss-popup__wrapper:not(.deactive) .resume-container',
        '.boss-popup__wrapper:not(.deactive)']) {
        const el = document.querySelector(sel);
        if (!el) continue;
        try { const b = el.scrollTop; el.scrollTop = b + dy; } catch (e) { }
      }
      await sleep(settle);
    }
    return true;
  };

  async function captureResumeMultiPage(a = {}) {
    const maxPages = Math.max(1, Math.min(12, Number(a.maxPages) || 8));
    const settle = Math.max(900, Math.min(4000, Number(a.settleMs) || 1700));
    const scale = Math.max(0.55, Math.min(1.1, Number(a.scale) || 0.9));
    const hash = (s) => { let h = 0; const n = s.length; for (let i = 0; i < n; i += 7) h = (h * 31 + s.charCodeAt(i)) | 0; return h + ':' + n; };

    // 真正的滚动容器（实测）：.resume-detail[.resume-content-wrap]
    const scroller = document.querySelector('.boss-popup__wrapper:not(.deactive) .resume-detail')
      || document.querySelector('.resume-detail')
      || document.querySelector('.resume-content-wrap');

    let m = null;
    for (let k = 0; k < 18 && !m; k++) { m = findResumeCanvasMeta(); if (!m) await sleep(700); }
    if (!m) return { pages: [], error: 'no-canvas' };

    const grab = () => {
      const meta = findResumeCanvasMeta();
      if (!meta) return null;
      const srcW = meta.cvs.width, srcH = meta.cvs.height;
      try {
        const out = meta.doc.createElement('canvas');
        const w = Math.round(srcW * scale), h = Math.round(srcH * scale);
        out.width = w; out.height = h;
        const ctx = out.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(meta.cvs, 0, 0, w, h);
        return { srcW, srcH, w, h, png: out.toDataURL('image/jpeg', 0.92) };
      } catch (e) { return null; }
    };

    const pages = [];
    let prevSig = null;
    if (scroller) { scroller.scrollTop = 0; await sleep(settle); }
    const step = scroller ? Math.max(500, (scroller.clientHeight || 749) - 60) : 700;
    for (let p = 1; p <= maxPages; p++) {
      const cap = grab();
      if (!cap) break;
      const sig = hash(cap.png);
      if (p > 1 && sig === prevSig) break;
      pages.push({ p, scrollTop: scroller ? Math.round(scroller.scrollTop) : 0, srcW: cap.srcW, srcH: cap.srcH, w: cap.w, h: cap.h, png: cap.png });
      prevSig = sig;
      if (!scroller) break;
      const before = scroller.scrollTop;
      scroller.scrollTop = before + step;
      await sleep(settle);
      if (scroller.scrollTop <= before + 5) break;      // 到底
    }
    if (scroller) { scroller.scrollTop = 0; await sleep(400); }
    return { pages, pageCount: pages.length, scrollHeight: scroller ? scroller.scrollHeight : null, clientHeight: scroller ? scroller.clientHeight : null };
  }
  async function captureResumeFull(a = {}) {
    const f = findResumeFrame();
    if (!f) return { ok: false, error: 'no-frame' };
    let meta = null;
    for (let k = 0; k < 18 && !meta; k++) { meta = findResumeCanvasMeta(); if (!meta) await sleep(700); }
    if (!meta) return { ok: false, error: 'no-canvas' };

    const h0 = meta.cvs.height;
    const restore = [];
    const push = (el, props) => { if (!el) return; const old = {}; for (const p of props) old[p] = el.style[p]; restore.push(() => { for (const p of props) el.style[p] = old[p]; }); };
    try {
      push(f.iframe, ['height', 'maxHeight', 'minHeight']);
      f.iframe.style.height = (Number(a.expandTo) || 8000) + 'px';
      f.iframe.style.maxHeight = 'none';
      const wrap = f.iframe.parentElement;
      if (wrap) { push(wrap, ['height', 'maxHeight', 'overflow']); wrap.style.height = 'auto'; wrap.style.maxHeight = 'none'; wrap.style.overflow = 'visible'; }
      const dlg = document.querySelector('.boss-popup__wrapper:not(.deactive) .boss-dialog__body')
        || document.querySelector('.boss-popup__wrapper:not(.deactive) .boss-popup__content');
      if (dlg) { push(dlg, ['height', 'maxHeight', 'overflow']); dlg.style.height = 'auto'; dlg.style.maxHeight = 'none'; dlg.style.overflow = 'visible'; }
    } catch (e) { }
    await sleep(Number(a.settleMs) || 3500);

    let meta2 = findResumeCanvasMeta();
    // 画布没长起来就再等一轮
    if (!meta2 || (meta2.cvs.height || 0) <= h0 + 50) { await sleep(2500); meta2 = findResumeCanvasMeta() || meta2; }
    const use = meta2 || meta;
    const srcW = use.cvs.width || 0, srcH = use.cvs.height || 0;
    const sliceSrcH = Math.max(700, Math.min(1600, Number(a.sliceSrcH) || 1150));
    const scale = Math.max(0.55, Math.min(1.1, Number(a.scale) || 0.85));
    const maxSlices = Math.max(1, Math.min(14, Number(a.maxPages) || 10));
    const pages = [];
    try {
      for (let y = 0, i = 1; y < srcH && i <= maxSlices; y += sliceSrcH, i++) {
        const sh = Math.min(sliceSrcH, srcH - y);
        const out = use.doc.createElement('canvas');
        out.width = Math.round(srcW * scale);
        out.height = Math.round(sh * scale);
        const ctx = out.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out.width, out.height);
        ctx.drawImage(use.cvs, 0, y, srcW, sh, 0, 0, out.width, out.height);
        pages.push({ p: i, y, srcW, srcH, w: out.width, h: out.height, png: out.toDataURL('image/jpeg', 0.92) });
      }
    } catch (e) { }
    for (const r of restore.reverse()) { try { r(); } catch (e) { } }
    return { ok: pages.length > 0, pages, canvasBefore: { srcW: meta.cvs.width, srcH: h0 }, canvasAfter: { srcW, srcH }, expanded: srcH > h0 + 50 };
  }

  // 用位移翻页：弹层是位移式滚动，把 iframe 上移一段再截当前视口
  async function resumeShiftCapture(a = {}) {
    const f = findResumeFrame();
    if (!f) return { ok: false, error: 'no-frame' };
    const y = Math.max(0, Number(a.y) || 0);
    if (a.mode === 'wheel') {
      // 简历画布可能是"滚轮驱动"的自绘滚动：直接在帧内派发滚轮事件
      const target = f.doc.querySelector('canvas') || f.doc.body;
      const step = Number(a.wheelStep) || 500;
      try {
        for (const el of [target, f.doc.body, f.doc.documentElement, f.win]) {
          if (!el) continue;
          el.dispatchEvent(new WheelEvent('wheel', { deltaY: step, deltaMode: 0, bubbles: true, cancelable: true, view: f.win }));
        }
      } catch (e) { }
      await sleep(Math.max(700, Math.min(4000, Number(a.settleMs) || 1600)));
      const m = findResumeCanvasMeta();
      if (!m) return { ok: false, error: 'no-canvas', y };
      const srcW = m.cvs.width, srcH = m.cvs.height;
      const scale = Math.max(0.55, Math.min(1.1, Number(a.scale) || 0.9));
      try {
        const out = m.doc.createElement('canvas');
        out.width = Math.round(srcW * scale); out.height = Math.round(srcH * scale);
        const ctx = out.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out.width, out.height);
        ctx.drawImage(m.cvs, 0, 0, out.width, out.height);
        return { ok: true, mode: 'wheel', srcW, srcH, w: out.width, h: out.height, png: out.toDataURL('image/jpeg', 0.92) };
      } catch (e) { return { ok: false, error: 'export-failed: ' + e.message }; }
    }
    try {
      f.iframe.style.transform = y ? `translateY(${-y}px)` : '';
      f.iframe.style.transition = 'none';
      const wrap = f.iframe.parentElement;
      if (wrap) wrap.style.transform = y ? `translateY(${-y}px)` : '';
    } catch (e) { }
    await sleep(Math.max(600, Math.min(5000, Number(a.settleMs) || 1800)));
    const meta = findResumeCanvasMeta();
    if (!meta) return { ok: false, error: 'no-canvas', y };
    const srcW = meta.cvs.width, srcH = meta.cvs.height;
    const scale = Math.max(0.55, Math.min(1.1, Number(a.scale) || 0.9));
    try {
      const out = meta.doc.createElement('canvas');
      out.width = Math.round(srcW * scale);
      out.height = Math.round(srcH * scale);
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(meta.cvs, 0, 0, out.width, out.height);
      return { ok: true, y, srcW, srcH, w: out.width, h: out.height, png: out.toDataURL('image/jpeg', 0.92) };
    } catch (e) { return { ok: false, error: 'export-failed: ' + e.message, y }; }
  }

  // 找已渲染好的简历画布（含所属文档，便于在帧内创建切片画布）
  function findResumeCanvasMeta() {
    const f = findResumeFrame();
    if (!f) return null;
    const all = [...f.doc.querySelectorAll('canvas')];
    if (!all.length) return null;
    const cvs = all.slice().sort((x, y) => (y.width * y.height) - (x.width * x.height))[0];
    if (!cvs || (cvs.width || 0) < 600 || (cvs.height || 0) < 300) return null;
    return { doc: f.doc, cvs, frame: f };
  }

  // 通用按键（翻页常用 PageDown/ArrowDown/Space），可指定目标选择器
  async function pressKey(a = {}) {
    const key = a.key || 'PageDown';
    const code = a.code || key;
    const keyCode = a.keyCode || ({ PageDown: 34, PageUp: 33, ArrowDown: 40, ArrowUp: 38, Space: 32, End: 35, Home: 36 }[key] || 0);
    const el = a.selector ? document.querySelector(a.selector) : (document.activeElement || document.body);
    if (a.focus) { try { el.focus(); } catch (e) { } }
    const times = Math.max(1, Math.min(20, Number(a.times) || 1));
    for (let i = 0; i < times; i++) {
      for (const type of ['keydown', 'keypress', 'keyup']) {
        try { el.dispatchEvent(new KeyboardEvent(type, { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true })); } catch (e) { }
      }
      await sleep(220);
    }
    return { ok: true, key, times, activeEl: (document.activeElement || {}).className || null };
  }

  // 诊断：列出所有简历 iframe 及其画布尺寸（判断长简历画布到底多高）
  function listResumeCanvases() {
    const out = [];
    [...document.querySelectorAll('iframe')].forEach((f, i) => {
      let doc = null;
      try { doc = f.contentDocument; } catch (e) { }
      if (!doc) return;
      const cvs = [...doc.querySelectorAll('canvas')];
      if (!cvs.length) return;
      out.push({
        i, src: (f.getAttribute('src') || '').slice(0, 60), w: f.clientWidth, h: f.clientHeight,
        visible: f.getBoundingClientRect().top > -100 && f.getBoundingClientRect().top < window.innerHeight,
        canvases: cvs.map((c) => `${c.width}x${c.height}`),
        docScrollHeight: (doc.scrollingElement || doc.documentElement).scrollHeight,
      });
    });
    return { ok: true, count: out.length, frames: out };
  }


  // 通过"聊天搜索下拉"打开指定候选人（比遍历列表可靠）
  async function searchOpenByName(a = {}) {
    const name = String(a.name || '').trim();
    if (!name) return { ok: false, error: 'name-required' };
    // 打开搜索框
    if (!document.querySelector('.search-input')) {
      const btn = document.querySelector('.chat-search-btn');
      if (btn) { humanClick(btn); await sleep(rnd(500, 900)); }
    }
    let input = document.querySelector('.search-input');
    if (!input) return { ok: false, error: 'no-search-input' };
    input.focus();
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    for (const ch of name) {
      input.value += ch;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(rnd(60, 140));
    }
    await sleep(rnd(900, 1600));
    const items = [...document.querySelectorAll('.search-box .list-container li, .geek-search-list li')]
      .filter((el) => clean(el.innerText));
    if (!items.length) return { ok: false, error: 'no-suggestion', typed: name };
    const matched = items.filter((el) => clean(el.innerText).includes(name));
    const pool = matched.length ? matched : items;
    const idx = Math.max(0, Math.min(pool.length - 1, Number(a.index) || 0));
    const hit = pool[idx];
    const hitText = clean(hit.innerText);
    humanClick(hit);
    await sleep(rnd(1200, 2200));
    const panel = (() => {
      const el = document.querySelector('.conversation-box .base-name .name-box') || document.querySelector('.conversation-box .base-name');
      return clean(el && el.innerText);
    })();
    return { ok: !!panel, typed: name, suggestion: hitText, panelName: panel, suggestions: items.length, matched: pool.length, index: idx };
  }


  // 诊断：弹窗内所有可滚动元素（含 overflow 设置与自定义滚动条）
  function modalScrollables() {
    const roots = [...document.querySelectorAll('.boss-popup__wrapper:not(.deactive), .dialog-wrap:not(.deactive)')];
    const out = [];
    const seen = new Set();
    const scan = (root, path) => {
      for (const el of root.querySelectorAll('*')) {
        if (seen.has(el)) continue;
        seen.add(el);
        let st = null;
        try { st = getComputedStyle(el); } catch (e) { continue; }
        const oy = st.overflowY;
        const scrollable = el.scrollHeight > el.clientHeight + 20;
        if (scrollable || /auto|scroll/.test(oy)) {
          const r = el.getBoundingClientRect();
          out.push({
            tag: el.tagName, cls: (el.className || '').toString().slice(0, 70), path,
            overflowY: oy, scrollTop: Math.round(el.scrollTop), scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
            rect: `${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.x)},${Math.round(r.y)}`,
          });
        }
      }
    };
    roots.forEach((r, i) => scan(r, 'modal#' + i));
    // iframe 内部
    const f = findResumeFrame();
    if (f) {
      try {
        for (const el of f.doc.querySelectorAll('*')) {
          let st = null; try { st = getComputedStyle(el); } catch (e) { continue; }
          if (el.scrollHeight > el.clientHeight + 20 || /auto|scroll/.test(st.overflowY)) {
            out.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 70), path: 'iframe', overflowY: st.overflowY, scrollTop: Math.round(el.scrollTop), scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, rect: 'iframe' });
          }
        }
      } catch (e) { }
    }
    return { ok: true, count: out.length, scrollables: out.slice(0, 40) };
  }


  // 一次只翻一页：reset=true 回到顶部并抓第 1 页；之后反复调用抓下一页
  async function resumePageCapture(a = {}) {
    const scale = Math.max(0.55, Math.min(1.1, Number(a.scale) || 0.95));
    const settle = Math.max(700, Math.min(4000, Number(a.settleMs) || 1400));
    const scroller = document.querySelector('.boss-popup__wrapper:not(.deactive) .resume-detail')
      || document.querySelector('.resume-detail');
    let m = null;
    for (let k = 0; k < 10 && !m; k++) { m = findResumeCanvasMeta(); if (!m) await sleep(600); }
    if (!m) return { ok: false, error: 'no-canvas' };

    if (a.reset) {
      if (scroller) scroller.scrollTop = 0;
      await sleep(settle);
    } else if (scroller) {
      const step = Math.max(400, Number(a.step) || (scroller.clientHeight || 749) - 80);
      const before = scroller.scrollTop;
      scroller.scrollTop = before + step;
      await sleep(settle);
      if (scroller.scrollTop <= before + 5) return { ok: true, atEnd: true, scrollTop: Math.round(scroller.scrollTop), scrollHeight: scroller.scrollHeight };
    }

    const meta = findResumeCanvasMeta();
    if (!meta) return { ok: false, error: 'canvas-gone' };
    const srcW = meta.cvs.width, srcH = meta.cvs.height;
    try {
      const out = meta.doc.createElement('canvas');
      const w = Math.round(srcW * scale), h = Math.round(srcH * scale);
      out.width = w; out.height = h;
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(meta.cvs, 0, 0, w, h);
      return {
        ok: true, atEnd: false, w, h, srcW, srcH,
        scrollTop: scroller ? Math.round(scroller.scrollTop) : 0,
        scrollHeight: scroller ? scroller.scrollHeight : null,
        clientHeight: scroller ? scroller.clientHeight : null,
        png: out.toDataURL('image/jpeg', 0.92),
      };
    } catch (e) { return { ok: false, error: 'export: ' + e.message }; }
  }


  // 把简历滚动容器撑到全高，促使 WASM 一次渲染整份简历，再整体导出（可分片）
  async function expandResumeCapture(a = {}) {
    const scale = Math.max(0.4, Math.min(1.1, Number(a.scale) || 0.8));
    const wait = Math.max(1500, Math.min(20000, Number(a.waitMs) || 6000));
    const scroller = document.querySelector('.boss-popup__wrapper:not(.deactive) .resume-detail')
      || document.querySelector('.resume-detail');
    let before = null;
    try { const m0 = findResumeCanvasMeta(); before = m0 ? { w: m0.cvs.width, h: m0.cvs.height } : null; } catch (e) { }

    const restore = [];
    const setStyle = (el, props) => { if (!el) return; const old = {}; for (const k of Object.keys(props)) old[k] = el.style[k]; restore.push(() => { for (const k of Object.keys(old)) el.style[k] = old[k]; }); for (const k of Object.keys(props)) el.style[k] = props[k]; };

    if (scroller) {
      const full = scroller.scrollHeight || 0;
      setStyle(scroller, { height: full + 'px', maxHeight: 'none', overflow: 'visible' });
      let parent = scroller.parentElement;
      for (let i = 0; i < 3 && parent; i++) { setStyle(parent, { height: 'auto', maxHeight: 'none', overflow: 'visible' }); parent = parent.parentElement; }
      await sleep(wait);
    }

    let meta = findResumeCanvasMeta();
    let after = meta ? { w: meta.cvs.width, h: meta.cvs.height } : null;
    if (!meta) { for (const r of restore.reverse()) { try { r(); } catch (e) { } } return { ok: false, error: 'no-canvas', before }; }

    const srcW = meta.cvs.width, srcH = meta.cvs.height;
    const sliceSrcH = Math.max(700, Math.min(4000, Number(a.sliceSrcH) || 3200));
    const pages = [];
    try {
      for (let y = 0, i = 1; y < srcH && i <= 8; y += sliceSrcH, i++) {
        const sh = Math.min(sliceSrcH, srcH - y);
        const out = meta.doc.createElement('canvas');
        out.width = Math.round(srcW * scale); out.height = Math.round(sh * scale);
        const ctx = out.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out.width, out.height);
        ctx.drawImage(meta.cvs, 0, y, srcW, sh, 0, 0, out.width, out.height);
        pages.push({ p: i, y, srcW, srcH, w: out.width, h: out.height, png: out.toDataURL('image/jpeg', 0.92) });
      }
    } catch (e) { }
    for (const r of restore.reverse()) { try { r(); } catch (e) { } }
    await sleep(600);
    return { ok: pages.length > 0, before, after, expanded: !!(before && after && after.h > before.h + 50), pages };
  }


  // 按块抓取：把画布切块、原生分辨率导出，规避单次响应过大导致的问题
  function resumeTile(a = {}) {
    const meta = findResumeCanvasMeta();
    if (!meta) return { ok: false, error: 'no-canvas' };
    const cvs = meta.cvs;
    const srcW = cvs.width, srcH = cvs.height;
    const x = Math.max(0, Math.min(srcW - 1, Number(a.x) || 0));
    const y = Math.max(0, Math.min(srcH - 1, Number(a.y) || 0));
    const w = Math.max(60, Math.min(srcW - x, Number(a.w) || Math.round(srcW / 2)));
    const h = Math.max(60, Math.min(srcH - y, Number(a.h) || Math.round(srcH / 2)));
    const scale = Math.max(0.4, Math.min(1.6, Number(a.scale) || 1));
    try {
      const out = meta.doc.createElement('canvas');
      out.width = Math.round(w * scale);
      out.height = Math.round(h * scale);
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(cvs, x, y, w, h, 0, 0, out.width, out.height);
      const png = out.toDataURL('image/jpeg', Number(a.quality) || 0.9);
      return { ok: true, x, y, w, h, srcW, srcH, scale, outW: out.width, outH: out.height, pngLen: png.length, png };
    } catch (e) { return { ok: false, error: 'export: ' + e.message }; }
  }


  // 在简历帧内按"帧内坐标"点击（简历含"查看全部"都由 WASM 画在 canvas 上，只能坐标点击）
  async function frameClickAt(a = {}) {
    const f = findResumeFrame();
    if (!f) return { ok: false, error: 'no-frame' };
    const x = Number(a.x) || 0, y = Number(a.y) || 0;
    const hits = [];
    const fire = (el, type, extra = {}) => {
      try {
        el.dispatchEvent(new MouseEvent(type, Object.assign({ bubbles: true, cancelable: true, clientX: x, clientY: y, view: f.win, button: 0 }, extra)));
      } catch (e) { }
    };
    const target = (() => {
      try { return f.doc.elementFromPoint(x, y) || f.doc.querySelector('canvas') || f.doc.body; } catch (e) { return f.doc.body; }
    })();
    if (a.hover !== false) {
      for (const t of ['mouseover', 'mouseenter', 'mousemove']) fire(target, t);
      await sleep(rnd(120, 260));
    }
    fire(target, 'mousedown', { buttons: 1 });
    await sleep(rnd(40, 90));
    fire(target, 'mouseup', { buttons: 0 });
    await sleep(rnd(40, 90));
    fire(target, 'click', { buttons: 0 });
    hits.push({ tag: target.tagName, cls: (target.className || '').toString().slice(0, 40) });
    // 也尝试在 canvas 上再补一次（有些实现把监听挂在 canvas 上）
    const cvs = f.doc.querySelector('canvas');
    if (cvs && cvs !== target) {
      fire(cvs, 'mousedown', { buttons: 1 }); fire(cvs, 'mouseup', { buttons: 0 }); fire(cvs, 'click', { buttons: 0 });
    }
    await sleep(Math.max(400, Math.min(4000, Number(a.settleMs) || 1500)));
    return { ok: true, x, y, hit: hits[0] };
  }


  // 识别画布里的"查看全部"链接（BOSS 主题青色）并逐个点开
  async function expandAllLinks(a = {}) {
    const f = findResumeFrame();
    if (!f) return { ok: false, error: 'no-frame' };
    const maxClicks = Math.max(0, Math.min(8, Number(a.max !== undefined ? a.max : 4)));
    const clicked = [];

    const scanLinks = () => {
      const meta = (() => { try { return findResumeCanvasMeta(); } catch (e) { return null; } })();
      if (!meta) return [];
      const cvs = meta.cvs, ctx = cvs.getContext('2d');
      let img;
      try { img = ctx.getImageData(0, 0, cvs.width, cvs.height); } catch (e) { return []; }
      const d = img.data, W = cvs.width, H = cvs.height;
      // 主题青色 rgb(16,160,160)：r 明显小于 g/b，且 g≈b
      const cell = 8;
      const grid = new Map();
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const r = d[i], g = d[i + 1], b = d[i + 2];
          if (!(r < 140 && g > 120 && b > 120 && Math.abs(g - b) < 45 && (g - r) > 35)) continue;
          const k = Math.floor(x / cell) + ':' + Math.floor(y / cell);
          const c = grid.get(k) || { n: 0, minx: 1e9, maxx: 0, miny: 1e9, maxy: 0 };
          c.n++; c.minx = Math.min(c.minx, x); c.maxx = Math.max(c.maxx, x); c.miny = Math.min(c.miny, y); c.maxy = Math.max(c.maxy, y);
          grid.set(k, c);
        }
      }
      // 合并相邻网格（同一条链接会被拆到多个格子里）
      const cells = [...grid.values()];
      const used = new Array(cells.length).fill(false);
      const clusters = [];
      for (let i = 0; i < cells.length; i++) {
        if (used[i]) continue;
        const q = [i]; used[i] = true;
        const g0 = cells[i];
        const acc = { n: g0.n, minx: g0.minx, maxx: g0.maxx, miny: g0.miny, maxy: g0.maxy };
        while (q.length) {
          const ci = q.pop(), a = cells[ci];
          for (let j = 0; j < cells.length; j++) {
            if (used[j]) continue;
            const b2 = cells[j];
            const near = !(b2.minx > acc.maxx + cell + 2 || b2.maxx < acc.minx - cell - 2 || b2.miny > acc.maxy + 4 || b2.maxy < acc.miny - 4);
            if (!near) continue;
            used[j] = true; q.push(j);
            acc.n += b2.n; acc.minx = Math.min(acc.minx, b2.minx); acc.maxx = Math.max(acc.maxx, b2.maxx);
            acc.miny = Math.min(acc.miny, b2.miny); acc.maxy = Math.max(acc.maxy, b2.maxy);
          }
        }
        clusters.push(acc);
      }
      const links = clusters
        .map((c) => ({ n: c.n, x: c.minx, y: c.miny, w: c.maxx - c.minx, h: c.maxy - c.miny }))
        .filter((c) => c.n >= 20 && c.w >= 40 && c.w <= 200 && c.h >= 9 && c.h <= 28)
        .sort((a2, b2) => a2.y - b2.y || a2.x - b2.x);
      if (a.debug) return { links, clusters: clusters.length };
      return links;
    };

    for (let round = 0; round < maxClicks; round++) {
      const scanned = scanLinks();
      const links = Array.isArray(scanned) ? scanned : (scanned.links || []);
      if (a.debug) return { ok: true, debug: true, clusters: scanned.clusters, links };
      if (!links.length) break;
      // 取最靠上、且还没点过的
      const target = links.find((l) => !clicked.some((c) => Math.abs(c.x - l.x) < 40 && Math.abs(c.y - l.y) < 24));
      if (!target) break;
      const hitX = Math.round(target.x + target.w / 2), hitY = Math.round(target.y + target.h / 2);
      const ev = (el, type, Ctor, extra = {}) => { try { el.dispatchEvent(new Ctor(type, Object.assign({ bubbles: true, cancelable: true, clientX: hitX, clientY: hitY, view: f.win, button: 0, buttons: /down/.test(type) ? 1 : 0, pointerId: 1, pointerType: 'mouse', isPrimary: true }, extra))); } catch (e) { } };
      const el = (() => { try { return f.doc.elementFromPoint(hitX, hitY) || f.doc.querySelector('canvas'); } catch (e) { return f.doc.querySelector('canvas'); } })();
      for (const t of ['pointerover', 'pointermove', 'mousemove']) { ev(el, t, t.startsWith('pointer') ? PointerEvent : MouseEvent); await sleep(50); }
      for (const t of ['pointerdown', 'mousedown']) ev(el, t, t.startsWith('pointer') ? PointerEvent : MouseEvent);
      await sleep(60);
      for (const t of ['pointerup', 'mouseup']) ev(el, t, t.startsWith('pointer') ? PointerEvent : MouseEvent);
      await sleep(60);
      ev(el, 'click', MouseEvent);
      clicked.push({ x: hitX, y: hitY });
      await sleep(Math.max(700, Number(a.settleMs) || 1500));
      if (a.dismiss !== false) await dismissPopups();
    }
    return { ok: true, clicked, count: clicked.length };
  }


  // 清理遗留：之前"撑高容器"实验留下的内联 height/overflow 样式 + 挪到屏幕外的僵尸弹层
  function cleanupResumeDom() {
    const report = { cleared: [], removed: [], framesCleared: 0 };
    const clearStyle = (el, props) => {
      if (!el || !el.style) return;
      let touched = false;
      for (const k of props) { if (el.style[k]) { el.style[k] = ''; touched = true; } }
      if (touched) report.cleared.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 50) });
    };
    // 1) 所有弹层链路上的 height/maxHeight/overflow 内联样式
    for (const el of document.querySelectorAll('.boss-popup__wrapper, .boss-popup__content, .boss-dialog, .boss-dialog__body, .resume-container, .resume-detail, .resume-content-wrap')) {
      clearStyle(el, ['height', 'maxHeight', 'overflow', 'overflowY']);
    }
    // 2) iframe 的内联 height/maxHeight
    for (const f of document.querySelectorAll('iframe')) {
      clearStyle(f, ['height', 'maxHeight', 'minHeight', 'transform', 'transition']);
    }
    // 3) 帧内文档的元素样式（撑高实验也会改到帧内）
    for (const f of document.querySelectorAll('iframe')) {
      let doc = null;
      try { doc = f.contentDocument; } catch (e) { continue; }
      if (!doc) continue;
      try {
        for (const el of doc.querySelectorAll('*')) {
          if (el.style && (el.style.height || el.style.maxHeight || el.style.overflow)) {
            el.style.height = ''; el.style.maxHeight = ''; el.style.overflow = '';
            report.framesCleared++;
          }
        }
        if (doc.scrollingElement) doc.scrollingElement.scrollTop = 0;
      } catch (e) { }
    }
    // 4) 挪到屏幕外的僵尸弹层：直接移除
    const wrappers = [...document.querySelectorAll('.boss-popup__wrapper, .dialog-wrap')];
    wrappers.forEach((w, i) => {
      const r = w.getBoundingClientRect();
      const offscreen = r.top < -80 || r.left < -200 || r.height > 2000;
      const hidden = w.style && w.style.display === 'none';
      if ((offscreen || hidden) && !w.classList.contains('deactive')) {
        try { w.parentNode && w.parentNode.removeChild(w); report.removed.push({ cls: (w.className || '').toString().slice(0, 60), rect: `${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.x)},${Math.round(r.y)}` }); } catch (e) { }
      }
    });
    return { ok: true, ...report };
  }


  // 诊断：统计画布里的"有彩色"像素（找出"查看全部"链接用的主题色）
  function canvasColorStats(a = {}) {
    const meta = findResumeCanvasMeta();
    if (!meta) return { ok: false, error: 'no-canvas' };
    const cvs = meta.cvs, ctx = cvs.getContext('2d');
    let img;
    try { img = ctx.getImageData(0, 0, cvs.width, cvs.height); } catch (e) { return { ok: false, error: 'getImageData: ' + e.message }; }
    const d = img.data, W = cvs.width, H = cvs.height;
    const bins = new Map();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx - mn < 40) continue;                    // 灰色系（正文/背景）跳过
        const key = `${Math.round(r / 16) * 16},${Math.round(g / 16) * 16},${Math.round(b / 16) * 16}`;
        const e = bins.get(key) || { n: 0, x0: 1e9, x1: 0, y0: 1e9, y1: 0 };
        e.n++;
        e.x0 = Math.min(e.x0, x); e.x1 = Math.max(e.x1, x);
        e.y0 = Math.min(e.y0, y); e.y1 = Math.max(e.y1, y);
        bins.set(key, e);
      }
    }
    const top = [...bins.entries()].map(([rgb, e]) => ({ rgb, n: e.n, box: `${e.x0}-${e.x1},${e.y0}-${e.y1}` }))
      .sort((a2, b2) => b2.n - a2.n).slice(0, 15);
    return { ok: true, w: W, h: H, top };
  }


  // 关闭站点因"查看全部"等弹出的浮层（Esc + 点空白 + 移除可能的浮层节点）
  async function dismissPopups(a = {}) {
    const seq = [
      () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true })),
      () => document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true })),
      () => { const f = findResumeFrame(); if (f) { f.doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true })); f.doc.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true })); } },
      // 注意：不能点简历弹层的关闭按钮（会把简历一起关掉）
    ];
    for (const fn of seq) { try { fn(); } catch (e) { } await sleep(220); }
    // 顶层可见的"小浮层"（非简历弹层）直接关掉
    let closed = 0;
    const wrappers = [...document.querySelectorAll('.popover:not(.deactive), .tooltip:not(.deactive), [class*="popup-tip"]')];
    for (const w of wrappers) {
      const r = w.getBoundingClientRect();
      if (r.width > 60 && r.height > 60) {
        try {
          const btn = w.querySelector('[class*="close"]');
          if (btn) { humanClick(btn); closed++; }
          else { w.style.display = 'none'; closed++; }
        } catch (e) { }
      }
    }
    await sleep(300);
    return { ok: true, closed };
  }


  // 在简历弹层里点"收藏"（BOSS 的收藏按钮在弹层右上角操作栏 / 也有 like-icon-and-text 样式）
  async function favoriteResume(a = {}) {
    const wrap = document.querySelector('.boss-popup__wrapper:not(.deactive)') || document;
    const cands = () => {
      const list = [];
      for (const el of wrap.querySelectorAll('*')) {
        const t = clean(el.innerText);
        const cls = (el.className || '').toString();
        if (!t || t.length > 8) continue;
        if (t === '收藏' || t === '已收藏' || /like|collect|favorite/i.test(cls)) list.push({ el, t, cls });
      }
      // 去掉包含子元素的容器，只留最内层
      return list.filter((x) => !list.some((y) => y !== x && x.el.contains(y.el)));
    };
    const before = cands().map((c) => c.t);
    const target = cands().find((c) => c.t === '收藏') || cands().find((c) => /like|collect/i.test(c.cls));
    if (!target) return { ok: false, error: 'no-favorite-btn', found: before.slice(0, 6) };
    const rect = target.el.getBoundingClientRect();
    humanClick(target.el);
    await sleep(Math.max(800, Number(a.settleMs) || 1400));
    const after = cands().map((c) => c.t);
    return { ok: true, before: before.slice(0, 6), after: after.slice(0, 6), clickedText: target.t, cls: target.cls.slice(0, 40), rect: `${Math.round(rect.width)}x${Math.round(rect.height)}@${Math.round(rect.x)},${Math.round(rect.y)}`, favorited: after.some((t) => t === '已收藏') || !after.includes('收藏') };
  }


  // 在聊天输入框输入并发送消息（多策略：内层/外层按钮 + 回车；确认输入框清空）
  async function chatSendText(a = {}) {
    const text = String(a.text || '');
    if (!text) return { ok: false, error: 'text-required' };
    const box = document.querySelector('.boss-chat-editor-input') || document.querySelector('[contenteditable="true"]');
    if (!box) return { ok: false, error: 'no-input' };
    const clear = async () => {
      box.focus();
      await sleep(150);
      try {
        const sel = window.getSelection(); const range = document.createRange();
        range.selectNodeContents(box); sel.removeAllRanges(); sel.addRange(range);
        document.execCommand('delete', false, null);
      } catch (e) { box.innerText = ''; }
      await sleep(120);
    };
    await clear();
    let typed = false;
    try { typed = document.execCommand('insertText', false, text); } catch (e) { typed = false; }
    if (!typed || !clean(box.innerText).includes(text.slice(0, 6))) {
      box.innerText = text;
      box.dispatchEvent(new Event('input', { bubbles: true }));
      box.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await sleep(Math.max(500, Number(a.settleMs) || 900));
    const typedNow = clean(box.innerText);
    if (!typedNow.includes(text.slice(0, 6))) return { ok: false, error: 'type-failed' };

    const fire = (el, type, extra = {}) => { try { el.dispatchEvent(new MouseEvent(type, Object.assign({ bubbles: true, cancelable: true, button: 0, buttons: /down/.test(type) ? 1 : 0, view: window }, extra))); } catch (e) { } };
    const clickEl = async (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
      const top = document.elementFromPoint(cx, cy) || el;
      for (const t of ['pointerover', 'pointerenter', 'pointermove', 'mousemove']) fire(top, t, { clientX: cx, clientY: cy });
      fire(top, 'pointerdown', { clientX: cx, clientY: cy, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true });
      await sleep(70);
      fire(top, 'pointerup', { clientX: cx, clientY: cy, pointerId: 1, pointerType: 'mouse', isPrimary: true });
      fire(top, 'mousedown', { clientX: cx, clientY: cy });
      await sleep(60);
      fire(top, 'mouseup', { clientX: cx, clientY: cy });
      fire(top, 'click', { clientX: cx, clientY: cy });
      return true;
    };
    const pressEnter = async () => {
      for (const type of ['keydown', 'keypress', 'keyup']) {
        try { box.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })); } catch (e) { }
      }
      await sleep(900);
    };
    const stillTyped = () => clean(box.innerText).includes(text.slice(0, 6));

    await clickEl(document.querySelector('.submit'));
    await sleep(900);
    if (stillTyped()) { await clickEl(document.querySelector('.submit-content')); await sleep(900); }
    if (stillTyped()) { await pressEnter(); }
    if (stillTyped()) { await clickEl(document.querySelector('.submit')); await sleep(1000); }

    const after = clean(box.innerText);
    const sent = !after.includes(text.slice(0, 6));
    return { ok: sent, sent, boxAfter: after.slice(0, 20) };
  }

  // 点"求简历"并确认（会向候选人发送请求简历的消息）
  async function requestResume(a = {}) {
    const btn = [...document.querySelectorAll('.operate-exchange-left .operate-icon-item, .operate-btn')]
      .find((el) => clean(el.innerText) === '求简历');
    if (!btn) return { ok: false, error: 'no-request-resume-btn' };
    humanClick(btn);
    await sleep(Math.max(500, Number(a.settleMs) || 900));
    const tip = document.querySelector('.exchange-tooltip');
    const confirm = tip ? [...tip.querySelectorAll('.boss-btn-primary, .boss-btn')].find((el) => clean(el.innerText) === '确定') : null;
    const text = tip ? clean(tip.innerText).slice(0, 60) : '';
    if (!confirm) return { ok: false, error: 'no-confirm-btn', tipVisible: !!tip, tipText: text };
    if (a.dryRun) return { ok: true, dryRun: true, tipText: text };
    humanClick(confirm);
    await sleep(Math.max(700, Number(a.afterMs) || 1300));
    const tipGone = !document.querySelector('.exchange-tooltip') || getComputedStyle(document.querySelector('.exchange-tooltip')).display === 'none';
    return { ok: true, tipText: text, tipGone };
  }


  // 只读：当前简历弹层里收藏按钮的状态（不点击）
  function favoriteState() {
    const wrap = document.querySelector('.boss-popup__wrapper:not(.deactive)') || document;
    const texts = [];
    for (const el of wrap.querySelectorAll('*')) {
      const t = clean(el.innerText);
      if (!t || t.length > 6) continue;
      if (t === '收藏' || t === '已收藏') texts.push(t);
    }
    const uniq = [...new Set(texts)];
    return { ok: true, states: uniq, favorited: uniq.includes('已收藏') && !uniq.includes('收藏'), mixed: uniq.length > 1 };
  }

  // 按会话 id 打开：先尝试已渲染的行，找不到就滚动列表后再找
  async function chatOpenById(a = {}) {
    const id = String(a.id || '');
    if (!id) return { ok: false, error: 'id-required' };
    const find = () => document.querySelector(`.user-list .geek-item[data-id="${id}"]`) || document.querySelector(`.user-list [data-id="${id}"]`);
    let el = find();
    let steps = 0;
    if (!el) {
      const list = document.querySelector('.user-list') || document.querySelector('.chat-user-list');
      if (list) {
        list.scrollTop = 0;
        await sleep(600);
        const maxSteps = Math.max(5, Math.min(60, Number(a.maxSteps) || 30));
        const step = Math.max(300, Number(a.step) || 560);
        for (steps = 0; steps < maxSteps && !el; steps++) {
          el = find();
          if (el) break;
          list.scrollTop = list.scrollTop + step;
          await sleep(Math.max(400, Number(a.settleMs) || 900));
          el = find();
        }
      }
    }
    if (!el) return { ok: false, error: 'row-not-found', id, steps };
    const wrap = el.closest('.geek-item-wrap') || el;
    const name = clean((wrap.querySelector('.geek-name') || {}).innerText);
    const preview = clean(wrap.innerText).slice(0, 40);
    el.scrollIntoView({ block: 'center' });
    await sleep(rnd(250, 600));
    humanClick(el);
    const t0 = Date.now();
    let panelName = null;
    while (Date.now() - t0 < 12000) {
      const cur = document.querySelector('.conversation-box .base-name .name-box, .conversation-box .base-name');
      const ct = clean(cur && cur.innerText);
      if (ct) { panelName = ct; break; }
      await sleep(400);
    }
    await sleep(rnd(700, 1500));
    return { ok: true, id, name, preview, panelName, steps };
  }

  // ==========================================================================
  // 只读取证探针（诊断专用；不改样式、不派发事件、不碰原生原型）
  //   probePoint / shadowScan / frameEnum / deepTextSearch / canvasCropAt
  // ==========================================================================
  const FZ_STYLE_KEYS = ['position', 'zIndex', 'display', 'visibility', 'opacity', 'pointerEvents',
    'backgroundColor', 'backgroundImage', 'color', 'overflow', 'overflowY', 'transform', 'boxShadow',
    'writingMode', 'columnCount', 'columnWidth', 'mixBlendMode', 'isolation', 'contain', 'filter',
    'clipPath', 'fontSize', 'lineHeight', 'whiteSpace', 'top', 'left', 'width', 'height'];

  function fzStyle(el) {
    const st = {};
    try {
      const cs = getComputedStyle(el);
      for (const k of FZ_STYLE_KEYS) st[k] = cs[k];
      st.scrollHeight = el.scrollHeight; st.clientHeight = el.clientHeight;
      st.scrollWidth = el.scrollWidth; st.clientWidth = el.clientWidth;
    } catch (e) { st.error = String(e && e.message); }
    return st;
  }

  function fzDescribe(el, textCut, htmlCut) {
    if (!el) return null;
    let r = null;
    try { r = el.getBoundingClientRect(); } catch (e) { }
    let shadow = null;
    try {
      shadow = el.shadowRoot ? { mode: el.shadowRoot.mode, childEls: el.shadowRoot.childElementCount } : null;
    } catch (e) { }
    return {
      tag: el.tagName || null,
      id: el.id || null,
      cls: (el.className && typeof el.className === 'string') ? el.className.slice(0, 120) : null,
      rect: r ? { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) } : null,
      shadowRoot: shadow,
      childEls: el.childElementCount,
      text: clean(el.innerText || '').slice(0, textCut || 160),
      html: (el.outerHTML || '').replace(/\s+/g, ' ').slice(0, htmlCut || 300),
    };
  }

  // 从文档根一路穿透 shadow root 命中点（elementFromPoint 只返回 shadow 宿主）
  function fzPierceChain(doc, x, y, maxDepth) {
    const chain = [];
    let root = doc;
    for (let d = 0; d < (maxDepth || 8); d++) {
      let el = null;
      try { el = root.elementFromPoint(x, y); } catch (e) { break; }
      if (!el) break;
      const desc = fzDescribe(el, 200, 300);
      desc.depth = d;
      desc.inShadow = d > 0;
      desc.canvas = (el.tagName === 'CANVAS') ? { w: el.width, h: el.height } : null;
      chain.push({ el: desc, style: fzStyle(el) });
      let sr = null;
      try { sr = el.shadowRoot; } catch (e) { }
      if (!sr) break;
      root = sr;
    }
    return chain;
  }

  function fzFramesOf(doc) {
    let out = [];
    try { out = [...doc.querySelectorAll('iframe, frame')]; } catch (e) { }
    return out;
  }

  function fzCanvasesCovering(doc, x, y) {
    const out = [];
    let all = [];
    try { all = [...doc.querySelectorAll('canvas')]; } catch (e) { return out; }
    for (const c of all) {
      let r = null; try { r = c.getBoundingClientRect(); } catch (e) { continue; }
      if (x < r.left - 1 || x > r.right + 1 || y < r.top - 1 || y > r.bottom + 1) continue;
      out.push({
        tag: 'CANVAS', cls: (c.className || '').toString().slice(0, 60),
        px: `${c.width}x${c.height}`,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        zIndex: (() => { try { return getComputedStyle(c).zIndex; } catch (e) { return null; } })(),
      });
    }
    return out;
  }

  // 递归探测（含 shadow 穿透 + 子 frame 坐标换算）
  function fzProbeInDoc(doc, win, x, y, path, out, depth) {
    if (!doc || depth > 4 || out.length > 24) return;
    const entry = { path, localX: Math.round(x), localY: Math.round(y), depth };
    entry.pierce = fzPierceChain(doc, x, y, 8);
    try {
      entry.stack = [...doc.elementsFromPoint(x, y)].slice(0, 14).map((e) => {
        const d = fzDescribe(e, 120, 200);
        d.zIndex = (() => { try { return getComputedStyle(e).zIndex; } catch (err) { return null; } })();
        d.bg = (() => { try { return getComputedStyle(e).backgroundColor; } catch (err) { return null; } })();
        return d;
      });
    } catch (e) { entry.stackError = String(e && e.message); }
    entry.canvasesCoveringPoint = fzCanvasesCovering(doc, x, y);
    entry.canvasCount = (() => { try { return doc.querySelectorAll('canvas').length; } catch (e) { return null; } })();
    entry.elementCount = (() => { try { return doc.querySelectorAll('*').length; } catch (e) { return null; } })();
    out.push(entry);

    for (const f of fzFramesOf(doc)) {
      let r = null; try { r = f.getBoundingClientRect(); } catch (e) { continue; }
      const lx = x - r.left, ly = y - r.top;
      if (lx < 0 || ly < 0 || lx > r.width || ly > r.height) continue;
      let fdoc = null;
      try { fdoc = f.contentDocument; } catch (e) { }
      const tag = path + '>iframe[' + ((f.getAttribute('src') || '').slice(0, 60) || 'no-src') + ']';
      if (!fdoc) { out.push({ path: tag, note: 'cross-origin-or-null-doc', rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }); continue; }
      fzProbeInDoc(fdoc, f.contentWindow, lx, ly, tag, out, depth + 1);
    }
  }

  function probePoint(a = {}) {
    const x = Number(a.x), y = Number(a.y);
    if (!isFinite(x) || !isFinite(y)) return { ok: false, error: 'x-y-required' };
    const out = [];
    fzProbeInDoc(document, window, x, y, 'top', out, 0);
    const deepest = out[out.length - 1] || {};
    const pierceTail = (deepest.pierce || []).slice(-1)[0] || null;
    return {
      ok: true, url: location.href,
      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
      scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
      point: { x, y },
      hitSummary: {
        docPath: deepest.path || null,
        local: { x: deepest.localX, y: deepest.localY },
        finalTag: pierceTail ? pierceTail.el.tag : null,
        finalCls: pierceTail ? pierceTail.el.cls : null,
        finalId: pierceTail ? pierceTail.el.id : null,
        throughShadow: !!(deepest.pierce && deepest.pierce.length > 1),
        isCanvas: !!(pierceTail && pierceTail.el.tag === 'CANVAS'),
        text: pierceTail ? pierceTail.el.text : null,
      },
      docs: out,
    };
  }

  function shadowScan(a = {}) {
    const docs = [];
    const walkDocs = (doc, path, depth) => {
      if (!doc || depth > 4 || docs.length > 30) return;
      docs.push({ doc, path });
      for (const f of fzFramesOf(doc)) {
        let d = null; try { d = f.contentDocument; } catch (e) { }
        if (d) walkDocs(d, path + '>iframe', depth + 1);
      }
    };
    walkDocs(document, 'top', 0);
    const hosts = [];
    const docStats = [];
    for (const { doc, path } of docs) {
      let all = [];
      try { all = [...doc.querySelectorAll('*')]; } catch (e) { continue; }
      docStats.push({ path, url: (() => { try { return doc.location.href; } catch (e) { return null; } })(), elementCount: all.length, shadowHosts: 0 });
      for (const el of all) {
        let sr = null;
        try { sr = el.shadowRoot; } catch (e) { }
        if (!sr) continue;
        docStats[docStats.length - 1].shadowHosts++;
        hosts.push({
          docPath: path,
          host: fzDescribe(el, 120, 200),
          mode: sr.mode,
          shadowEls: sr.childElementCount,
          shadowText: clean(sr.textContent || '').slice(0, Number(a.textCut) || 120),
          shadowHtml: (sr.innerHTML || '').replace(/\s+/g, ' ').slice(0, 300),
          strayTextNodes: (() => { try { return [...sr.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).length; } catch (e) { return null; } })(),
        });
      }
    }
    return { ok: true, url: location.href, docsScanned: docs.length, docStats, hostCount: hosts.length, hosts: hosts.slice(0, Number(a.max) || 30) };
  }

  function frameEnum(a = {}) {
    const rows = [];
    const walk = (doc, path, depth) => {
      if (!doc || depth > 4) return;
      const frames = fzFramesOf(doc);
      frames.forEach((f, i) => {
        let r = null; try { r = f.getBoundingClientRect(); } catch (e) { }
        let fdoc = null, same = false, err = null;
        try { fdoc = f.contentDocument; same = !!fdoc; } catch (e) { err = String(e && e.message); }
        let info = null;
        if (fdoc) {
          let els = null, text = null, cvs = [], nested = 0, sh = null;
          try { els = fdoc.querySelectorAll('*').length; } catch (e) { }
          try { text = clean((fdoc.body && fdoc.body.innerText) || '').slice(0, Number(a.textCut) || 120); } catch (e) { }
          try {
            cvs = [...fdoc.querySelectorAll('canvas')].map((c) => {
              const cr = c.getBoundingClientRect();
              return `${c.width}x${c.height}px@css${Math.round(cr.x)},${Math.round(cr.y)},${Math.round(cr.width)}x${Math.round(cr.height)}`;
            });
          } catch (e) { }
          try { nested = fzFramesOf(fdoc).length; } catch (e) { }
          try { sh = fdoc.scrollingElement ? fdoc.scrollingElement.scrollHeight : null; } catch (e) { }
          info = { els, text, canvases: cvs, nestedIframes: nested, docScrollH: sh, bodyCls: (() => { try { return (fdoc.body && fdoc.body.className) || null; } catch (e) { return null; } })() };
        }
        rows.push({
          path: path + '>iframe#' + i, depth, idx: i,
          src: (f.getAttribute('src') || '').slice(0, 160),
          id: f.id || null, cls: (f.className || '').toString().slice(0, 80),
          rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
          visible: r ? (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth) : null,
          sameOriginReadable: same, err, info,
        });
        if (fdoc) walk(fdoc, path + '>iframe#' + i, depth + 1);
      });
    };
    walk(document, 'top', 0);
    return { ok: true, url: location.href, count: rows.length, viewport: { w: window.innerWidth, h: window.innerHeight }, frames: rows.slice(0, Number(a.max) || 40) };
  }

  // 全量文本搜索：顶层 + 所有同源 frame + 所有 shadow root（含 textContent，能命中隐藏节点）
  function deepTextSearch(a = {}) {
    let needles = Array.isArray(a.needles) ? a.needles.slice() : [];
    if (a.needle) needles.push(a.needle);
    needles = needles.map((s) => String(s || '').trim()).filter(Boolean);
    if (!needles.length) return { ok: false, error: 'needle-required' };
    const maxHits = Math.max(1, Math.min(60, Number(a.max) || 20));
    const docs = [];
    const walkDocs = (doc, path, depth) => {
      if (!doc || depth > 4 || docs.length > 30) return;
      docs.push({ doc, path });
      for (const f of fzFramesOf(doc)) {
        let d = null; try { d = f.contentDocument; } catch (e) { }
        if (d) walkDocs(d, path + '>iframe', depth + 1);
      }
    };
    walkDocs(document, 'top', 0);

    const raw = [];
    const shadowRootsSeen = new Set();
    for (const { doc, path } of docs) {
      const scanRoot = (root, rpath, inShadow) => {
        let all = [];
        try { all = [...root.querySelectorAll('*')]; } catch (e) { return; }
        for (const el of all) {
          let txt = '';
          try { txt = el.textContent || ''; } catch (e) { }
          const hitNeedles = needles.filter((n) => txt.includes(n));
          if (hitNeedles.length) raw.push({ el, path: rpath, inShadow, hitNeedles, text: clean(txt).slice(0, 300) });
          let sr = null;
          try { sr = el.shadowRoot; } catch (e) { }
          if (sr && !shadowRootsSeen.has(sr)) { shadowRootsSeen.add(sr); scanRoot(sr, rpath + '>#shadow(' + (el.tagName || '') + ')', true); }
        }
      };
      scanRoot(doc, path, false);
    }
    // 只保留"最内层"命中（祖先的 textContent 必然也包含同一段文字）
    const inner = raw.filter((h) => !raw.some((o) => o !== h && o.el !== h.el && h.el.contains(o.el)));
    const hits = inner.slice(0, maxHits).map((h) => {
      const d = fzDescribe(h.el, 300, 300);
      d.docPath = h.path; d.inShadow = h.inShadow; d.hitNeedles = h.hitNeedles; d.matchText = h.text;
      d.visible = (() => { const r = h.el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })();
      return d;
    });
    return {
      ok: true, url: location.href, needles, docsScanned: docs.length,
      rawMatchNodes: raw.length, innermostMatches: inner.length, hits,
    };
  }

  // 只读可视化：把 (x,y) 所在文档中覆盖该点的 canvas 在该点附近裁剪导出（不写页面）
  function canvasCropAt(a = {}) {
    const X = Number(a.x) || 0, Y = Number(a.y) || 0;
    const W = Math.max(20, Math.min(1400, Number(a.w) || 440));
    const H = Math.max(20, Math.min(1400, Number(a.h) || 300));
    const scale = Math.max(0.2, Math.min(1.5, Number(a.scale) || 1));
    let doc = document, lx = X, ly = Y, path = 'top';
    for (let d = 0; d < 5; d++) {
      let el = null; try { el = doc.elementFromPoint(lx, ly); } catch (e) { break; }
      if (!el) break;
      let sr = null; try { sr = el.shadowRoot; } catch (e) { }
      if (sr) { doc = sr; continue; }
      if (el.tagName !== 'IFRAME' && el.tagName !== 'FRAME') break;
      let r = null; try { r = el.getBoundingClientRect(); } catch (e) { break; }
      let fdoc = null; try { fdoc = el.contentDocument; } catch (e) { }
      if (!fdoc) break;
      lx -= r.left; ly -= r.top; doc = fdoc; path = path + '>iframe';
    }
    const cands = [];
    try {
      for (const c of doc.querySelectorAll('canvas')) {
        const r = c.getBoundingClientRect();
        if (lx < r.left - 1 || lx > r.right + 1 || ly < r.top - 1 || ly > r.bottom + 1) continue;
        cands.push({ c, r });
      }
    } catch (e) { return { ok: false, error: 'query-failed: ' + e.message }; }
    cands.sort((a2, b2) => (b2.r.width * b2.r.height) - (a2.r.width * a2.r.height));
    const pick = cands[0];
    if (!pick) return { ok: false, error: 'no-canvas-at-point', docPath: path, local: { x: lx, y: ly } };
    const { c, r } = pick;
    const k = c.width / (r.width || 1);
    const sx = Math.round((lx - W / 2 - r.left) * k);
    const sy = Math.round((ly - H / 2 - r.top) * k);
    const sw = Math.round(W * k), sh = Math.round(H * k);
    try {
      const out = doc.createElement('canvas');
      out.width = Math.round(sw * scale); out.height = Math.round(sh * scale);
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(c, sx, sy, sw, sh, 0, 0, out.width, out.height);
      const png = out.toDataURL('image/jpeg', 0.9);
      return { ok: true, docPath: path, canvas: { px: `${c.width}x${c.height}`, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }, crop: { sx, sy, sw, sh }, outW: out.width, outH: out.height, pngLen: png.length, png };
    } catch (e) { return { ok: false, error: 'export: ' + e.message, docPath: path }; }
  }


  // 打开"附件简历"预览弹窗
  async function openAttachResume(a = {}) {
    const btn = document.querySelector('.btn.resume-btn-file') || document.querySelector('.resume-btn-file');
    if (!btn) return { ok: false, error: 'no-attach-btn' };
    const disabled = /disabled/.test((btn.className || '').toString());
    if (disabled) return { ok: false, error: 'attach-disabled' };
    humanClick(btn);
    await sleep(Math.max(1200, Number(a.settleMs) || 2500));
    const f = document.querySelector('iframe[src*="pdf-viewer"]');
    return { ok: true, viewerOpened: !!f, src: f ? (f.getAttribute('src') || '') : '' };
  }

  // 读取附件简历的真实下载地址（从 pdf-viewer iframe 的 url 参数里解出来）
  function getAttachUrl() {
    const f = document.querySelector('iframe[src*="pdf-viewer"]');
    if (!f) return { ok: false, error: 'no-viewer' };
    const src = f.getAttribute('src') || '';
    const m = /[?&]url=([^&]+)/.exec(src);
    if (!m) return { ok: false, error: 'no-url-param', src: src.slice(0, 120) };
    let inner = decodeURIComponent(m[1]);
    if (!/^https?:/.test(inner)) inner = location.origin + inner;
    const geek = /geekId=([^&]+)/.exec(decodeURIComponent(src));
    return { ok: true, url: inner, geekId: geek ? geek[1] : null, rawSrc: src.slice(0, 160) };
  }

  // 关闭附件简历弹窗
  async function closeAttachResume(a = {}) {
    const closes = [...document.querySelectorAll('.boss-popup__wrapper:not(.deactive) [class*="close"], .dialog-wrap:not(.deactive) [class*="close"], [class*="pdf"] [class*="close"]')]
      .filter((el) => el.getBoundingClientRect().width > 6 && el.getBoundingClientRect().width < 60);
    if (closes.length) humanClick(closes[0]);
    await sleep(600);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    await sleep(400);
    const still = !!document.querySelector('iframe[src*="pdf-viewer"]');
    return { ok: !still, closed: !still };
  }

  const DOM_FNS = {
    bodyText: (a) => clean(document.body ? document.body.innerText : '').slice(0, a.max || 1500),
    counts: () => ({ cards: cards().length, nextAvailable: !!nextButton(), login: loginState(), security: securityCheck() }),
    links: (a) => [...document.querySelectorAll('a[href*="/job_detail/"]')].slice(0, a.max || 20).map((x) => abs(x.getAttribute('href'))),
    // 只读探针：把真实 DOM 结构回传，便于调选择器（不执行任意外部代码）
    probe: (a) => {
      const cs = cards();
      const first = cs[0];
      return {
        url: location.href,
        cardCount: cs.length,
        cardClass: first ? cls(first) : null,
        cardHtml: first ? first.outerHTML.replace(/\s+/g, ' ').slice(0, a.max || 3000) : null,
        jobCardClasses: [...new Set([...document.querySelectorAll('[class*="job-card"],[class*="job-list"]')].map((e) => cls(e)))].slice(0, 15),
        pagination: [...document.querySelectorAll('.options-pages, [class*="pagination"], [class*="page-box"], [class*="options-page"]')]
          .map((e) => ({ cls: cls(e), text: clean(e.innerText).slice(0, 80), html: e.outerHTML.replace(/\s+/g, ' ').slice(0, 500) })).slice(0, 3),
        title: document.title,
      };
    },
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      try {
        switch (msg.cmd) {
          case 'ping':
            return sendResponse({ ok: true, url: location.href, title: document.title });
          case 'status':
            return sendResponse({ ok: true, url: location.href, title: document.title, loggedIn: loginState(), security: securityCheck(), cards: cards().length, next: !!nextButton(), guard: 'no-native-hooks' });
          case 'collect': {
            const jobs = cards().map(extract);
            return sendResponse({ ok: true, url: location.href, title: document.title, jobs, next: !!nextButton(), security: securityCheck(), login: loginState() });
          }
          case 'next':
            return sendResponse(await doNext());
          case 'searchInPage':
            return sendResponse(await searchInPage(msg.args && msg.args.keyword));
          case 'scroll':
            return sendResponse(await scrollAndCollect(msg.args || {}));
          case 'clickables':
            return sendResponse({ ok: true, url: location.href, items: clickableList((msg.args && msg.args.limit) || 40) });
          case 'clickIndex': {
            // 关键：点击可能触发导航 → 必须先立刻回包，否则消息通道被销毁（content-unreachable）
            const pre = prepareClick(msg.args && msg.args.i);
            if (!pre.ok) return sendResponse(pre);
            setTimeout(() => { try { humanClick(pre.el); } catch (e) { } }, Math.round(rnd(120, 450)));
            return sendResponse({ ok: true, dispatched: true, clicked: pre.text, cls: pre.cls, path: pre.path, target: pre.target, urlBefore: pre.urlBefore });
          }
          case 'lightScroll':
            return sendResponse(await lightScroll(msg.args || {}));
          case 'domQuery':
            return sendResponse(domQuery(msg.args || {}));
          case 'domType':
            return sendResponse(await domType(msg.args || {}));
          case 'domClick': {
            const r = domClick(msg.args || {});
            if (r.ok === false) return sendResponse(r);
            setTimeout(() => sendResponse({ ...r, note: 'clicked-async' }), Math.round(rnd(250, 600)));
            return true;      // 异步回包
          }
          case 'scrollContainer':
            return sendResponse(await scrollContainer(msg.args || {}));
          // ---- 招聘端 ----
          case 'chatList':
            return sendResponse(chatList(msg.args || {}));
          case 'chatScroll':
            return sendResponse(await chatScroll(msg.args || {}));
          case 'chatOpen':
            return sendResponse(await chatOpen(msg.args && msg.args.id));
          case 'chatSnapshot':
            return sendResponse(chatSnapshot());
          case 'chatExpand':
            return sendResponse(await chatExpand());
          case 'chatOpenResume':
            return sendResponse(await chatOpenResume());
          case 'resumeSnapshot':
            return sendResponse(resumeSnapshot(msg.args || {}));
          case 'resumeFrameSnapshot':
            return sendResponse(resumeFrameSnapshot(msg.args || {}));
          case 'resumeFrameCapture':
            return sendResponse(await resumeFrameCapture(msg.args || {}));
          case 'batchCaptureResumes':
            return sendResponse(await batchCaptureResumes(msg.args || {}));
          case 'captureResumePages':
            return sendResponse(await captureResumePagesInner(msg.args || {}));
          case 'captureResumeFull':
            return sendResponse(await captureResumeFull(msg.args || {}));
          case 'captureResumeMultiPage':
            return sendResponse(await captureResumeMultiPage(msg.args || {}));
          case 'resumeShiftCapture':
            return sendResponse(await resumeShiftCapture(msg.args || {}));
          case 'searchOpenByName':
            return sendResponse(await searchOpenByName(msg.args || {}));
          case 'modalScrollables':
            return sendResponse(modalScrollables());
          case 'probePoint':
            return sendResponse(probePoint(msg.args || {}));
          case 'shadowScan':
            return sendResponse(shadowScan(msg.args || {}));
          case 'frameEnum':
            return sendResponse(frameEnum(msg.args || {}));
          case 'deepTextSearch':
            return sendResponse(deepTextSearch(msg.args || {}));
          case 'canvasCropAt':
            return sendResponse(canvasCropAt(msg.args || {}));
          case 'resumePageCapture':
            return sendResponse(await resumePageCapture(msg.args || {}));
          case 'expandResumeCapture':
            return sendResponse(await expandResumeCapture(msg.args || {}));
          case 'frameClickAt':
            return sendResponse(await frameClickAt(msg.args || {}));
          case 'expandAllLinks':
            return sendResponse(await expandAllLinks(msg.args || {}));
          case 'cleanupResumeDom':
            return sendResponse(cleanupResumeDom());
          case 'canvasColorStats':
            return sendResponse(canvasColorStats(msg.args || {}));
          case 'dismissPopups':
            return sendResponse(await dismissPopups(msg.args || {}));
          case 'favoriteResume':
            return sendResponse(await favoriteResume(msg.args || {}));
          case 'chatSendText':
            return sendResponse(await chatSendText(msg.args || {}));
          case 'favoriteState':
            return sendResponse(favoriteState());
          case 'chatOpenById':
            return sendResponse(await chatOpenById(msg.args || {}));
          case 'openAttachResume':
            return sendResponse(await openAttachResume(msg.args || {}));
          case 'getAttachUrl':
            return sendResponse(getAttachUrl());
          case 'closeAttachResume':
            return sendResponse(await closeAttachResume(msg.args || {}));
          case 'requestResume':
            return sendResponse(await requestResume(msg.args || {}));
          case 'resumeTile':
            return sendResponse(resumeTile(msg.args || {}));
          case 'pressKey':
            return sendResponse(await pressKey(msg.args || {}));
          case 'listResumeCanvases':
            return sendResponse(listResumeCanvases());
          case 'frameScrollables':
            return sendResponse(frameScrollables(msg.args || {}));
          case 'resumeClose':
            return sendResponse(await resumeClose());
          case 'back':
            history.back();
            return sendResponse({ ok: true });
          case 'evalDom': {
            const fn = DOM_FNS[msg.args && msg.args.fn];
            if (!fn) return sendResponse({ ok: false, error: 'unknown-dom-fn', allowed: Object.keys(DOM_FNS) });
            return sendResponse({ ok: true, result: fn(msg.args || {}) });
          }
          default:
            return sendResponse({ ok: false, error: 'unknown-cmd' });
        }
      } catch (e) {
        return sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
    })();
    return true;
  });
})();



