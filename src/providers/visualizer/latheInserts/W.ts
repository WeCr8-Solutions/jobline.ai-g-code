// Trigon (W-type) lathe insert geometry

import * as THREE from 'three';

export function getWInsertShape(size: number, noseRadius: number = 0.4): THREE.Shape {
  // Trigon (approximate as triangle with rounded corners)
  const h = (Math.sqrt(3) / 3) * size;
  const shape = new THREE.Shape();
  shape.moveTo(0, 2 * h / 3 - noseRadius);
  shape.lineTo(-size / 2 + noseRadius, -h / 3);
  shape.lineTo(size / 2 - noseRadius, -h / 3);
  shape.lineTo(0, 2 * h / 3 - noseRadius);
  return shape;
}

export const W_INSERT_LABEL = 'Trigon (W)';
