// Message types and helpers for extension <-> webview communication
export type VisualizerMessage =
  | { type: 'toggle', layer: string, visible: boolean }
  | { type: 'importStock', name: string, data: ArrayBuffer }
  | { type: 'importFixture', name: string, data: ArrayBuffer }
  | { type: 'manualStock' }
  | { type: 'manualFixture' }
  | { type: 'update', path: string[], cutterSize: number, highlightIdx: number };

// Add more message types as needed
