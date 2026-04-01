// Handles state management and JSON import/export for the visualizer
export class VisualizerState {
  private state: Record<string, unknown> = {};

  set(key: string, value: unknown) { this.state[key] = value; }
  get(key: string): unknown { return this.state[key]; }
  exportJSON(): string { return JSON.stringify(this.state); }
  importJSON(json: string): void { this.state = JSON.parse(json); }
}
