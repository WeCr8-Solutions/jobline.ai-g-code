/**
 * Writes test/fixtures/revpack-geometry.golden.json from the public packs.
 * The same file is committed in jobline.ai-CAM and shift-handover-hub; copy it
 * there after regenerating. Run: npx ts-node --transpileOnly scripts/revpack-parity-golden.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { revPackParitySnapshot } from '../src/providers/visualizer/revpackParity';
import { targetStlFile } from '../src/providers/visualizer/revpack';

const root = path.join(__dirname, '..', 'test', 'fixtures', 'revpack-public');
const out: Record<string, unknown> = {};
for (const dir of fs.readdirSync(root).sort()) {
  const pack = JSON.parse(fs.readFileSync(path.join(root, dir, 'revpack.json'), 'utf8'));
  const gcode = fs.readFileSync(path.join(root, dir, pack.program.file), 'utf8');
  const stl = targetStlFile(pack);
  const target = stl ? fs.readFileSync(path.join(root, dir, stl)) : undefined;
  out[dir] = revPackParitySnapshot(pack, gcode, target);
}
fs.writeFileSync(path.join(__dirname, '..', 'test', 'fixtures', 'revpack-geometry.golden.json'), JSON.stringify(out, null, 2) + '\n');
console.log('wrote', Object.keys(out).join(', '));
