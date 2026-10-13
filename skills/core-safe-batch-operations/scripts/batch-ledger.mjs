#!/usr/bin/env node
/**
 * batch-ledger.mjs — validate and summarise a batch-run ledger.
 *
 * Portable: knows nothing about any specific application. It only requires that each
 * record follows the ledger schema documented in `references/idempotent-runner.md`.
 *
 * Usage:
 *   node batch-ledger.mjs <ledger.jsonl> [--contract <entities.json>] [--json] [--strict]
 *
 *   --contract  JSON array (or {entities:[...]}) of {key,...} — checks coverage (missing entities).
 *   --strict    exit 1 unless every key is verified | already-done and there are no schema errors.
 *               Without it, exit 1 only on schema errors.
 *
 * Exit codes: 0 = ok, 1 = schema/coverage/gate failure, 2 = usage error.
 */
import { readFileSync } from 'node:fs';

const REQUIRED = ['key', 'label', 'fingerprint', 'precheck', 'action', 'effect', 'at'];
const TERMINAL_OK = new Set(['verified', 'already-done', 'done-on-recheck']);
const TERMINAL_NEEDS_HUMAN = new Set(['unverified', 'failed', 'mismatch', 'needs-human']);

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('usage: node batch-ledger.mjs <ledger.jsonl> [--contract <entities.json>] [--json] [--strict]');
  process.exit(2);
}
const flag = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};
const contractPath = flag('contract');
const asJson = args.includes('--json');
const strict = args.includes('--strict');

const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim());
const records = [];
const schemaErrors = [];

lines.forEach((line, i) => {
  let rec;
  try {
    rec = JSON.parse(line);
  } catch (e) {
    schemaErrors.push(`line ${i + 1}: invalid JSON (${e.message})`);
    return;
  }
  const missing = REQUIRED.filter((k) => rec[k] === undefined || rec[k] === null || rec[k] === '');
  if (missing.length) schemaErrors.push(`line ${i + 1}: missing ${missing.join(', ')}`);
  const effect = String(rec.effect ?? '').split(':')[0].trim();
  if (!TERMINAL_OK.has(effect) && !TERMINAL_NEEDS_HUMAN.has(effect)) {
    schemaErrors.push(`line ${i + 1}: non-terminal effect "${rec.effect}"`);
  }
  records.push({ ...rec, _effect: effect, _line: i + 1 });
});

// latest record per key wins
const latest = new Map();
for (const r of records) latest.set(String(r.key), r);

const byEffect = {};
for (const r of latest.values()) byEffect[r._effect] = (byEffect[r._effect] ?? 0) + 1;

const needsHuman = [...latest.values()].filter((r) => TERMINAL_NEEDS_HUMAN.has(r._effect));
const multiAttempt = [...new Set(records.map((r) => String(r.key)))].filter(
  (k) => records.filter((r) => String(r.key) === k).length > 1,
);

let contractKeys = null;
let missingFromLedger = [];
if (contractPath) {
  const parsed = JSON.parse(readFileSync(contractPath, 'utf8'));
  const entities = Array.isArray(parsed) ? parsed : parsed.entities || [];
  contractKeys = entities.map((e) => String(e.key ?? e.id ?? e.UID ?? '')).filter(Boolean);
  missingFromLedger = contractKeys.filter((k) => !latest.has(k));
}

const okCount = [...latest.values()].filter((r) => TERMINAL_OK.has(r._effect)).length;
const summary = {
  ledger: file,
  records: records.length,
  entities: latest.size,
  byEffect,
  ok: okCount,
  needsHuman: needsHuman.map((r) => ({ key: r.key, label: r.label, effect: r._effect, line: r._line })),
  reattemptedKeys: multiAttempt,
  contractEntities: contractKeys ? contractKeys.length : null,
  missingFromLedger,
  schemaErrors,
};

const gateFailures = [];
if (schemaErrors.length) gateFailures.push(`${schemaErrors.length} schema error(s)`);
if (missingFromLedger.length) gateFailures.push(`${missingFromLedger.length} contract entit(ies) absent from the ledger`);
if (strict && needsHuman.length) gateFailures.push(`${needsHuman.length} entit(ies) not terminal-ok`);

if (asJson) {
  console.log(JSON.stringify({ ...summary, gateFailures }, null, 2));
} else {
  console.log(`ledger: ${file}`);
  console.log(`records ${records.length} · entities ${latest.size}${contractKeys ? ` · contract ${contractKeys.length}` : ''}`);
  console.log(`terminal-ok ${okCount}${needsHuman.length ? ` · needs-human ${needsHuman.length}` : ''}`);
  for (const [k, v] of Object.entries(byEffect)) console.log(`  ${k.padEnd(18)} ${v}`);
  if (multiAttempt.length) console.log(`re-attempted keys: ${multiAttempt.length}`);
  if (needsHuman.length) {
    console.log('\nneeds human:');
    for (const r of needsHuman.slice(0, 20)) console.log(`  ${r.key}  ${r.label}  ${r._effect}  (line ${r._line})`);
    if (needsHuman.length > 20) console.log(`  … ${needsHuman.length - 20} more`);
  }
  if (missingFromLedger.length) {
    console.log(`\nabsent from ledger (${missingFromLedger.length}): ${missingFromLedger.slice(0, 20).join(', ')}${missingFromLedger.length > 20 ? ' …' : ''}`);
  }
  if (schemaErrors.length) {
    console.log('\nschema errors:');
    for (const e of schemaErrors.slice(0, 20)) console.log(`  ${e}`);
  }
  console.log(gateFailures.length ? `\nGATE FAIL — ${gateFailures.join('; ')}` : '\nGATE PASS — ledger is complete and terminal-ok');
}

process.exit(gateFailures.length ? 1 : 0);
