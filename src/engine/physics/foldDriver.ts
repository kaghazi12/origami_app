/**
 * Drives the physics fold from the slider: moves the fold amount toward the slider's value, then
 * lets the paper settle and stops it.
 *
 * Rules, each fixing a real failure:
 * - The fold amount always reaches the slider value. It is rate-limited by crease rotation (at most
 *   MAX_DEG_PER_TICK per frame) so layers don't cross faster than contacts can catch them. It used
 *   to stop advancing whenever paper strain was over 4%, so patterns whose creases can't all reach
 *   their angles (strain never drops) stalled below 100%.
 * - Once there, the paper settles: after SETTLE_TICKS extra damping bleeds off any energy that
 *   jammed layers keep feeding in, and after FREEZE_TICKS the model stops. Before, an impossible
 *   pattern jittered and drifted for ever after 100%.
 * - While the user holds the paper nothing is frozen or damped extra.
 * - A pattern that can't fold flat at all (the exact folder found no layer order, or the creases
 *   tear) jams part way: pushing on made each frame take seconds and pushed paper through paper.
 *   With `jamStrain` set, the fold stops where the paper starts to stretch (`limit`) and backs off
 *   a little. Valid patterns never get a limit, so they always reach the slider value.
 */

import { TriMesh } from '../types';
import { rampRestAngles } from '../mesh/mesh';
import { FoldSolver } from './types';

/** Largest change of any crease's rest angle per frame, in degrees. */
export const MAX_DEG_PER_TICK = 1.5;
/** Frames at the target before extra damping starts (1 s at 60 fps), or SETTLE_MS, whichever first. */
export const SETTLE_TICKS = 60;
export const SETTLE_MS = 1000;
/** Frames at the target after which the model stops (3 s at 60 fps), or FREEZE_MS, whichever first. */
export const FREEZE_TICKS = 180;
export const FREEZE_MS = 3000;
/** Kinetic energy per vertex below which the paper counts as at rest. */
const REST_KE_PER_VERTEX = 1e-9;
/** Frames in a row over the jam strain before the fold counts as jammed. */
const JAM_TICKS = 6;
/** How far the fold backs off from where it jammed, in frames of folding. */
const JAM_BACKOFF_TICKS = 4;

export interface FoldDriverOptions {
  maxDegPerTick?: number;
  /** Stop folding when paper strain stays above this (impossible patterns only). Off by default. */
  jamStrain?: number | null;
}

export class FoldDriver {
  alpha = 0;
  target = 0;
  /** Frames spent at the target with nobody holding the paper, and since when (ms). */
  private atTarget = 0;
  private atTargetSince = 0;
  /** Clock in ms; heavy models tick slower than 60 fps, so settling also goes by wall time. */
  now: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  /** Stopped: no more physics until the slider moves or the paper is grabbed. */
  frozen = false;
  /** Settled on its own (energy ran out), as opposed to being stopped by the timeout. */
  settled = false;
  private readonly maxRate: number;
  /** Clock time of the previous tick, so the fold speed is per second, not per frame. */
  private lastTickAt: number | null = null;
  /** The furthest the pattern folds before jamming (1 = no limit). */
  limit = 1;
  private readonly jamStrain: number | null;
  private overStrain = 0;

  constructor(readonly mesh: TriMesh, private solver: FoldSolver, opts: FoldDriverOptions | number = {}) {
    const o = typeof opts === 'number' ? { maxDegPerTick: opts } : opts;
    const maxDegPerTick = o.maxDegPerTick ?? MAX_DEG_PER_TICK;
    this.jamStrain = o.jamStrain ?? null;
    let maxTarget = 0;
    for (const h of mesh.hinges) {
      if (h.assignment === 'M' || h.assignment === 'V') maxTarget = Math.max(maxTarget, Math.abs(h.targetAngle));
    }
    this.maxRate = ((maxDegPerTick * Math.PI) / 180) / (maxTarget || Math.PI);
  }

  setSolver(solver: FoldSolver) {
    this.solver = solver;
  }

  /** Move the slider. */
  setTarget(alpha: number) {
    const t = Math.max(0, Math.min(this.limit, alpha));
    // a jammed pattern keeps being asked for the slider's value: only a real change wakes it,
    // or it would never settle and stop
    if (t === this.target && this.jammed) return;
    this.target = t;
    this.wake();
  }

  /** The pattern jammed: it folds no further than `limit`. */
  get jammed() {
    return this.limit < 1;
  }

  /** Something changed (slider, grab, settings): run physics again. */
  wake() {
    this.frozen = false;
    this.settled = false;
    this.atTarget = 0;
    this.atTargetSince = this.now();
  }

  /** Jump without animating (e.g. after a reset). */
  jumpTo(alpha: number) {
    this.alpha = this.target = Math.max(0, Math.min(this.limit, alpha));
    rampRestAngles(this.mesh, this.alpha);
    this.wake();
  }

  get atTargetAlpha() {
    return Math.abs(this.alpha - this.target) < 1e-9;
  }

  /**
   * One frame. `holding` = the user is dragging or pinning the paper.
   * Returns false when frozen (nothing moved, nothing to send).
   */
  tick(dt = 0.016, holding = false): boolean {
    if (holding) this.wake();
    if (this.frozen) return false;

    // Fold speed per second: a frame slower than 60 fps advances proportionally more (up to 3x;
    // adaptive substeps in the solver absorb the bigger step), so the fold takes as long on a slow
    // machine or a heavy model as on a fast one.
    const t = this.now();
    const frames = this.lastTickAt === null ? 1 : Math.min(3, Math.max(1, (t - this.lastTickAt) / (1000 / 60)));
    this.lastTickAt = t;
    if (!this.atTargetAlpha) {
      const d = this.target - this.alpha;
      const rate = this.maxRate * frames;
      this.alpha = Math.abs(d) <= rate ? this.target : this.alpha + Math.sign(d) * rate;
      rampRestAngles(this.mesh, this.alpha);
      this.atTarget = 0;
      this.atTargetSince = this.now(); // the settle clock starts when the fold arrives
    } else if (holding) {
      this.atTargetSince = this.now();
    } else {
      this.atTarget++;
    }

    this.solver.step(dt);

    // An impossible pattern stretches the paper once it jams: stop there and back off a little.
    if (this.jamStrain !== null && !holding && this.target > this.alpha - 1e-9 && !this.atTargetAlpha) {
      this.overStrain = this.solver.getMaxStrain() > this.jamStrain ? this.overStrain + 1 : 0;
      if (this.overStrain >= JAM_TICKS) {
        this.limit = Math.max(0, this.alpha - this.maxRate * JAM_BACKOFF_TICKS);
        this.target = this.limit;
        this.overStrain = 0;
      }
    }

    if (!holding && this.atTargetAlpha) {
      const v = this.mesh.velocities;
      const elapsed = this.now() - this.atTargetSince;
      if (this.atTarget > SETTLE_TICKS || elapsed > SETTLE_MS) {
        // bleed off energy that jammed layers keep feeding in
        const k = 0.85;
        for (let i = 0; i < v.length; i++) v[i] *= k;
      }
      let ke = 0;
      for (let i = 0; i < v.length; i++) ke += v[i] * v[i];
      ke *= 0.5;
      if (this.atTarget > 10 && ke / Math.max(1, this.mesh.numVertices) < REST_KE_PER_VERTEX) {
        this.frozen = true;
        this.settled = true;
        v.fill(0);
      } else if (this.atTarget >= FREEZE_TICKS || elapsed >= FREEZE_MS) {
        this.frozen = true;
        v.fill(0);
      }
    }
    return true;
  }
}
