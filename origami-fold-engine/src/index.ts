export {
  FoldEngine,
  DEFAULT_LAYER_GAP,
  worldPolygon,
  worldVertices,
  faceNormal,
  polygonArea,
  triangulateFan,
  type EngineOptions,
  type Locator,
} from './engine';
export { parseModel } from './model';
export { FoldError } from './types';
export type { Face, FoldKind, FoldModel, FoldSide, FoldStep, PosedFace } from './types';
export type { Mat4, Vec2, Vec3 } from './math';
