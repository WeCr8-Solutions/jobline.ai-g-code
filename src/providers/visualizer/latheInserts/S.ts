// Square (S-type) lathe insert geometry

import * as THREE from 'three';

export function getSInsertShape(size: number, noseRadius: number = 0.4): THREE.Shape {
  // Square with rounded corners
  const h = size / 2 - noseRadius;
  const shape = new THREE.Shape();
  shape.moveTo(-h, -h + noseRadius);
  shape.absarc(-h, -h, noseRadius, Math.PI, Math.PI * 1.5, false);
  shape.lineTo(h, -h - noseRadius);
  shape.absarc(h, -h, noseRadius, Math.PI * 1.5, 0, false);
  shape.lineTo(h + noseRadius, h);
  shape.absarc(h, h, noseRadius, 0, Math.PI * 0.5, false);
  shape.lineTo(-h, h + noseRadius);
  shape.absarc(-h, h, noseRadius, Math.PI * 0.5, Math.PI, false);
  shape.lineTo(-h, -h + noseRadius);
  return shape;
}

export const S_INSERT_LABEL = 'Square (S)';
