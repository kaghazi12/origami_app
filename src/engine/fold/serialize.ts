import { FoldFormat } from '../types';

export function serializeFold(fold: FoldFormat, space: number = 2): string {
  return JSON.stringify(
    {
      file_spec: fold.file_spec,
      ...(fold.file_creator ? { file_creator: fold.file_creator } : {}),
      ...(fold.file_title ? { file_title: fold.file_title } : {}),
      ...(fold.file_classes ? { file_classes: fold.file_classes } : {}),
      ...(fold.frame_classes ? { frame_classes: fold.frame_classes } : {}),
      vertices_coords: fold.vertices_coords,
      edges_vertices: fold.edges_vertices,
      edges_assignment: fold.edges_assignment,
      ...(fold.edges_foldAngle ? { edges_foldAngle: fold.edges_foldAngle } : {}),
      ...(fold.faces_vertices ? { faces_vertices: fold.faces_vertices } : {}),
    },
    null,
    space
  );
}
