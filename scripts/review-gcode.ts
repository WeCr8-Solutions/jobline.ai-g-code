#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildVisualizerHarnessData } from '../src/providers/visualizer/fixtureHarness';
import { reviewGCodeProgram } from '../src/providers/visualizer/programReview';
import { parseGCodeToPath } from '../src/providers/visualizer/toolpathParser';

interface ReviewArtifact {
  schema: 'jobline.gcode-review/v1';
  generatedAt: string;
  source: { file: string; dialect: string };
  program: {
    number?: string;
    units: 'in' | 'mm';
    machineType: string;
    workOffsets: string[];
    operationCount: number;
    pathPointCount: number;
  };
  stock?: { width: number; depth: number; height: number };
  tools: ReturnType<typeof buildVisualizerHarnessData>['tools'];
  review: ReturnType<typeof reviewGCodeProgram>;
}

function usage(): never {
  console.error('Usage: npm run review:gcode -- <program.nc> [--dialect fanuc] [--json output.json]');
  process.exit(2);
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export function buildReviewArtifact(file: string, gcode: string, dialect: string): ReviewArtifact {
  const harness = buildVisualizerHarnessData(gcode, dialect);
  const toolpath = parseGCodeToPath(gcode);
  return {
    schema: 'jobline.gcode-review/v1',
    generatedAt: new Date().toISOString(),
    source: { file, dialect },
    program: {
      number: harness.setup.programNumber,
      units: toolpath.units,
      machineType: harness.setup.machineType,
      workOffsets: harness.setup.workOffsets,
      operationCount: harness.setup.operationCount,
      pathPointCount: toolpath.path.length,
    },
    stock: harness.setup.stockDimensions,
    tools: harness.tools,
    review: reviewGCodeProgram(gcode, dialect),
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const input = args.find(arg => !arg.startsWith('--') && !['fanuc', 'haas', 'siemens', 'mazak', 'okuma'].includes(arg));
  if (!input) usage();
  const inputPath = path.resolve(input);
  if (!fs.existsSync(inputPath)) {
    console.error(`G-code file not found: ${inputPath}`);
    process.exit(2);
  }

  const dialect = option(args, '--dialect') ?? 'fanuc';
  const artifact = buildReviewArtifact(inputPath, fs.readFileSync(inputPath, 'utf8'), dialect);
  const json = JSON.stringify(artifact, null, 2);
  const output = option(args, '--json');
  if (output) fs.writeFileSync(path.resolve(output), json, 'utf8');
  else console.log(json);

  const { errors, warnings, infos } = artifact.review.summary;
  console.error(`JobLine review: ${errors} errors, ${warnings} warnings, ${infos} notes; ${artifact.program.pathPointCount} path points`);
  if (errors > 0) process.exitCode = 1;
}

if (require.main === module) main();
