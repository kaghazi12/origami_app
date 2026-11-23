/**
 * Small vector / matrix helpers for the design engine. No dependencies.
 * Mat4 is column-major (same layout as THREE.Matrix4.elements).
 */

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Mat4 = number[];

/** Length tolerance. Internal paper coordinates are normalised so the sheet's longest side is 1. */
export const EPS = 1e-7;
/** Area tolerance for "these two faces really overlap". */
export const AREA_EPS = 1e-8;

export const sub2 = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const add2 = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const scale2 = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];
export const dot2 = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
export const cross2 = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];
export const len2 = (a: Vec2): number => Math.sqrt(a[0] * a[0] + a[1] * a[1]);
export const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const dist2 = (a: Vec2, b: Vec2): number => len2(sub2(a, b));

export function normalize2(a: Vec2): Vec2 {
  const l = len2(a);
  return l < 1e-15 ? [0, 0] : [a[0] / l, a[1] / l];
}

export function mat4Identity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** a * b (b is applied first). */
export function mat4Mul(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[row] * b[col * 4] + a[4 + row] * b[col * 4 + 1] + a[8 + row] * b[col * 4 + 2] + a[12 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

/** Rotation by `angle` (right-hand rule) about the line through `p` with unit direction `axis`. */
export function mat4RotateAboutLine(p: Vec3, axis: Vec3, angle: number): Mat4 {
  const [x, y, z] = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  const r00 = t * x * x + c, r01 = t * x * y - s * z, r02 = t * x * z + s * y;
  const r10 = t * x * y + s * z, r11 = t * y * y + c, r12 = t * y * z - s * x;
  const r20 = t * x * z - s * y, r21 = t * y * z + s * x, r22 = t * z * z + c;
  // translation = p - R p
  const tx = p[0] - (r00 * p[0] + r01 * p[1] + r02 * p[2]);
  const ty = p[1] - (r10 * p[0] + r11 * p[1] + r12 * p[2]);
  const tz = p[2] - (r20 * p[0] + r21 * p[1] + r22 * p[2]);
  return [r00, r10, r20, 0, r01, r11, r21, 0, r02, r12, r22, 0, tx, ty, tz, 1];
}

export function mat4Apply(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/** Map a paper point (z = 0) and return only the world x, y. */
export function mat4Apply2(m: Mat4, p: Vec2): Vec2 {
  return [m[0] * p[0] + m[4] * p[1] + m[12], m[1] * p[0] + m[5] * p[1] + m[13]];
}

/** Inverse of a rigid transform (rotation + translation). */
export function mat4InvertRigid(m: Mat4): Mat4 {
  const tx = m[12], ty = m[13], tz = m[14];
  return [
    m[0], m[4], m[8], 0,
    m[1], m[5], m[9], 0,
    m[2], m[6], m[10], 0,
    -(m[0] * tx + m[1] * ty + m[2] * tz),
    -(m[4] * tx + m[5] * ty + m[6] * tz),
    -(m[8] * tx + m[9] * ty + m[10] * tz),
    1,
  ];
}

/** Largest absolute difference between two matrices' entries. */
export function mat4MaxDiff(a: Mat4, b: Mat4): number {
  let d = 0;
  for (let i = 0; i < 16; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
  return d;
}

/** +1 when the paper's front side faces the viewer (+z), -1 when flipped. 0 if standing up. */
export function faceSign(m: Mat4): number {
  const z = m[10];
  return z > 0.5 ? 1 : z < -0.5 ? -1 : 0;
}

/** True when the transform keeps the paper in the table plane (flat state). */
export function isFlatTransform(m: Mat4): boolean {
  return Math.abs(Math.abs(m[10]) - 1) < 1e-6 && Math.abs(m[14]) < 1e-6;
}
