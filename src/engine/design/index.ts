/**
 * Design engine (prototype): origami designs as step-by-step JSON, folded exactly.
 *
 *   const compiled = compileDesign(json);      // validate + fold every step (deterministic)
 *   const anim = new DesignAnimator(compiled); // playback
 *   anim.pose(2.4);                            // step 3 is 40% done -> vertex positions
 */

export * from './format';
export { compileDesign, type CompiledDesign, type CompiledStep, type CompileError } from './compile';
export { DesignAnimator, type AnimatorOptions, type Pose, type StepGeometry } from './animator';
export { StepError, type StepRecord } from './ops';
export { worldPolygon, paperArea, type PaperState, type Face, type Crease, type Topology } from './state';
export { solveLayers, type LayerInput, type LayerResult } from './layers';
export type { Vec2, Vec3, Mat4 } from './math';
export { exportFold, exportCompiledFold, type FoldFile, type FoldExportOptions } from './foldExport';
