/**
 * 系统类命令：doctor（自检）、bridge（桥生命周期）、browser（启动浏览器）
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from '../config.mjs';
import { call, status } from '../bridge-client.mjs';
import { color, emit, fail, info, ok, sleep, table, warn } from '../util.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..', '..');          // packages/cli
const repoRoot = path.resolve(pkgRoot, '..', '..');      // <repo>
const bridgeRoot = path.join(repoRoot, 'packages', 'bridge');
const extensionDir = path.join(bridgeRoot, 'extension');
const serverEntry = path.join(bridgeRoot, 'server', 'boss-bridge-server.cjs');
const reloadScript = path.join(bridgeRoot, 'scripts', 'reload-browser.ps1');

const MAJOR = Number(process.versions.node.split('.')[0]);

export const commands = {
  doctor: {
    desc: '环境自检：Node / 扩展文件 / 桥连通 / 扩展是否连上 / 页面是否可操作',
    async run(args) {
      const rows = [];
      rows.push({
        item: 'Node 版本', expect: '>= 20', actual: process.versions.node,
        result: MAJOR >= 20 ? 'OK' : 'FAIL',
        hint: MAJOR >= 20 ? '' : '升级 Node',
      });
      for (const f of ['manifest.json', 'content.js', 'sw.js']) {
        const p = path.join(extensionDir, f);
        rows.push({ item: `扩展 ${f}`, expect: '存在', actual: existsSync(p) ? '存在' : '缺失', result: existsSync(p) ? 'OK' : 'FAIL', hint: existsSync(p) ? '' : `检查 ${extensionDir}` });
      }
      const st = await status();
      const connected = !!(st && st.extensionConnected);
      const bridgeReachable = st && st.ok !== false;
      rows.push({
        item: '本地桥', expect: `可达 ${config.bridgeHttp}`, actual: bridgeReachable ? '可达' : '不可达',
        result: bridgeReachable ? (connected ? 'OK' : 'WARN') : 'FAIL',
        hint: bridgeReachable ? (connected ? '' : '浏览器未连上：确认浏览器已带扩展启动（boss browser open）') : '运行 boss bridge start',
      });
      let pageOk = null, pageInfo = '';
      if (connected) {
        try {
          const r = await call('chatList', { limit: 1 }, 20000);
          pageOk = true;
          pageInfo = `会话行可读（${(r.items || r.list || []).length} 条样本）`;
        } catch (e) { pageOk = false; pageInfo = e.message.slice(0, 60); }
      }
      rows.push({
        item: '页面可操作', expect: 'Boss 沟通页', actual: pageInfo || '（未检测）',
        result: pageOk === true ? 'OK' : pageOk === false ? 'FAIL' : 'SKIP',
        hint: pageOk === false ? '确认浏览器停在 zhipin.com/web/chat/index 且已登录' : '',
      });

      const render = () => {
        const lines = [table(rows, [
          { key: 'item', label: '检查项' }, { key: 'expect', label: '期望' },
          { key: 'actual', label: '实际' }, { key: 'result', label: '结论' }, { key: 'hint', label: '建议' },
        ])];
        const bad = rows.filter((r) => r.result === 'FAIL');
        const warnRows = rows.filter((r) => r.result === 'WARN');
        lines.push('');
        lines.push(bad.length
          ? `${color.red}有 ${bad.length} 项未通过${color.reset}：按"建议"列处理后重跑 boss doctor`
          : warnRows.length
            ? `${color.yellow}基本可用，但有 ${warnRows.length} 项待确认${color.reset}：见"建议"列`
            : `${color.green}全部通过，可以开始工作${color.reset}`);
        lines.push(`${color.dim}下一步：boss list --limit 20${color.reset}`);
        return lines.join('\n');
      };
      emit(args, { ok: !rows.some((r) => r.result === 'FAIL'), checks: rows }, render);
    },
  },

  bridge: {
    desc: '桥生命周期：boss bridge start | status | stop',
    async run(args) {
      const sub = args._[0] || 'status';
      if (sub === 'status') {
        const st = await status();
        emit(args, st, (d) => {
          if (d.ok === false) return `${color.red}桥不可达${color.reset} ${config.bridgeHttp} —— 运行 boss bridge start`;
          return [
            `桥        ${color.green}运行中${color.reset} ${config.bridgeHttp}`,
            `扩展连接  ${d.extensionConnected ? color.green + '已连接' + color.reset : color.yellow + '未连接' + color.reset}（clients=${d.clients ?? '?'}）`,
            d.hello ? `扩展版本  ${d.hello.version ?? '?'}` : '',
          ].filter(Boolean).join('\n');
        });
        return;
      }
      if (sub === 'start') {
        if ((await status()).ok !== false) { warn('桥已在运行'); return; }
        if (!existsSync(serverEntry)) { fail(`找不到桥服务：${serverEntry}`); process.exitCode = 1; return; }
        const child = spawn(process.execPath, [serverEntry], {
          detached: !args.foreground, stdio: args.foreground ? 'inherit' : 'ignore',
          cwd: path.dirname(serverEntry), windowsHide: true,
        });
        if (!args.foreground) child.unref();
        info(`已启动桥（pid=${child.pid}）${args.foreground ? '' : '，后台运行'}`);
        for (let i = 0; i < 20; i++) {
          await sleep(500);
          const st = await status();
          if (st.ok !== false) { ok(`桥就绪：${config.bridgeHttp}（扩展连接：${st.extensionConnected ? '是' : '否'}）`); return; }
        }
        warn('桥启动后 10 秒内未就绪，请查看 packages/bridge/data/bridge.log');
        return;
      }
      if (sub === 'stop') {
        const st = await status();
        if (st.ok === false) { warn('桥本来就不可达'); return; }
        fail('当前版本不做强制杀进程；请用任务管理器结束 node 进程，或运行：boss bridge start --foreground 前台观察');
        process.exitCode = 1;
        return;
      }
      fail(`未知子命令：bridge ${sub}`);
      process.exitCode = 1;
    },
  },

  browser: {
    desc: '启动/重载浏览器：boss browser open [--clear-cache] [--no-proxy]',
    async run(args) {
      if (!existsSync(reloadScript)) { fail(`找不到启动脚本：${reloadScript}`); process.exitCode = 1; return; }
      const psArgs = ['-NoProfile', '-File', reloadScript];
      if (args.url) psArgs.push('-Url', String(args.url));
      if (config.profileDir) psArgs.push('-ProfileDir', config.profileDir);
      if (config.browserPath) psArgs.push('-BrowserPath', config.browserPath);
      if (args['clear-cache']) psArgs.push('-ClearCache');
      if (args['no-proxy']) psArgs.push('-NoProxy');
      const shell = process.platform === 'win32' ? 'pwsh' : 'pwsh';
      info(`执行：${shell} ${psArgs.join(' ')}`);
      await new Promise((resolve, reject) => {
        const c = spawn(shell, psArgs, { stdio: 'inherit' });
        c.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`退出码 ${code}`))));
        c.on('error', reject);
      }).catch((e) => {
        fail(`启动失败：${e.message}`);
        info('若未安装 PowerShell 7，可直接用 Chrome 手动启动：');
        info(`  chrome --user-data-dir=<profile> --load-extension="${extensionDir}" https://www.zhipin.com/web/chat/index`);
        process.exitCode = 1;
      });
    },
  },
};
