import { FoldFormat, TriMesh, SimulationState } from '../types';
import { triangulatePolygon } from './triangulate';
import { extractTopology, TopologyResult } from './topology';

export interface MeshOptions {
  axialStiffness?: number;
  creaseStiffness?: number;
  facetStiffness?: number;
}

/**
 * Creates a TriMesh from a valid FOLD 1.1 model
 */
export function createMeshFromFold(fold: FoldFormat, options: MeshOptions = {}): TriMesh {
  const numVertices = fold.vertices_coords.length;

  // Triangulate faces
  const allTriangles: [number, number, number][] = [];

  if (fold.faces_vertices && fold.faces_vertices.length > 0) {
    for (const face of fold.faces_vertices) {
      const { triangles } = triangulatePolygon(fold.vertices_coords, face);
      allTriangles.push(...triangles);
    }
  } else {
    // If faces_vertices is missing, default to fan-triangulating all vertices if 4 (standard quad)
    if (numVertices === 4) {
      allTriangles.push([0, 1, 2], [0, 2, 3]);
    } else {
      throw new Error('createMeshFromFold: FOLD model must contain faces_vertices');
    }
  }

  // Extract bars, hinges, and triangle index buffer
  const topology: TopologyResult = extractTopology(
    fold.vertices_coords,
    allTriangles,
    fold,
    options
  );

  // Initialize vertex buffers
  const uvs = new Float32Array(numVertices * 2);
  const positions = new Float32Array(numVertices * 3);
  const velocities = new Float32Array(numVertices * 3);
  const masses = new Float32Array(numVertices).fill(1.0);

  for (let i = 0; i < numVertices; i++) {
    const c = fold.vertices_coords[i];
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
 * Retrieves the current simulation state from a TriMesh (Amendment A)
 */
export function getSimulationState(mesh: TriMesh, stepCount: number = 0, time: number = 0): SimulationState {
  const numHinges = mesh.hinges.length;
  const restAngles = new Float32Array(numHinges);
  for (let i = 0; i < numHinges; i++) {
    restAngles[i] = mesh.hinges[i].restAngle;
  }

  return {
    positions: new Float32Array(mesh.positions),
    velocities: new Float32Array(mesh.velocities),
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
