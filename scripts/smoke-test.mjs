#!/usr/bin/env node
/**
 * 冒烟测试：不依赖浏览器和桥，验证仓库自身的完整性与语法。
 *   node scripts/smoke-test.mjs          静态检查
 *   node scripts/smoke-test.mjs --live   额外检查桥与扩展连通（需要先启动桥和浏览器）
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const live = process.argv.includes('--live');
let pass = 0, failCount = 0;

const ok = (m) => { console.log(`  \u001b[32m✓\u001b[0m ${m}`); pass++; };
const bad = (m) => { console.log(`  \u001b[31m✗\u001b[0m ${m}`); failCount++; };
const section = (t) => console.log(`\n\u001b[1m${t}\u001b[0m`);

const checkSyntax = (rel) => {
  const p = path.join(root, rel);
  if (!existsSync(p)) return bad(`缺少文件 ${rel}`);
  const r = spawnSync(process.execPath, ['--check', p], { encoding: 'utf8' });
  r.status === 0 ? ok(`语法 OK  ${rel}`) : bad(`语法错误 ${rel}\n${r.stderr}`);
};

section('1. 文件完整性');
for (const f of [
  'package.json', 'README.md', 'LICENSE', '.gitignore',
  'packages/bridge/extension/manifest.json',
  'packages/bridge/extension/content.js',
  'packages/bridge/extension/sw.js',
  'packages/bridge/server/boss-bridge-server.cjs',
  'packages/bridge/scripts/reload-browser.ps1',
  'packages/cli/bin/boss.mjs',
  'packages/cli/src/bridge-client.mjs',
  'packages/mcp-server/src/server.mjs',
  'packages/dsh-plugin/package.json',
  'packages/dsh-plugin/cordis.patch.yml',
  'skills/boss-recruiting/SKILL.md',
]) (existsSync(path.join(root, f)) ? ok(f) : bad(`缺少 ${f}`));

section('2. JavaScript 语法');
for (const f of [
  'packages/bridge/server/boss-bridge-server.cjs',
  'packages/bridge/extension/content.js',
  'packages/bridge/extension/sw.js',
  'packages/cli/bin/boss.mjs',
  'packages/cli/src/config.mjs',
  'packages/cli/src/util.mjs',
  'packages/cli/src/bridge-client.mjs',
  'packages/cli/src/commands/system.mjs',
  'packages/cli/src/commands/session.mjs',
  'packages/cli/src/commands/resume.mjs',
  'packages/cli/src/commands/outreach.mjs',
  'packages/mcp-server/src/server.mjs',
]) checkSyntax(f);

section('3. 扩展清单与插件清单');
try {
  const mf = JSON.parse(readFileSync(path.join(root, 'packages/bridge/extension/manifest.json'), 'utf8'));
  const need = ['manifest_version', 'name', 'version', 'permissions', 'background', 'content_scripts'];
  const missing = need.filter((k) => !(k in mf));
  missing.length === 0 ? ok(`manifest.json 字段齐全（MV${mf.manifest_version}，权限：${mf.permissions.join('/')}）`) : bad(`manifest.json 缺字段：${missing.join(', ')}`);
  (mf.permissions || []).includes('downloads') ? ok('已声明 downloads 权限（附件简历落盘需要）') : bad('缺少 downloads 权限');
} catch (e) { bad(`manifest.json 解析失败：${e.message}`); }

try {
  const dp = JSON.parse(readFileSync(path.join(root, 'packages/dsh-plugin/package.json'), 'utf8'));
  dp?.dsh?.bundle?.patch ? ok(`DSH 插件已声明组合包：${dp.dsh.id}（patch=${dp.dsh.bundle.patch}）`) : bad('DSH 插件缺少 dsh.bundle.patch');
  const patch = readFileSync(path.join(root, 'packages/dsh-plugin/cordis.patch.yml'), 'utf8');
  patch.includes('dsh-mcp-client') && patch.includes('serverName') ? ok('cordis.patch.yml 挂载了 MCP 客户端且声明 serverName') : bad('cordis.patch.yml 内容不完整');
} catch (e) { bad(`插件清单检查失败：${e.message}`); }

section('4. 技能文件 frontmatter');
try {
  const sk = readFileSync(path.join(root, 'skills/boss-recruiting/SKILL.md'), 'utf8');
  /^---\s*\nname:\s*\S+\ndescription:\s*\S+/m.test(sk) ? ok('SKILL.md frontmatter 合法（name/description）') : bad('SKILL.md 缺少合法 frontmatter');
} catch (e) { bad(`SKILL.md 读取失败：${e.message}`); }

section('5. 脱敏自检（public 仓库硬要求）');
const banned = [
  { re: /[A-Za-z]:\\+Users\\+[A-Za-z]/, why: '包含本机用户目录个人路径' },
  { re: /\/Users\/[a-z][a-z0-9_.-]+\/|\/home\/[a-z][a-z0-9_.-]+\//, why: '包含个人家目录路径' },
  { re: /\bgho_[A-Za-z0-9]{10,}|\bghp_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}/, why: '包含 GitHub token' },
  { re: /__zp_stoken__\s*[:=]\s*["'][^"']{20,}/, why: '包含会话 cookie 值' },
  { re: /\b\d{8,10}-\d\b(?![-0])/, why: '疑似真实会话 id（示例请用明显占位的全 0 编号）', allowIn: ['examples/people.example.json'] },
];
let filesToScan = [];
try {
  filesToScan = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean);
} catch {
  filesToScan = walk(root);
}
filesToScan = filesToScan.filter((f) => !/\.(png|jpg|jpeg|pdf|zip|tgz)$/i.test(f));
function walk(dir, base = root, acc = []) {
  const SKIP = new Set(['node_modules', '.git', 'dist', 'data', 'out', 'captures', 'profile']);
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, acc);
    else acc.push(path.relative(base, p).replace(/\\/g, '/'));
  }
  return acc;
}
let leaks = 0;
for (const rel of filesToScan) {
  let content = '';
  try { content = readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }
  for (const b of banned) {
    if (b.allowIn && b.allowIn.includes(rel.replace(/\\/g, '/'))) continue;
    if (b.re.test(content)) { bad(`${rel}：${b.why}`); leaks++; }
  }
}
leaks === 0 ? ok(`已扫描 ${filesToScan.length} 个受版本控制的文件，未发现敏感信息`) : bad(`发现 ${leaks} 处敏感信息`);

section('6. CLI 自检命令');
try {
  const out = execFileSync(process.execPath, [path.join(root, 'packages/cli/bin/boss.mjs'), '--help'], { encoding: 'utf8' });
  out.includes('boss') && out.includes('doctor') ? ok('boss --help 正常输出') : bad('boss --help 输出异常');
} catch (e) { bad(`boss --help 执行失败：${e.message}`); }

if (live) {
  section('7. 实时连通性（--live）');
  try {
    const res = await fetch('http://127.0.0.1:8898/status', { signal: AbortSignal.timeout(5000) });
    const st = await res.json();
    st.ok !== false ? ok(`桥可达 ${'http://127.0.0.1:8898'}（扩展连接：${st.extensionConnected ? '是' : '否'}）`) : bad('桥返回异常');
    st.extensionConnected ? ok('扩展已连上桥') : bad('扩展未连上：确认浏览器带着扩展启动，且停在 Boss 沟通页');
  } catch (e) { bad(`桥不可达：${e.message}（先运行 npm run bridge）`); }
} else {
  console.log('\n\u001b[2m（跳过实时连通性检查；加 --live 可检查桥与扩展）\u001b[0m');
}

console.log(`\n\u001b[1m结果\u001b[0m：通过 ${pass} 项，失败 ${failCount} 项`);
process.exit(failCount === 0 ? 0 : 1);
