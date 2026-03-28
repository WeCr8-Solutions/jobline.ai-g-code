// Utility to load and query manufacturer/model data
import * as path from 'path';
import * as fs from 'fs';

let manufacturersCache: Record<string, string[]> | null = null;

function loadManufacturers(): Record<string, string[]> {
  if (manufacturersCache) return manufacturersCache;

  let result: Record<string, string[]> = {};
  const manufPath = path.join(__dirname, '../../../machines/manufacturers.json');
  if (fs.existsSync(manufPath)) {
    try {
      const data = fs.readFileSync(manufPath, 'utf-8');
      result = JSON.parse(data);
    } catch (err) {
      console.warn('Failed to load manufacturers.json:', err);
    }
  }
  manufacturersCache = result;
  return result;
}

export function getManufacturers(): string[] {
  return Object.keys(loadManufacturers());
}

export function getModelsForManufacturer(manu: string): string[] {
  return loadManufacturers()[manu] || [];
}
