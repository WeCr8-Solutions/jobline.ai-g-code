import { BufferGeometry } from 'three';

// Handles stock geometry import, rendering, and visibility
export class StockVisualizer {
  private visible = true;
  private geometry: BufferGeometry | null = null;

  setVisibility(visible: boolean) { this.visible = visible; }
  isVisible() { return this.visible; }

  setGeometry(geometry: BufferGeometry) { this.geometry = geometry; }
  getGeometry() { return this.geometry; }

  // Add rendering and import logic here
}
