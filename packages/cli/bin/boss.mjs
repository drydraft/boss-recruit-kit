#!/usr/bin/env node
/**
 * boss —— Boss 直聘招聘自动化 CLI
 *
 * 用法：
 *   boss doctor                                   环境自检
 *   boss bridge start|status                      起桥 / 看状态
 *   boss browser open [--clear-cache] [--no-proxy] 启动可见浏览器（加载扩展）
 *   boss list [--limit 40]                        列沟通列表
 *   boss open <会话id|姓名> [--index N]            打开某人看指纹与消息
 *   boss capture-resume <会话id|姓名> --out DIR     抓在线简历（分块截图）
 *   boss download-resume <会话id|姓名>              下载附件简历 PDF
 *   boss send <会话id|姓名> --text "..."            发消息（会话核验）
 *   boss request-resume <会话id|姓名>               求简历（系统消息核验）
 *   boss favorite <会话id|姓名>                     收藏（先读状态，幂等）
 *   boss cleanup                                   清理僵尸弹层
 *   boss audit --people people.json                逐人核验
 *
 * 全局：--json 输出机器可读结果；--help 看用法；--version 看版本。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseArgs, color, fail, info } from '../src/util.mjs';
import { commands as systemCmds } from '../src/commands/system.mjs';
import { commands as sessionCmds } from '../src/commands/session.mjs';
import { commands as resumeCmds } from '../src/commands/resume.mjs';
import { commands as outreachCmds } from '../src/commands/outreach.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.resolve(here, '..', 'package.json'), 'utf8'));

const commands = { ...systemCmds, ...sessionCmds, ...resumeCmds, ...outreachCmds };

function usage() {
  const width = Math.max(...Object.keys(commands).map((k) => k.length));
  const lines = [
    `${color.bold}boss${color.reset} ${color.dim}v${pkg.version}${color.reset} — Boss 直聘招聘自动化 CLI`,
    '',
    `${color.bold}命令${color.reset}`,
  ];
  for (const [name, c] of Object.entries(commands)) {
    lines.push(`  ${name.padEnd(width + 2)}${c.desc}`);
  }
  lines.push('');
  lines.push(`${color.bold}全局选项${color.reset}`);
  lines.push(`  --json${' '.repeat(width)}以 JSON 输出（便于脚本串联）`);
  lines.push(`  --help${' '.repeat(width)}显示本帮助`);
  lines.push('');
  lines.push(`${color.dim}首次使用：boss doctor  →（按提示）boss bridge start → boss browser open → boss list${color.reset}`);
  lines.push(`${color.dim}踩坑必读：docs/PITFALLS.md；故障速查：docs/TROUBLESHOOTING.md${color.reset}`);
  return lines.join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    console.log(usage());
    return;
  }
  if (argv[0] === '--version' || argv[0] === '-v') { console.log(pkg.version); return; }

  const name = argv[0];
  const cmd = commands[name];
  if (!cmd) {
    fail(`未知命令：${name}`);
    info(`可用命令：${Object.keys(commands).join(', ')}`);
    info('运行 boss --help 看完整用法');
    process.exitCode = 2;
    return;
  }
  const args = parseArgs(argv.slice(1));
  if (args.help) { console.log(cmd.desc); return; }

  try {
    await cmd.run(args);
  } catch (e) {
    fail(e.message || String(e));
    if (process.env.BOSS_DEBUG) console.error(e.stack);
    process.exitCode = 1;
  }
}

await main();
