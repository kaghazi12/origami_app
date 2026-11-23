import { parseDesign, type DesignAction, type OrigamiDesign } from './format';
import type { Vec2 } from './math';
import {
  StepError,
  applyCollapse,
  applyFold,
  applyReverseFold,
  applyRotate,
  applyTurnOver,
  applyUnfold,
  type StepRecord,
} from './ops';
import { initialState, type PaperState } from './state';

export interface CompiledStep {
  index: number;
  caption: string;
  hint?: string;
  record: StepRecord;
}

export interface CompileError {
  /** Index of the step that failed. */
  step: number;
  message: string;
}

export interface CompiledDesign {
  design: OrigamiDesign;
  /** Internal coordinates = design coordinates * scale (the longest side of the sheet is 1). */
  scale: number;
  initial: PaperState;
  /** Steps that compiled. If `error` is set, the step at error.step and later are missing. */
  steps: CompiledStep[];
  error: CompileError | null;
  final: PaperState;
  /** Milliseconds spent compiling. */
  timeMs: number;
}

const scaleVec = (v: Vec2, s: number): Vec2 => [v[0] * s, v[1] * s];

function runAction(state: PaperState, action: DesignAction, scale: number, previous: StepRecord | undefined): StepRecord {
  switch (action.type) {
    case 'fold':
      return applyFold(state, {
        ...action,
        line: [scaleVec(action.line[0], scale), scaleVec(action.line[1], scale)],
        moving: scaleVec(action.moving, scale),
      });
    case 'reverseFold':
      return applyReverseFold(state, {
        ...action,
        line: [scaleVec(action.line[0], scale), scaleVec(action.line[1], scale)],
        moving: scaleVec(action.moving, scale),
      });
    case 'collapse':
      return applyCollapse(state, action, scale);
    case 'unfold':
      return applyUnfold(state, previous);
    case 'turnOver':
      return applyTurnOver(state, action);
    case 'rotate':
      return applyRotate(state, action);
  }
}

/**
 * Run every step of a design. Deterministic: the same design always gives the same result,
 * so this can run once on upload (server or worker) and the result can be cached.
 * Stops at the first step that cannot be folded and reports why.
 */
export function compileDesign(input: OrigamiDesign | unknown): CompiledDesign {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const design = parseDesign(input);
  const scale = 1 / Math.max(design.paper.width, design.paper.height);
  const initial = initialState(design.paper.width * scale, design.paper.height * scale);
  const steps: CompiledStep[] = [];
  let state = initial;
  let error: CompileError | null = null;

  for (let i = 0; i < design.steps.length; i++) {
    const s = design.steps[i];
    try {
      const record = runAction(state, s.action, scale, steps[steps.length - 1]?.record);
      steps.push({ index: i, caption: s.caption, ...(s.hint ? { hint: s.hint } : {}), record });
      state = record.after;
    } catch (e) {
      const message = e instanceof StepError ? e.message : `internal error: ${(e as Error).message}`;
      error = { step: i, message };
      break;
    }
  }
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { design, scale, initial, steps, error, final: state, timeMs: t1 - t0 };
}
