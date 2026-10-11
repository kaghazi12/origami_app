import { FoldFormat, EdgeAssignment } from '../types';

/**
 * Handles T-junctions by splitting edges that contain collinear vertices in their interior.
 * Updates vertices_coords, edges_vertices, edges_assignment, and edges_foldAngle in-place or returns a clean FoldFormat.
 */
export function resolveTJunctions(fold: FoldFormat, eps = 1e-6): FoldFormat {
  const coords = fold.vertices_coords.map((c) => [c[0], c[1]] as [number, number]);
  const numOrigVertices = coords.length;

  const newEdgesVertices: [number, number][] = [];
  const newEdgesAssignment: EdgeAssignment[] = [];
  const newEdgesFoldAngle: number[] = [];

  for (let e = 0; e < fold.edges_vertices.length; e++) {
    const [u, v] = fold.edges_vertices[e];
    const assignment = fold.edges_assignment[e];
    const angle = fold.edges_foldAngle ? fold.edges_foldAngle[e] : (assignment === 'V' ? 180 : assignment === 'M' ? -180 : 0);

    const a = coords[u];
    const b = coords[v];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lenSq = dx * dx + dy * dy;

    if (lenSq < eps * eps) continue; // Degenerate edge

    // Find all vertices lying strictly inside segment (a, b)
    const interiorPoints: { vertexIndex: number; t: number }[] = [];

    for (let k = 0; k < numOrigVertices; k++) {
      if (k === u || k === v) continue;
      const p = coords[k];

      const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
      if (t > eps && t < 1 - eps) {
        // Distance from point to line
        const projX = a[0] + t * dx;
        const projY = a[1] + t * dy;
        const distSq = (p[0] - projX) * (p[0] - projX) + (p[1] - projY) * (p[1] - projY);
        if (distSq < eps * eps) {
          interiorPoints.push({ vertexIndex: k, t });
        }
      }
    }

    if (interiorPoints.length === 0) {
      newEdgesVertices.push([u, v]);
      newEdgesAssignment.push(assignment);
      newEdgesFoldAngle.push(angle);
    } else {
      // Sort points along edge by parameter t
      interiorPoints.sort((p1, p2) => p1.t - p2.t);
      const chain = [u, ...interiorPoints.map((p) => p.vertexIndex), v];
      for (let i = 0; i < chain.length - 1; i++) {
        newEdgesVertices.push([chain[i], chain[i + 1]]);
        newEdgesAssignment.push(assignment);
        newEdgesFoldAngle.push(angle);
      }
    }
  }

  return {
    ...fold,
    edges_vertices: newEdgesVertices,
    edges_assignment: newEdgesAssignment,
    edges_foldAngle: newEdgesFoldAngle,
  };
}

/**
 * Extracts 2D planar polygonal faces from an edge graph.
 * Resolves T-junctions and traces counter-clockwise half-edge cycles.
 */
export function extractPlanarFaces(fold: FoldFormat): number[][] {
  const resolvedFold = resolveTJunctions(fold);
  const coords = resolvedFold.vertices_coords;
  const numVertices = coords.length;

  // Build adjacency list of outgoing edges at each vertex
  interface OutgoingEdge {
    to: number;
    angle: number;
  }
  const adj = new Map<number, OutgoingEdge[]>();
  for (let i = 0; i < numVertices; i++) adj.set(i, []);

  resolvedFold.edges_vertices.forEach(([u, v]) => {
    const cu = coords[u];
    const cv = coords[v];

    const angleUV = Math.atan2(cv[1] - cu[1], cv[0] - cu[0]);
    const angleVU = Math.atan2(cu[1] - cv[1], cu[0] - cv[0]);

    adj.get(u)!.push({ to: v, angle: angleUV });
    adj.get(v)!.push({ to: u, angle: angleVU });
  });

  // Sort outgoing edges counter-clockwise at each vertex
  for (let i = 0; i < numVertices; i++) {
    const edges = adj.get(i)!;
    edges.sort((e1, e2) => e1.angle - e2.angle);
  }

  // Key for directed half-edge
  const dKey = (u: number, v: number) => `${u}->${v}`;
  const visited = new Set<string>();
  const faces: number[][] = [];

  resolvedFold.edges_vertices.forEach(([startU, startV]) => {
    const candidates: [number, number][] = [
      [startU, startV],
      [startV, startU],
    ];

    for (const [u0, v0] of candidates) {
      if (visited.has(dKey(u0, v0))) continue;

      const cycle: number[] = [];
      let currU = u0;
      let currV = v0;
      let loopSafe = 0;
      const maxSteps = resolvedFold.edges_vertices.length * 2 + 10;

      while (!visited.has(dKey(currU, currV)) && loopSafe < maxSteps) {
        loopSafe++;
        visited.add(dKey(currU, currV));
        cycle.push(currU);

        // At vertex currV, find incoming edge (currU -> currV)
        // In CCW sorted list at currV, the reverse edge is currV -> currU
        const outList = adj.get(currV)!;
        const revIdx = outList.findIndex((e) => e.to === currU);
        if (revIdx === -1) break;

        // Sharpest left turn: predecessor in CCW list (or previous index)
        const nextIdx = (revIdx - 1 + outList.length) % outList.length;
        const nextV = outList[nextIdx].to;

        currU = currV;
        currV = nextV;

        if (currU === u0 && currV === v0) break;
      }

      if (cycle.length >= 3) {
        // Calculate signed area of cycle
        let area = 0;
        for (let i = 0; i < cycle.length; i++) {
          const p1 = coords[cycle[i]];
          const p2 = coords[cycle[(i + 1) % cycle.length]];
          area += p1[0] * p2[1] - p2[0] * p1[1];
        }
        area /= 2;

        // Only positive (counter-clockwise) cycles represent interior faces
        // Negative cycles are the unbounded exterior of the paper
        if (area > 1e-7) {
          faces.push(cycle);
        }
      }
    }
  });

  return faces;
}
