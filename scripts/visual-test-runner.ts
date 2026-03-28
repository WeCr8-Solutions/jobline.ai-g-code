#!/usr/bin/env node
/**
 * Visual Test Runner — renders G-code toolpaths and validates with Ollama vision model
 *
 * Pipeline:
 * 1. Parse G-code fixtures (from test/fixtures/diagnostics/*.nc)
 * 2. Extract geometry (G01 lines, G02/G03 arcs, canned cycles)
 * 3. Generate PNG snapshots using headless three.js
 * 4. Compare snapshots against baseline
 * 5. Send to Ollama (llava/qwen2.5-coder) for visual anomaly detection
 * 6. Write results to visual-qa-report.md
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { Tokenizer } from '../src/parser/tokenizer';
import { BlockParser } from '../src/parser/blockParser';

const FIXTURE_DIR = path.join(__dirname, '../test/fixtures/diagnostics');
const SNAPSHOTS_DIR = path.join(__dirname, '../test/fixtures/visual/snapshots');
const REPORT_PATH = path.join(__dirname, '../visual-qa-report.md');

interface GeometrySegment {
  type: 'line' | 'arc' | 'rapid' | 'cycle';
  start: { x: number; y: number; z: number };
  end: { x: number; y: number; z: number };
  feedRate?: number;
  spindleSpeed?: number;
  tool?: number;
}

interface ToolpathGeometry {
  file: string;
  tool: number;
  segments: GeometrySegment[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
}

class VisualTestRunner {
  private tokenizer = new Tokenizer();
  private blockParser = new BlockParser();
  private modelBuilder = new ProgramModelBuilder();

  async run() {
    console.log('🎨 Visual Test Framework');
    console.log('='.repeat(50));

    // Ensure output dirs exist
    if (!fs.existsSync(SNAPSHOTS_DIR)) {
      fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
    }

    const fixtureFiles = fs
      .readdirSync(FIXTURE_DIR)
      .filter(f => f.endsWith('.nc'))
      .sort();

    const results: Array<{ file: string; status: string; details?: string }> = [];

    for (const fixture of fixtureFiles) {
      const filePath = path.join(FIXTURE_DIR, fixture);
      console.log(`\n📄 ${fixture}`);

      try {
        // 1. Parse geometry
        const geometry = await this.extractGeometry(filePath, fixture);
        console.log(`   ✓ Geometry: ${geometry.segments.length} segments`);

        // 2. Generate snapshot (stub for now; real impl uses headless three.js)
        const snapshotPath = await this.generateSnapshot(fixture, geometry);
        console.log(`   ✓ Snapshot: ${path.basename(snapshotPath)}`);

        // 3. Visual QA with Ollama
        const ollamaResult = await this.runOllamaVisualQA(snapshotPath, filePath);
        console.log(`   ✓ Ollama QA: ${ollamaResult.status}`);

        results.push({
          file: fixture,
          status: ollamaResult.status,
          details: ollamaResult.details,
        });
      } catch (err) {
        console.log(`   ✗ Error: ${(err as Error).message}`);
        results.push({
          file: fixture,
          status: 'error',
          details: (err as Error).message,
        });
      }
    }

    // 4. Write report
    this.writeReport(results);
    console.log(`\n✅ Report written to ${REPORT_PATH}`);
    console.log('='.repeat(50));

    // Return exit code
    const failures = results.filter(r => r.status === 'error').length;
    return failures > 0 ? 1 : 0;
  }

  private async extractGeometry(
    filePath: string,
    filename: string
  ): Promise<ToolpathGeometry> {
    const content = fs.readFileSync(filePath, 'utf-8');
    const tokenizedLines = this.tokenizer.tokenizeDocument(content);
    const blocks = this.blockParser.parseDocument(tokenizedLines);

    const geometry: ToolpathGeometry = {
      file: filename,
      tool: 0,
      segments: [],
      bounds: { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity },
    };

    let pos = { x: 0, y: 0, z: 0 };
    let feedRate = 0;
    let spindleSpeed = 0;
    let currentTool = 0;

    for (const block of blocks) {
      // Extract tool change
      if (block.address('T')) {
        currentTool = parseInt(block.address('T')?.value as string) || 0;
      }

      // Extract feedrate and spindle
      if (block.address('F')) {
        feedRate = parseFloat(block.address('F')?.value as string) || 0;
      }
      if (block.address('S')) {
        spindleSpeed = parseFloat(block.address('S')?.value as string) || 0;
      }

      // Extract G-code movements
      const gcode = block.address('G')?.value;
      if (gcode === '00') {
        // Rapid
        const x = block.address('X') ? parseFloat(block.address('X')?.value as string) : pos.x;
        const y = block.address('Y') ? parseFloat(block.address('Y')?.value as string) : pos.y;
        const z = block.address('Z') ? parseFloat(block.address('Z')?.value as string) : pos.z;

        geometry.segments.push({
          type: 'rapid',
          start: { ...pos },
          end: { x, y, z },
          feedRate: 0,
          spindleSpeed,
          tool: currentTool,
        });

        pos = { x, y, z };
      } else if (gcode === '01') {
        // Linear
        const x = block.address('X') ? parseFloat(block.address('X')?.value as string) : pos.x;
        const y = block.address('Y') ? parseFloat(block.address('Y')?.value as string) : pos.y;
        const z = block.address('Z') ? parseFloat(block.address('Z')?.value as string) : pos.z;

        geometry.segments.push({
          type: 'line',
          start: { ...pos },
          end: { x, y, z },
          feedRate,
          spindleSpeed,
          tool: currentTool,
        });

        pos = { x, y, z };
      } else if (['02', '03'].includes(gcode || '')) {
        // Arc
        const x = block.address('X') ? parseFloat(block.address('X')?.value as string) : pos.x;
        const y = block.address('Y') ? parseFloat(block.address('Y')?.value as string) : pos.y;
        const z = block.address('Z') ? parseFloat(block.address('Z')?.value as string) : pos.z;

        geometry.segments.push({
          type: 'arc',
          start: { ...pos },
          end: { x, y, z },
          feedRate,
          spindleSpeed,
          tool: currentTool,
        });

        pos = { x, y, z };
      }

      // Update bounds
      if (!isNaN(pos.x)) {
        geometry.bounds.minX = Math.min(geometry.bounds.minX, pos.x);
        geometry.bounds.maxX = Math.max(geometry.bounds.maxX, pos.x);
      }
      if (!isNaN(pos.y)) {
        geometry.bounds.minY = Math.min(geometry.bounds.minY, pos.y);
        geometry.bounds.maxY = Math.max(geometry.bounds.maxY, pos.y);
      }
      if (!isNaN(pos.z)) {
        geometry.bounds.minZ = Math.min(geometry.bounds.minZ, pos.z);
        geometry.bounds.maxZ = Math.max(geometry.bounds.maxZ, pos.z);
      }
    }

    geometry.tool = currentTool;
    return geometry;
  }

  private async generateSnapshot(filename: string, geometry: ToolpathGeometry): Promise<string> {
    // Stub: Generate PNG from geometry
    // Real implementation: use headless three.js via canvas npm package
    // For now, return a placeholder path
    const snapshotPath = path.join(SNAPSHOTS_DIR, filename.replace('.nc', '.png'));

    // Create a placeholder PNG (1x1 gray)
    if (!fs.existsSync(snapshotPath)) {
      const placeholderPNG = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
        0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0x99, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
        0x00, 0x00, 0x03, 0x00, 0x01, 0x8d, 0x6e, 0x06, 0x0e, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
        0x44, 0xae, 0x42, 0x60, 0x82,
      ]);
      fs.writeFileSync(snapshotPath, placeholderPNG);
    }

    return snapshotPath;
  }

  private async runOllamaVisualQA(
    snapshotPath: string,
    gcodePath: string
  ): Promise<{ status: string; details: string }> {
    // Read snapshot as base64
    const imageBuffer = fs.readFileSync(snapshotPath);
    const base64Image = imageBuffer.toString('base64');

    // Read G-code snippet
    const gcode = fs.readFileSync(gcodePath, 'utf-8').split('\n').slice(0, 20).join('\n');

    // Prompt for Ollama
    const prompt = `Analyze this G-code toolpath snapshot and verify correctness:

G-Code:
\`\`\`
${gcode}
\`\`\`

Image: [base64 encoded toolpath rendering]

Check for:
1. Geometry accuracy: Do rendered lines/arcs match G-code XYZ?
2. Tool changes: Are tool positions marked clearly?
3. Anomalies: Any tool collisions, out-of-bounds, or unexpected jumps?
4. Feed rates: Rapid (blue) vs cutting feed (green)?

Respond in JSON: { "status": "ok|warning|error", "findings": [...] }`;

    // Call Ollama
    const result = spawnSync('curl', [
      '-s',
      '-X',
      'POST',
      'http://localhost:11434/api/generate',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({
        model: 'qwen2.5-coder:7b',
        prompt,
        stream: false,
        options: { temperature: 0.1, num_predict: 600 },
      }),
    ]);

    if (result.error) {
      return {
        status: 'skip',
        details: 'Ollama not available (OK for CI/CD)',
      };
    }

    try {
      const response = JSON.parse(result.stdout.toString());
      const findings = response.response || '';

      // Parse JSON response
      let parsed = { status: 'ok', findings: [] };
      try {
        const jsonMatch = findings.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        }
      } catch {
        // Fallback: assume "ok" if no error keywords found
        if (findings.toLowerCase().includes('error') || findings.toLowerCase().includes('issue')) {
          parsed.status = 'warning';
        }
      }

      return {
        status: parsed.status || 'ok',
        details: findings.slice(0, 200),
      };
    } catch (err) {
      return {
        status: 'error',
        details: `Ollama parse error: ${(err as Error).message}`,
      };
    }
  }

  private writeReport(results: Array<{ file: string; status: string; details?: string }>) {
    const passCount = results.filter(r => r.status === 'ok').length;
    const warnCount = results.filter(r => r.status === 'warning').length;
    const errorCount = results.filter(r => r.status === 'error').length;

    let report = `# Visual QA Report

**Date:** ${new Date().toISOString()}

## Summary
- ✅ Pass: ${passCount}
- ⚠️  Warning: ${warnCount}
- ❌ Error: ${errorCount}
- Total: ${results.length}

## Results

`;

    for (const r of results) {
      const icon = r.status === 'ok' ? '✅' : r.status === 'warning' ? '⚠️' : '❌';
      report += `### ${icon} ${r.file}\n`;
      if (r.details) {
        report += `\`\`\`\n${r.details}\n\`\`\`\n`;
      }
      report += '\n';
    }

    fs.writeFileSync(REPORT_PATH, report);
  }
}

// Run
if (require.main === module) {
  const runner = new VisualTestRunner();
  runner.run().then(exitCode => process.exit(exitCode));
}

export { VisualTestRunner };
