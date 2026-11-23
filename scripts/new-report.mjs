#!/usr/bin/env node
// Create docs/ai/reports/YYYY-MM-DD-<slug>.md from the template.
// Usage: pnpm report:new -- <slug>
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const slug = process.argv.slice(2).filter((a) => a !== '--')[0];

if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
  console.error('new-report: provide a kebab-case slug, e.g. `pnpm report:new -- reel-tease-polish`');
  process.exit(1);
}

const now = new Date();
const date = now.toISOString().slice(0, 10);
const target = resolve(root, `docs/ai/reports/${date}-${slug}.md`);
if (existsSync(target)) {
  console.error(`new-report: ${target} already exists`);
  process.exit(1);
}

const template = readFileSync(resolve(root, 'docs/ai/reports/_TEMPLATE.md'), 'utf8');
const body = template
  .replaceAll('{{DATE}}', date)
  .replaceAll('{{TIMESTAMP}}', now.toISOString().replace(/\.\d{3}Z$/, 'Z'))
  .replaceAll('{{SLUG}}', slug);

writeFileSync(target, body);
console.log(`Created ${target}`);
