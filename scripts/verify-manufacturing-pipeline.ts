#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildVisualizerHarnessData } from '../src/providers/visualizer/fixtureHarness';
import { parseGCodeToPath } from '../src/providers/visualizer/toolpathParser';
import { parseSTL } from '../src/providers/visualizer/stlParser';
import { parseParasolidText } from '../src/providers/visualizer/parasolidTextParser';

type StageStatus = 'pass' | 'partial' | 'fail';
interface Stage { id: string; status: StageStatus; evidence: string }

const root = path.resolve(__dirname, '..');
const positionalArgs = process.argv.slice(2).filter(argument => !argument.startsWith('--'));
const gcodeFile = path.resolve(positionalArgs[0] || path.join(root, 'test/fixtures/verification/rectangle-profile.nc'));
const modelFile = path.resolve(positionalArgs[1] || path.join(root, 'test/fixtures/verification/rectangle-profile-goal.stl'));
const reportOnly = process.argv.includes('--report-only');

function loadModel(file: string): { format: string; triangles?: number } {
  const extension = path.extname(file).toLowerCase();
  if (extension === '.stl') {
    const source = fs.readFileSync(file);
    const parsed = parseSTL(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
    return { format: `STL (${parsed.format})`, triangles: parsed.triangleCount };
  }
  if (extension === '.x_t') {
    parseParasolidText(fs.readFileSync(file, 'utf8'));
    return { format: 'Parasolid text' };
  }
  throw new Error(`${extension || 'Unknown'} model loading is not implemented. Native STEP/STP and binary Parasolid require a geometry kernel.`);
}

function main(): void {
  const stages: Stage[] = [];
  const gcode = fs.readFileSync(gcodeFile, 'utf8');
  const parsed = parseGCodeToPath(gcode);
  stages.push({ id: 'gcode-load', status: parsed.path.length > 1 ? 'pass' : 'fail', evidence: `${parsed.path.length} simulated path points (${parsed.units})` });

  const harness = buildVisualizerHarnessData(gcode);
  stages.push({
    id: 'tool-extraction',
    status: harness.tools.length > 0 ? 'pass' : 'fail',
    evidence: harness.tools.length > 0
      ? harness.tools.map(tool => `T${tool.toolNumber} ${tool.type} Ø${tool.diameter} ${tool.unit}`).join(', ')
      : 'No buildable tool definitions were extracted',
  });

  try {
    const model = loadModel(modelFile);
    stages.push({ id: 'goal-model-load', status: 'pass', evidence: `${model.format}${model.triangles === undefined ? '' : `, ${model.triangles} triangles`}` });
  } catch (error) {
    stages.push({ id: 'goal-model-load', status: 'fail', evidence: String(error) });
  }

  stages.push({
    id: 'material-removal',
    status: 'fail',
    evidence: 'No geometric stock-removal engine is connected; swept-tube rendering is visualization only.',
  });
  stages.push({
    id: 'result-solid-export',
    status: 'fail',
    evidence: 'No simulated in-process stock mesh exists to export as STL or STEP.',
  });
  stages.push({
    id: 'target-conformance',
    status: 'partial',
    evidence: 'Bounds comparison exists, but surface deviation, gouge, excess-stock, collision, and topology checks do not.',
  });

  const complete = stages.every(stage => stage.status === 'pass');
  const report = {
    schema: 'jobline.manufacturing-pipeline-verification/v1',
    complete,
    inputs: { gcode: path.relative(root, gcodeFile), goalModel: path.relative(root, modelFile) },
    stages,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!complete && !reportOnly) process.exitCode = 1;
}

main();
