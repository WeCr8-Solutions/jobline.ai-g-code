// Utility to load/query manufacturer, model, and control type
import machineModels from './machineModels.sample.json';
import type { MachineLibraryEntry } from '../../../types/machineLibrary';

/**
 * Catalog entry used by the visualizer.
 *
 * `controls` lists all control variants known for this machine model
 * (e.g. a DMG MORI NHX may ship with Fanuc 31i, Siemens 840D, or Heidenhain).
 * This is distinct from MachineLibraryEntry.control_type, which records the
 * single control actually installed on a purchased/assigned machine profile.
 *
 * When a full MachineLibraryEntry is available (purchased from the hub
 * marketplace), pass it as the optional `profile` field so the visualizer
 * and diagnostics engine can access travel limits and capabilities.
 */
export interface MachineModel {
  manufacturer: string;
  model: string;
  /** All control variants this machine model can ship with */
  controls: string[];
  /** Full hub profile, present when a machine has been purchased/assigned */
  profile?: MachineLibraryEntry;
}

export function getManufacturers(): string[] {
  return Array.from(new Set(machineModels.map(m => m.manufacturer)));
}

export function getModelsForManufacturer(manu: string): string[] {
  return machineModels.filter(m => m.manufacturer === manu).map(m => m.model);
}

export function getControlsForModel(manu: string, model: string): string[] {
  const entry = machineModels.find(m => m.manufacturer === manu && m.model === model);
  return entry ? entry.controls : [];
}

// Placeholder for mapping control types to G-code/M-code templates
export function getTemplateForControl(control: string): string {
  // TODO: Implement real template lookup
  return `Template for ${control}`;
}
