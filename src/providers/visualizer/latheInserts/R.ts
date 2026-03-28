// Round (R-type) lathe insert geometry

import * as THREE from 'three';

export function getRInsertShape(size: number, noseRadius: number = 0.4): THREE.Shape {
  // Round insert: nose radius is the full radius
  const shape = new THREE.Shape();
  shape.absarc(0, 0, (size / 2) - noseRadius, 0, Math.PI * 2, false);
  return shape;
}

export const R_INSERT_LABEL = 'Round (R)';
