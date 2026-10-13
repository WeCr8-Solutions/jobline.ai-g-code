#!/usr/bin/env node
/* eslint-env node */
/*
 * Regenerates the Commands and Settings tables in README.md from package.json
 * (contributes.commands / contributes.configuration), so the Marketplace
 * listing never drifts from what the extension actually contributes.
 *
 *   node scripts/gen-readme-tables.cjs          rewrite README.md in place
 *   node scripts/gen-readme-tables.cjs --check  exit 1 if README.md is stale
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const readmePath = path.join(root, 'README.md');
const readme = fs.readFileSync(readmePath, 'utf8');
const eol = readme.includes('\r\n') ? '\r\n' : '\n';

const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const code = (s) => '`' + String(s).replace(/`/g, "'") + '`';

const hidden = new Set(
  ((pkg.contributes.menus || {}).commandPalette || [])
    .filter((m) => m.when === 'false')
    .map((m) => m.command),
);

const GROUPS = [
  ['Machine presets', (id) => id.startsWith('jobline.presets.') || id === 'jobline.selectControl' || id === 'jobline.selectMachineType'],
  ['Check, explain and format', (id) => ['jobline.validateProgram', 'jobline.formatDocument', 'jobline.openExplainer', 'jobline.insertStockHeader'].includes(id)],
  ['Toolpath visualizer and simulation', (id) => id.startsWith('jobline.gcode.') || id.startsWith('jobline.openSimulation') || id === 'jobline.openToolPreview'],
  ['Toolbox (program edits)', (id) => id.startsWith('jobline.toolbox.')],
  ['Sidebar navigation and tools', (id) => id.startsWith('jobline.sidebar.') || id.startsWith('jobline.tools.')],
];

function commandsTable() {
  const cmds = pkg.contributes.commands;
  const used = new Set();
  const out = [];
  for (const [title, match] of GROUPS) {
    const rows = cmds.filter((c) => !used.has(c.command) && match(c.command));
    if (!rows.length) continue;
    rows.forEach((c) => used.add(c.command));
    out.push(`**${title}**`, '', '| Command | ID |', '| --- | --- |');
    for (const c of rows) {
      const note = hidden.has(c.command) ? ' (sidebar menu only)' : '';
      out.push(`| ${esc(c.title)}${note} | ${code(c.command)} |`);
    }
    out.push('');
  }
  const rest = cmds.filter((c) => !used.has(c.command));
  if (rest.length) {
    out.push('**Other**', '', '| Command | ID |', '| --- | --- |');
    for (const c of rest) out.push(`| ${esc(c.title)} | ${code(c.command)} |`);
    out.push('');
  }
  out.push(`_${cmds.length} commands, generated from package.json for v${pkg.version}._`);
  return out.join(eol);
}

function settingsTable() {
  const cfg = Array.isArray(pkg.contributes.configuration) ? pkg.contributes.configuration : [pkg.contributes.configuration];
  const out = ['| Setting | Default | Description |', '| --- | --- | --- |'];
  let n = 0;
  for (const section of cfg) {
    for (const [key, p] of Object.entries(section.properties || {})) {
      n++;
      let desc = p.markdownDescription || p.description || '';
      if (p.enum) desc += ` Values: ${p.enum.map(code).join(', ')}.`;
      out.push(`| ${code(key)} | ${code(JSON.stringify(p.default === undefined ? null : p.default))} | ${esc(desc)} |`);
    }
  }
  out.push('', `_${n} settings, generated from package.json for v${pkg.version}._`);
  return out.join(eol);
}

function replaceBlock(text, name, body) {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  const i = text.indexOf(start);
  const j = text.indexOf(end);
  if (i < 0 || j < 0) throw new Error(`README.md is missing ${start} / ${end} markers`);
  return text.slice(0, i + start.length) + eol + eol + body + eol + eol + text.slice(j);
}

let next = replaceBlock(readme, 'commands', commandsTable());
next = replaceBlock(next, 'settings', settingsTable());

if (process.argv.includes('--check')) {
  if (next !== readme) {
    console.error('README.md command/setting tables are stale: run node scripts/gen-readme-tables.cjs');
    process.exit(1);
  }
  console.log('README.md tables match package.json');
} else {
  fs.writeFileSync(readmePath, next);
  console.log('README.md tables regenerated from package.json');
}
