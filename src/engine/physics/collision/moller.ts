/**
 * Exact Triangle-Triangle Intersection Test
 * 
 * Implementation of Tomas Möller's algorithm:
 * "A Fast Triangle-Triangle Intersection Test", Journal of Graphics Tools, 2(2):25-30, 1997.
 */

type Vec3 = [number, number, number] | Float64Array;

function cross(out: [number, number, number], a: Vec3, b: Vec3): void {
  out[0] = a[1] * b[2] - a[2] * b[1];
  out[1] = a[2] * b[0] - a[0] * b[2];
  out[2] = a[0] * b[1] - a[1] * b[0];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function sub(out: [number, number, number], a: Vec3, b: Vec3): void {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  out[2] = a[2] - b[2];
}

const EPSILON = 1e-6;

/**
 * Tests 2D triangle-triangle overlap for coplanar triangles projected to 2D
 */
function edgeCheck2D(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  p: [number, number]
): boolean {
  // Is p strictly on the same side of line ab as c? The tolerance is relative to the triangle's
  // size: an absolute tolerance on the product of two areas (the old `cp1 * cp2 >= -1e-6`)
  // accepted almost any point for triangles a few hundredths across.
  const cp1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const cp2 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (cp2 === 0) return false;
  return Math.sign(cp2) * cp1 > REL_EPS * Math.abs(cp2);
}

/** Relative tolerance for the 2D (coplanar) tests: touching at an edge or corner is not overlap. */
const REL_EPS = 1e-9;

function pointInTriangle2D(
  p: [number, number],
  a: [number, number],
  b: [number, number],
  c: [number, number]
): boolean {
  return (
    edgeCheck2D(a, b, c, p) &&
    edgeCheck2D(b, c, a, p) &&
    edgeCheck2D(c, a, b, p)
  );
}

function segIntersect2D(
  p1: [number, number],
  q1: [number, number],
  p2: [number, number],
  q2: [number, number]
): boolean {
  const d1 = (q2[0] - p2[0]) * (p1[1] - p2[1]) - (q2[1] - p2[1]) * (p1[0] - p2[0]);
  const d2 = (q2[0] - p2[0]) * (q1[1] - p2[1]) - (q2[1] - p2[1]) * (q1[0] - p2[0]);
  const d3 = (q1[0] - p1[0]) * (p2[1] - p1[1]) - (q1[1] - p1[1]) * (p2[0] - p1[0]);
  const d4 = (q1[0] - p1[0]) * (q2[1] - p1[1]) - (q1[1] - p1[1]) * (q2[0] - p1[0]);
  // tolerance scaled by the segments' lengths (these are areas)
  const t = REL_EPS * Math.hypot(q1[0] - p1[0], q1[1] - p1[1]) * Math.hypot(q2[0] - p2[0], q2[1] - p2[1]);

  return (
    ((d1 > t && d2 < -t) || (d1 < -t && d2 > t)) &&
    ((d3 > t && d4 < -t) || (d3 < -t && d4 > t))
  );
}

function coplanarTrianglesOverlap(
  V0: Vec3,
  V1: Vec3,
  V2: Vec3,
  U0: Vec3,
  U1: Vec3,
  U2: Vec3,
  N: [number, number, number]
): boolean {
  // Project onto 2D plane by dropping the coordinate with the largest normal component
  let i0 = 0, i1 = 1;
  const absX = Math.abs(N[0]);
  const absY = Math.abs(N[1]);
  const absZ = Math.abs(N[2]);

  if (absX > absY && absX > absZ) {
    i0 = 1;
    i1 = 2;
  } else if (absY > absZ) {
    i0 = 0;
    i1 = 2;
  }

  const v0_2d: [number, number] = [V0[i0], V0[i1]];
  const v1_2d: [number, number] = [V1[i0], V1[i1]];
  const v2_2d: [number, number] = [V2[i0], V2[i1]];

  const u0_2d: [number, number] = [U0[i0], U0[i1]];
  const u1_2d: [number, number] = [U1[i0], U1[i1]];
  const u2_2d: [number, number] = [U2[i0], U2[i1]];

  // Check edge-edge crossings
  const edgesV: [ [number, number], [number, number] ][] = [
    [v0_2d, v1_2d],
    [v1_2d, v2_2d],
    [v2_2d, v0_2d],
  ];
  const edgesU: [ [number, number], [number, number] ][] = [
    [u0_2d, u1_2d],
    [u1_2d, u2_2d],
    [u2_2d, u0_2d],
  ];

  for (const [p1, q1] of edgesV) {
    for (const [p2, q2] of edgesU) {
      if (segIntersect2D(p1, q1, p2, q2)) return true;
    }
  }

  // Check point containment
  if (pointInTriangle2D(u0_2d, v0_2d, v1_2d, v2_2d)) return true;
  if (pointInTriangle2D(v0_2d, u0_2d, u1_2d, u2_2d)) return true;

  return false;
}

/**
 * Computes interval [t0, t1] along the intersection line of the two triangle planes
 */
function computeInterval(
  VV0: number,
  VV1: number,
  VV2: number,
  D0: number,
  D1: number,
  D2: number
): [number, number] {
  let isect0 = 0, isect1 = 0;

  if (D0 * D1 > 0.0) {
    isect0 = VV0 + (VV2 - VV0) * (D0 / (D0 - D2));
    isect1 = VV1 + (VV2 - VV1) * (D1 / (D1 - D2));
  } else if (D0 * D2 > 0.0) {
    isect0 = VV0 + (VV1 - VV0) * (D0 / (D0 - D1));
    isect1 = VV2 + (VV1 - VV2) * (D2 / (D2 - D1));
  } else if (D1 * D2 > 0.0) {
    isect0 = VV1 + (VV0 - VV1) * (D1 / (D1 - D0));
    isect1 = VV2 + (VV0 - VV2) * (D2 / (D2 - D0));
  } else if (D0 === 0.0) {
    isect0 = VV0;
    if (D1 * D2 < 0.0) {
      isect1 = VV1 + (VV2 - VV1) * (D1 / (D1 - D2));
    } else if (D1 === 0.0) {
      isect1 = VV1;
    } else {
      isect1 = VV2;
    }
  } else if (D1 === 0.0) {
    isect0 = VV1;
    if (D0 * D2 < 0.0) {
      isect1 = VV0 + (VV2 - VV0) * (D0 / (D0 - D2));
    } else if (D2 === 0.0) {
      isect1 = VV2;
    } else {
      isect1 = VV0;
    }
  } else if (D2 === 0.0) {
    isect0 = VV2;
    if (D0 * D1 < 0.0) {
      isect1 = VV0 + (VV1 - VV0) * (D0 / (D0 - D1));
    } else if (D0 === 0.0) {
      isect1 = VV0;
    } else {
      isect1 = VV1;
    }
  }

  return isect0 < isect1 ? [isect0, isect1] : [isect1, isect0];
}

/**
 * Exact Tomas Möller (1997) Triangle-Triangle Intersection Test
 * Returns true if triangle (V0, V1, V2) intersects triangle (U0, U1, U2).
 */
export function checkTriangleTriangleIntersection(
  V0: Vec3,
  V1: Vec3,
  V2: Vec3,
  U0: Vec3,
  U1: Vec3,
  U2: Vec3
): boolean {
  // Triangle 1 edges & plane normal (normalized)
  const e1: [number, number, number] = [0, 0, 0];
  const e2: [number, number, number] = [0, 0, 0];
  const N1: [number, number, number] = [0, 0, 0];
  sub(e1, V1, V0);
  sub(e2, V2, V0);
  cross(N1, e1, e2);
  const n1Len = Math.hypot(N1[0], N1[1], N1[2]);
  if (n1Len < 1e-12) return false;
  N1[0] /= n1Len; N1[1] /= n1Len; N1[2] /= n1Len;
  const d1 = -dot(N1, V0);

  // Signed distances of U to plane of V (in meters)
  let du0 = dot(N1, U0) + d1;
  let du1 = dot(N1, U1) + d1;
  let du2 = dot(N1, U2) + d1;

  if (Math.abs(du0) < EPSILON) du0 = 0.0;
  if (Math.abs(du1) < EPSILON) du1 = 0.0;
  if (Math.abs(du2) < EPSILON) du2 = 0.0;

  // If all points of U lie on same side of plane of V (all >= 0 or all <= 0)
  if ((du0 >= 0 && du1 >= 0 && du2 >= 0) || (du0 <= 0 && du1 <= 0 && du2 <= 0)) {
    // If not strictly coplanar (at least one vertex strictly off-plane), no piercing is possible
    if (du0 !== 0 || du1 !== 0 || du2 !== 0) {
      return false;
    }
  }

  // Triangle 2 edges & plane normal (normalized)
  const f1: [number, number, number] = [0, 0, 0];
  const f2: [number, number, number] = [0, 0, 0];
  const N2: [number, number, number] = [0, 0, 0];
  sub(f1, U1, U0);
  sub(f2, U2, U0);
  cross(N2, f1, f2);
  const n2Len = Math.hypot(N2[0], N2[1], N2[2]);
  if (n2Len < 1e-12) return false;
  N2[0] /= n2Len; N2[1] /= n2Len; N2[2] /= n2Len;
  const d2 = -dot(N2, U0);

  // Signed distances of V to plane of U (in meters)
  let dv0 = dot(N2, V0) + d2;
  let dv1 = dot(N2, V1) + d2;
  let dv2 = dot(N2, V2) + d2;

  if (Math.abs(dv0) < EPSILON) dv0 = 0.0;
  if (Math.abs(dv1) < EPSILON) dv1 = 0.0;
  if (Math.abs(dv2) < EPSILON) dv2 = 0.0;

  // If all points of V lie on same side of plane of U (all >= 0 or all <= 0)
  if ((dv0 >= 0 && dv1 >= 0 && dv2 >= 0) || (dv0 <= 0 && dv1 <= 0 && dv2 <= 0)) {
    if (dv0 !== 0 || dv1 !== 0 || dv2 !== 0) {
      return false;
    }
  }

  // Coplanar check: both triangles lie entirely within the mutual plane
  if (du0 === 0 && du1 === 0 && du2 === 0 && dv0 === 0 && dv1 === 0 && dv2 === 0) {
    return coplanarTrianglesOverlap(V0, V1, V2, U0, U1, U2, N1);
  }

  // Direction of intersection line
  const D: [number, number, number] = [0, 0, 0];
  cross(D, N1, N2);
  const dLen = Math.hypot(D[0], D[1], D[2]);
  if (dLen < 1e-6) {
    // Planes are virtually parallel. Since they are not coplanar, no intersection occurs.
    return false;
  }

  // Simplified projection onto max component of D
  let maxComp = 0;
  let maxVal = Math.abs(D[0]);
  if (Math.abs(D[1]) > maxVal) {
    maxVal = Math.abs(D[1]);
    maxComp = 1;
  }
  if (Math.abs(D[2]) > maxVal) {
    maxVal = Math.abs(D[2]);
    maxComp = 2;
  }

  const vp0 = V0[maxComp];
  const vp1 = V1[maxComp];
  const vp2 = V2[maxComp];

  const up0 = U0[maxComp];
  const up1 = U1[maxComp];
  const up2 = U2[maxComp];

  const [tV0, tV1] = computeInterval(vp0, vp1, vp2, dv0, dv1, dv2);
  const [tU0, tU1] = computeInterval(up0, up1, up2, du0, du1, du2);

  // Check if intervals overlap
  return tV0 <= tU1 + EPSILON && tU0 <= tV1 + EPSILON;
}
