import { FoldFormat, EdgeAssignment, TriMesh } from '../types';
import { extractTopology } from './topology';

export interface MeshQuality {
  minAngleDeg: number;
  maxAngleDeg: number;
  avgMinAngleDeg: number;
  minEdgeLength: number;
  maxEdgeLength: number;
}

/**
 * Computes geometric quality metrics for a triangulated mesh (angles and edge lengths)
 */
export function computeMeshQuality(mesh: TriMesh): MeshQuality {
  let globalMinAngle = 180;
  let globalMaxAngle = 0;
  let sumMinAngles = 0;
  let globalMinEdge = Infinity;
  let globalMaxEdge = 0;

  for (const bar of mesh.bars) {
    if (bar.restLength < globalMinEdge) globalMinEdge = bar.restLength;
    if (bar.restLength > globalMaxEdge) globalMaxEdge = bar.restLength;
  }

  const numTriangles = mesh.numTriangles;
  for (let t = 0; t < numTriangles; t++) {
    const i0 = mesh.indices[t * 3 + 0];
    const i1 = mesh.indices[t * 3 + 1];
    const i2 = mesh.indices[t * 3 + 2];

    const u0 = mesh.uvs[i0 * 2 + 0];
    const v0 = mesh.uvs[i0 * 2 + 1];
    const u1 = mesh.uvs[i1 * 2 + 0];
    const v1 = mesh.uvs[i1 * 2 + 1];
    const u2 = mesh.uvs[i2 * 2 + 0];
    const v2 = mesh.uvs[i2 * 2 + 1];

    // Edge vectors
    const d01: [number, number] = [u1 - u0, v1 - v0];
    const d12: [number, number] = [u2 - u1, v2 - v1];
    const d20: [number, number] = [u0 - u2, v0 - v2];

    const l01 = Math.hypot(d01[0], d01[1]);
    const l12 = Math.hypot(d12[0], d12[1]);
    const l20 = Math.hypot(d20[0], d20[1]);

    if (l01 < 1e-9 || l12 < 1e-9 || l20 < 1e-9) continue;

    // Angles using dot products
    const cos0 = (-d20[0] * d01[0] - d20[1] * d01[1]) / (l20 * l01);
    const cos1 = (-d01[0] * d12[0] - d01[1] * d12[1]) / (l01 * l12);
    const cos2 = (-d12[0] * d20[0] - d12[1] * d20[1]) / (l12 * l20);

    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    const a0 = (Math.acos(clamp(cos0)) * 180) / Math.PI;
    const a1 = (Math.acos(clamp(cos1)) * 180) / Math.PI;
    const a2 = (Math.acos(clamp(cos2)) * 180) / Math.PI;

    const minA = Math.min(a0, a1, a2);
    const maxA = Math.max(a0, a1, a2);

    if (minA < globalMinAngle) globalMinAngle = minA;
    if (maxA > globalMaxAngle) globalMaxAngle = maxA;
    sumMinAngles += minA;
  }

  return {
    minAngleDeg: globalMinAngle === 180 ? 0 : globalMinAngle,
    maxAngleDeg: globalMaxAngle,
    avgMinAngleDeg: numTriangles > 0 ? sumMinAngles / numTriangles : 0,
    minEdgeLength: globalMinEdge === Infinity ? 0 : globalMinEdge,
    maxEdgeLength: globalMaxEdge,
  };
}

/**
 * Checks if segment (p1->p2) is collinear and lies on crease segment (c1->c2)
 */
function isSubSegment(
  p1: [number, number],
  p2: [number, number],
  c1: [number, number],
  c2: [number, number],
  eps = 1e-6
): boolean {
  const cdx = c2[0] - c1[0];
  const cdy = c2[1] - c1[1];
  const cLenSq = cdx * cdx + cdy * cdy;
  if (cLenSq < eps * eps) return false;

  const t1 = ((p1[0] - c1[0]) * cdx + (p1[1] - c1[1]) * cdy) / cLenSq;
  const t2 = ((p2[0] - c1[0]) * cdx + (p2[1] - c1[1]) * cdy) / cLenSq;

  if (t1 < -eps || t1 > 1 + eps || t2 < -eps || t2 > 1 + eps) return false;

  // Check perpendicular distance from p1 and p2 to line c1->c2
  const d1Sq = Math.pow(p1[0] - (c1[0] + t1 * cdx), 2) + Math.pow(p1[1] - (c1[1] + t1 * cdy), 2);
  const d2Sq = Math.pow(p2[0] - (c1[0] + t2 * cdx), 2) + Math.pow(p2[1] - (c1[1] + t2 * cdy), 2);

  return d1Sq < eps * eps && d2Sq < eps * eps;
}

/**
 * Verifies whether a crease segment c1->c2 is completely covered by a contiguous
 * union of mesh edges collinear with c1->c2.
 */
export function isCreaseCoveredByMeshEdges(
  c1: [number, number],
  c2: [number, number],
  mesh: TriMesh,
  eps = 1e-5
): boolean {
  const cdx = c2[0] - c1[0];
  const cdy = c2[1] - c1[1];
  const cLenSq = cdx * cdx + cdy * cdy;
  if (cLenSq < eps * eps) return true;

  const intervals: [number, number][] = [];

  for (const bar of mesh.bars) {
    const p1: [number, number] = [mesh.uvs[bar.v0 * 2], mesh.uvs[bar.v0 * 2 + 1]];
    const p2: [number, number] = [mesh.uvs[bar.v1 * 2], mesh.uvs[bar.v1 * 2 + 1]];

    if (isSubSegment(p1, p2, c1, c2, eps)) {
      const t1 = ((p1[0] - c1[0]) * cdx + (p1[1] - c1[1]) * cdy) / cLenSq;
      const t2 = ((p2[0] - c1[0]) * cdx + (p2[1] - c1[1]) * cdy) / cLenSq;
      intervals.push([Math.min(t1, t2), Math.max(t1, t2)]);
    }
  }

  if (intervals.length === 0) return false;

  // Sort intervals by start
  intervals.sort((a, b) => a[0] - b[0]);

  // Merge intervals
  let mergedStart = intervals[0][0];
  let mergedEnd = intervals[0][1];

  if (mergedStart > eps) return false;

  for (let i = 1; i < intervals.length; i++) {
    const [s, e] = intervals[i];
    if (s <= mergedEnd + eps) {
      if (e > mergedEnd) mergedEnd = e;
    } else {
      // Gap in coverage
      return false;
    }
  }

  return mergedEnd >= 1 - eps;
}

/**
 * Checks whether a regular Cartesian grid of cell size ~targetEdgeLength can
 * honor every crease segment in the FOLD model.
 */
export function canGridHonorCreases(
  fold: FoldFormat,
  targetEdgeLength: number,
  eps = 1e-5
): boolean {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const [x, y] of fold.vertices_coords) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const width = maxX - minX || 1;
  const height = maxY - minY || 1;

  const nx = Math.max(1, Math.round(width / targetEdgeLength));
  const ny = Math.max(1, Math.round(height / targetEdgeLength));

  const dx = width / nx;
  const dy = height / ny;

  // The grid covers the bounding rectangle, so the paper must be that rectangle: every boundary
  // edge on one of its sides, together running all the way round. (A triangle or hexagon sheet
  // whose creases happen to sit on the grid would otherwise gain paper that isn't there.)
  let boundaryLength = 0;
  for (let eIdx = 0; eIdx < fold.edges_vertices.length; eIdx++) {
    if (fold.edges_assignment[eIdx] !== 'B') continue;
    const [u, v] = fold.edges_vertices[eIdx];
    const p = fold.vertices_coords[u], q = fold.vertices_coords[v];
    const onSide =
      (Math.abs(p[0] - minX) < eps && Math.abs(q[0] - minX) < eps) ||
      (Math.abs(p[0] - maxX) < eps && Math.abs(q[0] - maxX) < eps) ||
      (Math.abs(p[1] - minY) < eps && Math.abs(q[1] - minY) < eps) ||
      (Math.abs(p[1] - maxY) < eps && Math.abs(q[1] - maxY) < eps);
    if (!onSide) return false;
    boundaryLength += Math.hypot(q[0] - p[0], q[1] - p[1]);
  }
  if (Math.abs(boundaryLength - 2 * (width + height)) > 1e-6 * (width + height)) return false;

  for (let eIdx = 0; eIdx < fold.edges_vertices.length; eIdx++) {
    const a = fold.edges_assignment[eIdx];
    if (a === 'B') continue;

    const [u, v] = fold.edges_vertices[eIdx];
    const p1 = fold.vertices_coords[u];
    const p2 = fold.vertices_coords[v];

    // Check if both endpoints lie on grid coordinates
    const onGrid1X = Math.abs(p1[0] - (minX + Math.round((p1[0] - minX) / dx) * dx)) < eps;
    const onGrid1Y = Math.abs(p1[1] - (minY + Math.round((p1[1] - minY) / dy) * dy)) < eps;
    const onGrid2X = Math.abs(p2[0] - (minX + Math.round((p2[0] - minX) / dx) * dx)) < eps;
    const onGrid2Y = Math.abs(p2[1] - (minY + Math.round((p2[1] - minY) / dy) * dy)) < eps;

    if (!onGrid1X || !onGrid1Y || !onGrid2X || !onGrid2Y) {
      return false;
    }

    // Check slope orientation: must be horizontal, vertical, or forward diagonal (slope = dy / dx)
    const deltax = p2[0] - p1[0];
    const deltay = p2[1] - p1[1];

    const isHorizontal = Math.abs(deltay) < eps;
    const isVertical = Math.abs(deltax) < eps;
    const isForwardDiagonal = Math.abs(deltax / dx - deltay / dy) < eps;
    const isBackwardDiagonal = Math.abs(deltax / dx + deltay / dy) < eps;

    if (!isHorizontal && !isVertical && !isForwardDiagonal && !isBackwardDiagonal) {
      return false;
    }
  }

  return true;
}

/**
 * Creates a regularized quality triangulation of a rectangular paper sheet with targetEdgeLength,
 * strictly preserving all crease edges from the original FOLD model.
 */
export function createRegularTriangulation(
  fold: FoldFormat,
  targetEdgeLength: number,
  options: { axialStiffness?: number; creaseStiffness?: number; facetStiffness?: number } = {}
): TriMesh {
  // Compute bounding box
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const [x, y] of fold.vertices_coords) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const width = maxX - minX || 1;
  const height = maxY - minY || 1;

  const nx = Math.max(1, Math.round(width / targetEdgeLength));
  const ny = Math.max(1, Math.round(height / targetEdgeLength));

  const dx = width / nx;
  const dy = height / ny;

  // Generate grid vertices: (nx + 1) * (ny + 1)
  const coords: [number, number][] = [];
  const vertexLookup = (i: number, j: number) => j * (nx + 1) + i;

  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      coords.push([minX + i * dx, minY + j * dy]);
    }
  }

  const numVertices = coords.length;

  // Generate triangles and edges for each cell
  const triangles: [number, number, number][] = [];
  const edgesVertices: [number, number][] = [];
  const edgesAssignment: EdgeAssignment[] = [];
  const edgesFoldAngle: number[] = [];

  const addedEdgeSet = new Set<string>();
  const addEdge = (u: number, v: number, assignment: EdgeAssignment, angleDeg: number) => {
    const key = u < v ? `${u}_${v}` : `${v}_${u}`;
    if (!addedEdgeSet.has(key)) {
      addedEdgeSet.add(key);
      edgesVertices.push([u, v]);
      edgesAssignment.push(assignment);
      edgesFoldAngle.push(angleDeg);
    }
  };

  // Pre-extract crease segments from fold
  const originalCreases: {
    c1: [number, number];
    c2: [number, number];
    assignment: EdgeAssignment;
    angleDeg: number;
  }[] = [];

  fold.edges_vertices.forEach(([u, v], eIdx) => {
    const a = fold.edges_assignment[eIdx];
    if (a !== 'B') {
      const p1 = fold.vertices_coords[u] as [number, number];
      const p2 = fold.vertices_coords[v] as [number, number];
      const angle = fold.edges_foldAngle ? fold.edges_foldAngle[eIdx] : (a === 'V' ? 180 : a === 'M' ? -180 : 0);
      originalCreases.push({ c1: p1, c2: p2, assignment: a, angleDeg: angle });
    }
  });

  const getEdgeProperties = (u: number, v: number): { assignment: EdgeAssignment; angle: number } => {
    const p1 = coords[u];
    const p2 = coords[v];

    // Check if on boundary
    const onBottom = Math.abs(p1[1] - minY) < 1e-6 && Math.abs(p2[1] - minY) < 1e-6;
    const onTop = Math.abs(p1[1] - maxY) < 1e-6 && Math.abs(p2[1] - maxY) < 1e-6;
    const onLeft = Math.abs(p1[0] - minX) < 1e-6 && Math.abs(p2[0] - minX) < 1e-6;
    const onRight = Math.abs(p1[0] - maxX) < 1e-6 && Math.abs(p2[0] - maxX) < 1e-6;

    if (onBottom || onTop || onLeft || onRight) {
      return { assignment: 'B', angle: 0 };
    }

    // Check against original creases
    for (const crease of originalCreases) {
      if (isSubSegment(p1, p2, crease.c1, crease.c2)) {
        return { assignment: crease.assignment, angle: crease.angleDeg };
      }
    }

    return { assignment: 'F', angle: 0 };
  };

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const v00 = vertexLookup(i, j);
      const v10 = vertexLookup(i + 1, j);
      const v11 = vertexLookup(i + 1, j + 1);
      const v01 = vertexLookup(i, j + 1);

      // Add quad boundary edges
      const e00_10 = getEdgeProperties(v00, v10);
      addEdge(v00, v10, e00_10.assignment, e00_10.angle);

      const e10_11 = getEdgeProperties(v10, v11);
      addEdge(v10, v11, e10_11.assignment, e10_11.angle);

      const e11_01 = getEdgeProperties(v11, v01);
      addEdge(v11, v01, e11_01.assignment, e11_01.angle);

      const e01_00 = getEdgeProperties(v01, v00);
      addEdge(v01, v00, e01_00.assignment, e01_00.angle);

      // Check if backward diagonal [v01, v10] lies on a crease
      const eDiagBackward = getEdgeProperties(v01, v10);
      const useBackward = eDiagBackward.assignment !== 'F';

      if (useBackward) {
        // Split along backward diagonal v01 -> v10
        triangles.push([v00, v10, v01]);
        triangles.push([v10, v11, v01]);
        addEdge(v01, v10, eDiagBackward.assignment, eDiagBackward.angle);
      } else {
        // Split along forward diagonal v00 -> v11
        triangles.push([v00, v10, v11]);
        triangles.push([v00, v11, v01]);
        const eDiag = getEdgeProperties(v00, v11);
        addEdge(v00, v11, eDiag.assignment, eDiag.angle);
      }
    }
  }

  // Construct FOLD format for regular grid
  const gridFold: FoldFormat = {
    file_spec: 1.1,
    vertices_coords: coords,
    edges_vertices: edgesVertices,
    edges_assignment: edgesAssignment,
    edges_foldAngle: edgesFoldAngle,
  };

  const topology = extractTopology(coords, triangles, gridFold, options);

  const uvs = new Float64Array(numVertices * 2);
  const positions = new Float64Array(numVertices * 3);
  const velocities = new Float64Array(numVertices * 3);
  const masses = new Float64Array(numVertices).fill(1.0);

  for (let i = 0; i < numVertices; i++) {
    uvs[i * 2 + 0] = coords[i][0];
    uvs[i * 2 + 1] = coords[i][1];
    positions[i * 3 + 0] = coords[i][0];
    positions[i * 3 + 1] = coords[i][1];
    positions[i * 3 + 2] = 0;
  }

  return {
    numVertices,
    numTriangles: triangles.length,
    uvs,
    positions,
    velocities,
    masses,
    indices: topology.indices,
    bars: topology.bars,
    hinges: topology.hinges,
  };
}
