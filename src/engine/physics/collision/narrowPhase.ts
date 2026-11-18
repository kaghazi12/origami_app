/**
 * Narrow-Phase Distance Queries and XPBD Contact Resolution
 * 
 * - Closest point on 3D triangle to point (Ericson 5.1.5)
 * - Closest points between two 3D line segments (Ericson 5.1.9)
 * - XPBD Vertex-Triangle and Edge-Edge contact constraints with Coulomb friction
 */

export interface ContactData {
  type: 'VT' | 'EE';
  // For VT: pIdx is the vertex, tIdx0, tIdx1, tIdx2 are the triangle vertices, u, v, w are barycentric weights
  // For EE: pIdx, tIdx0 are edge 1 vertices (s, 1-s), tIdx1, tIdx2 are edge 2 vertices (t, 1-t)
  p0: number;
  p1: number;
  p2?: number;
  p3?: number;
  w0: number;
  w1: number;
  w2?: number;
  nx: number;
  ny: number;
  nz: number;
  depth: number; // thickness - distance > 0
}

/**
 * Computes closest point on triangle ABC to point P.
 * Returns barycentric coordinates [u, v, w] such that closest Q = u*A + v*B + w*C
 */
export function closestPointTriangle(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  out: [number, number, number] // [u, v, w]
): number {
  // Vectors
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;

  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0.0 && d2 <= 0.0) {
    out[0] = 1.0; out[1] = 0.0; out[2] = 0.0; // Vertex A
    return Math.hypot(px - ax, py - ay, pz - az);
  }

  // Check vertex B region
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0.0 && d4 <= d3) {
    out[0] = 0.0; out[1] = 1.0; out[2] = 0.0; // Vertex B
    return Math.hypot(px - bx, py - by, pz - bz);
  }

  // Check edge AB region
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0) {
    const v = d1 / (d1 - d3);
    out[0] = 1.0 - v; out[1] = v; out[2] = 0.0;
    const qx = ax + v * abx, qy = ay + v * aby, qz = az + v * abz;
    return Math.hypot(px - qx, py - qy, pz - qz);
  }

  // Check vertex C region
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0.0 && d5 <= d6) {
    out[0] = 0.0; out[1] = 0.0; out[2] = 1.0; // Vertex C
    return Math.hypot(px - cx, py - cy, pz - cz);
  }

  // Check edge AC region
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0) {
    const w = d2 / (d2 - d6);
    out[0] = 1.0 - w; out[1] = 0.0; out[2] = w;
    const qx = ax + w * acx, qy = ay + w * acy, qz = az + w * acz;
    return Math.hypot(px - qx, py - qy, pz - qz);
  }

  // Check edge BC region
  const va = d3 * d6 - d5 * d4;
  if (va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    out[0] = 0.0; out[1] = 1.0 - w; out[2] = w;
    const qx = bx + w * (cx - bx), qy = by + w * (cy - by), qz = bz + w * (cz - bz);
    return Math.hypot(px - qx, py - qy, pz - qz);
  }

  // Inside face ABC region
  const denom = 1.0 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  const u = 1.0 - v - w;
  out[0] = u; out[1] = v; out[2] = w;
  const qx = u * ax + v * bx + w * cx;
  const qy = u * ay + v * by + w * cy;
  const qz = u * az + v * bz + w * cz;
  return Math.hypot(px - qx, py - qy, pz - qz);
}

/**
 * Computes closest points between segment A->B and segment C->D (Ericson 5.1.9)
 * Returns distance and writes segment parameters [s, t]
 */
export function closestPointsSegments(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  dx: number, dy: number, dz: number,
  outST: [number, number]
): number {
  const d1x = bx - ax, d1y = by - ay, d1z = bz - az; // Direction of segment 1
  const d2x = dx - cx, d2y = dy - cy, d2z = dz - cz; // Direction of segment 2
  const rx = ax - cx, ry = ay - cy, rz = az - cz;

  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;

  let s = 0.0;
  let t = 0.0;

  if (a <= 1e-12 && e <= 1e-12) {
    outST[0] = 0.0; outST[1] = 0.0;
    return Math.hypot(rx, ry, rz);
  }

  if (a <= 1e-12) {
    s = 0.0;
    t = Math.max(0.0, Math.min(1.0, f / e));
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-12) {
      t = 0.0;
      s = Math.max(0.0, Math.min(1.0, -c / a));
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;

      if (denom !== 0.0) {
        s = Math.max(0.0, Math.min(1.0, (b * f - c * e) / denom));
      } else {
        s = 0.0;
      }

      t = (b * s + f) / e;
      if (t < 0.0) {
        t = 0.0;
        s = Math.max(0.0, Math.min(1.0, -c / a));
      } else if (t > 1.0) {
        t = 1.0;
        s = Math.max(0.0, Math.min(1.0, (b - c) / a));
      }
    }
  }

  outST[0] = s;
  outST[1] = t;

  const p1x = ax + s * d1x, p1y = ay + s * d1y, p1z = az + s * d1z;
  const p2x = cx + t * d2x, p2y = cy + t * d2y, p2z = cz + t * d2z;
  return Math.hypot(p1x - p2x, p1y - p2y, p1z - p2z);
}

/**
 * Solves generated contact constraints in XPBD using Gauss-Seidel projections
 */
export function solveContactsXPBD(
  contacts: ContactData[],
  posStar: Float64Array,
  posPrev: Float64Array,
  invMass: Float64Array,
  muStatic: number,
  muKinetic: number
): void {
  for (let c = 0; c < contacts.length; c++) {
    const cont = contacts[c];
    const nx = cont.nx;
    const ny = cont.ny;
    const nz = cont.nz;

    if (cont.type === 'VT') {
      const p = cont.p0 * 3;
      const a = cont.p1 * 3;
      const b = (cont.p2!) * 3;
      const cV = (cont.p3!) * 3;

      const wp = invMass[cont.p0];
      const wa = invMass[cont.p1];
      const wb = invMass[cont.p2!];
      const wc = invMass[cont.p3!];

      const u = cont.w0;
      const v = cont.w1;
      const w = cont.w2!;

      // Current separation along normal
      const px = posStar[p + 0], py = posStar[p + 1], pz = posStar[p + 2];
      const qx = u * posStar[a + 0] + v * posStar[b + 0] + w * posStar[cV + 0];
      const qy = u * posStar[a + 1] + v * posStar[b + 1] + w * posStar[cV + 1];
      const qz = u * posStar[a + 2] + v * posStar[b + 2] + w * posStar[cV + 2];

      const currentSep = (px - qx) * nx + (py - qy) * ny + (pz - qz) * nz;
      const depth = cont.depth; // paperThickness - distance at detection
      // Correction needed to enforce separation >= thickness
      const C = currentSep - (depth <= 0 ? 0 : 0); // one-sided penetration
      if (currentSep >= depth) continue;

      const violation = depth - currentSep;
      const wEff = wp + u * u * wa + v * v * wb + w * w * wc;
      if (wEff < 1e-12) continue;

      const deltaLambda = violation / wEff;

      // Position update
      if (wp > 0) {
        posStar[p + 0] += wp * deltaLambda * nx;
        posStar[p + 1] += wp * deltaLambda * ny;
        posStar[p + 2] += wp * deltaLambda * nz;
      }
      if (wa > 0) {
        posStar[a + 0] -= u * wa * deltaLambda * nx;
        posStar[a + 1] -= u * wa * deltaLambda * ny;
        posStar[a + 2] -= u * wa * deltaLambda * nz;
      }
      if (wb > 0) {
        posStar[b + 0] -= v * wb * deltaLambda * nx;
        posStar[b + 1] -= v * wb * deltaLambda * ny;
        posStar[b + 2] -= v * wb * deltaLambda * nz;
      }
      if (wc > 0) {
        posStar[cV + 0] -= w * wc * deltaLambda * nx;
        posStar[cV + 1] -= w * wc * deltaLambda * ny;
        posStar[cV + 2] -= w * wc * deltaLambda * nz;
      }

      // Coulomb friction
      const dP_x = (posStar[p + 0] - posPrev[p + 0]) - (u * (posStar[a + 0] - posPrev[a + 0]) + v * (posStar[b + 0] - posPrev[b + 0]) + w * (posStar[cV + 0] - posPrev[cV + 0]));
      const dP_y = (posStar[p + 1] - posPrev[p + 1]) - (u * (posStar[a + 1] - posPrev[a + 1]) + v * (posStar[b + 1] - posPrev[b + 1]) + w * (posStar[cV + 1] - posPrev[cV + 1]));
      const dP_z = (posStar[p + 2] - posPrev[p + 2]) - (u * (posStar[a + 2] - posPrev[a + 2]) + v * (posStar[b + 2] - posPrev[b + 2]) + w * (posStar[cV + 2] - posPrev[cV + 2]));

      const dNorm = dP_x * nx + dP_y * ny + dP_z * nz;
      const tx = dP_x - dNorm * nx;
      const ty = dP_y - dNorm * ny;
      const tz = dP_z - dNorm * nz;
      const tLen = Math.hypot(tx, ty, tz);

      if (tLen > 1e-12 && deltaLambda > 0) {
        const fMax = muStatic * deltaLambda;
        if (tLen <= fMax) {
          // Static arrest
          if (wp > 0) {
            posStar[p + 0] -= (wp / wEff) * tx;
            posStar[p + 1] -= (wp / wEff) * ty;
            posStar[p + 2] -= (wp / wEff) * tz;
          }
        } else {
          // Dynamic Coulomb slip
          const slipReduction = Math.min(1.0, (muKinetic * deltaLambda) / tLen);
          if (wp > 0) {
            posStar[p + 0] -= (wp / wEff) * tx * slipReduction;
            posStar[p + 1] -= (wp / wEff) * ty * slipReduction;
            posStar[p + 2] -= (wp / wEff) * tz * slipReduction;
          }
        }
      }
    } else if (cont.type === 'EE') {
      const a = cont.p0 * 3;
      const b = cont.p1 * 3;
      const cV = (cont.p2!) * 3;
      const d = (cont.p3!) * 3;

      const wa = invMass[cont.p0];
      const wb = invMass[cont.p1];
      const wc = invMass[cont.p2!];
      const wd = invMass[cont.p3!];

      const s = cont.w0;
      const t = cont.w1;
      const oms = 1.0 - s;
      const omt = 1.0 - t;

      const px = oms * posStar[a + 0] + s * posStar[b + 0];
      const py = oms * posStar[a + 1] + s * posStar[b + 1];
      const pz = oms * posStar[a + 2] + s * posStar[b + 2];

      const qx = omt * posStar[cV + 0] + t * posStar[d + 0];
      const qy = omt * posStar[cV + 1] + t * posStar[d + 1];
      const qz = omt * posStar[cV + 2] + t * posStar[d + 2];

      const currentSep = (px - qx) * nx + (py - qy) * ny + (pz - qz) * nz;
      const depth = cont.depth;
      if (currentSep >= depth) continue;

      const violation = depth - currentSep;
      const wEff = oms * oms * wa + s * s * wb + omt * omt * wc + t * t * wd;
      if (wEff < 1e-12) continue;

      const deltaLambda = violation / wEff;

      if (wa > 0) {
        posStar[a + 0] += oms * wa * deltaLambda * nx;
        posStar[a + 1] += oms * wa * deltaLambda * ny;
        posStar[a + 2] += oms * wa * deltaLambda * nz;
      }
      if (wb > 0) {
        posStar[b + 0] += s * wb * deltaLambda * nx;
        posStar[b + 1] += s * wb * deltaLambda * ny;
        posStar[b + 2] += s * wb * deltaLambda * nz;
      }
      if (wc > 0) {
        posStar[cV + 0] -= omt * wc * deltaLambda * nx;
        posStar[cV + 1] -= omt * wc * deltaLambda * ny;
        posStar[cV + 2] -= omt * wc * deltaLambda * nz;
      }
      if (wd > 0) {
        posStar[d + 0] -= t * wd * deltaLambda * nx;
        posStar[d + 1] -= t * wd * deltaLambda * ny;
        posStar[d + 2] -= t * wd * deltaLambda * nz;
      }
    }
  }
}
