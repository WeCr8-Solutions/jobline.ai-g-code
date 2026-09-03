#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildReviewArtifact } from './review-gcode';
import { compareBounds, extractGCodeCutBounds, type Bounds3D } from '../src/providers/visualizer/gcodeGoalComparison';
import { parseParasolidText } from '../src/providers/visualizer/parasolidTextParser';
import { parseSTL } from '../src/providers/visualizer/stlParser';

const root = path.resolve(__dirname, '..');
const fixtureRoot = path.join(root, 'test', 'fixtures');
const outputRoot = path.join(root, 'test-results', 'fixture-review');
const gcodeExtensions = new Set(['.nc', '.gcode', '.ngc', '.tap', '.cnc', '.mpf', '.spf', '.prg', '.min']);

function walk(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

function arrayBuffer(buffer: Buffer): ArrayBufferLike {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function solidBounds(file: string): Bounds3D {
  return path.extname(file).toLowerCase() === '.stl'
    ? parseSTL(arrayBuffer(fs.readFileSync(file))).bounds
    : parseParasolidText(fs.readFileSync(file, 'utf8')).bounds;
}

function dialectFor(file: string): string {
  const normalized = file.toLowerCase();
  if (normalized.includes(`${path.sep}siemens${path.sep}`)) return 'siemens';
  if (normalized.includes(`${path.sep}okuma${path.sep}`)) return 'okuma';
  return 'fanuc';
}

function main(): void {
  fs.mkdirSync(outputRoot, { recursive: true });
  const files = walk(fixtureRoot);
  const programs = files.filter(file => gcodeExtensions.has(path.extname(file).toLowerCase()));
  const solids = files.filter(file => ['.stl', '.x_t'].includes(path.extname(file).toLowerCase()));
  const explicitPairs = new Map<string, string>();
  explicitPairs.set(
    path.join(fixtureRoot, 'verification', 'rectangle-profile.nc'),
    path.join(fixtureRoot, 'verification', 'rectangle-profile-goal.stl'),
  );
  const revpackManifest = path.join(fixtureRoot, 'revpack', 'revpack.visualizer-harness.json');
  if (fs.existsSync(revpackManifest)) {
    const manifest = JSON.parse(fs.readFileSync(revpackManifest, 'utf8')) as { gcode: string; goalModels: { parasolidText: string } };
    explicitPairs.set(path.join(path.dirname(revpackManifest), manifest.gcode), path.join(path.dirname(revpackManifest), manifest.goalModels.parasolidText));
  }

  const results = programs.map(file => {
    const relative = path.relative(root, file);
    const gcode = fs.readFileSync(file, 'utf8');
    const artifact = buildReviewArtifact(relative, gcode, dialectFor(file));
    const solid = explicitPairs.get(file);
    const solidComparison = solid && fs.existsSync(solid) ? {
      solid: path.relative(root, solid),
      ...compareBounds(extractGCodeCutBounds(gcode).bounds, solidBounds(solid), 0.01),
    } : undefined;
    const outputName = relative.replace(/[\\/: ]+/g, '__').replace(/\.[^.]+$/, '.json');
    fs.writeFileSync(path.join(outputRoot, outputName), JSON.stringify({ ...artifact, solidComparison }, null, 2));
    return { file: relative, ...artifact.review.summary, pathPoints: artifact.program.pathPointCount, solidComparison };
  });

  const summary = {
    schema: 'jobline.fixture-review/v1',
    generatedAt: new Date().toISOString(),
    programs: results.length,
    solids: solids.map(file => path.relative(root, file)),
    pairedSolidChecks: results.filter(result => result.solidComparison).length,
    totals: {
      errors: results.reduce((sum, result) => sum + result.errors, 0),
      warnings: results.reduce((sum, result) => sum + result.warnings, 0),
      infos: results.reduce((sum, result) => sum + result.infos, 0),
    },
    results,
  };
  fs.writeFileSync(path.join(outputRoot, 'index.json'), JSON.stringify(summary, null, 2));
  console.log(`Reviewed ${summary.programs} programs against ${summary.solids.length} solid files.`);
  console.log(`Paired solid checks: ${summary.pairedSolidChecks}. Findings: ${summary.totals.errors} errors, ${summary.totals.warnings} warnings, ${summary.totals.infos} notes.`);
  console.log(`Index: ${path.relative(root, path.join(outputRoot, 'index.json'))}`);

  if (process.argv.includes('--fail-on-errors') && summary.totals.errors > 0) process.exitCode = 1;
}

main();
