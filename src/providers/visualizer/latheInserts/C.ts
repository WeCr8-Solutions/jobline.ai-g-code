// Diamond 80° (C-type) lathe insert geometry

import * as THREE from 'three';

// Adjustable nose radius for C-type insert
export function getCInsertShape(size: number, noseRadius: number = 0.4): THREE.Shape {
  // 80° diamond with rounded corners (nose radius)
  const a = size / 2;
  const angleRad = (80 * Math.PI) / 180;
  const b = a / Math.tan(angleRad / 2);
  const shape = new THREE.Shape();
  // For simplicity, use arcs at corners for nose radius
  // This is a simplified approach; for full accuracy, use a path with arcTo
  shape.moveTo(0, a - noseRadius);
  shape.absarc(b - noseRadius, 0, noseRadius, Math.PI / 2, 0, true);
  shape.lineTo(0, -a + noseRadius);
  shape.absarc(-b + noseRadius, 0, noseRadius, Math.PI, Math.PI / 2, true);
  shape.lineTo(0, a - noseRadius);
  return shape;
}

export const C_INSERT_LABEL = 'Diamond 80° (C)';
