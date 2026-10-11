/**
 * Pure TypeScript Origami Engine Types (Zero Three.js / React / DOM dependencies)
 * Fully compatible with Web Workers and Vitest.
 */

export type EdgeAssignment = 'B' | 'M' | 'V' | 'F' | 'U';
// 'B' = Boundary edge
// 'M' = Mountain fold (negative fold angle)
// 'V' = Valley fold (positive fold angle)
// 'F' = Flat crease (0 fold angle, facet stabilization)
// 'U' = Unassigned

/**
 * Standard FOLD 1.1 Specification interface
 * Reference: https://github.com/edemaine/fold
 */
export interface FoldFormat {
  file_spec: 1.1;
  file_creator?: string;
  file_title?: string;
  file_classes?: string[];
  frame_classes?: string[];
  /** 2D or 3D vertex coordinates */
  vertices_coords: [number, number][] | [number, number, number][];
  /** Directed or undirected edge vertex pairs [v0, v1] */
  edges_vertices: [number, number][];
  /** Edge assignment for each edge: 'B' | 'M' | 'V' | 'F' | 'U' */
  edges_assignment: EdgeAssignment[];
  /** Target fold angle in degrees: [-180, 180] */
  edges_foldAngle?: number[];
  /** Optional faces array: list of vertex indices defining each face */
  faces_vertices?: number[][];
}

/**
 * Mechanical Bar Element (axial spring for in-plane incompressibility)
 */
export interface BarElement {
  v0: number;
  v1: number;
  restLength: number;
  stiffness: number;
}

/**
 * Mechanical Hinge Element (torsional spring for crease & facet bending)
 */
export interface HingeElement {
  id: number;
  /** Index in FOLD edges_vertices if this hinge corresponds to an authored crease */
  edgeIndex?: number;
  /** Hinge line axis vertices: v0 -> v1 */
  v0: number;
  v1: number;
  /** Opposite vertex in triangle 1 */
  v2: number;
  /** Opposite vertex in triangle 2 */
  v3: number;
  /** Edge assignment: 'M' | 'V' | 'F' | 'U' */
  assignment: EdgeAssignment;
  /** Target fold angle in radians: positive = valley, negative = mountain */
  targetAngle: number;
  /** Persistent state: current rest angle in radians (Amendment A) */
  restAngle: number;
  /** Torsional stiffness (k_crease for M/V, k_facet for F) */
  stiffness: number;
}

/**
 * Persistent Simulation State (Amendment A)
 * The solver can continue from any current 3D pose at any time.
 * Uses Float64Array for simulation precision; convert to Float32Array only for rendering.
 */
export interface SimulationState {
  /** 3 * numVertices 3D positions [x, y, z] */
  positions: Float64Array;
  /** 3 * numVertices 3D velocities [vx, vy, vz] */
  velocities: Float64Array;
  /** numHinges per-hinge current rest angles in radians */
  restAngles: Float64Array;
  /** Simulation step count */
  stepCount: number;
  /** Simulated time elapsed in seconds */
  time: number;
}

/**
 * Triangulated Paper Mesh with Bars and Hinges
 */
export interface TriMesh {
  numVertices: number;
  numTriangles: number;
  /** 2 * numVertices 2D paper coordinates [u, v] */
  uvs: Float64Array;
  /** 3 * numVertices 3D coordinates [x, y, z] */
  positions: Float64Array;
  /** 3 * numVertices 3D velocities [vx, vy, vz] */
  velocities: Float64Array;
  /** numVertices masses */
  masses: Float64Array;
  /** 3 * numTriangles triangle index buffer */
  indices: Uint32Array;
  /** Axial springs */
  bars: BarElement[];
  /** Torsional springs */
  hinges: HingeElement[];
}

/**
 * Render/transfer buffers converted to Float32Array for WebGL / Three.js
 */
export interface RenderBuffers {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

export class FoldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FoldError';
  }
}
