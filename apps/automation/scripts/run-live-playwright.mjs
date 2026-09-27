#!/usr/bin/env node
/**
 * Single-process LIVE / LIVE_DEMO Playwright runner.
 * Reads a JSON selection file (no shell concatenation of user input).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function parseArgs(argv) {
  let selectionPath = process.env.QA_LIVE_SELECTION_PATH || '';
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--selection' && argv[i + 1]) {
      selectionPath = argv[i + 1];
      i += 1;
    }
  }
  return selectionPath;
}

function buildPositiveGrep(flowIds, excludeTags) {
  const tags = flowIds.map((id) => `@${id.replace(/^@/, '')}`);
  const tagAlt = tags.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  let pattern = `(?=.*(?:${tagAlt}))(?=.*@positive)`;
  for (const ex of excludeTags) {
    const esc = ex.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pattern += `(?!.*${esc})`;
  }
  return pattern;
}

function buildNegativeGrep(flowIds, excludeTags) {
  const tags = flowIds.map((id) => `@${id.replace(/^@/, '')}`);
  const tagAlt = tags.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  let pattern = `(?=.*(?:${tagAlt}))(?=.*@negative)`;
  for (const ex of excludeTags) {
    const esc = ex.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pattern += `(?!.*${esc})`;
  }
  return pattern;
}

const selectionPath = parseArgs(process.argv.slice(2));
if (!selectionPath || !fs.existsSync(selectionPath)) {
  console.error('Missing or invalid --selection file for run-live-playwright.mjs');
  process.exit(2);
}

let payload;
try {
  payload = JSON.parse(fs.readFileSync(selectionPath, 'utf8'));
} catch {
  console.error('Invalid JSON selection file');
  process.exit(2);
}

const flows = Array.isArray(payload.flows) ? payload.flows : [];
if (!flows.length) {
  console.error('Selection file has no flows');
  process.exit(2);
}

const excludeTags = Array.isArray(payload.grep_exclude_tags) ? payload.grep_exclude_tags : ['@param-test'];
const polarities = new Set(flows.map((f) => f.polarity));
if (polarities.size !== 1) {
  console.error('Mixed polarities in one live selection are not supported');
  process.exit(2);
}

const polarity = [...polarities][0];
const flowIds = flows.map((f) => f.flow_id);
const grep =
  polarity === 'negative'
    ? buildNegativeGrep(flowIds, excludeTags)
    : buildPositiveGrep(flowIds, excludeTags);

console.error('LIVE_RUN:RUN_START collapsed_selection');
const playwrightArgs = ['playwright', 'test', '--grep', grep, '--workers=1'];
const result = spawnSync('npx', playwrightArgs, {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});

console.error(`LIVE_RUN:RUN_END exit=${result.status ?? 1}`);
process.exit(result.status ?? 1);
