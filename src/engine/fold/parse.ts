import { EdgeAssignment, FoldError, FoldFormat } from '../types';

const VALID_ASSIGNMENTS = new Set<EdgeAssignment>(['B', 'M', 'V', 'F', 'U']);

export function parseFold(json: unknown): FoldFormat {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new FoldError('Invalid FOLD: input must be an object');
  }

  const raw = json as Record<string, unknown>;

  // Check file_spec (default or coerce to 1.1)
  const file_spec = raw.file_spec === 1.1 || raw.file_spec === 1.2 ? 1.1 : 1.1;

  // Check vertices_coords
  if (!Array.isArray(raw.vertices_coords)) {
    throw new FoldError('Invalid FOLD: "vertices_coords" must be an array');
  }
  const vertices_coords = raw.vertices_coords.map((v, i) => {
    if (!Array.isArray(v) || (v.length !== 2 && v.length !== 3)) {
      throw new FoldError(`Invalid FOLD: vertices_coords[${i}] must be [x, y] or [x, y, z]`);
    }
    for (let c = 0; c < v.length; c++) {
      if (typeof v[c] !== 'number' || !Number.isFinite(v[c])) {
        throw new FoldError(`Invalid FOLD: vertices_coords[${i}][${c}] must be a finite number`);
      }
    }
    return (v.length === 2 ? [v[0], v[1]] : [v[0], v[1], v[2]]) as [number, number] | [number, number, number];
  });

  const numVertices = vertices_coords.length;

  // Check edges_vertices
  if (!Array.isArray(raw.edges_vertices)) {
    throw new FoldError('Invalid FOLD: "edges_vertices" must be an array');
  }
  const edges_vertices = raw.edges_vertices.map((e, i) => {
    if (!Array.isArray(e) || e.length !== 2) {
      throw new FoldError(`Invalid FOLD: edges_vertices[${i}] must be [v0, v1] pair`);
    }
    const [v0, v1] = e;
    if (!Number.isInteger(v0) || !Number.isInteger(v1)) {
      throw new FoldError(`Invalid FOLD: edges_vertices[${i}] indices must be integers`);
    }
    if (v0 < 0 || v0 >= numVertices || v1 < 0 || v1 >= numVertices) {
      throw new FoldError(`Invalid FOLD: edges_vertices[${i}] references out-of-bounds vertex index`);
    }
    if (v0 === v1) {
      throw new FoldError(`Invalid FOLD: edges_vertices[${i}] cannot connect vertex ${v0} to itself`);
    }
    return [v0, v1] as [number, number];
  });

  const numEdges = edges_vertices.length;

  // Check edges_assignment
  if (!Array.isArray(raw.edges_assignment)) {
    throw new FoldError('Invalid FOLD: "edges_assignment" must be an array');
  }
  if (raw.edges_assignment.length !== numEdges) {
    throw new FoldError(
      `Invalid FOLD: edges_assignment length (${raw.edges_assignment.length}) must match edges_vertices length (${numEdges})`
    );
  }
  const edges_assignment = raw.edges_assignment.map((a, i) => {
    if (typeof a !== 'string' || !VALID_ASSIGNMENTS.has(a as EdgeAssignment)) {
      throw new FoldError(`Invalid FOLD: edges_assignment[${i}] must be one of 'B', 'M', 'V', 'F', 'U'`);
    }
    return a as EdgeAssignment;
  });

  // Check edges_foldAngle (optional)
  let edges_foldAngle: number[] | undefined;
  if (raw.edges_foldAngle !== undefined) {
    if (!Array.isArray(raw.edges_foldAngle)) {
      throw new FoldError('Invalid FOLD: "edges_foldAngle" must be an array');
    }
    if (raw.edges_foldAngle.length !== numEdges) {
      throw new FoldError(
        `Invalid FOLD: edges_foldAngle length (${raw.edges_foldAngle.length}) must match edges_vertices length (${numEdges})`
      );
    }
    edges_foldAngle = raw.edges_foldAngle.map((deg, i) => {
      if (typeof deg !== 'number' || !Number.isFinite(deg)) {
        throw new FoldError(`Invalid FOLD: edges_foldAngle[${i}] must be a finite number`);
      }
      return deg;
    });
  } else {
    // Generate default fold angles based on assignment
    edges_foldAngle = edges_assignment.map((a) => {
      if (a === 'V') return 180;
      if (a === 'M') return -180;
      return 0;
    });
  }

  // Check faces_vertices (optional)
  let faces_vertices: number[][] | undefined;
  if (raw.faces_vertices !== undefined) {
    if (!Array.isArray(raw.faces_vertices)) {
      throw new FoldError('Invalid FOLD: "faces_vertices" must be an array');
    }
    faces_vertices = raw.faces_vertices.map((f, i) => {
      if (!Array.isArray(f) || f.length < 3) {
        throw new FoldError(`Invalid FOLD: faces_vertices[${i}] must be an array of at least 3 vertex indices`);
      }
      for (let k = 0; k < f.length; k++) {
        if (!Number.isInteger(f[k]) || f[k] < 0 || f[k] >= numVertices) {
          throw new FoldError(`Invalid FOLD: faces_vertices[${i}][${k}] references out-of-bounds vertex index`);
        }
      }
      return [...f];
    });
  }

  return {
    file_spec,
    ...(typeof raw.file_creator === 'string' ? { file_creator: raw.file_creator } : {}),
    ...(typeof raw.file_title === 'string' ? { file_title: raw.file_title } : {}),
    ...(Array.isArray(raw.file_classes) ? { file_classes: raw.file_classes.map(String) } : {}),
    ...(Array.isArray(raw.frame_classes) ? { frame_classes: raw.frame_classes.map(String) } : {}),
    vertices_coords: (vertices_coords.some((v) => v.length === 3)
      ? vertices_coords.map((v) => (v.length === 3 ? [v[0], v[1], v[2]] : [v[0], v[1], 0]))
      : vertices_coords.map((v) => [v[0], v[1]])) as [number, number][] | [number, number, number][],
    edges_vertices,
    edges_assignment,
    edges_foldAngle,
    ...(faces_vertices ? { faces_vertices } : {}),
  };
}
