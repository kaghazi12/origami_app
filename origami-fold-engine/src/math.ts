export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/**
 * 4x4 matrix as 16 numbers in column-major order.
 * Same layout as THREE.Matrix4.elements, so `new THREE.Matrix4().fromArray(m)` works directly.
 */
export type Mat4 = number[];

/** Distances smaller than this (in paper units) count as "on the crease line". */
export const EPS = 1e-7;

export function mat4Identity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function mat4Translation(x: number, y: number, z: number): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

/** a * b: applies b first, then a. */
export function mat4Mul(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/** Rotation by `angle` radians (right-hand rule) about the line through `point` with unit direction `axis`. */
export function mat4RotateAboutLine(point: Vec3, axis: Vec3, angle: number): Mat4 {
  const [x, y, z] = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  // Rodrigues' rotation formula, written column by column.
  const rotation: Mat4 = [
    t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0,
    t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
    t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0,
    0, 0, 0, 1,
  ];
  return mat4Mul(
    mat4Translation(point[0], point[1], point[2]),
    mat4Mul(rotation, mat4Translation(-point[0], -point[1], -point[2])),
  );
}

export function mat4Apply(m: Mat4, p: Vec3): Vec3 {
  const [x, y, z] = p;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/** Signed area of a simple polygon (positive when counter-clockwise). */
export function signedArea(poly: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    sum += x0 * y1 - x1 * y0;
  }
  return sum / 2;
}
