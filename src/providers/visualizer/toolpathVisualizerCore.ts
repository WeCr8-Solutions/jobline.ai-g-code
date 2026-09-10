// Handles toolpath rendering and visibility
export class ToolpathVisualizerCore {
  private visible = true;
  private path: Array<{ x: number; y: number; z: number; }> = [];

  setVisibility(visible: boolean) { this.visible = visible; }
  isVisible() { return this.visible; }

  setPath(path: Array<{ x: number; y: number; z: number; }>) { this.path = path; }
  getPath() { return this.path; }

  // Add rendering logic here
}
