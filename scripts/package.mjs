#!/usr/bin/env node
/**
 * 打包：把仓库打成可分发的压缩包（默认 dist/boss-recruit-kit-<version>.tgz）。
 * 排除 node_modules / .git / 运行时数据 / 浏览器 profile / 候选人数据。
 *
 * 用法：
 *   node scripts/package.mjs                # 生成 .tgz
 *   node scripts/package.mjs --zip          # 生成 .zip（Windows 友好）
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const parent = path.dirname(root);
const name = path.basename(root);
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const distDir = path.join(root, 'dist');
mkdirSync(distDir, { recursive: true });

const EXCLUDES = [
  'node_modules', '.git', 'dist', 'data', 'out', 'captures', 'profile', '.boss-kit',
  'resumes', '*.log', '*.jsonl', '.DS_Store', 'Thumbs.db',
];

const wantZip = process.argv.includes('--zip');
const outName = `${name}-v${version}${wantZip ? '.zip' : '.tgz'}`;
const outPath = path.join(distDir, outName);

// bsdtar：多次 --exclude 逐项排除
const tarArgs = ['-c', '-f', outPath];
for (const e of EXCLUDES) tarArgs.push('--exclude', e);
if (wantZip) tarArgs.push('-a');           // 按扩展名自动选格式（bsdtar）
else tarArgs.push('-z');
tarArgs.push('-C', parent, name);

try {
  execFileSync('tar', tarArgs, { stdio: 'inherit' });
} catch (e) {
  console.error('打包失败：', e.message);
  console.error('提示：需要系统自带 tar（Windows 10+ / macOS / Linux 均自带 bsdtar）。');
  process.exit(1);
}

const buf = readFileSync(outPath);
const sha = createHash('sha256').update(buf).digest('hex');
writeFileSync(`${outPath}.sha256`, `${sha}  ${outName}\n`);
const kb = Math.round(statSync(outPath).size / 1024);
console.log(`\n包  ：${outPath}`);
console.log(`大小：${kb} KB`);
console.log(`SHA256：${sha}`);
console.log(`校验：${outPath}.sha256`);
