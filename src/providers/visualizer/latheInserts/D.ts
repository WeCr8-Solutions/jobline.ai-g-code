// Diamond 55° (D-type) lathe insert geometry

import * as THREE from 'three';

export function getDInsertShape(size: number, noseRadius: number = 0.4): THREE.Shape {
  // 55° diamond with rounded corners
  const a = size / 2;
  const angleRad = (55 * Math.PI) / 180;
  const b = a / Math.tan(angleRad / 2);
  const shape = new THREE.Shape();
  shape.moveTo(0, a - noseRadius);
  shape.absarc(b - noseRadius, 0, noseRadius, Math.PI / 2, 0, true);
  shape.lineTo(0, -a + noseRadius);
  shape.absarc(-b + noseRadius, 0, noseRadius, Math.PI, Math.PI / 2, true);
  shape.lineTo(0, a - noseRadius);
  return shape;
}

export const D_INSERT_LABEL = 'Diamond 55° (D)';
