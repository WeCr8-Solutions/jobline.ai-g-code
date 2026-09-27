import { inflateRawSync } from 'node:zlib';
import { decompress } from 'fzstd';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_CAM_DOCUMENT_BYTES = 8 * 1024 * 1024;

export interface FusionSetupMetadata {
  setupName: string;
  operationNames: string[];
  units: 'mm';
  model: {
    width: number;
    depth: number;
    height: number;
  };
  stock: {
    mode: string;
    width: number;
    depth: number;
    height: number;
    sideAllowance: number;
    topAllowance: number;
    bottomAllowance: number;
  };
  workOffset: {
    code: string;
    fusionIndex: number;
    inferred: boolean;
  };
  wcs: {
    orientationMode: string;
    originMode: string;
    originReferencePresent: boolean;
    flipX: boolean;
    flipY: boolean;
    flipZ: boolean;
  };
  fixture: {
    assigned: boolean;
    radialClearance: number;
    axialClearance: number;
  };
  safeZ: {
    mode: string;
    offset: number;
  };
}

function findEocd(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= start; offset--) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  throw new Error('Not a valid Fusion ZIP archive: end record not found.');
}

function readZipEntry(bytes: Uint8Array, wantedSuffix: string): Uint8Array {
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new Error('Fusion archive exceeds the 64 MB metadata limit.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(bytes);
  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();

  for (let index = 0; index < entryCount; index++) {
    if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) throw new Error('Invalid Fusion ZIP directory.');
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)).replace(/\\/g, '/');

    if (name.endsWith(wantedSuffix)) {
      if (uncompressedSize > MAX_CAM_DOCUMENT_BYTES || compressedSize > MAX_CAM_DOCUMENT_BYTES) {
        throw new Error('Fusion CAM metadata exceeds the 8 MB safety limit.');
      }
      if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) throw new Error('Invalid Fusion ZIP entry.');
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
      let result: Uint8Array;
      if (method === 0) result = compressed;
      else if (method === 8) result = inflateRawSync(compressed);
      else if (method === 93) result = decompress(compressed, new Uint8Array(uncompressedSize));
      else throw new Error(`Unsupported Fusion ZIP compression method ${method}.`);
      if (result.length !== uncompressedSize) throw new Error('Fusion CAM metadata size mismatch.');
      return result;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error('Fusion archive contains no active CAM setup document.');
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([A-Za-z_][\w.-]*)="([^"]*)"/g)) result[match[1]] = match[2];
  return result;
}

function parameterMap(setupXml: string): Map<string, Record<string, string>> {
  const result = new Map<string, Record<string, string>>();
  for (const match of setupXml.matchAll(/<Parameter\b[^>]*>/g)) {
    const parsed = attributes(match[0]);
    if (parsed.name) result.set(parsed.name, parsed);
  }
  return result;
}

function numberValue(parameters: Map<string, Record<string, string>>, name: string): number {
  const value = Number(parameters.get(name)?.value);
  if (!Number.isFinite(value)) throw new Error(`Fusion setup is missing numeric parameter ${name}.`);
  return value;
}

function stringValue(parameters: Map<string, Record<string, string>>, name: string, fallback = ''): string {
  return parameters.get(name)?.value ?? fallback;
}

function boolValue(parameters: Map<string, Record<string, string>>, name: string): boolean {
  return stringValue(parameters, name) === 'true';
}

function offsetCode(index: number): string {
  // Fusion documents both 0 (controller default) and 1 as G54, then increments.
  return `G${54 + Math.max(0, index - 1)}`;
}

export function parseFusionSetupArchive(source: Uint8Array): FusionSetupMetadata {
  const documentBytes = readZipEntry(source, 'Iron.Document/theIronDoc.irondoc');
  const xml = new TextDecoder('utf-8', { fatal: true }).decode(documentBytes);
  const setupMatch = xml.match(/<object\b(?=[^>]*strategy="setup")([^>]*)>([\s\S]*?)<\/object>/);
  if (!setupMatch) throw new Error('Fusion CAM document contains no machining setup.');
  const setupAttributes = attributes(setupMatch[1]);
  const setupXml = setupMatch[2];
  const parameters = parameterMap(setupXml);
  const fusionIndex = numberValue(parameters, 'job_workOffset');
  const operationNames = Array.from(xml.matchAll(/<object\b(?=[^>]*parent="2")(?=[^>]*strategy="(?!setup)[^"]+")([^>]*)>/g))
    .map(match => attributes(match[1]).displayName)
    .filter((name): name is string => Boolean(name));
  const fixtureTag = setupXml.match(/<Parameter\b[^>]*name="job_fixture"[^>]*>/)?.[0] ?? '';
  const fixtureAssigned = !/\/\s*>$/.test(fixtureTag) || /value="true"/.test(fixtureTag);
  const originTag = setupXml.match(/<Parameter\b[^>]*name="wcs_origin_point"[^>]*>/)?.[0] ?? '';
  const sideAllowance = numberValue(parameters, 'job_stockOffsetSides');
  const topAllowance = numberValue(parameters, 'job_stockOffsetTop');
  const bottomAllowance = numberValue(parameters, 'job_stockOffsetBottom');
  const modelWidth = numberValue(parameters, 'job_stockFixedX');
  const modelDepth = numberValue(parameters, 'job_stockFixedY');
  const modelHeight = numberValue(parameters, 'job_stockFixedZ');

  return {
    setupName: setupAttributes.displayName || 'Fusion setup',
    operationNames,
    units: 'mm',
    model: { width: modelWidth, depth: modelDepth, height: modelHeight },
    stock: {
      mode: stringValue(parameters, 'job_stockMode', 'unknown'),
      width: modelWidth + sideAllowance * 2,
      depth: modelDepth + sideAllowance * 2,
      height: modelHeight + topAllowance + bottomAllowance,
      sideAllowance,
      topAllowance,
      bottomAllowance,
    },
    workOffset: { code: offsetCode(fusionIndex), fusionIndex, inferred: fusionIndex === 0 },
    wcs: {
      orientationMode: stringValue(parameters, 'wcs_orientation_mode', 'unknown'),
      originMode: stringValue(parameters, 'wcs_origin_mode', 'unknown'),
      originReferencePresent: Boolean(originTag) && !/\/\s*>$/.test(originTag),
      flipX: boolValue(parameters, 'wcs_orientation_flipX'),
      flipY: boolValue(parameters, 'wcs_orientation_flipY'),
      flipZ: boolValue(parameters, 'wcs_orientation_flipZ'),
    },
    fixture: {
      assigned: fixtureAssigned,
      radialClearance: numberValue(parameters, 'radialFixtureClearanceSetup'),
      axialClearance: numberValue(parameters, 'axialFixtureClearanceSetup'),
    },
    safeZ: {
      mode: stringValue(parameters, 'jobSafeZ_mode', 'unknown'),
      offset: numberValue(parameters, 'jobSafeZ_offset'),
    },
  };
}

export function extractFusionPreview(source: Uint8Array): Uint8Array {
  const preview = readZipEntry(source, 'Toolpath[Active]/Previews/big.png');
  if (preview.length < 8 || preview[0] !== 0x89 || preview[1] !== 0x50 || preview[2] !== 0x4e || preview[3] !== 0x47) {
    throw new Error('Fusion archive preview is not a valid PNG image.');
  }
  return preview;
}
