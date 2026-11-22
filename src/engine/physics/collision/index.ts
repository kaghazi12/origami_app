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

// Pool of reusable contact records (contact generation runs every substep; avoid GC churn).
const contactPool: ContactData[] = [];
function nextContact(i: number): ContactData {
  let c = contactPool[i];
  if (!c) {
    c = { type: 'VT', p0: 0, p1: 0, p2: 0, p3: 0, w0: 0, w1: 0, w2: 0, nx: 0, ny: 0, nz: 1, depth: 0 };
    contactPool[i] = c;
  }
  return c;
}

const _bary: [number, number, number] = [0, 0, 0];
const _st: [number, number] = [0, 0];

/**
 * Proximity test of vertex v against triangle (t0,t1,t2) in `pos`.
 * Only registers a contact when v projects into the triangle interior: points beside a
 * triangle are covered by the neighbouring triangle or by edge-edge tests, and using a
 * face-normal plane for them would push in-plane neighbours out of the sheet.
 */
function testVT(
  pos: Float64Array | number[], v: number, t0: number, t1: number, t2: number,
  radius: number, thickness: number, out: ContactData[], n: number
): number {
  const v3 = v * 3, a = t0 * 3, b = t1 * 3, c = t2 * 3;
  // Cheap box rejection before the exact query
  for (let k = 0; k < 3; k++) {
    const x = pos[v3 + k], pa = pos[a + k], pb = pos[b + k], pc = pos[c + k];
    if (x + radius < (pa < pb ? (pa < pc ? pa : pc) : (pb < pc ? pb : pc))) return n;
    if (x - radius > (pa > pb ? (pa > pc ? pa : pc) : (pb > pc ? pb : pc))) return n;
  }
  const d = closestPointTriangle(
    pos[v3], pos[v3 + 1], pos[v3 + 2],
    pos[a], pos[a + 1], pos[a + 2],
    pos[b], pos[b + 1], pos[b + 2],
    pos[c], pos[c + 1], pos[c + 2],
    _bary
  );
  if (d >= radius) return n;
  const eps = 1e-6;
  if (_bary[0] < eps || _bary[1] < eps || _bary[2] < eps) return n;

  const abx = pos[b] - pos[a], aby = pos[b + 1] - pos[a + 1], abz = pos[b + 2] - pos[a + 2];
  const acx = pos[c] - pos[a], acy = pos[c + 1] - pos[a + 1], acz = pos[c + 2] - pos[a + 2];
  let nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-14) return n;
  nx /= len; ny /= len; nz /= len;
  // Side from the committed (non-penetrating) configuration
  const hgt = (pos[v3] - pos[a]) * nx + (pos[v3 + 1] - pos[a + 1]) * ny + (pos[v3 + 2] - pos[a + 2]) * nz;
  const sign = hgt >= 0 ? 1 : -1;

  const ct = nextContact(n);
  ct.type = 'VT';
  ct.p0 = v; ct.p1 = t0; ct.p2 = t1; ct.p3 = t2;
  ct.w0 = _bary[0]; ct.w1 = _bary[1]; ct.w2 = _bary[2];
  ct.nx = nx * sign; ct.ny = ny * sign; ct.nz = nz * sign;
  ct.depth = thickness;
  out[n] = ct;
  return n + 1;
}

function testEE(
  pos: Float64Array | number[], ea0: number, ea1: number, eb0: number, eb1: number,
  radius: number, thickness: number, out: ContactData[], n: number
): number {
  const a0 = ea0 * 3, a1 = ea1 * 3, b0 = eb0 * 3, b1 = eb1 * 3;
  for (let k = 0; k < 3; k++) {
    const p = pos[a0 + k], q = pos[a1 + k], r = pos[b0 + k], u = pos[b1 + k];
    if ((p < q ? p : q) - radius > (r > u ? r : u)) return n;
    if ((r < u ? r : u) - radius > (p > q ? p : q)) return n;
  }
  const d = closestPointsSegments(
    pos[a0], pos[a0 + 1], pos[a0 + 2],
    pos[a1], pos[a1 + 1], pos[a1 + 2],
    pos[b0], pos[b0 + 1], pos[b0 + 2],
    pos[b1], pos[b1 + 1], pos[b1 + 2],
    _st
  );
  if (d >= radius || d < 1e-9) return n;
  const s = _st[0], t = _st[1];
  // Endpoint cases (vertex-edge, vertex-vertex) are kept on purpose: vertex-triangle tests only
  // cover interior projections, so sheet edges meeting head-on are caught only here.
  const px = (1 - s) * pos[a0] + s * pos[a1] - ((1 - t) * pos[b0] + t * pos[b1]);
  const py = (1 - s) * pos[a0 + 1] + s * pos[a1 + 1] - ((1 - t) * pos[b0 + 1] + t * pos[b1 + 1]);
  const pz = (1 - s) * pos[a0 + 2] + s * pos[a1 + 2] - ((1 - t) * pos[b0 + 2] + t * pos[b1 + 2]);
  const inv = 1 / d;
  const ct = nextContact(n);
  ct.type = 'EE';
  ct.p0 = ea0; ct.p1 = ea1; ct.p2 = eb0; ct.p3 = eb1;
  ct.w0 = s; ct.w1 = t; ct.w2 = 0;
  ct.nx = px * inv; ct.ny = py * inv; ct.nz = pz * inv;
  ct.depth = thickness;
  out[n] = ct;
  return n + 1;
}

/**
 * Detects vertex-triangle and edge-edge proximity contacts between candidate triangle pairs.
 *
 * `positions` should be the last committed (non-penetrating) state. Contacts are registered for
 * features closer than `radius` (>= thickness, padded for this substep's motion) with normals and
 * sides frozen from that state; `solveContactsXPBD` then enforces separation >= thickness on the
 * predicted positions. Detecting on predicted positions instead lets fast motion tunnel straight
 * through and picks the wrong side for anything that already crossed.
 */
export function generateSelfContacts(
  candidatePairs: [number, number][],
  positions: Float64Array | number[],
  faces: number[] | Int32Array | Uint32Array,
  paperThickness: number,
  contactsOut: ContactData[],
  radius: number = paperThickness
): void {
  const r = Math.max(radius, paperThickness);
  let n = 0;
  for (let p = 0; p < candidatePairs.length; p++) {
    const pair = candidatePairs[p];
    const t1 = pair[0], t2 = pair[1];
    const a0 = faces[t1 * 3], a1 = faces[t1 * 3 + 1], a2 = faces[t1 * 3 + 2];
    const b0 = faces[t2 * 3], b1 = faces[t2 * 3 + 1], b2 = faces[t2 * 3 + 2];

    n = testVT(positions, a0, b0, b1, b2, r, paperThickness, contactsOut, n);
    n = testVT(positions, a1, b0, b1, b2, r, paperThickness, contactsOut, n);
    n = testVT(positions, a2, b0, b1, b2, r, paperThickness, contactsOut, n);
    n = testVT(positions, b0, a0, a1, a2, r, paperThickness, contactsOut, n);
    n = testVT(positions, b1, a0, a1, a2, r, paperThickness, contactsOut, n);
    n = testVT(positions, b2, a0, a1, a2, r, paperThickness, contactsOut, n);

    n = testEE(positions, a0, a1, b0, b1, r, paperThickness, contactsOut, n);
    n = testEE(positions, a0, a1, b1, b2, r, paperThickness, contactsOut, n);
    n = testEE(positions, a0, a1, b2, b0, r, paperThickness, contactsOut, n);
    n = testEE(positions, a1, a2, b0, b1, r, paperThickness, contactsOut, n);
    n = testEE(positions, a1, a2, b1, b2, r, paperThickness, contactsOut, n);
    n = testEE(positions, a1, a2, b2, b0, r, paperThickness, contactsOut, n);
    n = testEE(positions, a2, a0, b0, b1, r, paperThickness, contactsOut, n);
    n = testEE(positions, a2, a0, b1, b2, r, paperThickness, contactsOut, n);
    n = testEE(positions, a2, a0, b2, b0, r, paperThickness, contactsOut, n);
  }
  contactsOut.length = n;
}

/**
 * Deduplicating contact generator.
 *
 * `generateSelfContacts` walks triangle pairs, so a vertex shared by ~6 triangles is tested against
 * the same triangle ~6 times and an edge pair up to 4 times. This variant groups candidate pairs by
 * triangle (CSR) and stamps vertices/edges, so each vertex-triangle test runs once and each
 * edge-edge test at most twice (once from each edge's owning triangle).
 */
export class SelfContactGenerator {
  private numFaces = 0;
  private numVerts = 0;
  private faces: ArrayLike<number> = [];
  // Unique edges
  private edgeV0: Int32Array = new Int32Array(0);
  private edgeV1: Int32Array = new Int32Array(0);
  private triEdges: Int32Array = new Int32Array(0); // 3 per face
  private edgeOwner: Int32Array = new Int32Array(0); // lowest-index incident face
  // Dedup stamps
  private vStamp: Int32Array = new Int32Array(0);
  private eStamp: Int32Array = new Int32Array(0);
  // CSR of candidate partners per face
  private start: Int32Array = new Int32Array(0);
  private fill: Int32Array = new Int32Array(0);
  private partners: Int32Array = new Int32Array(0);

  init(faces: ArrayLike<number>, numFaces: number, numVerts: number): void {
    this.faces = faces;
    this.numFaces = numFaces;
    this.numVerts = numVerts;
    const map = new Map<number, number>();
    const e0: number[] = [], e1: number[] = [], owner: number[] = [];
    this.triEdges = new Int32Array(numFaces * 3);
    for (let f = 0; f < numFaces; f++) {
      for (let k = 0; k < 3; k++) {
        const a = faces[f * 3 + k], b = faces[f * 3 + ((k + 1) % 3)];
        const lo = a < b ? a : b, hi = a < b ? b : a;
        const key = lo * numVerts + hi;
        let id = map.get(key);
        if (id === undefined) {
          id = e0.length;
          map.set(key, id);
          e0.push(lo); e1.push(hi); owner.push(f);
        }
        this.triEdges[f * 3 + k] = id;
      }
    }
    this.edgeV0 = Int32Array.from(e0);
    this.edgeV1 = Int32Array.from(e1);
    this.edgeOwner = Int32Array.from(owner);
    this.vStamp = new Int32Array(numVerts).fill(-1);
    this.eStamp = new Int32Array(e0.length).fill(-1);
    this.start = new Int32Array(numFaces + 1);
    this.fill = new Int32Array(numFaces);
  }

  generate(
    candidatePairs: [number, number][],
    positions: Float64Array | number[],
    paperThickness: number,
    radius: number,
    contactsOut: ContactData[]
  ): void {
    const nF = this.numFaces;
    const faces = this.faces;
    const r = Math.max(radius, paperThickness);
    const nP = candidatePairs.length;

    // Build CSR (each pair stored in both directions)
    const start = this.start, fillA = this.fill;
    start.fill(0);
    for (let p = 0; p < nP; p++) {
      start[candidatePairs[p][0] + 1]++;
      start[candidatePairs[p][1] + 1]++;
    }
    for (let f = 0; f < nF; f++) start[f + 1] += start[f];
    if (this.partners.length < 2 * nP) this.partners = new Int32Array(Math.max(1024, 4 * nP));
    const partners = this.partners;
    for (let f = 0; f < nF; f++) fillA[f] = start[f];
    for (let p = 0; p < nP; p++) {
      const a = candidatePairs[p][0], b = candidatePairs[p][1];
      partners[fillA[a]++] = b;
      partners[fillA[b]++] = a;
    }

    const vStamp = this.vStamp, eStamp = this.eStamp;
    vStamp.fill(-1);
    eStamp.fill(-1);
    const triEdges = this.triEdges, edgeOwner = this.edgeOwner, eV0 = this.edgeV0, eV1 = this.edgeV1;
    let n = 0;

    for (let T = 0; T < nF; T++) {
      const s0 = start[T], s1 = start[T + 1];
      if (s0 === s1) continue;
      const t0 = faces[T * 3], t1 = faces[T * 3 + 1], t2 = faces[T * 3 + 2];

      // Vertex-triangle: every vertex of every partner against T, once each
      for (let q = s0; q < s1; q++) {
        const P = partners[q];
        for (let k = 0; k < 3; k++) {
          const v = faces[P * 3 + k];
          if (vStamp[v] === T) continue;
          vStamp[v] = T;
          if (v === t0 || v === t1 || v === t2) continue;
          n = testVT(positions, v, t0, t1, t2, r, paperThickness, contactsOut, n);
        }
      }

      // Edge-edge: edges owned by T against every edge of every partner
      for (let k = 0; k < 3; k++) {
        const e = triEdges[T * 3 + k];
        if (edgeOwner[e] !== T) continue;
        const ea = eV0[e], eb = eV1[e];
        for (let q = s0; q < s1; q++) {
          const P = partners[q];
          for (let j = 0; j < 3; j++) {
            const f = triEdges[P * 3 + j];
            if (eStamp[f] === e) continue;
            eStamp[f] = e;
            const fa = eV0[f], fb = eV1[f];
            if (fa === ea || fa === eb || fb === ea || fb === eb) continue;
            n = testEE(positions, ea, eb, fa, fb, r, paperThickness, contactsOut, n);
          }
        }
      }
    }
    contactsOut.length = n;
  }
}
