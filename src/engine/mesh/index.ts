export { triangulatePolygon, polygonArea2D } from './triangulate';
export {
  extractTopology,
  edgeKey,
  DEFAULT_AXIAL_STIFFNESS,
  DEFAULT_CREASE_STIFFNESS,
  DEFAULT_FACET_STIFFNESS,
} from './topology';
export {
  createMeshFromFold,
  getSimulationState,
  setSimulationState,
  rampRestAngles,
  getRenderBuffers,
  type MeshOptions,
} from './mesh';
export {
  splitMeshAlongPolyline,
  splitMeshAlongSegment,
  splitMeshAlongPolylines,
  type SplitOptions,
} from './split';
export {
  computeMeshQuality,
  createRegularTriangulation,
  canGridHonorCreases,
  isCreaseCoveredByMeshEdges,
  type MeshQuality,
} from './remesh';
export {
  computeBisectorPlane,
  sliceMeshWithPlane,
  chainSegmentsToPolylines,
  floodFillFlap,
  computeMeshQuality3D,
  cleanupMeshQuality,
  bakeCreasesToFold,
  type BisectorPlane,
  type CutIntersection,
  type TriangleSlice,
  type CreasePreviewResult,
} from './creaseSlice';
