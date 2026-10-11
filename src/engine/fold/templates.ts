import { FoldFormat } from '../types';

/**
 * Creates a blank rectangular sheet of paper
 */
export function createSquareSheet(width: number = 1, height: number = 1): FoldFormat {
  return {
    file_spec: 1.1,
    file_creator: 'origami-fold-engine',
    file_title: 'Blank Sheet',
    file_classes: ['singleModel'],
    frame_classes: ['creasePattern'],
    vertices_coords: [
      [0, 0],
      [width, 0],
      [width, height],
      [0, height],
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
    ],
    edges_assignment: ['B', 'B', 'B', 'B'],
    edges_foldAngle: [0, 0, 0, 0],
    faces_vertices: [[0, 1, 2, 3]],
  };
}

/**
 * Single vertical valley fold in half
 */
export function createHalfFoldPattern(width: number = 1, height: number = 1): FoldFormat {
  const midX = width / 2;
  return {
    file_spec: 1.1,
    file_creator: 'origami-fold-engine',
    file_title: 'Half Fold (Valley)',
    file_classes: ['singleModel'],
    frame_classes: ['creasePattern'],
    vertices_coords: [
      [0, 0], // 0
      [midX, 0], // 1
      [width, 0], // 2
      [width, height], // 3
      [midX, height], // 4
      [0, height], // 5
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 0],
      // Valley crease down center:
      [1, 4],
    ],
    edges_assignment: ['B', 'B', 'B', 'B', 'B', 'B', 'V'],
    edges_foldAngle: [0, 0, 0, 0, 0, 0, 180],
    faces_vertices: [
      [0, 1, 4, 5],
      [1, 2, 3, 4],
    ],
  };
}

/**
 * Diagonal valley fold in half
 */
export function createDiagonalFoldPattern(width: number = 1, height: number = 1): FoldFormat {
  return {
    file_spec: 1.1,
    file_creator: 'origami-fold-engine',
    file_title: 'Diagonal Fold',
    file_classes: ['singleModel'],
    frame_classes: ['creasePattern'],
    vertices_coords: [
      [0, 0], // 0
      [width, 0], // 1
      [width, height], // 2
      [0, height], // 3
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      // Diagonal crease:
      [0, 2],
    ],
    edges_assignment: ['B', 'B', 'B', 'B', 'V'],
    edges_foldAngle: [0, 0, 0, 0, 180],
    faces_vertices: [
      [0, 1, 2],
      [0, 2, 3],
    ],
  };
}

/**
 * Classical Waterbomb Base Crease Pattern
 * Center vertex with horizontal Mountain fold and two diagonal Valley folds
 */
export function createWaterbombBasePattern(size: number = 1): FoldFormat {
  const half = size / 2;
  return {
    file_spec: 1.1,
    file_creator: 'origami-fold-engine',
    file_title: 'Waterbomb Base',
    file_classes: ['singleModel'],
    frame_classes: ['creasePattern'],
    vertices_coords: [
      [0, 0], // 0 bottom-left
      [half, 0], // 1 bottom-mid
      [size, 0], // 2 bottom-right
      [size, half], // 3 right-mid
      [size, size], // 4 top-right
      [half, size], // 5 top-mid
      [0, size], // 6 top-left
      [0, half], // 7 left-mid
      [half, half], // 8 center
    ],
    edges_vertices: [
      // Boundary
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 0],
      // Creases meeting at center:
      // Horizontal mountain folds
      [7, 8],
      [8, 3],
      // Diagonal valley folds
      [0, 8],
      [8, 4],
      [6, 8],
      [8, 2],
    ],
    edges_assignment: [
      'B', 'B', 'B', 'B', 'B', 'B', 'B', 'B',
      'M', 'M',
      'V', 'V', 'V', 'V',
    ],
    edges_foldAngle: [
      0, 0, 0, 0, 0, 0, 0, 0,
      -180, -180,
      180, 180, 180, 180,
    ],
    faces_vertices: [
      [0, 1, 2, 8], // Bottom quad
      [2, 3, 8],    // Right-bottom triangle
      [3, 4, 8],    // Right-top triangle
      [4, 5, 6, 8], // Top quad
      [6, 7, 8],    // Left-top triangle
      [7, 0, 8],    // Left-bottom triangle
    ],
  };
}

/**
 * Classical Preliminary Base (Square Base) Crease Pattern
 * Center vertex with orthogonal Valley folds and diagonal Mountain folds
 */
export function createPreliminaryBasePattern(size: number = 1): FoldFormat {
  const half = size / 2;
  return {
    file_spec: 1.1,
    file_creator: 'origami-fold-engine',
    file_title: 'Preliminary Base',
    file_classes: ['singleModel'],
    frame_classes: ['creasePattern'],
    vertices_coords: [
      [0, 0], // 0 bottom-left
      [half, 0], // 1 bottom-mid
      [size, 0], // 2 bottom-right
      [size, half], // 3 right-mid
      [size, size], // 4 top-right
      [half, size], // 5 top-mid
      [0, size], // 6 top-left
      [0, half], // 7 left-mid
      [half, half], // 8 center
    ],
    edges_vertices: [
      // Boundary
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 0],
      // Orthogonal valley folds
      [1, 8],
      [8, 5],
      [7, 8],
      [8, 3],
      // Diagonal mountain folds
      [0, 8],
      [8, 4],
      [6, 8],
      [8, 2],
    ],
    edges_assignment: [
      'B', 'B', 'B', 'B', 'B', 'B', 'B', 'B',
      'V', 'V', 'V', 'V',
      'M', 'M', 'M', 'M',
    ],
    edges_foldAngle: [
      0, 0, 0, 0, 0, 0, 0, 0,
      180, 180, 180, 180,
      -180, -180, -180, -180,
    ],
    faces_vertices: [
      [0, 1, 8],
      [1, 2, 8],
      [2, 3, 8],
      [3, 4, 8],
      [4, 5, 8],
      [5, 6, 8],
      [6, 7, 8],
      [7, 0, 8],
    ],
  };
}
