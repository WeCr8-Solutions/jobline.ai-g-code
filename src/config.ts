/**
 * JobLine Configuration Manager
 *
 * Reads VS Code workspace settings into the typed JobLineConfig interface.
 * Provides a singleton that updates when settings change.
 */

import { JobLineConfig, ControlType, MachineType } from './parser/types';

// Default configuration (used when VS Code API not available, e.g., in tests)
const DEFAULT_CONFIG: JobLineConfig = {
  controlType: 'fanuc',
  machineType: 'mill',
  units: 'inch',
  validation: {
    enableSafetyChecks: true,
    enableArcValidation: true,
    arcTolerance: 0.001,
  },
  formatter: {
    wordSpacing: true,
    decimalPlaces: null,
    uppercaseGM: true,
  },
};

let currentConfig: JobLineConfig = { ...DEFAULT_CONFIG };

/**
 * Load configuration from VS Code settings.
 * Call this on activation and when settings change.
 */
export function loadConfig(getConfig: (key: string) => unknown): JobLineConfig {
  currentConfig = {
    controlType: (getConfig('jobline.controlType') as ControlType) ?? DEFAULT_CONFIG.controlType,
    machineType: (getConfig('jobline.machineType') as MachineType) ?? DEFAULT_CONFIG.machineType,
    units: (getConfig('jobline.units') as 'inch' | 'metric') ?? DEFAULT_CONFIG.units,
    validation: {
      enableSafetyChecks: (getConfig('jobline.validation.enableSafetyChecks') as boolean) ?? true,
      enableArcValidation: (getConfig('jobline.validation.enableArcValidation') as boolean) ?? true,
      arcTolerance: (getConfig('jobline.validation.arcTolerance') as number) ?? 0.001,
    },
    formatter: {
      wordSpacing: (getConfig('jobline.formatter.wordSpacing') as boolean) ?? true,
      decimalPlaces: (getConfig('jobline.formatter.decimalPlaces') as number | null) ?? null,
      uppercaseGM: (getConfig('jobline.formatter.uppercaseGM') as boolean) ?? true,
    },
  };
  return currentConfig;
}

/** Get current configuration */
export function getJobLineConfig(): JobLineConfig {
  return currentConfig;
}

/** Get default configuration (for tests) */
export function getDefaultConfig(): JobLineConfig {
  return { ...DEFAULT_CONFIG };
}
