/**
 * Effective control type for one program in VS Code.
 *
 * `jobline.controlType` is the workspace's control. When
 * `jobline.controlAutoDetect` is on (the default) and the program's header
 * names a different CNC control (a Haas post writes "HAAS MILL NGC"), the
 * program is checked as that control instead, unless the control was set
 * explicitly for this workspace or folder (Select CNC / Robot Control Type,
 * or a machine preset applied to the workspace). Robot languages are never
 * overridden.
 */

import * as vscode from 'vscode';
import { detectControlFromProgram } from '../diagnostics/controlRules';

export interface ResolvedControl {
  controlType: string;
  /** True when the program header picked the control. */
  detected: boolean;
}

export function resolveControl(text: string | undefined, scope?: vscode.Uri): ResolvedControl {
  const cfg = vscode.workspace.getConfiguration(undefined, scope);
  const configured = cfg.get<string>('jobline.controlType', 'fanuc');
  if (!text || configured === 'fanuc-robot' || configured === 'abb') return { controlType: configured, detected: false };
  if (!cfg.get<boolean>('jobline.controlAutoDetect', true)) return { controlType: configured, detected: false };
  const inspected = cfg.inspect<string>('jobline.controlType');
  if (inspected?.workspaceFolderValue !== undefined || inspected?.workspaceValue !== undefined) {
    return { controlType: configured, detected: false };
  }
  const found = detectControlFromProgram(text);
  if (found && found !== configured) return { controlType: found, detected: true };
  return { controlType: configured, detected: false };
}

export function resolveControlType(text: string | undefined, scope?: vscode.Uri): string {
  return resolveControl(text, scope).controlType;
}
