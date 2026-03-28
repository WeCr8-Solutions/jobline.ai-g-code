// Handles toolpath rendering and visibility
export class ToolpathVisualizerCore {
  private visible = true;
  private path: any[] = [];

  setVisibility(visible: boolean) { this.visible = visible; }
  isVisible() { return this.visible; }

  setPath(path: any[]) { this.path = path; }
  getPath() { return this.path; }

  // Add rendering logic here
}
