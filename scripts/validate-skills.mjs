#!/usr/bin/env node
/**
 * validate-skills.mjs — static validator for the skill family (the "quick_validate" equivalent).
 *
 * Enforces the architecture documented in skills/README.md:
 *   1. directory name === frontmatter `name`
 *   2. `name` matches ^[a-z0-9]+(-[a-z0-9]+)*$ and is <= 40 chars
 *   3. `description` present, third-person, contains no '<' or '>'
 *   4. SKILL.md within the word budget (default 1400 words)
 *   5. SKILL.md contains a "load on demand" routing table
 *   6. every path referenced in that table exists on disk
 *   7. no shared paragraph duplicated between SKILL.md and its references
 *
 * Usage: node scripts/validate-skills.mjs [--root skills] [--budget 1400] [--json]
 * Exit: 0 = clean, 1 = violations.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const skillsRoot = path.resolve(repoRoot, flag('root', 'skills'));
const WORD_BUDGET = Number(flag('budget', 1400));
const asJson = args.includes('--json');

const violations = [];
const notes = [];
const v = (skill, rule, detail) => violations.push({ skill, rule, detail });

const renderMarkdown = (md) =>
  md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_>#|-]/g, ' ');

const paragraphs = (md) =>
  md
    .split(/\r?\n\r?\n/)
    .map((p) => renderMarkdown(p).replace(/\s+/g, ' ').trim())
    .filter((p) => p.length >= 90); // only substantial prose can be "duplicated"

const words = (md) => renderMarkdown(md).split(/\s+/).filter(Boolean).length;

const skillDirs = readdirSync(skillsRoot, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => path.join(skillsRoot, e.name))
  .filter((d) => existsSync(path.join(d, 'SKILL.md')));

if (!skillDirs.length) {
  console.error(`no skills found under ${skillsRoot}`);
  process.exit(1);
}

for (const dir of skillDirs) {
  const name = path.basename(dir);
  const md = readFileSync(path.join(dir, 'SKILL.md'), 'utf8');

  // 1 + 2. frontmatter
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  if (!fm) {
    v(name, 'frontmatter', 'SKILL.md must start with a --- frontmatter block');
    continue;
  }
  const fields = Object.fromEntries(
    fm[1]
      .split(/\r?\n/)
      .map((l) => /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(l))
      .filter(Boolean)
      .map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, '')]),
  );
  const declared = fields.name || '';
  if (!declared) v(name, 'name', 'frontmatter is missing `name`');
  else {
    if (declared !== name) v(name, 'name-matches-dir', `name "${declared}" !== directory "${name}"`);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(declared)) v(name, 'name-charset', `"${declared}" must be hyphen-case [a-z0-9-]`);
    if (declared.length > 40) v(name, 'name-length', `${declared.length} chars > 40`);
  }

  // 3. description
  const desc = fields.description || '';
  if (!desc) v(name, 'description', 'frontmatter is missing `description`');
  else {
    if (/[<>]/.test(desc)) v(name, 'description-charset', 'description must not contain < or >');
    const thirdPerson = /^(Use this skill|This skill|Designed to|Create|Edit|Redesign)\b/i.test(desc);
    if (!thirdPerson) v(name, 'description-third-person', 'description should open third-person, e.g. "Use this skill when …"');
    const hasTriggers = /[，,]|trigger|when/i.test(desc);
    if (!hasTriggers) v(name, 'description-triggers', 'description must state trigger conditions');
  }

  // 4. budget
  const w = words(md);
  if (w > WORD_BUDGET) v(name, 'word-budget', `${w} words > ${WORD_BUDGET}; move knowledge into references/`);
  notes.push(`${name}: SKILL.md ${w} words`);

  // 5 + 6. routing table with on-disk targets
  const tableRows = md
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith('|') && l.includes('{SKILL_ROOT}'));
  const hasWhenToLoad = /When to load/i.test(md);
  if (!tableRows.length) v(name, 'routing-table', 'SKILL.md must contain a "Files — Load On Demand" table');
  else if (!hasWhenToLoad) v(name, 'routing-table', 'routing table must have a "When to load" column');
  for (const row of tableRows) {
    for (const m of row.matchAll(/\{SKILL_ROOT\}\/([^\s`|)]+)/g)) {
      const rel = m[1];
      if (!existsSync(path.join(dir, rel))) v(name, 'routing-target', `referenced file missing: ${rel}`);
    }
  }
  const refs = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(md|mjs|cjs|py)$/.test(e.name)) refs.push(p);
    }
  };
  walk(dir);
  const refFiles = refs.filter((p) => !p.endsWith('SKILL.md'));
  if (!refFiles.length) v(name, 'references', 'no references/ or scripts/ files — knowledge was not pushed out of SKILL.md');

  // 7. duplication
  const skillParas = new Set(paragraphs(md.replace(fm[0], '')));
  for (const f of refFiles.filter((p) => p.endsWith('.md'))) {
    for (const p of paragraphs(readFileSync(f, 'utf8'))) {
      if (skillParas.has(p)) {
        v(name, 'duplication', `paragraph duplicated between SKILL.md and ${path.relative(dir, f)}: "${p.slice(0, 60)}…"`);
      }
    }
  }
}

// family-level checks
const hasRouter = skillDirs.some((d) => /router/.test(path.basename(d)));
const cores = skillDirs.filter((d) => /^core-/.test(path.basename(d)));
const domains = skillDirs.filter((d) => /^domain-/.test(path.basename(d)));
if (!hasRouter) v('family', 'router', 'expected one *router* skill');
if (cores.length < 1) v('family', 'cores', 'expected at least one core-* skill');
if (!domains.length) notes.push('family: no domain-* skill present (cores-only deployment)');
if (!existsSync(path.join(skillsRoot, 'README.md'))) v('family', 'readme', 'skills/README.md (family index) is missing');

const out = { ok: violations.length === 0, skills: skillDirs.length, budget: WORD_BUDGET, notes, violations };
if (asJson) console.log(JSON.stringify(out, null, 2));
else {
  console.log(`validate-skills — ${skillDirs.length} skill(s) under ${path.relative(repoRoot, skillsRoot)}`);
  for (const n of notes) console.log(`  · ${n}`);
  if (violations.length) {
    console.log('\nVIOLATIONS:');
    for (const x of violations) console.log(`  ✗ [${x.skill}] ${x.rule}: ${x.detail}`);
    console.log(`\n${violations.length} violation(s).`);
  } else {
    console.log('\nOK: naming, frontmatter, budget, routing tables and non-duplication all pass.');
  }
}
process.exit(violations.length ? 1 : 0);
