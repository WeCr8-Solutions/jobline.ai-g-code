/* eslint-env node */
/* global __dirname */

import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const MEDIA_DIR = path.join(__dirname, '..', 'media');
const SRC_DIR   = path.join(__dirname, '..', 'src', 'providers');

describe('Visualizer control contract', () => {
  it('documents and wires pan, zoom, and fit-view controls for operators', () => {
    const html = fs.readFileSync(
      path.join(MEDIA_DIR, 'toolpathVisualizerWebview.html'),
      'utf8'
    );

    expect(html).toContain('Middle drag: Pan');
    expect(html).toContain('Shift+Left : Pan');
    expect(html).toContain('Double click: Fit view');
    expect(html).toContain('{{CSP_SOURCE}}');
    expect(html).toContain("import * as THREE from '{{THREE_JS_URI}}'");
    expect(html).toContain("button === 1 || button === 2 || (button === 0 && shiftKey)");
    expect(html).toContain("renderer.domElement.addEventListener('wheel'");
    expect(html).toContain("renderer.domElement.addEventListener('dblclick'");
    expect(html).toContain("if (action === 'pan')");
    expect(html).toContain("if (action === 'orbit')");
    expect(html).toContain('id="review-panel"');
    expect(html).toContain("case 'review'");
    expect(html).toContain("jobline.gcode.revealLine");
  });
});

// ---------------------------------------------------------------------------
// Three.js integrity — ensures no startup race and media assets are present
// ---------------------------------------------------------------------------
describe('Three.js loading integrity', () => {
  it('three.min.js is bundled in media/ and non-empty', () => {
    const threeFile = path.join(MEDIA_DIR, 'three.min.js');
    expect(fs.existsSync(threeFile), 'three.min.js must exist in media/').toBe(true);
    const size = fs.statSync(threeFile).size;
    // A valid Three.js bundle is always >300 KB
    expect(size).toBeGreaterThan(300_000);
  });

  it('bundles every local module imported by three.min.js', () => {
    const entry = fs.readFileSync(path.join(MEDIA_DIR, 'three.min.js'), 'utf8');
    const imports = Array.from(entry.matchAll(/from["']\.\/(.+?)["']/g), match => match[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const importedFile of imports) {
      expect(fs.existsSync(path.join(MEDIA_DIR, importedFile)), `Missing Three.js dependency: ${importedFile}`).toBe(true);
    }
  });

  it('visualizer HTML uses a single module script — no module/classic split', () => {
    const html = fs.readFileSync(
      path.join(MEDIA_DIR, 'toolpathVisualizerWebview.html'),
      'utf8'
    );
    // Must have exactly one <script type="module"> block
    const moduleScripts = (html.match(/<script type="module">/g) ?? []).length;
    expect(moduleScripts).toBe(1);

    // Must NOT have any bare classic <script> tag after the module block
    // (a plain <script> with no type= after the module block = race condition)
    const modulePos = html.indexOf('<script type="module">');
    const classicAfterModule = html.indexOf('\n  <script>\n', modulePos);
    expect(classicAfterModule).toBe(-1);

    // THREE import must live inside the module script (not assigned to window)
    expect(html).toContain("import * as THREE from '{{THREE_JS_URI}}'");
    expect(html).not.toContain('window.THREE = THREE');
  });

  it('visualizer HTML guard uses module-safe check, not typeof global', () => {
    const html = fs.readFileSync(
      path.join(MEDIA_DIR, 'toolpathVisualizerWebview.html'),
      'utf8'
    );
    // The old race guard was `typeof THREE === 'undefined'` — must be gone
    expect(html).not.toContain("typeof THREE === 'undefined'");
    // The new safe guard checks the imported binding directly
    expect(html).toContain('if (!THREE || !THREE.WebGLRenderer)');
  });

  it('CSP allows the webview origin ({{CSP_SOURCE}} placeholder present)', () => {
    const html = fs.readFileSync(
      path.join(MEDIA_DIR, 'toolpathVisualizerWebview.html'),
      'utf8'
    );
    // Both occurrences required: script-src and img-src (or default-src)
    expect((html.match(/\{\{CSP_SOURCE\}\}/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('toolPreviewPanel HTML uses a single module script — no module/classic split', () => {
    const ts = fs.readFileSync(
      path.join(SRC_DIR, 'toolPreviewPanel.ts'),
      'utf8'
    );
    // Count <script type="module"> occurrences inside the template literal
    const moduleScripts = (ts.match(/<script type="module">/g) ?? []).length;
    expect(moduleScripts).toBe(1);

    // Must NOT split into two script blocks
    const classicScript = ts.match(/<\/script>\s*\n\s*<script>/);
    expect(classicScript).toBeNull();

    // window.THREE global assignment must be gone
    expect(ts).not.toContain('window.THREE = THREE');
    // Old classic-script race check must be gone
    expect(ts).not.toContain("typeof THREE !== 'undefined'");
  });

  it('toolPreviewPanel queues loadTool data before scene is ready', () => {
    const ts = fs.readFileSync(
      path.join(SRC_DIR, 'toolPreviewPanel.ts'),
      'utf8'
    );
    // pendingToolData mechanism must exist
    expect(ts).toContain('pendingToolData');
    // Must replay pending data after setup
    expect(ts).toContain('if (pendingToolData)');
  });

  it('toolpathVisualizer.ts replaces both CSP_SOURCE and THREE_JS_URI at runtime', () => {
    const ts = fs.readFileSync(
      path.join(SRC_DIR, 'toolpathVisualizer.ts'),
      'utf8'
    );
    expect(ts).toContain(".split('{{CSP_SOURCE}}').join(");
    expect(ts).toContain(".split('{{THREE_JS_URI}}').join(");
  });

  it('toolpathVisualizer.ts has a fallback error page for missing HTML template', () => {
    const ts = fs.readFileSync(
      path.join(SRC_DIR, 'toolpathVisualizer.ts'),
      'utf8'
    );
    // Must catch readFileSync failures and return a fallback error page
    expect(ts).toContain('catch (err)');
    expect(ts).toContain('Error loading Visualizer UI');
  });
});
