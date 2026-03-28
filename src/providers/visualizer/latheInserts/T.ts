// Triangle (T-type) lathe insert geometry

import * as THREE from 'three';

export function getTInsertShape(size: number, noseRadius: number = 0.4): THREE.Shape {
  // Equilateral triangle with rounded corners
  const h = (Math.sqrt(3) / 3) * size;
  const shape = new THREE.Shape();
  // For simplicity, just use sharp corners (rounded corners can be added with arcTo for full accuracy)
  shape.moveTo(0, 2 * h / 3 - noseRadius);
  shape.lineTo(-size / 2 + noseRadius, -h / 3);
  shape.lineTo(size / 2 - noseRadius, -h / 3);
  shape.lineTo(0, 2 * h / 3 - noseRadius);
  return shape;
}

export const T_INSERT_LABEL = 'Triangle (T)';
