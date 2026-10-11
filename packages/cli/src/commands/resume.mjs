/**
 * 简历类命令：capture-resume（抓在线简历截图）、download-resume（下载附件简历 PDF）
 *
 * 抓取策略（见 docs/PITFALLS.md C1）：
 *   在线简历是 WASM 画布，整张导出会超过桥的安全响应体积导致调用卡死，
 *   因此**按 2×2 分块、原生分辨率**逐块导出；再滚动一屏继续。
 */
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { config } from '../config.mjs';
import { call, closeResume, openResume, openTarget } from '../bridge-client.mjs';
import { color, emit, info, ok, pad3, saveDataUrl, sleep, warn } from '../util.mjs';

async function canvasSize() {
  const c = await call('listResumeCanvases', {}, 40000);
  const cv = c?.frames?.[0]?.canvases?.[0];
  const [w, h] = String(cv || '734x749').split('x').map(Number);
  return { w: w || 734, h: h || 749 };
}

/** 把一个视口画布切成 2×2 导出（每块约 40–50KB，避开大响应） */
async function shootViewport(outDir, prefix, cw, ch, scale) {
  const halfW = Math.floor(cw / 2), halfH = Math.floor(ch / 2);
  const tiles = [[0, 0, halfW, halfH], [halfW, 0, cw - halfW, halfH], [0, halfH, halfW, ch - halfH], [halfW, halfH, cw - halfW, ch - halfH]];
  const files = [];
  for (let i = 0; i < tiles.length; i++) {
    const [x, y, w, h] = tiles[i];
    const r = await call('resumeTile', { x, y, w, h, scale }, 90000);
    if (!r.ok || !r.png) { warn(`第 ${i} 块导出失败：${r.error || 'empty'}`); continue; }
    const file = path.join(outDir, `${prefix}_${i}.jpg`);
    await saveDataUrl(r.png, file);
    files.push(file);
  }
  return files;
}

export const commands = {
  'capture-resume': {
    desc: '抓某人的在线简历：boss capture-resume <会话id|姓名> --out <目录> [--screens 12] [--no-expand] [--scale 1]',
    async run(args) {
      const target = args._[0];
      if (!target) throw new Error('用法：boss capture-resume <会话id|姓名> --out <目录>');
      const outDir = path.resolve(String(args.out || config.captureDir));
      const screens = Math.max(1, Math.min(60, Number(args.screens) || 12));
      const scale = Number(args.scale) || 1;
      const isId = /^\d/.test(target);

      await mkdir(outDir, { recursive: true });
      const { snap } = await openTarget({ id: isId ? target : undefined, name: isId ? undefined : target, index: Number(args.index) || 0 });
      const person = snap.name || target;
      info(`目标：${person}（${snap.age ?? ''} ${snap.years ?? ''} ${(snap.workExp || [])[0] ?? ''}）`);

      await openResume();
      if (args.expand !== false) {
        const ex = await call('expandAllLinks', { max: Number(args.maxLinks) || 8 }, 150000).catch((e) => ({ ok: false, error: e.message }));
        info(`"查看全部" 展开：${ex.ok ? `点了 ${ex.clicked?.length ?? 0} 处` : `跳过（${ex.error || '无链接'}）`}`);
      }

      const all = [];
      for (let p = 0; p < screens; p++) {
        if (p > 0) {
          const sc = await call('resumePageCapture', { step: Number(args.step) || undefined }, 90000).catch((e) => ({ ok: false, error: e.message }));
          if (sc.ok === false || sc.atBottom || sc.done) { info(`已到简历末尾（第 ${p} 屏）`); break; }
          await sleep(400);
        } else {
          await call('resumePageCapture', { reset: true }, 90000).catch(() => {});
        }
        const { w, h } = await canvasSize();
        const files = await shootViewport(outDir, `${pad3(p + 1)}`, w, h, scale);
        all.push(...files);
        info(`第 ${p + 1} 屏 → ${files.length} 块`);
      }

      await closeResume();
      emit(args, { ok: true, person, screens: all.length / 4, files: all }, (d) =>
        `${color.green}完成${color.reset}：${d.person} 共 ${d.files.length} 张分块图 → ${outDir}\n${color.dim}提示：分块图可用任意看图工具拼接，或直接用 boss open 的在线简历读取流程。${color.reset}`);
    },
  },

  'download-resume': {
    desc: '下载某人的附件简历 PDF：boss download-resume <会话id|姓名> [--out-name 文件名] [--json]',
    async run(args) {
      const target = args._[0];
      if (!target) throw new Error('用法：boss download-resume <会话id|姓名> [--out-name 文件名.pdf]');
      const isId = /^\d/.test(target);
      const { snap } = await openTarget({ id: isId ? target : undefined, name: isId ? undefined : target, index: Number(args.index) || 0 });
      const person = snap.name || target;

      if (!snap.resumeBtns?.file) {
        emit(args, { ok: false, person, reason: 'no-attachment', message: '对方还没有发附件简历' },
          (d) => `${color.yellow}${d.person}：暂无附件简历${color.reset}（可以先 boss send 一句催件）`);
        return;
      }
      if (snap.resumeBtns.fileDisabled) {
        emit(args, { ok: false, person, reason: 'attachment-disabled' },
          (d) => `${color.red}${d.person}：附件简历按钮不可用${color.reset}`);
        return;
      }

      await call('cleanupResumeDom', {}, 40000).catch(() => {});
      const o = await call('openAttachResume', {}, 60000);
      if (!o.viewerOpened) throw new Error('附件简历预览未打开（界面可能变化，见 docs/TROUBLESHOOTING.md）');
      const u = await call('getAttachUrl', {}, 40000);
      if (!u.ok) throw new Error(`未能解析下载地址：${u.error}`);

      const filename = String(args['out-name'] || `${person}.pdf`).replace(/[\\/:*?"<>|]/g, '_');
      const d = await call('downloadResume', { url: u.url, filename }, 180000);
      await call('closeAttachResume', {}, 30000).catch(() => {});

      emit(args, { ok: !!d.ok, person, file: d.filename, bytes: d.bytes, state: d.state }, (r) =>
        r.ok ? `${color.green}✓${color.reset} ${r.person} → ${r.file}（${Math.round((r.bytes || 0) / 1024)}KB）`
             : `${color.red}✗${color.reset} 下载未完成：${r.state}`);
    },
  },
};
