import { BarElement, HingeElement, EdgeAssignment, FoldFormat } from '../types';

export const DEFAULT_AXIAL_STIFFNESS = 10000;
export const DEFAULT_CREASE_STIFFNESS = 1.0;
export const DEFAULT_FACET_STIFFNESS = 20.0;

export interface TopologyResult {
  bars: BarElement[];
  hinges: HingeElement[];
  indices: Uint32Array;
  /** Lookup map: key "min(u,v)_max(u,v)" -> bar index */
  edgeMap: Map<string, number>;
}

export function edgeKey(u: number, v: number): string {
  return u < v ? `${u}_${v}` : `${v}_${u}`;
}

export function extractTopology(
  coords: [number, number][] | [number, number, number][],
  triangles: [number, number, number][],
  fold?: FoldFormat,
  options: {
    axialStiffness?: number;
    creaseStiffness?: number;
    facetStiffness?: number;
  } = {}
): TopologyResult {
  const kAxial = options.axialStiffness ?? DEFAULT_AXIAL_STIFFNESS;
  const kCrease = options.creaseStiffness ?? DEFAULT_CREASE_STIFFNESS;
  const kFacet = options.facetStiffness ?? DEFAULT_FACET_STIFFNESS;

  // Build FOLD edge lookup map
  const foldEdgeLookup = new Map<
    string,
    { index: number; assignment: EdgeAssignment; foldAngleDeg: number }
  >();

  if (fold) {
    fold.edges_vertices.forEach(([u, v], i) => {
      const assignment = fold.edges_assignment[i];
      const foldAngleDeg =
        fold.edges_foldAngle?.[i] ??
        (assignment === 'V' ? 180 : assignment === 'M' ? -180 : 0);
      foldEdgeLookup.set(edgeKey(u, v), { index: i, assignment, foldAngleDeg });
    });
  }

  // Edge to incident triangles map:
  // key -> array of { triIndex, oppVertex, v0, v1 }
  interface EdgeTriangleRef {
    triIndex: number;
    oppVertex: number;
    v0: number;
    v1: number;
  }
  const edgeTriangles = new Map<string, EdgeTriangleRef[]>();

  triangles.forEach(([a, b, c], triIndex) => {
    const edges: [number, number, number][] = [
      [a, b, c], // edge a->b, opposite c
      [b, c, a], // edge b->c, opposite a
      [c, a, b], // edge c->a, opposite b
    ];

    edges.forEach(([v0, v1, opp]) => {
      const key = edgeKey(v0, v1);
      let list = edgeTriangles.get(key);
      if (!list) {
        list = [];
        edgeTriangles.set(key, list);
      }
      list.push({ triIndex, oppVertex: opp, v0, v1 });
    });
  });

  const bars: BarElement[] = [];
  const hinges: HingeElement[] = [];
  const edgeMap = new Map<string, number>();

  let hingeIdCounter = 0;

  for (const [key, triRefs] of edgeTriangles.entries()) {
    const [strU, strV] = key.split('_');
    const u = parseInt(strU, 10);
    const v = parseInt(strV, 10);

    // Compute rest length from initial 2D coords
    const cU = coords[u];
    const cV = coords[v];
    const dx = cV[0] - cU[0];
    const dy = cV[1] - cU[1];
    const dz = (cV[2] ?? 0) - (cU[2] ?? 0);
    const restLength = Math.hypot(dx, dy, dz);

    const barIdx = bars.length;
    bars.push({
      v0: u,
      v1: v,
      restLength,
      stiffness: kAxial,
    });
    edgeMap.set(key, barIdx);

    // If edge is shared by exactly 2 triangles, it forms a hinge
    if (triRefs.length === 2) {
      const t1 = triRefs[0];
      const t2 = triRefs[1];

      const foldInfo = foldEdgeLookup.get(key);
      let assignment: EdgeAssignment = 'F';
      let targetAngleRad = 0;
      let stiffness = kFacet;
      let edgeIndex: number | undefined;

      if (foldInfo) {
        edgeIndex = foldInfo.index;
        assignment = foldInfo.assignment;
        targetAngleRad = (foldInfo.foldAngleDeg * Math.PI) / 180;
        if (assignment === 'M' || assignment === 'V') {
          stiffness = kCrease;
        } else {
          stiffness = kFacet;
        }
      }

      hinges.push({
        id: hingeIdCounter++,
        edgeIndex,
        v0: t1.v0,
        v1: t1.v1,
        v2: t1.oppVertex,
        v3: t2.oppVertex,
        assignment,
        targetAngle: targetAngleRad,
        restAngle: 0, // Initial rest angle is 0 (flat)
        previousAngle: 0,
        stiffness,
      });
    }
  }

  // Flatten triangle indices into Uint32Array
  const indices = new Uint32Array(triangles.length * 3);
  for (let i = 0; i < triangles.length; i++) {
    indices[i * 3 + 0] = triangles[i][0];
    indices[i * 3 + 1] = triangles[i][1];
    indices[i * 3 + 2] = triangles[i][2];
  }

  return { bars, hinges, indices, edgeMap };
}
