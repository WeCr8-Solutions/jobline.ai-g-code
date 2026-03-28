/**
 * MachineLibraryEntry — shared interface with shift-handover-hub.
 *
 * This is a verbatim copy of the interface defined in:
 *   hub: src/hooks/useStationMachineProfile.ts → MachineLibraryEntry
 *
 * Source of truth: shift-handover-hub. When the hub adds or removes fields,
 * update this file to match.
 *
 * Used in the g-code extension for:
 *   - Enriching the visualizer with machine travel limits and capabilities
 *   - Validating that programmed axis positions stay within machine travel
 *   - Surfacing machine specs in the sidebar (control type, spindle, tooling)
 */
export interface MachineLibraryEntry {
  id: string;
  manufacturer: string;
  model: string;
  /** Detailed machine type (e.g. "3-Axis Vertical Mill", "Swiss") */
  machine_type: string;
  /** Broad platform category (e.g. "CNC Machine", "CMM") */
  platform_category: string;

  // ── Axis travel (mm) ────────────────────────────────────────────────────────
  max_x_travel: number | null;
  max_y_travel: number | null;
  max_z_travel: number | null;

  // ── Part envelope ────────────────────────────────────────────────────────────
  max_part_weight: number | null;           // lbs
  max_part_envelope_length: number | null;  // in
  max_part_envelope_width: number | null;   // in
  max_part_envelope_height: number | null;  // in

  // ── Machine capabilities (boolean flags) ─────────────────────────────────────
  five_axis_simultaneous: boolean;
  fourth_axis: boolean;
  live_tooling: boolean;
  y_axis_turn: boolean;
  sub_spindle: boolean;
  probing: boolean;
  through_spindle_coolant: boolean;
  pallet_pool: boolean;
  bar_feeder: boolean;

  // ── Material capability ───────────────────────────────────────────────────────
  /** e.g. ["Aluminum", "Steel", "Titanium"] */
  material_capability: string[];

  /** Typical achievable tolerance (±inches) */
  typical_tolerance: number | null;

  /** Hard programming constraints (reserved for future structured rules) */
  hard_constraints: unknown[];

  /** Whether this entry has been verified by JobLine platform team */
  is_verified: boolean;

  // ── Spindle & tooling specs ──────────────────────────────────────────────────
  max_spindle_rpm: number | null;
  /** Taper standard, e.g. "CAT40", "HSK-A63" */
  spindle_taper: string | null;
  spindle_power_hp: number | null;
  tool_magazine_capacity: number | null;
  max_tool_diameter: number | null;   // mm
  max_tool_length: number | null;     // mm

  // ── Controller info ───────────────────────────────────────────────────────────
  /** Display name, e.g. "Fanuc", "Siemens", "HAAS" */
  control_type: string | null;
  /** Specific model, e.g. "31i", "840D sl" */
  control_model: string | null;

  // ── Turning specs ─────────────────────────────────────────────────────────────
  max_turning_diameter: number | null;  // mm
  max_turning_length: number | null;    // mm
  bar_capacity_mm: number | null;

  // ── Media ────────────────────────────────────────────────────────────────────
  image_url: string | null;
  datasheet_url: string | null;
}
