// Diamond 35° (V-type) lathe insert geometry

import * as THREE from 'three';

export function getVInsertShape(size: number, noseRadius: number = 0.4): THREE.Shape {
  // 35° diamond with rounded corners
  const a = size / 2;
  const angleRad = (35 * Math.PI) / 180;
  const b = a / Math.tan(angleRad / 2);
  const shape = new THREE.Shape();
  shape.moveTo(0, a - noseRadius);
  shape.absarc(b - noseRadius, 0, noseRadius, Math.PI / 2, 0, true);
  shape.lineTo(0, -a + noseRadius);
  shape.absarc(-b + noseRadius, 0, noseRadius, Math.PI, Math.PI / 2, true);
  shape.lineTo(0, a - noseRadius);
  return shape;
}

export const V_INSERT_LABEL = 'Diamond 35° (V)';
