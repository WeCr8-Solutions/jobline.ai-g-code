/**
 * Canonical machine-profile constants — sourced from shift-handover-hub.
 *
 * These mirror the exports in hub's src/hooks/useStationMachineProfile.ts.
 * When the hub's constants change, update this file to match.
 */

export const MANUFACTURERS = [
  "DMG MORI",
  "HAAS",
  "Mazak",
  "Okuma",
  "Doosan",
  "Hermle",
  "Makino",
  "Hurco",
  "Toyoda",
  "Matsuura",
  "Kitamura",
  "Brother",
  "Nakamura-Tome",
  "Star",
  "Citizen",
  "Tsugami",
  "Hardinge",
  "Flow",
  "OMAX",
  "Trumpf",
  "Amada",
  "Sodick",
  "Mitsubishi",
  "GF Machining",
  "Hexagon",
  "Zeiss",
  "Okamoto",
  "Studer",
  "Other",
] as const;

export type Manufacturer = typeof MANUFACTURERS[number];

export const CONTROL_TYPES = [
  "Fanuc",
  "HAAS",
  "Siemens",
  "Mazatrol",
  "Okuma OSP",
  "Heidenhain",
  "Mitsubishi",
  "Fagor",
  "Manual",
  "Other",
] as const;

export type ControlTypeName = typeof CONTROL_TYPES[number];

export const MACHINE_TYPES = [
  "3-Axis Vertical Mill",
  "4-Axis Mill",
  "5-Axis Mill (Trunnion)",
  "5-Axis Mill (Table/Table)",
  "Horizontal Mill",
  "Turn Center (2-Axis)",
  "Turn/Mill (Y-Axis)",
  "Swiss",
  "CMM",
  "Laser",
  "Waterjet",
  "EDM Wire",
  "EDM Sinker",
  "Surface Grinder",
  "Cylindrical Grinder",
  "Other",
] as const;

export type MachineTypeName = typeof MACHINE_TYPES[number];

export const SPINDLE_TAPERS = [
  "CAT40",
  "CAT50",
  "BT30",
  "BT40",
  "BT50",
  "HSK-A63",
  "HSK-A100",
  "HSK-E40",
  "HSK-E50",
  "R8",
  "MT2",
  "MT3",
  "MT4",
  "MT5",
  "5C",
  "16C",
  "Other",
] as const;

export type SpindleTaper = typeof SPINDLE_TAPERS[number];
