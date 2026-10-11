import { BarElement, HingeElement, EdgeAssignment, TriMesh } from '../types';
import { edgeKey } from './topology';

export interface SplitOptions {
  assignment?: EdgeAssignment;
  targetAngleDeg?: number;
  creaseStiffness?: number;
  facetStiffness?: number;
  axialStiffness?: number;
}

/**
 * 2D Segment-Segment intersection test
 * Returns parameter t on segment (p1->p2) if they intersect, or null.
 */
function intersectSegments2D(
  p1: [number, number],
  p2: [number, number],
  q1: [number, number],
  q2: [number, number],
  eps = 1e-6
): number | null {
  const dx1 = p2[0] - p1[0];
  const dy1 = p2[1] - p1[1];
  const dx2 = q2[0] - q1[0];
  const dy2 = q2[1] - q1[1];

  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-12) return null; // Parallel

  const t = ((q1[0] - p1[0]) * dy2 - (q1[1] - p1[1]) * dx2) / denom;
  const s = ((q1[0] - p1[0]) * dy1 - (q1[1] - p1[1]) * dx1) / denom;

  if (t > eps && t < 1 - eps && s > -eps && s < 1 + eps) {
    return t;
  }
  return null;
}

/**
 * Splits an existing TriMesh along a 2D line segment [cutP0, cutP1] in paper space.
 * Preserves existing 3D positions, barycentric-interpolates new vertices,
 * and maintains hinge states so that the 3D shape does not jump (Amendment B).
 */
export function splitMeshAlongSegment(
  mesh: TriMesh,
  cutP0: [number, number],
  cutP1: [number, number],
  options: SplitOptions = {}
): TriMesh {
  const newAssignment = options.assignment ?? 'V';
  const targetAngleRad = ((options.targetAngleDeg ?? (newAssignment === 'M' ? -180 : 180)) * Math.PI) / 180;
  const kCrease = options.creaseStiffness ?? 1.0;
  const kFacet = options.facetStiffness ?? 20.0;
  const kAxial = options.axialStiffness ?? 10000;

  // Clone vertex arrays so we can append new vertices
  const uvsList: [number, number][] = [];
  const positionsList: [number, number, number][] = [];
  const velocitiesList: [number, number, number][] = [];
  const massesList: number[] = [];

  for (let i = 0; i < mesh.numVertices; i++) {
    uvsList.push([mesh.uvs[i * 2 + 0], mesh.uvs[i * 2 + 1]]);
    positionsList.push([
      mesh.positions[i * 3 + 0],
      mesh.positions[i * 3 + 1],
      mesh.positions[i * 3 + 2],
    ]);
    velocitiesList.push([
      mesh.velocities[i * 3 + 0],
      mesh.velocities[i * 3 + 1],
      mesh.velocities[i * 3 + 2],
    ]);
    massesList.push(mesh.masses[i]);
  }

  // Pre-existing bars lookup by edge key
  const oldBarMap = new Map<string, BarElement>();
  for (const bar of mesh.bars) {
    oldBarMap.set(edgeKey(bar.v0, bar.v1), bar);
  }

  // Pre-existing hinges lookup by edge key
  const oldHingeMap = new Map<string, HingeElement>();
  for (const hinge of mesh.hinges) {
    oldHingeMap.set(edgeKey(hinge.v0, hinge.v1), hinge);
  }

  // Cache of split points on edges: edgeKey -> { newVertexIndex, t }
  interface EdgeSplit {
    newVertex: number;
    t: number; // parameter from v0 to v1
  }
  const splitEdges = new Map<string, EdgeSplit>();

  const getOrSplitEdge = (v0: number, v1: number): EdgeSplit | null => {
    const key = edgeKey(v0, v1);
    const existing = splitEdges.get(key);
    if (existing) {
      // Adjust parameter t if v0 > v1
      const t = v0 < v1 ? existing.t : 1 - existing.t;
      return { newVertex: existing.newVertex, t };
    }

    const uv0 = uvsList[v0];
    const uv1 = uvsList[v1];
    const t = intersectSegments2D(uv0, uv1, cutP0, cutP1);
    if (t === null) return null;

    // Create new vertex
    const newIdx = uvsList.length;

    // 2D UV
    const newU = uv0[0] + (uv1[0] - uv0[0]) * t;
    const newV = uv0[1] + (uv1[1] - uv0[1]) * t;
    uvsList.push([newU, newV]);

    // Barycentric-interpolated 3D position
    const p0 = positionsList[v0];
    const p1 = positionsList[v1];
    const newX = p0[0] + (p1[0] - p0[0]) * t;
    const newY = p0[1] + (p1[1] - p0[1]) * t;
    const newZ = p0[2] + (p1[2] - p0[2]) * t;
    positionsList.push([newX, newY, newZ]);

    // Interpolated velocity
    const vel0 = velocitiesList[v0];
    const vel1 = velocitiesList[v1];
    velocitiesList.push([
      vel0[0] + (vel1[0] - vel0[0]) * t,
      vel0[1] + (vel1[1] - vel0[1]) * t,
      vel0[2] + (vel1[2] - vel0[2]) * t,
    ]);
    massesList.push(1.0);

    const storeT = v0 < v1 ? t : 1 - t;
    splitEdges.set(key, { newVertex: newIdx, t: storeT });
    return { newVertex: newIdx, t };
  };

  // Process all triangles in the mesh
  const newTriangles: [number, number, number][] = [];
  const cutInternalEdges: [number, number][] = [];

  for (let tri = 0; tri < mesh.numTriangles; tri++) {
    const a = mesh.indices[tri * 3 + 0];
    const b = mesh.indices[tri * 3 + 1];
    const c = mesh.indices[tri * 3 + 2];

    const splitAB = getOrSplitEdge(a, b);
    const splitBC = getOrSplitEdge(b, c);
    const splitCA = getOrSplitEdge(c, a);

    const numSplits = (splitAB ? 1 : 0) + (splitBC ? 1 : 0) + (splitCA ? 1 : 0);

    if (numSplits === 0) {
      // Triangle unaffected
      newTriangles.push([a, b, c]);
    } else if (numSplits === 2) {
      // Line cuts through 2 edges, splitting triangle into 1 triangle and 1 quad (2 triangles)
      if (splitAB && splitCA) {
        const p = splitAB.newVertex;
        const q = splitCA.newVertex;
        // Triangle 1 (corner a): [a, p, q]
        newTriangles.push([a, p, q]);
        // Quad [p, b, c, q] -> 2 triangles
        newTriangles.push([p, b, c]);
        newTriangles.push([p, c, q]);
        cutInternalEdges.push([p, q]);
      } else if (splitAB && splitBC) {
        const p = splitAB.newVertex;
        const q = splitBC.newVertex;
        // Triangle 1 (corner b): [b, q, p]
        newTriangles.push([b, q, p]);
        // Quad [a, p, q, c] -> 2 triangles
        newTriangles.push([a, p, q]);
        newTriangles.push([a, q, c]);
        cutInternalEdges.push([p, q]);
      } else if (splitBC && splitCA) {
        const p = splitBC.newVertex;
        const q = splitCA.newVertex;
        // Triangle 1 (corner c): [c, q, p]
        newTriangles.push([c, q, p]);
        // Quad [a, b, p, q] -> 2 triangles
        newTriangles.push([a, b, p]);
        newTriangles.push([a, p, q]);
        cutInternalEdges.push([p, q]);
      }
    } else if (numSplits === 1) {
      // Cut touched one edge and likely terminated or hit a corner
      if (splitAB) {
        const p = splitAB.newVertex;
        newTriangles.push([a, p, c]);
        newTriangles.push([p, b, c]);
      } else if (splitBC) {
        const p = splitBC.newVertex;
        newTriangles.push([b, p, a]);
        newTriangles.push([p, c, a]);
      } else if (splitCA) {
        const p = splitCA.newVertex;
        newTriangles.push([c, p, b]);
        newTriangles.push([p, a, b]);
      }
    } else {
      // Degenerate (rare 3 edge split): retain original
      newTriangles.push([a, b, c]);
    }
  }

  // Rebuild Bars
  // Gather all unique edges from newTriangles
  interface EdgeTriUsage {
    triIndex: number;
    opp: number;
    v0: number;
    v1: number;
  }
  const newEdgeUsage = new Map<string, EdgeTriUsage[]>();

  newTriangles.forEach(([t0, t1, t2], triIdx) => {
    const triEdges: [number, number, number][] = [
      [t0, t1, t2],
      [t1, t2, t0],
      [t2, t0, t1],
    ];
    triEdges.forEach(([u, v, opp]) => {
      const k = edgeKey(u, v);
      let arr = newEdgeUsage.get(k);
      if (!arr) {
        arr = [];
        newEdgeUsage.set(k, arr);
      }
      arr.push({ triIndex: triIdx, opp, v0: u, v1: v });
    });
  });

  const newBars: BarElement[] = [];
  const newHinges: HingeElement[] = [];

  let hingeCounter = 0;
  const cutEdgeSet = new Set<string>();
  cutInternalEdges.forEach(([p, q]) => cutEdgeSet.add(edgeKey(p, q)));

  for (const [k, usages] of newEdgeUsage.entries()) {
    const [strU, strV] = k.split('_');
    const u = parseInt(strU, 10);
    const v = parseInt(strV, 10);

    // Compute rest length from 2D UVs
    const uv0 = uvsList[u];
    const uv1 = uvsList[v];
    const restLength = Math.hypot(uv1[0] - uv0[0], uv1[1] - uv0[1]);

    newBars.push({
      v0: u,
      v1: v,
      restLength,
      stiffness: kAxial,
    });

    if (usages.length === 2) {
      const u1 = usages[0];
      const u2 = usages[1];

      let assignment: EdgeAssignment = 'F';
      let tAngle = 0;
      let rAngle = 0;
      let stiffness = kFacet;

      // Check if this is the newly cut crease
      if (cutEdgeSet.has(k)) {
        assignment = newAssignment;
        tAngle = targetAngleRad;
        rAngle = 0; // Flat initial rest angle -> NO JUMP!
        stiffness = assignment === 'M' || assignment === 'V' ? kCrease : kFacet;
      } else {
        // Inherit from old hinge if this edge was part of an existing hinge
        // Or if it was split from an old hinge edge
        const oldHinge = oldHingeMap.get(k);
        if (oldHinge) {
          assignment = oldHinge.assignment;
          tAngle = oldHinge.targetAngle;
          rAngle = oldHinge.restAngle;
          stiffness = oldHinge.stiffness;
        } else {
          // Check if it belongs to a split edge
          let parentKey: string | null = null;
          for (const [pKey, s] of splitEdges.entries()) {
            const [pU, pV] = pKey.split('_').map((n) => parseInt(n, 10));
            if ((u === s.newVertex && (v === pU || v === pV)) || (v === s.newVertex && (u === pU || u === pV))) {
              parentKey = pKey;
              break;
            }
          }
          if (parentKey && oldHingeMap.has(parentKey)) {
            const parentHinge = oldHingeMap.get(parentKey)!;
            assignment = parentHinge.assignment;
            tAngle = parentHinge.targetAngle;
            rAngle = parentHinge.restAngle;
            stiffness = parentHinge.stiffness;
          }
        }
      }

      newHinges.push({
        id: hingeCounter++,
        v0: u1.v0,
        v1: u1.v1,
        v2: u1.opp,
        v3: u2.opp,
        assignment,
        targetAngle: tAngle,
        restAngle: rAngle,
        stiffness,
      });
    }
  }

  // Build flattened typed arrays
  const totalVerts = uvsList.length;
  const uvsArray = new Float32Array(totalVerts * 2);
  const posArray = new Float32Array(totalVerts * 3);
  const velArray = new Float32Array(totalVerts * 3);
  const massArray = new Float32Array(totalVerts);

  for (let i = 0; i < totalVerts; i++) {
    uvsArray[i * 2 + 0] = uvsList[i][0];
    uvsArray[i * 2 + 1] = uvsList[i][1];

    posArray[i * 3 + 0] = positionsList[i][0];
    posArray[i * 3 + 1] = positionsList[i][1];
    posArray[i * 3 + 2] = positionsList[i][2];

    velArray[i * 3 + 0] = velocitiesList[i][0];
    velArray[i * 3 + 1] = velocitiesList[i][1];
    velArray[i * 3 + 2] = velocitiesList[i][2];

    massArray[i] = massesList[i];
  }

  const indicesArray = new Uint32Array(newTriangles.length * 3);
  for (let i = 0; i < newTriangles.length; i++) {
    indicesArray[i * 3 + 0] = newTriangles[i][0];
    indicesArray[i * 3 + 1] = newTriangles[i][1];
    indicesArray[i * 3 + 2] = newTriangles[i][2];
  }

  return {
    numVertices: totalVerts,
    numTriangles: newTriangles.length,
    uvs: uvsArray,
    positions: posArray,
    velocities: velArray,
    masses: massArray,
    indices: indicesArray,
    bars: newBars,
    hinges: newHinges,
  };
}
