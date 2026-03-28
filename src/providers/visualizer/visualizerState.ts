// Handles state management and JSON import/export for the visualizer
export class VisualizerState {
  private state: Record<string, any> = {};

  set(key: string, value: any) { this.state[key] = value; }
  get(key: string) { return this.state[key]; }
  exportJSON() { return JSON.stringify(this.state); }
  importJSON(json: string) { this.state = JSON.parse(json); }
}
