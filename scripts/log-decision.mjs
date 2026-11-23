#!/usr/bin/env node
// Append one validated entry to docs/ai/decision-log.jsonl.
// Usage: pnpm log:decision -- --actor agent --area engine --decision "…" --rationale "…" \
//          --files a.ts,b.ts --tradeoffs "…"
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const logPath = resolve(root, 'docs/ai/decision-log.jsonl');

const ACTORS = ['human', 'agent'];
const REQUIRED = ['actor', 'area', 'decision', 'rationale', 'files', 'tradeoffs'];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (!arg.startsWith('--')) fail(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) fail(`Missing value for --${key}`);
    out[key] = value;
    i++;
  }
  return out;
}

function fail(msg) {
  console.error(`log-decision: ${msg}`);
  console.error('Required: ' + REQUIRED.map((k) => `--${k}`).join(' '));
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
for (const key of REQUIRED) if (!args[key]?.trim()) fail(`--${key} is required`);
if (!ACTORS.includes(args.actor)) fail(`--actor must be one of ${ACTORS.join(', ')}`);

const entry = {
  timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  actor: args.actor,
  area: args.area.trim(),
  decision: args.decision.trim(),
  rationale: args.rationale.trim(),
  filesTouched: args.files.split(',').map((f) => f.trim()).filter(Boolean),
  tradeoffs: args.tradeoffs.trim(),
};

// Guard: the existing log must still be valid JSONL before we append to it.
if (existsSync(logPath)) {
  const lines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
  lines.forEach((line, i) => {
    try {
      JSON.parse(line);
    } catch {
      fail(`decision-log.jsonl line ${i + 1} is not valid JSON; fix it before appending`);
    }
  });
}

appendFileSync(logPath, JSON.stringify(entry) + '\n');
console.log(`Logged ${entry.timestamp} [${entry.area}] ${entry.decision}`);
