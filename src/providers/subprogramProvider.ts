/**
 * JobLine Subprogram Navigation Provider
 *
 * Implements:
 *  1. Go to Definition for M98 Pxxx (Fanuc subprogram call) — jumps to Oxxx
 *     in the same file or a workspace file whose first line begins with Oxxx.
 *  2. Document Links for M98 Pxxx lines (clickable underline).
 *  3. Workspace symbol provider — finds all Oxxx program numbers in .nc/.gcode files.
 */

import * as vscode from 'vscode';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GCODE_EXTENSIONS = /\.(nc|gcode|ngc|tap|cnc|mpf|spf|prg|min)$/i;

function isGCodeDocument(document: vscode.TextDocument): boolean {
  if (document.languageId === 'gcode') return true;
  return GCODE_EXTENSIONS.test(document.fileName);
}

/**
 * Extract P-value from an M98 line.
 * Returns null if not an M98 line or no P word found.
 */
function extractM98PValue(lineText: string): number | null {
  // Must contain M98 (with optional leading zeros / spaces)
  if (!/\bM0*98\b/i.test(lineText)) return null;
  const pMatch = /\bP0*(\d+)\b/.exec(lineText);
  if (!pMatch) return null;
  return parseInt(pMatch[1], 10);
}

/**
 * Given lines in the current document, find the line index of Oxxx.
 */
function findONumberInLines(lines: string[], oNumber: number): number {
  const pattern = new RegExp(`^[Oo]0*${oNumber}\\b`);
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i].trim())) {
      return i;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Go to Definition Provider
// ---------------------------------------------------------------------------

class SubprogramDefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): Promise<vscode.Definition | null> {
    if (!isGCodeDocument(document)) return null;

    const lineText = document.lineAt(position.line).text;
    const pValue = extractM98PValue(lineText);
    if (pValue === null) return null;

    // 1. Check same file first
    const lines = document.getText().split(/\r?\n/);
    const sameFileIdx = findONumberInLines(lines, pValue);
    if (sameFileIdx >= 0) {
      const pos = new vscode.Position(sameFileIdx, 0);
      return new vscode.Location(document.uri, pos);
    }

    // 2. Search workspace files
    const workspaceResult = await findSubprogramInWorkspace(pValue);
    return workspaceResult;
  }
}

// ---------------------------------------------------------------------------
// Document Link Provider
// ---------------------------------------------------------------------------

class SubprogramLinkProvider implements vscode.DocumentLinkProvider {
  async provideDocumentLinks(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): Promise<vscode.DocumentLink[]> {
    if (!isGCodeDocument(document)) return [];

    const links: vscode.DocumentLink[] = [];
    const lines = document.getText().split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      const pValue = extractM98PValue(lineText);
      if (pValue === null) continue;

      // Find the range of the P-word in the line
      const pMatch = /\bP0*\d+\b/.exec(lineText);
      if (!pMatch) continue;

      const start = new vscode.Position(i, pMatch.index);
      const end = new vscode.Position(i, pMatch.index + pMatch[0].length);
      const range = new vscode.Range(start, end);

      // Resolve the target URI
      let targetUri: vscode.Uri | undefined;

      // Check same file
      const sameFileIdx = findONumberInLines(lines, pValue);
      if (sameFileIdx >= 0) {
        targetUri = document.uri.with({ fragment: `L${sameFileIdx + 1}` });
      } else {
        // We can't easily resolve workspace URIs in DocumentLinks without async,
        // so we set target to undefined — the definition provider handles navigation
        targetUri = undefined;
      }

      const link = new vscode.DocumentLink(range, targetUri);
      link.tooltip = `Go to subprogram O${String(pValue).padStart(4, '0')}`;
      links.push(link);
    }

    return links;
  }
}

// ---------------------------------------------------------------------------
// Workspace Symbol Provider
// ---------------------------------------------------------------------------

class SubprogramWorkspaceSymbolProvider implements vscode.WorkspaceSymbolProvider {
  async provideWorkspaceSymbols(
    query: string,
    _token: vscode.CancellationToken
  ): Promise<vscode.SymbolInformation[]> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return [];

    const results: vscode.SymbolInformation[] = [];
    const oNumberPattern = /^[Oo](\d{1,8})\b/;

    // Find all gcode files in the workspace
    const files = await vscode.workspace.findFiles(
      '**/*.{nc,gcode,ngc,tap,cnc,mpf,spf,prg,min}',
      '**/node_modules/**',
      500
    );

    for (const fileUri of files) {
      try {
        const doc = await vscode.workspace.openTextDocument(fileUri);
        const firstFewLines = doc.getText().split(/\r?\n/).slice(0, 10);

        for (let i = 0; i < firstFewLines.length; i++) {
          const line = firstFewLines[i].trim();
          const match = oNumberPattern.exec(line);
          if (match) {
            const oNum = match[1];
            const symbolName = `O${oNum}`;

            // Filter by query if provided
            if (query && !symbolName.toLowerCase().includes(query.toLowerCase())) continue;

            const pos = new vscode.Position(i, 0);
            results.push(new vscode.SymbolInformation(
              symbolName,
              vscode.SymbolKind.Module,
              path.basename(fileUri.fsPath),
              new vscode.Location(fileUri, pos)
            ));
            break; // Only first O-number per file
          }
        }
      } catch {
        // Skip files that can't be read
      }
    }

    return results;
  }
}

// ---------------------------------------------------------------------------
// Helper: find subprogram in workspace
// ---------------------------------------------------------------------------

async function findSubprogramInWorkspace(
  pValue: number
): Promise<vscode.Location | null> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;

  const files = await vscode.workspace.findFiles(
    '**/*.{nc,gcode,ngc,tap,cnc,mpf,spf,prg,min}',
    '**/node_modules/**',
    500
  );

  const oPattern = new RegExp(`^[Oo]0*${pValue}\\b`);

  for (const fileUri of files) {
    try {
      const doc = await vscode.workspace.openTextDocument(fileUri);
      const firstFewLines = doc.getText().split(/\r?\n/).slice(0, 5);

      for (let i = 0; i < firstFewLines.length; i++) {
        if (oPattern.test(firstFewLines[i].trim())) {
          return new vscode.Location(fileUri, new vscode.Position(i, 0));
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public registration function
// ---------------------------------------------------------------------------

export function registerSubprogramProvider(context: vscode.ExtensionContext): void {
  const selector: vscode.DocumentSelector = [
    { language: 'gcode' },
    { pattern: '**/*.{nc,gcode,ngc,tap,cnc,mpf,spf,prg,min}' },
  ];

  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(selector, new SubprogramDefinitionProvider()),
    vscode.languages.registerDocumentLinkProvider(selector, new SubprogramLinkProvider()),
    vscode.languages.registerWorkspaceSymbolProvider(new SubprogramWorkspaceSymbolProvider())
  );
}
