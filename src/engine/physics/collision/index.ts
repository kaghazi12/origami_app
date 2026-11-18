import { checkTriangleTriangleIntersection } from './moller';
import { SpatialHash } from './spatialHash';
import {
  closestPointTriangle,
  closestPointsSegments,
  solveContactsXPBD,
  ContactData,
} from './narrowPhase';

export {
  checkTriangleTriangleIntersection,
  SpatialHash,
  closestPointTriangle,
  closestPointsSegments,
  solveContactsXPBD,
};
export type { ContactData };

/**
 * Runs exact Möller 1997 triangle-triangle intersection test over all non-adjacent triangle pairs.
 * Returns the number of intersecting pairs and optional list of intersecting pair indices.
 */
export function countMeshIntersections(
  positions: Float64Array | number[],
  faces: number[] | Int32Array | Uint32Array,
  numFaces: number,
  uvs?: Float64Array | number[],
  minRestDist?: number
): { intersectionCount: number; intersectingPairs: [number, number][] } {
  const intersectingPairs: [number, number][] = [];

  // Build vertex-to-triangles to exclude triangles sharing vertices
  const vertexToTriangles: Map<number, number[]> = new Map();
  for (let f = 0; f < numFaces; f++) {
    const v0 = faces[f * 3 + 0];
    const v1 = faces[f * 3 + 1];
    const v2 = faces[f * 3 + 2];
    for (const v of [v0, v1, v2]) {
      let l = vertexToTriangles.get(v);
      if (!l) {
        l = [];
        vertexToTriangles.set(v, l);
      }
      l.push(f);
    }
  }

  const adjacent: Set<number>[] = new Array(numFaces);
  for (let f = 0; f < numFaces; f++) {
    adjacent[f] = new Set<number>();
    adjacent[f].add(f);
  }
  for (const [, triList] of vertexToTriangles) {
    for (let i = 0; i < triList.length; i++) {
      for (let j = i + 1; j < triList.length; j++) {
        adjacent[triList[i]].add(triList[j]);
        adjacent[triList[j]].add(triList[i]);
      }
    }
  }

  if (uvs && uvs.length > 0) {
    const centroids: [number, number][] = new Array(numFaces);
    let totalEdgeLen = 0;
    let edgeCount = 0;

    for (let f = 0; f < numFaces; f++) {
      const v0 = faces[f * 3 + 0];
      const v1 = faces[f * 3 + 1];
      const v2 = faces[f * 3 + 2];

      const u0 = uvs[v0 * 2 + 0], v0_uv = uvs[v0 * 2 + 1];
      const u1 = uvs[v1 * 2 + 0], v1_uv = uvs[v1 * 2 + 1];
      const u2 = uvs[v2 * 2 + 0], v2_uv = uvs[v2 * 2 + 1];

      centroids[f] = [(u0 + u1 + u2) / 3, (v0_uv + v1_uv + v2_uv) / 3];

      totalEdgeLen += Math.hypot(u1 - u0, v1_uv - v0_uv);
      totalEdgeLen += Math.hypot(u2 - u1, v2_uv - v1_uv);
      totalEdgeLen += Math.hypot(u0 - u2, v0_uv - v2_uv);
      edgeCount += 3;
    }

    const avgEdge = edgeCount > 0 ? totalEdgeLen / edgeCount : 0.1;
    const threshold = minRestDist ?? Math.max(0.01, 1.4 * avgEdge);

    for (let i = 0; i < numFaces; i++) {
      const ci = centroids[i];
      for (let j = i + 1; j < numFaces; j++) {
        const cj = centroids[j];
        if (Math.hypot(ci[0] - cj[0], ci[1] - cj[1]) < threshold) {
          adjacent[i].add(j);
          adjacent[j].add(i);
        }
      }
    }
  }

  const V0: [number, number, number] = [0, 0, 0];
  const V1: [number, number, number] = [0, 0, 0];
  const V2: [number, number, number] = [0, 0, 0];
  const U0: [number, number, number] = [0, 0, 0];
  const U1: [number, number, number] = [0, 0, 0];
  const U2: [number, number, number] = [0, 0, 0];

  for (let i = 0; i < numFaces; i++) {
    const i0 = faces[i * 3 + 0] * 3;
    const i1 = faces[i * 3 + 1] * 3;
    const i2 = faces[i * 3 + 2] * 3;

    V0[0] = positions[i0 + 0]; V0[1] = positions[i0 + 1]; V0[2] = positions[i0 + 2];
    V1[0] = positions[i1 + 0]; V1[1] = positions[i1 + 1]; V1[2] = positions[i1 + 2];
    V2[0] = positions[i2 + 0]; V2[1] = positions[i2 + 1]; V2[2] = positions[i2 + 2];

    for (let j = i + 1; j < numFaces; j++) {
      if (adjacent[i].has(j)) continue; // skip adjacent triangles sharing vertices

      const j0 = faces[j * 3 + 0] * 3;
      const j1 = faces[j * 3 + 1] * 3;
      const j2 = faces[j * 3 + 2] * 3;

      U0[0] = positions[j0 + 0]; U0[1] = positions[j0 + 1]; U0[2] = positions[j0 + 2];
      U1[0] = positions[j1 + 0]; U1[1] = positions[j1 + 1]; U1[2] = positions[j1 + 2];
      U2[0] = positions[j2 + 0]; U2[1] = positions[j2 + 1]; U2[2] = positions[j2 + 2];

      if (checkTriangleTriangleIntersection(V0, V1, V2, U0, U1, U2)) {
        intersectingPairs.push([i, j]);
      }
    }
  }

  return {
    intersectionCount: intersectingPairs.length,
    intersectingPairs,
  };
}

/**
 * Detects vertex-triangle and edge-edge contacts between candidate triangle pairs.
 */
export function generateSelfContacts(
  candidatePairs: [number, number][],
  positions: Float64Array | number[],
  faces: number[] | Int32Array | Uint32Array,
  paperThickness: number,
  contactsOut: ContactData[]
): void {
  contactsOut.length = 0;
  const baryOut: [number, number, number] = [0, 0, 0];
  const stOut: [number, number] = [0, 0];

  for (let p = 0; p < candidatePairs.length; p++) {
    const [t1, t2] = candidatePairs[p];

    const a0 = faces[t1 * 3 + 0];
    const a1 = faces[t1 * 3 + 1];
    const a2 = faces[t1 * 3 + 2];

    const b0 = faces[t2 * 3 + 0];
    const b1 = faces[t2 * 3 + 1];
    const b2 = faces[t2 * 3 + 2];

    const a0_3 = a0 * 3, a1_3 = a1 * 3, a2_3 = a2 * 3;
    const b0_3 = b0 * 3, b1_3 = b1 * 3, b2_3 = b2 * 3;

    // --- 1. Vertex-Triangle: Vertices of T1 against T2 ---
    const v1List = [a0, a1, a2];
    for (const v of v1List) {
      const v3 = v * 3;
      const d = closestPointTriangle(
        positions[v3 + 0], positions[v3 + 1], positions[v3 + 2],
        positions[b0_3 + 0], positions[b0_3 + 1], positions[b0_3 + 2],
        positions[b1_3 + 0], positions[b1_3 + 1], positions[b1_3 + 2],
        positions[b2_3 + 0], positions[b2_3 + 1], positions[b2_3 + 2],
        baryOut
      );

      if (d < paperThickness) {
        const qx = baryOut[0] * positions[b0_3 + 0] + baryOut[1] * positions[b1_3 + 0] + baryOut[2] * positions[b2_3 + 0];
        const qy = baryOut[0] * positions[b0_3 + 1] + baryOut[1] * positions[b1_3 + 1] + baryOut[2] * positions[b2_3 + 1];
        const qz = baryOut[0] * positions[b0_3 + 2] + baryOut[1] * positions[b1_3 + 2] + baryOut[2] * positions[b2_3 + 2];

        const abx = positions[b1_3 + 0] - positions[b0_3 + 0];
        const aby = positions[b1_3 + 1] - positions[b0_3 + 1];
        const abz = positions[b1_3 + 2] - positions[b0_3 + 2];
        const acx = positions[b2_3 + 0] - positions[b0_3 + 0];
        const acy = positions[b2_3 + 1] - positions[b0_3 + 1];
        const acz = positions[b2_3 + 2] - positions[b0_3 + 2];
        const cpx = aby * acz - abz * acy;
        const cpy = abz * acx - abx * acz;
        const cpz = abx * acy - aby * acx;
        const cpLen = Math.hypot(cpx, cpy, cpz);

        let fnx = 0, fny = 0, fnz = 1;
        if (cpLen > 1e-12) {
          fnx = cpx / cpLen; fny = cpy / cpLen; fnz = cpz / cpLen;
        }

        const rx = positions[v3 + 0] - qx;
        const ry = positions[v3 + 1] - qy;
        const rz = positions[v3 + 2] - qz;
        const h = rx * fnx + ry * fny + rz * fnz;
        const sign = h >= 0 ? 1 : -1;

        contactsOut.push({
          type: 'VT',
          p0: v,
          p1: b0,
          p2: b1,
          p3: b2,
          w0: baryOut[0],
          w1: baryOut[1],
          w2: baryOut[2],
          nx: fnx * sign,
          ny: fny * sign,
          nz: fnz * sign,
          depth: paperThickness,
        });
      }
    }

    // --- 2. Vertex-Triangle: Vertices of T2 against T1 ---
    const v2List = [b0, b1, b2];
    for (const v of v2List) {
      const v3 = v * 3;
      const d = closestPointTriangle(
        positions[v3 + 0], positions[v3 + 1], positions[v3 + 2],
        positions[a0_3 + 0], positions[a0_3 + 1], positions[a0_3 + 2],
        positions[a1_3 + 0], positions[a1_3 + 1], positions[a1_3 + 2],
        positions[a2_3 + 0], positions[a2_3 + 1], positions[a2_3 + 2],
        baryOut
      );

      if (d < paperThickness) {
        const qx = baryOut[0] * positions[a0_3 + 0] + baryOut[1] * positions[a1_3 + 0] + baryOut[2] * positions[a2_3 + 0];
        const qy = baryOut[0] * positions[a0_3 + 1] + baryOut[1] * positions[a1_3 + 1] + baryOut[2] * positions[a2_3 + 1];
        const qz = baryOut[0] * positions[a0_3 + 2] + baryOut[1] * positions[a1_3 + 2] + baryOut[2] * positions[a2_3 + 2];

        const abx = positions[a1_3 + 0] - positions[a0_3 + 0];
        const aby = positions[a1_3 + 1] - positions[a0_3 + 1];
        const abz = positions[a1_3 + 2] - positions[a0_3 + 2];
        const acx = positions[a2_3 + 0] - positions[a0_3 + 0];
        const acy = positions[a2_3 + 1] - positions[a0_3 + 1];
        const acz = positions[a2_3 + 2] - positions[a0_3 + 2];
        const cpx = aby * acz - abz * acy;
        const cpy = abz * acx - abx * acz;
        const cpz = abx * acy - aby * acx;
        const cpLen = Math.hypot(cpx, cpy, cpz);

        let fnx = 0, fny = 0, fnz = 1;
        if (cpLen > 1e-12) {
          fnx = cpx / cpLen; fny = cpy / cpLen; fnz = cpz / cpLen;
        }

        const rx = positions[v3 + 0] - qx;
        const ry = positions[v3 + 1] - qy;
        const rz = positions[v3 + 2] - qz;
        const h = rx * fnx + ry * fny + rz * fnz;
        const sign = h >= 0 ? 1 : -1;

        contactsOut.push({
          type: 'VT',
          p0: v,
          p1: a0,
          p2: a1,
          p3: a2,
          w0: baryOut[0],
          w1: baryOut[1],
          w2: baryOut[2],
          nx: fnx * sign,
          ny: fny * sign,
          nz: fnz * sign,
          depth: paperThickness,
        });
      }
    }

    // --- 3. Edge-Edge Contacts: Edges of T1 against Edges of T2 ---
    const edges1 = [[a0, a1], [a1, a2], [a2, a0]];
    const edges2 = [[b0, b1], [b1, b2], [b2, b0]];

    for (const [ea0, ea1] of edges1) {
      const ea0_3 = ea0 * 3, ea1_3 = ea1 * 3;
      for (const [eb0, eb1] of edges2) {
        const eb0_3 = eb0 * 3, eb1_3 = eb1 * 3;

        const d = closestPointsSegments(
          positions[ea0_3 + 0], positions[ea0_3 + 1], positions[ea0_3 + 2],
          positions[ea1_3 + 0], positions[ea1_3 + 1], positions[ea1_3 + 2],
          positions[eb0_3 + 0], positions[eb0_3 + 1], positions[eb0_3 + 2],
          positions[eb1_3 + 0], positions[eb1_3 + 1], positions[eb1_3 + 2],
          stOut
        );

        // Only register genuine edge-edge if contact is not right at the vertices
        const s = stOut[0], t = stOut[1];
        if (s > 0.05 && s < 0.95 && t > 0.05 && t < 0.95) {
          if (d < paperThickness && d > 1e-9) {
            const p1x = (1 - s) * positions[ea0_3 + 0] + s * positions[ea1_3 + 0];
            const p1y = (1 - s) * positions[ea0_3 + 1] + s * positions[ea1_3 + 1];
            const p1z = (1 - s) * positions[ea0_3 + 2] + s * positions[ea1_3 + 2];

            const p2x = (1 - t) * positions[eb0_3 + 0] + t * positions[eb1_3 + 0];
            const p2y = (1 - t) * positions[eb0_3 + 1] + t * positions[eb1_3 + 1];
            const p2z = (1 - t) * positions[eb0_3 + 2] + t * positions[eb1_3 + 2];

            const invD = 1.0 / d;
            contactsOut.push({
              type: 'EE',
              p0: ea0,
              p1: ea1,
              p2: eb0,
              p3: eb1,
              w0: s,
              w1: t,
              nx: (p1x - p2x) * invD,
              ny: (p1y - p2y) * invD,
              nz: (p1z - p2z) * invD,
              depth: paperThickness,
            });
          }
        }
      }
    }
  }
}
