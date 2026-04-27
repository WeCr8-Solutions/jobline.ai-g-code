#!/usr/bin/env node
/* eslint-env node */
/* global __dirname, process, console */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildVisualizerHarnessData, type VisualizerHarnessManifest } from '../src/providers/visualizer/fixtureHarness';
import { extractGCodeCutBounds, compareBounds } from '../src/providers/visualizer/gcodeGoalComparison';
import { parseParasolidText } from '../src/providers/visualizer/parasolidTextParser';
import { parseSTL } from '../src/providers/visualizer/stlParser';

const workspaceRoot = path.resolve(__dirname, '..');
const fixtureRoot = path.join(workspaceRoot, 'test', 'fixtures', 'revpack');
const manifestPath = path.join(fixtureRoot, 'revpack.visualizer-harness.json');
const outputPath = path.join(fixtureRoot, 'revpack.visualizer-harness-report.json');

function readArrayBuffer(filePath: string): ArrayBufferLike {
  const buffer = fs.readFileSync(filePath);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function resolveGoalModel(filePath: string) {
  if (filePath.toLowerCase().endsWith('.x_t')) {
    return {
      exists: fs.existsSync(filePath),
      format: 'parasolid-text',
      bounds: fs.existsSync(filePath) ? parseParasolidText(fs.readFileSync(filePath, 'utf8')).bounds : null,
    };
  }

  if (filePath.toLowerCase().endsWith('.stl')) {
    return {
      exists: fs.existsSync(filePath),
      format: 'stl',
      bounds: fs.existsSync(filePath) ? parseSTL(readArrayBuffer(filePath)).bounds : null,
    };
  }

  return {
    exists: false,
    format: 'unsupported',
    bounds: null,
  };
}

function main(): void {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as VisualizerHarnessManifest;
  const gcodePath = path.join(fixtureRoot, manifest.gcode);
  const xTPath = path.join(fixtureRoot, manifest.goalModels.parasolidText);
  const stlPath = manifest.goalModels.stl ? path.join(fixtureRoot, manifest.goalModels.stl) : null;

  const gcode = fs.readFileSync(gcodePath, 'utf8');
  const harness = buildVisualizerHarnessData(gcode, manifest.dialect);
  const gcodeEnvelope = extractGCodeCutBounds(gcode);

  const goalModels = [
    {
      label: 'parasolidText',
      path: xTPath,
      result: resolveGoalModel(xTPath),
    },
    ...(stlPath ? [{ label: 'stl', path: stlPath, result: resolveGoalModel(stlPath) }] : []),
  ].map(entry => ({
    ...entry,
    comparison: entry.result.bounds ? compareBounds(gcodeEnvelope.bounds, entry.result.bounds, 0.01) : null,
  }));

  const report = {
    manifest,
    setup: harness.setup,
    tools: harness.tools,
    gcodeEnvelope,
    goalModels,
  };

  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

  console.log(`Harness manifest: ${path.relative(workspaceRoot, manifestPath)}`);
  console.log(`Program: ${manifest.name}`);
  console.log(`Fixture mode: ${harness.setup.fixtureMode}`);
  console.log(`Machine type: ${harness.setup.machineType}`);
  console.log(`Work offsets: ${harness.setup.workOffsets.join(', ') || '(none)'}`);
  console.log(`Tools extracted: ${harness.tools.length}`);
  console.log(`Goal models: ${goalModels.map(model => `${model.label}=${model.result.exists ? 'present' : 'missing'}`).join(', ')}`);
  console.log(`Report: ${path.relative(workspaceRoot, outputPath)}`);
}

main();