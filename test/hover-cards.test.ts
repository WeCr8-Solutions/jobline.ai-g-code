/* eslint-env node */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import Module = require('node:module');

const originalLoad = (Module as any)._load;
const vscodeMock = {
  Uri: {
    file(filePath: string) {
      return { fsPath: filePath, path: filePath.replace(/\\/g, '/'), toString: () => `file:///${filePath.replace(/\\/g, '/')}` };
    },
    joinPath(base: { fsPath?: string; path?: string }, ...parts: string[]) {
      const root = (base.fsPath || base.path || '').replace(/\\/g, '/').replace(/\/$/, '');
      const joined = [root, ...parts].join('/').replace(/\/+/g, '/');
      return { fsPath: joined, path: joined, toString: () => `file:///${joined}` };
    },
  },
  MarkdownString: class MarkdownString {
    value = '';
    supportThemeIcons = false;
    isTrusted: unknown = false;
    constructor(value = '') { this.value = value; }
    appendMarkdown(value: string) { this.value += value; }
  },
};

(Module as any)._load = function patchedLoad(request: string, parent: unknown, isMain: boolean) {
  if (request === 'vscode') return vscodeMock;
  return originalLoad.call(this, request, parent, isMain);
};

const { getHoverMarkdown } = require('../src/providers/hoverProvider');
const extensionUri = vscodeMock.Uri.file('C:/tmp/jobline-gcode');

describe('Mill hover cards', () => {
  it('renders a rich linear-motion card with metrics and graphic', () => {
    const md = getHoverMarkdown('G1 X1.25 Y-0.5 Z-0.125 F18.', 0, 1, extensionUri);
    assert.ok(md);
    const text = md.value;
    assert.match(text, /JobLine\.ai/);
    assert.match(text, /Natural Language View/);
    assert.match(text, /EXPLAINED/);
    assert.match(text, /Line 1\s+`G1/);
    assert.match(text, /Move in a straight line.*G1/);
    assert.match(text, /The cutter moves in a straight line/);
    assert.match(text, /X 1\\\.25/);
    assert.match(text, /F 18/);
    assert.match(text, /\[ Natural Language \]/);
    assert.match(text, /Coordinate System \(G54\)/);
  });

  it('renders a rich G83 peck-drilling card with Z/R/Q/F parameters', () => {
    const md = getHoverMarkdown('G83 X2. Y1. Z-.75 R.1 Q.05 F7.', 0, 1, extensionUri);
    assert.ok(md);
    const text = md.value;
    assert.match(text, /JobLine\.ai/);
    assert.match(text, /Natural Language View/);
    assert.match(text, /EXPLAINED/);
    assert.match(text, /Deep\\-Hole Peck Drilling.*G83/);
    assert.match(text, /Q 0\\\.05/);
    assert.match(text, /Confirm Q peck depth/);
  });

  it('preserves legacy fallback for non-card address hovers', () => {
    const md = getHoverMarkdown('G1 X1.25', 0, 3, extensionUri);
    assert.ok(md);
    assert.match(md.value, /X-axis position/);
  });
});
