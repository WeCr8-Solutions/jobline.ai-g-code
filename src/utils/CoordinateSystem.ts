// CoordinateSystem.ts
// Utility for managing global and local coordinate systems for the visualizer
// Provides transformation functions for points and toolpaths

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface CoordinateSystem {
  origin: Vector3; // Offset from global origin
  rotation: [number, number, number]; // Euler angles (radians) for XYZ
}

export function identitySystem(): CoordinateSystem {
  return { origin: { x: 0, y: 0, z: 0 }, rotation: [0, 0, 0] };
}

// Apply translation and rotation (Z-Y-X order)
export function transformPoint(pt: Vector3, system: CoordinateSystem): Vector3 {
  // Apply rotation (simple ZYX Euler)
  const { x, y, z } = pt;
  const [rx, ry, rz] = system.rotation;
  // Rotate around Z
  const x1 = x * Math.cos(rz) - y * Math.sin(rz);
  const y1 = x * Math.sin(rz) + y * Math.cos(rz);
  const z1 = z;
  // Rotate around Y
  const x2 = x1 * Math.cos(ry) + z1 * Math.sin(ry);
  const y2 = y1;
  const z2 = -x1 * Math.sin(ry) + z1 * Math.cos(ry);
  // Rotate around X
  const x3 = x2;
  const y3 = y2 * Math.cos(rx) - z2 * Math.sin(rx);
  const z3 = y2 * Math.sin(rx) + z2 * Math.cos(rx);
  // Apply translation
  return {
    x: x3 + system.origin.x,
    y: y3 + system.origin.y,
    z: z3 + system.origin.z,
  };
}

// Transform an array of points
export function transformPath(path: Vector3[], system: CoordinateSystem): Vector3[] {
  return path.map(pt => transformPoint(pt, system));
}

// Compose two coordinate systems (local in parent)
export function composeSystems(parent: CoordinateSystem, local: CoordinateSystem): CoordinateSystem {
  // For simplicity, just add origins and rotations (not a true matrix multiply, but sufficient for most CAM offsets)
  return {
    origin: {
      x: parent.origin.x + local.origin.x,
      y: parent.origin.y + local.origin.y,
      z: parent.origin.z + local.origin.z,
    },
    rotation: [
      parent.rotation[0] + local.rotation[0],
      parent.rotation[1] + local.rotation[1],
      parent.rotation[2] + local.rotation[2],
    ],
  };
}
