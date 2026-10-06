/**
 * JobLine Hover Provider
 * Architecture v0.4.0 Section 8.2
 *
 * Shows rich tooltips when hovering over G-codes, M-codes,
 * and address letters. Displays code name, description,
 * and parameter info from the reference data.
 */

import { Tokenizer } from '../parser/tokenizer';
import { GCodeToken } from '../parser/types';
import * as vscode from 'vscode';

// Load reference data
import * as gcodeRef from '../../data/gcode-reference.json';

interface CodeInfo {
  name: string;
  desc: string;
  group?: string;
}

const gCodeData = gcodeRef.gcodes as Record<string, CodeInfo>;
const mCodeData = gcodeRef.mcodes as Record<string, CodeInfo>;

// Address descriptions
const ADDRESS_INFO: Record<string, string> = {
  X: 'X-axis position',
  Y: 'Y-axis position',
  Z: 'Z-axis position',
  A: 'A-axis (rotary around X)',
  B: 'B-axis (rotary around Y)',
  C: 'C-axis (rotary around Z)',
  I: 'Arc center offset in X (or thread lead on lathe)',
  J: 'Arc center offset in Y',
  K: 'Arc center offset in Z',
  R: 'Canned cycle retract plane / Arc radius',
  Q: 'Peck depth (canned cycles) / Shift amount',
  F: 'Feed rate (IPM, mm/min, IPR, or mm/rev depending on G94/G95)',
  S: 'Spindle speed (RPM or SFM/m-min depending on G96/G97)',
  T: 'Tool number',
  H: 'Tool length offset number',
  D: 'Tool diameter/radius compensation number',
  P: 'Dwell time / Subprogram number / Parameter',
  L: 'Loop count (number of repetitions)',
  N: 'Sequence (line) number',
  O: 'Program number',
  U: 'Incremental X (lathe) / Dwell (some cycles)',
  W: 'Incremental Z (lathe)',
};

const tokenizer = new Tokenizer();

/**
 * Get hover content for a position in a line.
 * Returns markdown string or null if nothing to show.
 */
export function getHoverContent(
  lineText: string,
  lineNumber: number,
  column: number
): string | null {
  const tokenized = tokenizer.tokenizeLine(lineText, lineNumber);

  // Find the token at the cursor position
  const token = tokenized.tokens.find(
    t => column >= t.startCol && column < t.endCol
  );

  if (!token) return null;

  switch (token.type) {
    case 'G':
      return formatGCodeHover(token);
    case 'M':
      return formatMCodeHover(token);
    case 'address':
      return formatAddressHover(token);
    case 'siemensCycle':
      return formatSiemensCycleHover(token);
    case 'comment':
      return null;
    default:
      return null;
  }
}

export function getHoverMarkdown(
  lineText: string,
  lineNumber: number,
  column: number,
  extensionUri: vscode.Uri
): vscode.MarkdownString | null {
  const tokenized = tokenizer.tokenizeLine(lineText, lineNumber);
  const token = tokenized.tokens.find(
    t => column >= t.startCol && column < t.endCol
  );
  if (!token) return null;

  const rich = token.type === 'G'
    ? formatMillHoverCard(token, tokenized.tokens, extensionUri, lineNumber, lineText)
    : null;
  if (rich) return rich;

  const legacy = getHoverContent(lineText, lineNumber, column);
  if (!legacy) return null;
  const md = new vscode.MarkdownString(legacy);
  md.supportThemeIcons = true;
  md.isTrusted = true;
  return md;
}

function formatGCodeHover(token: GCodeToken): string | null {
  const code = token.code;
  if (code === undefined) return null;

  // For subcoded G-codes (G38.2, G54.1, G90.1 etc.), extract from raw text
  const subcodeMatch = token.raw.match(/[Gg]\s*(\d{1,3})(\.\d)/);
  const key = subcodeMatch ? `${subcodeMatch[1]}${subcodeMatch[2]}` : String(code);
  const info = gCodeData[key] ?? gCodeData[String(code)];

  if (!info) {
    return `**G${code}** â€” Unknown G-code`;
  }

  let md = `**G${code}** â€” ${info.name}\n\n${info.desc}`;

  // Add parameter hints for canned cycles and probing
  const paramHints = getCycleParameters(code, token.raw);
  if (paramHints) {
    md += `\n\n**Parameters:**\n${paramHints}`;
  }

  return md;
}

function formatMCodeHover(token: GCodeToken): string | null {
  const code = token.code;
  if (code === undefined) return null;

  const key = String(code);
  const info = mCodeData[key];

  if (!info) {
    return `**M${code}** â€” Unknown M-code`;
  }

  return `**M${code}** â€” ${info.name}\n\n${info.desc}`;
}

function formatAddressHover(token: GCodeToken): string | null {
  const letter = token.letter?.toUpperCase();
  if (!letter) return null;

  const desc = ADDRESS_INFO[letter];
  if (!desc) return null;

  let md = `**${letter}** â€” ${desc}`;

  // Show resolved value for macro variables
  if (token.value.kind === 'variable') {
    md += `\n\nMacro variable #${token.value.variableNum}`;
  } else if (token.value.kind === 'expression') {
    md += `\n\nMacro expression (value resolved at runtime)`;
  }

  return md;
}

function formatSiemensCycleHover(token: GCodeToken): string | null {
  const name = token.raw.toUpperCase();

  const siemensCycles: Record<string, string> = {
    'CYCLE81': 'Drilling â€” Feed to final depth, rapid retract',
    'CYCLE82': 'Drilling with Dwell â€” Feed to depth, dwell, rapid retract',
    'CYCLE83': 'Deep Hole Drilling â€” Peck drilling with chip-break or full retract',
    'CYCLE84': 'Rigid Tapping â€” Synchronized spindle/feed tapping',
    'CYCLE85': 'Boring â€” Feed in and feed out',
    'CYCLE86': 'Boring with Spindle Stop â€” Feed in, stop, rapid out',
    'CYCLE97': 'Thread Cutting â€” Lathe threading cycle',
    'MCALL': 'Modal Cycle Call â€” Makes next cycle modal (repeats at each position)',
  };

  const desc = siemensCycles[name] ?? 'Siemens cycle call';
  return `**${name}** â€” ${desc}\n\nSiemens positional parameter syntax: ${name}(param1, param2, ...)`;
}

function getCycleParameters(code: number, raw?: string): string | null {
  // For G38.x, use raw token text to distinguish subcode
  if (Math.floor(code) === 38 && raw) {
    const m = raw.match(/G38\.(\d)/i);
    const sub = m ? parseInt(m[1]) : 2;
    const probeParams: Record<number, string> = {
      2: '`X` `Y` `Z` target position Â· `F` feed rate Â· **Alarm** if no contact made',
      3: '`X` `Y` `Z` target position Â· `F` feed rate Â· Silent if no contact made',
      4: '`X` `Y` `Z` target position Â· `F` feed rate Â· **Alarm** if contact not lost',
      5: '`X` `Y` `Z` target position Â· `F` feed rate Â· Silent if contact not lost',
    };
    return probeParams[sub] ?? '`X` `Y` `Z` target Â· `F` feed rate';
  }

  const params: Record<number, string> = {
    31:  '`X` `Y` `Z` target position Â· `F` feed rate Â· Contact result stored in #5061â€“#5066',
    73: '`Z` final depth Â· `R` retract plane Â· `Q` peck depth Â· `F` feed rate',
    81: '`Z` final depth Â· `R` retract plane Â· `F` feed rate',
    82: '`Z` final depth Â· `R` retract plane Â· `P` dwell (sec) Â· `F` feed rate',
    83: '`Z` final depth Â· `R` retract plane Â· `Q` peck depth (must be > 0) Â· `F` feed rate',
    84: '`Z` final depth Â· `R` retract plane Â· `F` feed (= S Ã— pitch) Â· `S` spindle speed',
    85: '`Z` final depth Â· `R` retract plane Â· `F` feed rate',
    86: '`Z` final depth Â· `R` retract plane Â· `F` feed rate',
    87: '`Z` final depth Â· `R` retract plane Â· `F` feed rate',
    88: '`Z` final depth Â· `R` retract plane Â· `P` dwell Â· `F` feed rate',
    89:  '`Z` final depth Â· `R` retract plane Â· `P` dwell Â· `F` feed rate',
    187: '`P` mode: 0=off/exact-stop, 1=rough, 2=medium, 3=finish Â· `E` corner tolerance (optional, in current units)',
    234: 'No additional parameters â€” activates TCPC mode. Requires G254 (DWO) to be active. Cancel with G255.',
    254: '`D` fixture offset number â€” selects which base work offset (G54â€“G59) to tilt Â· A/B/C axis positions are read at time of call',
  };

  return params[code] ?? null;
}

const MILL_MOTION: Record<number, {
  title: string;
  badge: string;
  icon: string;
  summary: string;
  kid: string;
  asset: string;
}> = {
  0: {
    title: 'Rapid Positioning',
    badge: 'Mill Motion',
    icon: 'rocket',
    summary: 'Positions the tool quickly without a controlled cutting feed.',
    kid: 'The machine moves fast to the next spot before cutting.',
    asset: 'motion.rapid',
  },
  1: {
    title: 'Linear Feed Move',
    badge: 'Mill Motion',
    icon: 'arrow-right',
    summary: 'Feeds in a straight line at the programmed or inherited feed rate.',
    kid: 'The cutter moves in a straight line while machining.',
    asset: 'motion.linear',
  },
  2: {
    title: 'Clockwise Arc',
    badge: 'Mill Arc Motion',
    icon: 'sync',
    summary: 'Moves along a clockwise circular path in the active plane.',
    kid: 'The cutter follows a curved clockwise path.',
    asset: 'motion.arc-cw',
  },
  3: {
    title: 'Counterclockwise Arc',
    badge: 'Mill Arc Motion',
    icon: 'sync',
    summary: 'Moves along a counterclockwise circular path in the active plane.',
    kid: 'The cutter follows a curved counterclockwise path.',
    asset: 'motion.arc-ccw',
  },
};

const MILL_DRILLING: Record<number, {
  title: string;
  badge: string;
  icon: string;
  summary: string;
  kid: string;
  asset: string;
  required: string[];
  optional: string[];
  caution?: string;
}> = {
  73: {
    title: 'High-Speed Peck Drilling',
    badge: 'Mill Canned Cycle',
    icon: 'symbol-method',
    summary: 'Feeds in short chip-breaking pecks without a full retract between each peck.',
    kid: 'The drill pecks down a little at a time to break chips.',
    asset: 'drilling.peck',
    required: ['Z', 'R', 'Q', 'F'],
    optional: ['X', 'Y', 'P', 'L'],
  },
  81: {
    title: 'Simple Drilling Cycle',
    badge: 'Mill Canned Cycle',
    icon: 'symbol-method',
    summary: 'Drills to the final Z depth and retracts to the R plane.',
    kid: 'The drill goes down to make a hole, then comes back up.',
    asset: 'drilling.simple',
    required: ['Z', 'R', 'F'],
    optional: ['X', 'Y', 'L'],
  },
  82: {
    title: 'Drilling with Dwell',
    badge: 'Mill Canned Cycle',
    icon: 'watch',
    summary: 'Drills to depth, pauses at the bottom, then retracts.',
    kid: 'The drill pauses at the bottom so the hole finishes cleanly.',
    asset: 'drilling.dwell',
    required: ['Z', 'R', 'P', 'F'],
    optional: ['X', 'Y', 'L'],
  },
  83: {
    title: 'Deep-Hole Peck Drilling',
    badge: 'Mill Canned Cycle',
    icon: 'list-tree',
    summary: 'Drills deep holes using repeated pecks and retracts to clear chips.',
    kid: 'The drill goes down, backs out to clear chips, and repeats.',
    asset: 'drilling.peck',
    required: ['Z', 'R', 'Q', 'F'],
    optional: ['X', 'Y', 'P', 'L'],
    caution: 'Confirm Q peck depth is positive and appropriate for the drill, material, coolant, and chip evacuation.',
  },
  84: {
    title: 'Tapping Cycle',
    badge: 'Mill Threading / Tapping',
    icon: 'symbol-key',
    summary: 'Synchronizes spindle rotation and Z feed to cut or form an internal thread.',
    kid: 'The tap spins and moves down at the same pace to make threads.',
    asset: 'drilling.tap',
    required: ['Z', 'R', 'F'],
    optional: ['X', 'Y', 'S', 'P', 'L'],
    caution: 'Tapping behavior depends on rigid-tap support, spindle synchronization, pitch, feed mode, and controller settings.',
  },
};

function formatMillHoverCard(token: GCodeToken, tokens: GCodeToken[], extensionUri: vscode.Uri, lineNumber: number, lineText: string): vscode.MarkdownString | null {
  const code = token.code;
  if (code === undefined) return null;
  const motion = MILL_MOTION[code];
  const drilling = MILL_DRILLING[code];
  if (!motion && !drilling) return null;

  const command = `G${code}`;
  const words = collectLiteralWords(tokens);
  const card = motion
    ? {
        title: motion.title,
        badge: motion.badge,
        icon: motion.icon,
        summary: motion.summary,
        kid: motion.kid,
        asset: motion.asset,
        machineAction: motionAction(command, words),
        caution: undefined as string | undefined,
        metricLetters: ['Z', 'F', 'X', 'Y', 'A', 'B', 'C', 'I', 'J', 'K', 'R'],
      }
    : {
        title: drilling!.title,
        badge: drilling!.badge,
        icon: drilling!.icon,
        summary: drilling!.summary,
        kid: drilling!.kid,
        asset: drilling!.asset,
        machineAction: drillingAction(command, words),
        caution: drilling!.caution,
        metricLetters: [...drilling!.required, ...drilling!.optional],
      };

  const md = new vscode.MarkdownString('', true);
  md.supportThemeIcons = true;
  md.isTrusted = {
    enabledCommands: [
      'jobline.openExplainer',
      'jobline.openSimulation',
      'jobline.gcode.showVisualizer',
    ],
  };

  md.appendMarkdown(`$(file-code) **JobLine.ai**  Natural Language View  **[$(pass-filled) EXPLAINED]**`);
  md.appendMarkdown(`\n\nLine ${lineNumber + 1}  \`${inlineCode(lineText.trim() || command)}\``);
  md.appendMarkdown(`\n\n## $(${card.icon}) ${escapeMd(cardTitle(command, card.title))}`);
  md.appendMarkdown('\n\n**Actions:**  ');
  md.appendMarkdown('[ Natural Language ](command:jobline.openExplainer)  ');
  md.appendMarkdown(`[ About ${escapeMd(command)} ](command:jobline.openExplainer)  `);
  md.appendMarkdown('[ Feed Rates ](command:jobline.openExplainer)  ');
  md.appendMarkdown('[ Coordinate System (G54) ](command:jobline.openExplainer)  ');
  md.appendMarkdown('[ Visualizer ](command:jobline.openSimulation)');

  const cleanMetrics = card.metricLetters
    .filter((letter, index, array) => array.indexOf(letter) === index)
    .map(letter => metricLine(letter, words))
    .filter((line): line is string => Boolean(line));
  if (cleanMetrics.length > 0) {
    md.appendMarkdown('\n\n---\n\n');
    md.appendMarkdown(drilling ? drillMetricSummary(words) : cleanMetrics.slice(0, 3).join('\n\n'));
  }

  md.appendMarkdown(`\n\n> $(lightbulb) **${escapeMd(card.kid)}**`);
  if (card.caution) {
    md.appendMarkdown(`\n\n> $(warning) ${escapeMd(card.caution)}`);
  }

  return md;
}

function cardTitle(command: string, title: string): string {
  if (command === 'G1') return `Move in a straight line (${command})`;
  if (command === 'G0') return `Rapid move (${command})`;
  if (command === 'G2') return `Clockwise arc move (${command})`;
  if (command === 'G3') return `Counterclockwise arc move (${command})`;
  return `${title} (${command})`;
}

function collectLiteralWords(tokens: GCodeToken[]): Record<string, number> {
  const words: Record<string, number> = {};
  for (const t of tokens) {
    const letter = t.letter?.toUpperCase();
    if (!letter || t.value.kind !== 'literal') continue;
    words[letter] = t.value.value;
  }
  return words;
}

function metricLine(letter: string, words: Record<string, number>): string | null {
  const value = words[letter];
  if (value === undefined) return null;
  const label = ADDRESS_INFO[letter] ?? `${letter} value`;
  const unit = ['A', 'B', 'C'].includes(letter) ? 'deg' : '';
  return `$(${metricIcon(letter)}) **${escapeMd(letter)} ${escapeMd(String(value))}${unit ? ` ${unit}` : ''}** — ${escapeMd(label)}`;
}

function drillMetricSummary(words: Record<string, number>): string {
  const z = words.Z !== undefined ? `$(arrow-down) **Z ${escapeMd(String(words.Z))}** depth` : '';
  const r = words.R !== undefined ? `$(arrow-right) **R ${escapeMd(String(words.R))}** retract` : '';
  const q = words.Q !== undefined ? `$(arrow-right) **Q ${escapeMd(String(words.Q))}** peck` : '';
  const f = words.F !== undefined ? `$(dashboard) **F ${escapeMd(String(words.F))}** feed` : '';
  return [[z, r], [q, f]]
    .map(row => row.filter(Boolean).join('   '))
    .filter(Boolean)
    .join('\n\n');
}

function metricIcon(letter: string): string {
  if (letter === 'Z') return 'arrow-down';
  if (letter === 'Y') return 'arrow-up';
  if (['A', 'B', 'C'].includes(letter)) return 'sync';
  if (letter === 'F') return 'dashboard';
  if (letter === 'S') return 'pulse';
  if (letter === 'P') return 'watch';
  return 'arrow-right';
}

function motionAction(command: string, words: Record<string, number>): string {
  const axes = ['X', 'Y', 'Z', 'A', 'B', 'C']
    .filter(letter => words[letter] !== undefined)
    .map(letter => `${letter} ${words[letter]}`)
    .join(', ');
  if (command === 'G0') return axes ? `Rapidly position to ${axes}.` : 'Rapid positioning move.';
  if (command === 'G1') return axes ? `Feed in a straight line to ${axes}.` : 'Controlled linear feed move.';
  const ijk = ['I', 'J', 'K', 'R']
    .filter(letter => words[letter] !== undefined)
    .map(letter => `${letter} ${words[letter]}`)
    .join(', ');
  return `${command === 'G2' ? 'Clockwise' : 'Counterclockwise'} circular interpolation${axes ? ` to ${axes}` : ''}${ijk ? ` using ${ijk}` : ''}.`;
}

function drillingAction(command: string, words: Record<string, number>): string {
  const bits = [];
  if (words.Z !== undefined) bits.push(`final depth Z ${words.Z}`);
  if (words.R !== undefined) bits.push(`R plane ${words.R}`);
  if (words.Q !== undefined) bits.push(`Q peck ${words.Q}`);
  if (words.P !== undefined) bits.push(`P dwell ${words.P}`);
  if (words.F !== undefined) bits.push(`feed F ${words.F}`);
  const suffix = bits.length ? ` with ${bits.join(', ')}` : '';
  if (command === 'G84') return `Tap the hole${suffix}.`;
  if (command === 'G83') return `Deep drill with full chip-clearing pecks${suffix}.`;
  if (command === 'G73') return `Drill with high-speed chip-breaking pecks${suffix}.`;
  if (command === 'G82') return `Drill, dwell at depth, then retract${suffix}.`;
  return `Drill to depth and retract${suffix}.`;
}

function escapeMd(s: string): string {
  return s.replace(/([\\`*_{}[\]()#+.!|>~-])/g, '\\$1');
}

function inlineCode(s: string): string {
  return s.replace(/`/g, "'");
}
