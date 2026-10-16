#!/usr/bin/env node
/* eslint-env node */
/* global __dirname, process, console */
/**
 * RevPack end-to-end harness.
 *
 * For every RevPack under test/fixtures/revpack-public/ (committed, synthetic)
 * and test/fixtures/revpack/ (private, gitignored, optional):
 *   1. validate the pack (target, stock, workholding, offsets, tools, machine)
 *   2. step the program against it (revpackCorrelation)
 *   3. check the outcome against the pack's `expect`
 *   4. write qa/revpack-e2e/<id>.after.svg, <id>.before.svg, report.json and
 *      SUMMARY.md
 *
 * Exits 1 when any pack fails validation or its expectation. A private v1
 * manifest (the old revpack.visualizer-harness.json: program + goal model,
 * fixtureMode 'none') is reported as needing an upgrade, not silently passed.
 *
 *   npm run revpack:e2e
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { validateRevPack, type RevPack } from '../src/providers/visualizer/revpack';
import { correlateProgramWithRevPack } from '../src/providers/visualizer/revpackCorrelation';
import { renderCorrelationSvg } from '../src/providers/visualizer/revpackPlot';
import { parseSTL } from '../src/providers/visualizer/stlParser';
import { buildVisualizerHarnessData } from '../src/providers/visualizer/fixtureHarness';
import { buildRevPackSimulationMessages } from '../src/providers/visualizer/simulationSetup';

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'qa', 'revpack-e2e');
const sources = [
  path.join(root, 'test', 'fixtures', 'revpack-public'),
  path.join(root, 'test', 'fixtures', 'revpack'),
];

interface PackResult {
  id: string;
  dir: string;
  ok: boolean;
  problems: string[];
  summary?: unknown;
  findings?: unknown;
}

function packDirs(base: string): string[] {
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base)
    .map(name => path.join(base, name))
    .filter(dir => fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, 'revpack.json')));
}

function targetBounds(dir: string, pack: RevPack) {
  if (!pack.target || pack.target.format !== 'stl') return null;
  const file = path.join(dir, pack.target.file);
  if (!fs.existsSync(file)) return null;
  const buffer = fs.readFileSync(file);
  const bounds = parseSTL(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)).bounds;
  return { min: [bounds.minX, bounds.minY, bounds.minZ] as [number, number, number], max: [bounds.maxX, bounds.maxY, bounds.maxZ] as [number, number, number] };
}

function main(): void {
  fs.mkdirSync(outDir, { recursive: true });
  const results: PackResult[] = [];

  // Old v1 private manifest: say plainly that it carries no setup.
  const v1 = path.join(root, 'test', 'fixtures', 'revpack', 'revpack.visualizer-harness.json');
  if (fs.existsSync(v1)) {
    results.push({
      id: 'private-v1-manifest', dir: path.dirname(v1), ok: false,
      problems: ['v1 manifest has no stock, workholding, work-offset locations, tool lengths or machine; convert it to jobline.revpack/2'],
    });
  }

  for (const dir of sources.flatMap(packDirs)) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'revpack.json'), 'utf8'));
    const validation = validateRevPack(raw);
    if (!validation.ok) {
      results.push({ id: raw.id ?? path.basename(dir), dir, ok: false, problems: validation.errors });
      continue;
    }
    const pack = raw as RevPack;
    const problems: string[] = [];
    const programPath = path.join(dir, pack.program.file);
    if (!fs.existsSync(programPath)) {
      results.push({ id: pack.id, dir, ok: false, problems: [`program ${pack.program.file} not found`] });
      continue;
    }
    if (pack.target && !fs.existsSync(path.join(dir, pack.target.file))) problems.push(`target ${pack.target.file} not found`);
    const gcode = fs.readFileSync(programPath, 'utf8');
    const report = correlateProgramWithRevPack(gcode, pack);

    // The visualizer is fed from the pack, not guessed from the program.
    const harness = buildVisualizerHarnessData(gcode, pack.program.dialect);
    const setupMessages = buildRevPackSimulationMessages(pack, harness.tools);
    if (!setupMessages.some(message => message.type === 'stockSettings')) problems.push('visualizer setup has no stock');

    if (pack.expect?.clean && !report.summary.pass) {
      problems.push(`expected a clean run, got ${report.summary.errors} error(s): ${report.findings.filter(f => f.severity === 'error').map(f => f.id).join(', ')}`);
    }
    for (const id of pack.expect?.findingIds ?? []) {
      if (!report.findings.some(finding => finding.id === id || finding.id.startsWith(`${id}`))) problems.push(`expected finding ${id} was not raised`);
    }

    const bounds = targetBounds(dir, pack);
    fs.writeFileSync(path.join(outDir, `${pack.id}.after.svg`), renderCorrelationSvg(pack, report, { targetBounds: bounds }));
    fs.writeFileSync(path.join(outDir, `${pack.id}.before.svg`), renderCorrelationSvg(pack, report, {
      mode: 'before',
      title: `${pack.name} — old harness view`,
      beforeNotes: [
        `Old harness output for this program: fixtureMode=none, machineType=${harness.setup.machineType}, work offsets ${harness.setup.workOffsets.join(', ') || '(none)'}, ${harness.tools.length} tools parsed from comments.`,
        'Not loaded: stock, workholding, where the work offset sits on the machine, tool gauge lengths, machine axes/limits/kinematics.',
        'Not checked: travel limits, rapids into stock or workholding, H vs T, spindle/feed state, tool-change retracts, TCPC.',
        `The same program checked against its RevPack now: ${report.summary.errors} error(s), ${report.summary.warnings} warning(s).`,
      ],
    }));
    results.push({ id: pack.id, dir: path.relative(root, dir), ok: problems.length === 0, problems, summary: report.summary, findings: report.findings });
  }

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(results, null, 2));
  const lines = ['# RevPack E2E harness', '', '| Pack | Result | Errors | Warnings | Problems |', '| --- | --- | --- | --- | --- |'];
  for (const result of results) {
    const summary = result.summary as { errors: number; warnings: number } | undefined;
    lines.push(`| ${result.id} | ${result.ok ? 'PASS' : 'FAIL'} | ${summary?.errors ?? '-'} | ${summary?.warnings ?? '-'} | ${result.problems.join('; ') || ''} |`);
  }
  fs.writeFileSync(path.join(outDir, 'SUMMARY.md'), `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
  if (results.some(result => !result.ok && result.id !== 'private-v1-manifest')) process.exitCode = 1;
}

main();
