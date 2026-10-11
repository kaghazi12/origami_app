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

  const numVertices = workingFold.vertices_coords.length;
  const allTriangles: [number, number, number][] = [];

  if (workingFold.faces_vertices && workingFold.faces_vertices.length > 0) {
    for (const face of workingFold.faces_vertices) {
      const { triangles } = triangulatePolygon(workingFold.vertices_coords, face);
      allTriangles.push(...triangles);
    }
  } else {
    throw new Error('createMeshFromFold: unable to extract faces from crease pattern');
  }

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

/**
 * Retrieves the current simulation state from a TriMesh using Float64Array (Amendment A)
 */
export function getSimulationState(mesh: TriMesh, stepCount: number = 0, time: number = 0): SimulationState {
  const numHinges = mesh.hinges.length;
  const restAngles = new Float64Array(numHinges);
  for (let i = 0; i < numHinges; i++) {
    restAngles[i] = mesh.hinges[i].restAngle;
  }

  return {
    positions: new Float64Array(mesh.positions),
    velocities: new Float64Array(mesh.velocities),
    restAngles,
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
