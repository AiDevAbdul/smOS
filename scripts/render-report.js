#!/usr/bin/env node
/**
 * render-report.js — generate a self-contained HTML report from a template + JSON data
 *
 * Usage:
 *   node scripts/render-report.js --type pre-audit --slug bluersoeauto
 *   node scripts/render-report.js --type audit     --slug blue-rose-auto
 *
 * Output: public/reports/<slug>/<date>-<type>.html
 * Also updates public/reports/index.json with the new entry.
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
function getArg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}

const type = getArg('--type');   // 'pre-audit' | 'audit'
const slug = getArg('--slug');   // client/prospect slug
const date = getArg('--date') || new Date().toISOString().slice(0, 10);

if (!type || !slug) {
  console.error('Usage: node scripts/render-report.js --type <pre-audit|audit> --slug <slug>');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');

// ── Locate source JSON ──
function findSourceJson(t, s) {
  if (t === 'pre-audit') {
    const candidates = [
      path.join(ROOT, 'prospects', s, 'page_audit.json'),
      path.join(ROOT, 'prospects', s, 'pre_audit.json'),
    ];
    for (const c of candidates) if (fs.existsSync(c)) return c;
    throw new Error(`No pre-audit JSON found for prospect: ${s}`);
  }
  if (t === 'audit') {
    const candidates = [
      path.join(ROOT, 'clients', s, 'audit_raw.json'),
    ];
    for (const c of candidates) if (fs.existsSync(c)) return c;
    throw new Error(`No audit_raw.json found for client: ${s}`);
  }
  throw new Error(`Unknown report type: ${t}`);
}

const templateMap = {
  'pre-audit': 'pre-audit-report.html',
  'audit':     'audit-report.html',
};
const templateFile = templateMap[type];
if (!templateFile) { console.error(`Unknown type: ${type}`); process.exit(1); }

const templatePath = path.join(ROOT, 'templates', templateFile);
if (!fs.existsSync(templatePath)) { console.error(`Template not found: ${templatePath}`); process.exit(1); }

const jsonPath = findSourceJson(type, slug);
const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

const clientName =
  data.business_name ||
  data.organic?.facebook?.page_name ||
  data.slug ||
  slug;

// ── Render ──
let html = fs.readFileSync(templatePath, 'utf8');
// Use a replacer function to prevent JSON $ signs from being treated as regex backreferences
html = html.replace('__CLIENT_NAME__', () => clientName);
html = html.replace('__REPORT_DATA__', () => JSON.stringify(data));

// ── Write output ──
const outDir = path.join(ROOT, 'public', 'reports', slug);
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${date}-${type}.html`);
fs.writeFileSync(outFile, html);
console.log(`✓  Report written: ${path.relative(ROOT, outFile)}`);

// ── Update index.json ──
const indexPath = path.join(ROOT, 'public', 'reports', 'index.json');
let index = [];
if (fs.existsSync(indexPath)) {
  try { index = JSON.parse(fs.readFileSync(indexPath, 'utf8')); } catch {}
}
const entry = {
  slug,
  type,
  date,
  client: clientName,
  url: `/reports/${slug}/${date}-${type}.html`,
  generated_at: new Date().toISOString(),
};
const existing = index.findIndex(e => e.slug === slug && e.type === type && e.date === date);
if (existing !== -1) index[existing] = entry;
else index.unshift(entry);
fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
console.log(`✓  Index updated: ${index.length} report(s)`);
console.log(`\n→  Deploy path: /reports/${slug}/${date}-${type}.html`);
