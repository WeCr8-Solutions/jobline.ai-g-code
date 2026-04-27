#!/usr/bin/env node
/* eslint-env node */
/* global __dirname, process, console */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractGCodeCutBounds, compareBounds } from '../src/providers/visualizer/gcodeGoalComparison';
import { parseParasolidText } from '../src/providers/visualizer/parasolidTextParser';
import { parseSTL } from '../src/providers/visualizer/stlParser';

const workspaceRoot = path.resolve(__dirname, '..');
const defaultGcodePath = path.join(workspaceRoot, 'test', 'fixtures', 'verification', 'rectangle-profile.nc');
const defaultStlPath = path.join(workspaceRoot, 'test', 'fixtures', 'verification', 'rectangle-profile-goal.stl');

const gcodePath = process.argv[2] ? path.resolve(process.argv[2]) : defaultGcodePath;
const stlPath = process.argv[3] ? path.resolve(process.argv[3]) : defaultStlPath;
const tolerance = process.argv[4] ? Number.parseFloat(process.argv[4]) : 0.001;

const targetExtension = path.extname(stlPath).toLowerCase();
if (targetExtension !== '.stl' && targetExtension !== '.x_t') {
  if (targetExtension === '.x_b') {
    throw new Error(`Parasolid binary targets are not supported yet. Export ${path.basename(stlPath)} to .x_t or STL and rerun the comparison.`);
  }

  throw new Error(`Unsupported target model format: ${targetExtension || '(none)'}. Expected an STL or Parasolid text (.x_t) file.`);
}

const gcode = fs.readFileSync(gcodePath, 'utf8');
const envelope = extractGCodeCutBounds(gcode);
const modelBounds = targetExtension === '.stl'
  ? (() => {
      const stlBuffer = fs.readFileSync(stlPath);
      return parseSTL(stlBuffer.buffer.slice(stlBuffer.byteOffset, stlBuffer.byteOffset + stlBuffer.byteLength));
    })()
  : parseParasolidText(fs.readFileSync(stlPath, 'utf8'));
const comparison = compareBounds(envelope.bounds, modelBounds.bounds, tolerance);

console.log(`G-code fixture: ${path.relative(workspaceRoot, gcodePath)}`);
console.log(`Goal model: ${path.relative(workspaceRoot, stlPath)}`);
console.log(`Units: ${envelope.units}`);
console.log(`Cut moves: ${envelope.cutMoveCount}`);
console.log(`Tolerance: ${tolerance}`);
console.log('G-code bounds:', envelope.bounds);
console.log('Goal bounds:', modelBounds.bounds);
console.log('Axis deltas:', comparison.deltas);

if (!comparison.matches) {
  console.error('Result: FAIL - G-code cut envelope does not match target model bounds');
  process.exit(1);
}

console.log('Result: PASS - G-code cut envelope matches target model bounds');