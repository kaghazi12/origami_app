import { FoldFormat, TriMesh, SimulationState, RenderBuffers } from '../types';
import { triangulatePolygon } from './triangulate';
import { extractTopology, TopologyResult } from './topology';
import { extractPlanarFaces } from '../fold/faces';
import { createRegularTriangulation, canGridHonorCreases } from './remesh';

export interface MeshOptions {
  axialStiffness?: number;
  creaseStiffness?: number;
  facetStiffness?: number;
  /** Maximum edge length for quality remeshing (e.g. 0.1) */
  targetEdgeLength?: number;
  /** Refine patterns the grid can't follow by midpoint subdivision (default true). */
  refine?: boolean;
}

/**
 * Creates a TriMesh from a valid FOLD 1.1 model.
 * If faces_vertices is missing, planar faces are derived automatically.
 * If targetEdgeLength is specified, quality triangulation/remeshing is applied.
 */
export function createMeshFromFold(fold: FoldFormat, options: MeshOptions = {}): TriMesh {
  let workingFold = fold;

  // 1. If targetEdgeLength specified, produce quality regular triangulation if grid honors all creases;
  // otherwise, fall back to constrained triangulation preserving all creases (Requirement 7)
  if (options.targetEdgeLength && options.targetEdgeLength > 0) {
    if (canGridHonorCreases(workingFold, options.targetEdgeLength)) {
      return createRegularTriangulation(workingFold, options.targetEdgeLength, options);
    }
  }

  // 2. If faces_vertices missing or empty, derive from planar edge graph
  if (!workingFold.faces_vertices || workingFold.faces_vertices.length === 0) {
    const derivedFaces = extractPlanarFaces(workingFold);
    workingFold = {
      ...workingFold,
      faces_vertices: derivedFaces,
    };
  }

  let allTriangles: [number, number, number][] = [];

  if (workingFold.faces_vertices && workingFold.faces_vertices.length > 0) {
    for (const face of workingFold.faces_vertices) {
      const { triangles } = triangulatePolygon(workingFold.vertices_coords, face);
      allTriangles.push(...triangles);
    }
  } else {
    throw new Error('createMeshFromFold: unable to extract faces from crease pattern');
  }

  // Flat folds the regular grid can't follow (any crease angle, any paper outline) are refined by
  // splitting triangles at their edge midpoints, so faces can flex on the way to flat instead of
  // staying one rigid triangle: twists, for example, can't collapse without that. 3D targets keep
  // their faces rigid: a target with consistent angles is reached by rigid faces, and flexible
  // walls (a box's sides meeting edge to edge) only press into each other.
  const flatTarget = workingFold.edges_assignment.every((a, i) => {
    if (a !== 'M' && a !== 'V') return true;
    const d = workingFold.edges_foldAngle?.[i];
    return d === undefined || Math.abs(Math.abs(d) - 180) < 1e-6;
  });
  if (flatTarget && options.targetEdgeLength && options.targetEdgeLength > 0 && options.refine !== false) {
    const refined = refineByMidpoints(workingFold, allTriangles, options.targetEdgeLength);
    workingFold = refined.fold;
    allTriangles = refined.triangles;
  }
  const numVertices = workingFold.vertices_coords.length;

  // 3. Extract bars, hinges, and triangle index buffer
  const topology: TopologyResult = extractTopology(
    workingFold.vertices_coords,
    allTriangles,
    workingFold,
    options
  );

  // 4. Initialize Float64Array vertex buffers for simulation
  const uvs = new Float64Array(numVertices * 2);
  const positions = new Float64Array(numVertices * 3);
  const velocities = new Float64Array(numVertices * 3);
  const masses = new Float64Array(numVertices).fill(1.0);

  for (let i = 0; i < numVertices; i++) {
    const c = workingFold.vertices_coords[i];
    uvs[i * 2 + 0] = c[0];
    uvs[i * 2 + 1] = c[1];

    positions[i * 3 + 0] = c[0];
    positions[i * 3 + 1] = c[1];
    positions[i * 3 + 2] = c[2] ?? 0;
  }

  return {
    numVertices,
    numTriangles: allTriangles.length,
    uvs,
    positions,
    velocities,
    masses,
    indices: topology.indices,
    bars: topology.bars,
    hinges: topology.hinges,
  };
}

/** Most triangles midpoint refinement may produce. */
const MAX_REFINED_TRIANGLES = 4000;
/**
 * Refine only while some edge is longer than this many target lengths. Finer than this made
 * stacked flat folds too floppy for the contacts (layers pushed through each other).
 */
const REFINE_FACTOR = 3;

/**
 * Split every triangle into four at its edge midpoints until no edge is longer than 1.5 x
 * targetEdgeLength (or the triangle budget runs out). Crease and boundary edges are split too and
 * keep their assignment and fold angle, so the pattern is unchanged; only the paper gets finer.
 */
export function refineByMidpoints(
  fold: FoldFormat,
  triangles: [number, number, number][],
  targetEdgeLength: number
): { fold: FoldFormat; triangles: [number, number, number][] } {
  let coords = fold.vertices_coords.map((c) => [c[0], c[1], c[2] ?? 0]) as [number, number, number][];
  let tris = triangles;
  let edges = fold.edges_vertices.map((e) => [e[0], e[1]] as [number, number]);
  let assign = [...fold.edges_assignment];
  let angles = fold.edges_assignment.map((a, i) => fold.edges_foldAngle?.[i] ?? (a === 'V' ? 180 : a === 'M' ? -180 : 0));
  const len = (u: number, v: number) => Math.hypot(coords[u][0] - coords[v][0], coords[u][1] - coords[v][1], coords[u][2] - coords[v][2]);
  for (let level = 0; level < 6; level++) {
    let longest = 0;
    for (const [a, b, c] of tris) longest = Math.max(longest, len(a, b), len(b, c), len(c, a));
    if (longest <= REFINE_FACTOR * targetEdgeLength || tris.length * 4 > MAX_REFINED_TRIANGLES) break;
    const mid = new Map<string, number>();
    const m = (u: number, v: number) => {
      const k = u < v ? `${u}_${v}` : `${v}_${u}`;
      let i = mid.get(k);
      if (i === undefined) {
        i = coords.length;
        coords.push([(coords[u][0] + coords[v][0]) / 2, (coords[u][1] + coords[v][1]) / 2, (coords[u][2] + coords[v][2]) / 2]);
        mid.set(k, i);
      }
      return i;
    };
    const next: [number, number, number][] = [];
    for (const [a, b, c] of tris) {
      const ab = m(a, b), bc = m(b, c), ca = m(c, a);
      next.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
    }
    const e2: [number, number][] = [], a2: typeof assign = [], g2: number[] = [];
    edges.forEach(([u, v], i) => {
      const k = u < v ? `${u}_${v}` : `${v}_${u}`;
      const w = mid.get(k);
      if (w === undefined) { e2.push([u, v]); a2.push(assign[i]); g2.push(angles[i]); return; }
      e2.push([u, w], [w, v]); a2.push(assign[i], assign[i]); g2.push(angles[i], angles[i]);
    });
    tris = next; edges = e2; assign = a2; angles = g2;
  }
  const flat2D = coords.every((c) => c[2] === 0);
  return {
    fold: {
      ...fold,
      vertices_coords: (flat2D ? coords.map((c) => [c[0], c[1]]) : coords) as FoldFormat['vertices_coords'],
      edges_vertices: edges,
      edges_assignment: assign,
      edges_foldAngle: angles,
      faces_vertices: undefined,
    },
    triangles: tris,
  };
}

/**
 * Retrieves the current simulation state from a TriMesh using Float64Array (Amendment A)
 */
export function getSimulationState(mesh: TriMesh, stepCount: number = 0, time: number = 0): SimulationState {
  const numHinges = mesh.hinges.length;
  const restAngles = new Float64Array(numHinges);
  const previousAngles = new Float64Array(numHinges);
  for (let i = 0; i < numHinges; i++) {
    restAngles[i] = mesh.hinges[i].restAngle;
    previousAngles[i] = mesh.hinges[i].previousAngle ?? 0;
  }

  return {
    positions: new Float64Array(mesh.positions),
    velocities: new Float64Array(mesh.velocities),
    restAngles,
    previousAngles,
    stepCount,
    time,
  };
}

/**
 * Restores a simulation state onto a TriMesh (Amendment A)
 */
export function setSimulationState(mesh: TriMesh, state: SimulationState): void {
  mesh.positions.set(state.positions);
  mesh.velocities.set(state.velocities);
  for (let i = 0; i < mesh.hinges.length && i < state.restAngles.length; i++) {
    mesh.hinges[i].restAngle = state.restAngles[i];
    if (state.previousAngles && i < state.previousAngles.length) {
      mesh.hinges[i].previousAngle = state.previousAngles[i];
    }
  }
}

/**
 * Helper to ramp per-hinge restAngle toward the FOLD target angle (Amendment A)
 * alpha: 0 = flat (restAngle 0), 1 = target fold angle
 */
export function rampRestAngles(mesh: TriMesh, alpha: number): void {
  const clamped = Math.max(0, Math.min(1, alpha));
  for (const hinge of mesh.hinges) {
    if (hinge.assignment === 'M' || hinge.assignment === 'V') {
      hinge.restAngle = clamped * hinge.targetAngle;
    } else {
      hinge.restAngle = 0; // Flat facet edges stay 0
    }
  }
}

/**
 * Converts Float64Array mesh state to Float32Array buffers for WebGL rendering
 */
export function getRenderBuffers(mesh: TriMesh): RenderBuffers {
  const numPos = mesh.positions.length;
  const numUV = mesh.uvs.length;

  const positions32 = new Float32Array(numPos);
  const uvs32 = new Float32Array(numUV);

  for (let i = 0; i < numPos; i++) positions32[i] = mesh.positions[i];
  for (let i = 0; i < numUV; i++) uvs32[i] = mesh.uvs[i];

  return {
    positions: positions32,
    uvs: uvs32,
    indices: mesh.indices,
  };
}
