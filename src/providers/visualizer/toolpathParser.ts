export interface ToolpathPoint {
  x: number;
  y: number;
  z?: number;
  a?: number;
  b?: number;
  c?: number;
  isRapid?: boolean;
  mStop?: 'M0' | 'M1' | 'M2' | 'M30';
  lineNumber?: number;
}

function executableText(line: string): string {
  let result = '';
  let commentDepth = 0;
  for (const character of line) {
    if (character === '(') commentDepth++;
    else if (character === ')' && commentDepth > 0) commentDepth--;
    else if (character === ';' && commentDepth === 0) break;
    else if (commentDepth === 0) result += character;
  }
  return result;
}

function addressValue(line: string, letter: string): number | null {
  const match = line.match(new RegExp(`${letter}\\s*([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+))`, 'i'));
  return match ? Number.parseFloat(match[1]) : null;
}

function hasCode(line: string, letter: 'G' | 'M', code: string): boolean {
  return new RegExp(`${letter}0*${code}(?=[A-Z+\\-\\s]|$)`, 'i').test(line);
}

const ARC_SEGMENTS_PER_CIRCLE = 360;

function tessellateArc(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  iOff: number | null,
  jOff: number | null,
  kOff: number | null,
  rVal: number | null,
  cw: boolean,
  plane: 17 | 18 | 19,
  lineNumber: number
): ToolpathPoint[] {
  let a0: number;
  let b0: number;
  let a1: number;
  let b1: number;
  let hStart: number;
  let hEnd: number;
  let iA: number | null;
  let iB: number | null;

  if (plane === 17) {
    a0 = x0; b0 = y0; a1 = x1; b1 = y1; hStart = z0; hEnd = z1;
    iA = iOff; iB = jOff;
  } else if (plane === 18) {
    a0 = x0; b0 = z0; a1 = x1; b1 = z1; hStart = y0; hEnd = y1;
    iA = iOff; iB = kOff;
  } else {
    a0 = y0; b0 = z0; a1 = y1; b1 = z1; hStart = x0; hEnd = x1;
    iA = jOff; iB = kOff;
  }

  let cA: number;
  let cB: number;

  if (rVal !== null && rVal !== 0) {
    const r = Math.abs(rVal);
    const dx = a1 - a0;
    const dy = b1 - b0;
    const chord = Math.sqrt(dx * dx + dy * dy);
    if (chord < 1e-9) return [];
    const h = Math.sqrt(Math.max(r * r - (chord / 2) * (chord / 2), 0));
    const mx = (a0 + a1) / 2;
    const my = (b0 + b1) / 2;
    const px = -dy / chord;
    const py = dx / chord;
    const side = (rVal > 0 ? 1 : -1) * (cw ? -1 : 1);
    cA = mx + px * h * side;
    cB = my + py * h * side;
  } else if (iA !== null || iB !== null) {
    cA = a0 + (iA ?? 0);
    cB = b0 + (iB ?? 0);
  } else {
    return [{ x: x1, y: y1, z: z1, isRapid: false, lineNumber }];
  }

  const radius = Math.sqrt((a0 - cA) ** 2 + (b0 - cB) ** 2);
  if (radius < 1e-9) return [];

  const startAngle = Math.atan2(b0 - cB, a0 - cA);
  const endAngle = Math.atan2(b1 - cB, a1 - cA);

  let sweep: number;
  if (cw) {
    sweep = endAngle - startAngle;
    if (sweep > 0) sweep -= 2 * Math.PI;
  } else {
    sweep = endAngle - startAngle;
    if (sweep < 0) sweep += 2 * Math.PI;
  }

  if (Math.abs(sweep) < 1e-6) {
    sweep = cw ? -2 * Math.PI : 2 * Math.PI;
  }

  const nSegs = Math.max(3, Math.round(Math.abs(sweep) / (2 * Math.PI) * ARC_SEGMENTS_PER_CIRCLE));
  const dAngle = sweep / nSegs;
  const dH = (hEnd - hStart) / nSegs;
  const pts: ToolpathPoint[] = [];

  for (let index = 1; index <= nSegs; index++) {
    const angle = startAngle + dAngle * index;
    const pA = cA + radius * Math.cos(angle);
    const pB = cB + radius * Math.sin(angle);
    const pH = hStart + dH * index;

    let px: number;
    let py: number;
    let pz: number;
    if (plane === 17) {
      px = pA; py = pB; pz = pH;
    } else if (plane === 18) {
      px = pA; py = pH; pz = pB;
    } else {
      px = pH; py = pA; pz = pB;
    }
    pts.push({ x: px, y: py, z: pz, isRapid: false, lineNumber });
  }

  return pts;
}

export function parseGCodeToPath(gcode: string): { path: ToolpathPoint[]; units: 'in' | 'mm' } {
  const lines = gcode.split(/\r?\n/);
  let x = 0;
  let y = 0;
  let z = 0;
  let a = 0;
  let b = 0;
  let c = 0;
  let units: 'in' | 'mm' = 'in';
  let motionMode = 0;
  let plane: 17 | 18 | 19 = 17;
  let absolute = true;
  let activeCycle: number | null = null;
  let cycleZ: number | null = null;
  let cycleR: number | null = null;
  let cycleInitialZ = 0;
  let returnToInitial = true;
  const path: ToolpathPoint[] = [{ x, y, z }];

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const upper = executableText(lines[lineNum]).toUpperCase();

    if (!upper.trim() || /^\s*%/.test(upper)) continue;
    if (hasCode(upper, 'G', '20')) units = 'in';
    if (hasCode(upper, 'G', '21')) units = 'mm';
    if (hasCode(upper, 'G', '17')) plane = 17;
    if (hasCode(upper, 'G', '18')) plane = 18;
    if (hasCode(upper, 'G', '19')) plane = 19;
    if (hasCode(upper, 'G', '90')) absolute = true;
    if (hasCode(upper, 'G', '91')) absolute = false;
    if (hasCode(upper, 'G', '98')) returnToInitial = true;
    if (hasCode(upper, 'G', '99')) returnToInitial = false;
    if (hasCode(upper, 'G', '80')) activeCycle = null;

    let mStop: ToolpathPoint['mStop'] | undefined;
    if (hasCode(upper, 'M', '0')) mStop = 'M0';
    if (hasCode(upper, 'M', '1')) mStop = 'M1';
    if (hasCode(upper, 'M', '2')) mStop = 'M2';
    if (hasCode(upper, 'M', '30')) mStop = 'M30';

    const gMotion = upper.match(/G0*([0123])(?=[A-Z+\-\s]|$)/);
    if (gMotion) motionMode = parseInt(gMotion[1], 10);

    const xVal = addressValue(upper, 'X');
    const yVal = addressValue(upper, 'Y');
    const zVal = addressValue(upper, 'Z');
    const iVal = addressValue(upper, 'I');
    const jVal = addressValue(upper, 'J');
    const kVal = addressValue(upper, 'K');
    const rVal = addressValue(upper, 'R');
    const aVal = addressValue(upper, 'A');
    const bVal = addressValue(upper, 'B');
    const cVal = addressValue(upper, 'C');
    const cycleMatch = upper.match(/G0*(7[3489]|8[1-9])(?=[A-Z+\-\s]|$)/);
    if (cycleMatch) {
      activeCycle = Number.parseInt(cycleMatch[1], 10);
      cycleInitialZ = z;
    }
    if (activeCycle !== null) {
      if (zVal !== null) cycleZ = absolute ? zVal : z + zVal;
      if (rVal !== null) cycleR = absolute ? rVal : z + rVal;
    }
    const hasMove = xVal !== null || yVal !== null || zVal !== null;

    const nextA = aVal !== null ? (absolute ? aVal : a + aVal) : a;
    const nextB = bVal !== null ? (absolute ? bVal : b + bVal) : b;
    const nextC = cVal !== null ? (absolute ? cVal : c + cVal) : c;
    const rotary = nextA !== 0 || nextB !== 0 || nextC !== 0 ? { a: nextA, b: nextB, c: nextC } : {};

    if (activeCycle !== null && (xVal !== null || yVal !== null) && cycleZ !== null && cycleR !== null) {
      const holeX = xVal !== null ? (absolute ? xVal : x + xVal) : x;
      const holeY = yVal !== null ? (absolute ? yVal : y + yVal) : y;
      path.push({ x: holeX, y: holeY, z: cycleR, ...rotary, isRapid: true, lineNumber: lineNum });
      path.push({ x: holeX, y: holeY, z: cycleZ, ...rotary, isRapid: false, lineNumber: lineNum });
      const retractZ = returnToInitial ? Math.max(cycleInitialZ, cycleR) : cycleR;
      path.push({ x: holeX, y: holeY, z: retractZ, ...rotary, isRapid: true, lineNumber: lineNum });
      x = holeX; y = holeY; z = retractZ; a = nextA; b = nextB; c = nextC;
      continue;
    }

    if (!hasMove && aVal === null && bVal === null && cVal === null && !mStop) continue;

    const x1 = xVal !== null ? (absolute ? xVal : x + xVal) : x;
    const y1 = yVal !== null ? (absolute ? yVal : y + yVal) : y;
    const z1 = zVal !== null ? (absolute ? zVal : z + zVal) : z;

    if (motionMode === 2 || motionMode === 3) {
      path.push(...tessellateArc(x, y, z, x1, y1, z1, iVal, jVal, kVal, rVal, motionMode === 2, plane, lineNum));
    } else {
      path.push({ x: x1, y: y1, z: z1, ...rotary, isRapid: motionMode === 0, mStop, lineNumber: lineNum });
    }

    x = x1;
    y = y1;
    z = z1;
    a = nextA;
    b = nextB;
    c = nextC;
  }

  return { path, units };
}
