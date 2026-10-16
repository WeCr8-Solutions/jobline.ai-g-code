/**
 * Dependency-free SVG plot of a RevPack correlation run.
 *
 * Three orthographic views (top XY, front XZ, side YZ) in PART coordinates:
 * stock, workholding, the target's bounds, the toolpath (rapids dashed red,
 * feeds blue, tilted moves orange), every finding marked where it happened,
 * and the machine's reachable travel for the tool tip drawn as a dashed box.
 * No 3D machine model is used: part, code, tool and path against the machine's
 * axes, limits, kinematics and dialect is what the picture shows.
 */

import { isCylinder, type RevPack, type Vec3 } from './revpack';
import type { CorrelationReport } from './revpackCorrelation';

interface Bounds { min: Vec3; max: Vec3 }

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface PlotOptions {
  title?: string;
  targetBounds?: Bounds | null;
  /** 'before' draws only what the old harness used (toolpath, no setup, no checks). */
  mode?: 'after' | 'before';
  beforeNotes?: string[];
}

export function renderCorrelationSvg(pack: RevPack, report: CorrelationReport, options: PlotOptions = {}): string {
  const mode = options.mode ?? 'after';
  const turning = pack.machine.machineClass === 'lathe';
  // Part-frame shapes as boxes (cylinders become their bounding box in X/Z; Y = ±radius).
  const shapeBox = (shape: RevPack['stock']): Bounds => isCylinder(shape)
    ? { min: [-shape.diameter / 2, -shape.diameter / 2, shape.zMin], max: [shape.diameter / 2, shape.diameter / 2, shape.zMax] }
    : { min: shape.min, max: shape.max };
  const stock = shapeBox(pack.stock);
  const holders = pack.workholding.map(holder => ({ name: holder.name, box: shapeBox(holder) }));

  // Reachable tip travel in part coordinates (rotaries at 0).
  const offset = Object.values(pack.workOffsets)[0];
  const axis = (name: string) => pack.machine.axes.find(entry => entry.name === name);
  const shortest = pack.tools.reduce((min, tool) => Math.min(min, tool.gaugeLength || 0), Infinity);
  const toolLen = turning || pack.machine.machineClass === 'laser' ? 0 : (Number.isFinite(shortest) ? shortest : 0);
  const travel: Bounds | null = offset && axis('X') && axis('Z') ? {
    min: [
      turning ? (axis('X')!.min - offset.x) / 2 : axis('X')!.min - offset.x,
      axis('Y') ? axis('Y')!.min - (offset.y ?? 0) : -1,
      axis('Z')!.min - offset.z - toolLen,
    ],
    max: [
      turning ? (axis('X')!.max - offset.x) / 2 : axis('X')!.max - offset.x,
      axis('Y') ? axis('Y')!.max - (offset.y ?? 0) : 1,
      axis('Z')!.max - offset.z - toolLen,
    ],
  } : null;

  // View extents: stock + holders + path, padded.
  const pts: Vec3[] = [stock.min, stock.max];
  holders.forEach(holder => pts.push(holder.box.min, holder.box.max));
  for (const seg of report.segments) {
    // Ignore the long moves to and from home so the part stays readable.
    for (const p of [seg.from, seg.to]) {
      const near = p.every((v, i) => v > stock.min[i] - (stock.max[i] - stock.min[i]) * 1.5 && v < stock.max[i] + (stock.max[i] - stock.min[i]) * 1.5);
      if (near) pts.push(p);
    }
  }
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
  for (let i = 0; i < 3; i++) { const pad = (hi[i] - lo[i]) * 0.12 || 1; lo[i] -= pad; hi[i] += pad; }

  const W = 1500;
  const H = 1010;
  const panel = 460;
  const views: Array<{ name: string; ax: [number, number]; x: number; y: number; labels: [string, string] }> = turning
    ? [
      { name: 'Turning plane (Z horizontal, X radius up)', ax: [2, 0], x: 40, y: 150, labels: ['Z', 'X (radius)'] },
      { name: 'End view (X/Y)', ax: [0, 1], x: 540, y: 150, labels: ['X', 'Y'] },
      { name: 'Top (Z/Y)', ax: [2, 1], x: 1020, y: 150, labels: ['Z', 'Y'] },
    ]
    : [
      { name: 'Top (XY)', ax: [0, 1], x: 40, y: 150, labels: ['X', 'Y'] },
      { name: 'Front (XZ)', ax: [0, 2], x: 540, y: 150, labels: ['X', 'Z'] },
      { name: 'Side (YZ)', ax: [1, 2], x: 1020, y: 150, labels: ['Y', 'Z'] },
    ];

  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, Helvetica, Arial, sans-serif">`);
  out.push(`<rect width="${W}" height="${H}" fill="#0f141a"/>`);
  const title = options.title ?? `${pack.name}`;
  out.push(`<text x="40" y="44" fill="#ffffff" font-size="26" font-weight="600">${esc(title)}</text>`);
  out.push(`<text x="40" y="78" fill="#9fb3c8" font-size="16">${esc(`${pack.machine.name} · ${pack.machine.dialect}${pack.machine.controlModel ? ` ${pack.machine.controlModel}` : ''} · ${pack.machine.kinematics} · program ${pack.program.file} (${pack.program.dialect}) · units ${pack.units}`)}</text>`);
  out.push(`<text x="40" y="102" fill="#7d8b99" font-size="14">${esc(mode === 'before'
    ? 'BEFORE: what the old RevPack harness used — the program text only. No stock, workholding, work-offset location, tool lengths or machine limits were loaded or checked.'
    : 'No 3D machine model loaded (optional). Shown: target, stock, workholding, toolpath per tool, and the machine travel the tool tip can reach.')}</text>`);

  for (const view of views) {
    const [a, b] = view.ax;
    const spanA = hi[a] - lo[a];
    const spanB = hi[b] - lo[b];
    const k = Math.min(panel / spanA, panel / spanB);
    const ox = view.x + (panel - spanA * k) / 2;
    const oy = view.y + (panel - spanB * k) / 2;
    const X = (p: Vec3) => ox + (p[a] - lo[a]) * k;
    const Y = (p: Vec3) => oy + (hi[b] - p[b]) * k;
    const rect = (box: Bounds, attrs: string) => {
      const x0 = X(box.min); const x1 = X(box.max);
      const y0 = Y(box.max); const y1 = Y(box.min);
      return `<rect x="${Math.min(x0, x1).toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${Math.abs(x1 - x0).toFixed(1)}" height="${Math.abs(y1 - y0).toFixed(1)}" ${attrs}/>`;
    };
    out.push(`<rect x="${view.x}" y="${view.y}" width="${panel}" height="${panel}" fill="#161d25" stroke="#2a3542"/>`);
    out.push(`<text x="${view.x}" y="${view.y - 8}" fill="#cfd8e3" font-size="15">${esc(view.name)}</text>`);
    out.push(`<clipPath id="c${view.x}"><rect x="${view.x}" y="${view.y}" width="${panel}" height="${panel}"/></clipPath><g clip-path="url(#c${view.x})">`);
    if (mode === 'after') {
      if (travel) out.push(rect(travel, 'fill="none" stroke="#3ddc97" stroke-dasharray="10 6" stroke-width="1.5"'));
      for (const holder of holders) out.push(rect(holder.box, 'fill="#c0704f" fill-opacity="0.45" stroke="#e08a63" stroke-width="1.5"'));
      out.push(rect(stock, 'fill="#4488ff" fill-opacity="0.22" stroke="#4488ff" stroke-width="1.5"'));
      if (options.targetBounds) out.push(rect(options.targetBounds, 'fill="none" stroke="#e6ecff" stroke-width="1.2" stroke-dasharray="3 3"'));
    }
    for (const seg of report.segments) {
      const color = mode === 'before' ? '#9fb3c8' : seg.rapid ? '#ff5d5d' : seg.tilted ? '#ffa94d' : '#4dabf7';
      const dash = seg.rapid ? ' stroke-dasharray="5 4"' : '';
      out.push(`<line x1="${X(seg.from).toFixed(1)}" y1="${Y(seg.from).toFixed(1)}" x2="${X(seg.to).toFixed(1)}" y2="${Y(seg.to).toFixed(1)}" stroke="${color}" stroke-width="${seg.rapid ? 1 : 1.6}"${dash}/>`);
    }
    if (mode === 'after') {
      for (const finding of report.findings.filter(f => f.severity !== 'info')) {
        const seg = report.segments.find(entry => entry.line === finding.line) ?? report.segments.find(entry => entry.line > finding.line);
        if (!seg) continue;
        const color = finding.severity === 'error' ? '#ff3b3b' : '#ffd43b';
        out.push(`<circle cx="${X(seg.to).toFixed(1)}" cy="${Y(seg.to).toFixed(1)}" r="7" fill="none" stroke="${color}" stroke-width="2.5"/>`);
      }
    }
    out.push('</g>');
    out.push(`<text x="${view.x + panel - 10}" y="${view.y + panel + 18}" fill="#7d8b99" font-size="13" text-anchor="end">${view.labels[0]} →   ${view.labels[1]} ↑</text>`);
  }

  // Legend + checks.
  let y = 670;
  if (mode === 'after') {
    const legend: Array<[string, string]> = [
      ['#4488ff', 'Stock (RevPack)'], ['#c7d2fe', 'Target bounds'], ['#e08a63', 'Workholding (RevPack)'],
      ['#3ddc97', 'Machine travel reachable by tool tip'], ['#4dabf7', 'Feed'], ['#ffa94d', 'Feed, tool tilted (TCPC/DWO)'], ['#ff5d5d', 'Rapid'],
    ];
    legend.forEach(([color, label], i) => {
      const lx = 40 + (i % 4) * 300;
      const ly = y + Math.floor(i / 4) * 24;
      out.push(`<rect x="${lx}" y="${ly - 12}" width="16" height="16" fill="${color}"/><text x="${lx + 24}" y="${ly + 1}" fill="#cfd8e3" font-size="14">${esc(label)}</text>`);
    });
    y += 64;
    const verdict = report.summary.pass ? 'PASS' : 'FAIL';
    out.push(`<text x="40" y="${y}" fill="${report.summary.pass ? '#3ddc97' : '#ff5d5d'}" font-size="22" font-weight="700">${verdict}: ${report.summary.errors} errors, ${report.summary.warnings} warnings · tools ${report.toolsUsed.map(t => `T${t}`).join(' ')} · offsets ${report.workOffsetsUsed.join(' ') || '(control default)'}</text>`);
    y += 28;
    const checks = Object.entries(report.checks).map(([name, value]) => `${name} ${value.failed === 0 ? '✓' : `✗${value.failed}`} (${value.checked})`).join('   ');
    out.push(`<text x="40" y="${y}" fill="#9fb3c8" font-size="14">${esc(checks)}</text>`);
    y += 26;
    for (const finding of report.findings.filter(f => f.severity !== 'info').slice(0, 9)) {
      out.push(`<text x="40" y="${y}" fill="${finding.severity === 'error' ? '#ff8787' : '#ffd43b'}" font-size="14">${esc(`L${finding.line} ${finding.id}: ${finding.message}`).slice(0, 190)}</text>`);
      y += 21;
    }
  } else {
    for (const note of options.beforeNotes ?? []) {
      out.push(`<text x="40" y="${y}" fill="#cfd8e3" font-size="16">${esc(note)}</text>`);
      y += 26;
    }
  }
  out.push('</svg>');
  return out.join('\n');
}
