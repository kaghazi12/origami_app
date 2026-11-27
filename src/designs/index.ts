/**
 * The designs that ship with the app, for the landing page and both modes' pickers.
 * Step designs (.json) belong to Learn; crease patterns (.fold) and built-in templates belong to
 * Crease pattern mode.
 */
import type { FoldFormat } from '../engine/types';
import { theme } from '../theme';
import {
  createMiuraOriPattern,
  createPreliminaryBasePattern,
  createSquareSheet,
  createWaterbombBasePattern,
} from '../engine/fold/templates';
import cupJson from './paper-cup.json';
import prelimJson from './preliminary-base.json';
import craneJson from './crane.json';
import dogJson from './dog-face.json';
import helmetJson from './samurai-helmet.json';
import planeJson from './paper-airplane.json';
import swanJson from './swan.json';
import birdBaseText from './bird-base.fold?raw';
import boxText from './box.fold?raw';
import test3Text from './test-3.fold?raw';

export interface StepDesignEntry {
  id: string;
  json: unknown;
  title: string;
  difficulty?: string;
  stepCount: number;
  front: string;
  back: string;
}

function stepEntry(json: unknown): StepDesignEntry {
  const j = json as {
    meta: { id: string; title: string; difficulty?: string };
    paper: { front?: string; back?: string };
    steps: unknown[];
  };
  return {
    id: j.meta.id,
    json,
    title: j.meta.title,
    difficulty: j.meta.difficulty,
    stepCount: j.steps.length,
    front: j.paper.front ?? theme.paperBack,
    back: j.paper.back ?? theme.paperFront,
  };
}

/** Learn mode, easiest first. */
export const STEP_DESIGNS: StepDesignEntry[] = [
  stepEntry(cupJson),
  stepEntry(dogJson),
  stepEntry(planeJson),
  stepEntry(helmetJson),
  stepEntry(prelimJson),
  stepEntry(swanJson),
  stepEntry(craneJson),
];

export interface PatternEntry {
  id: string;
  title: string;
  /** Short description for the picker. */
  meta: string;
  group: 'Examples' | 'Bases' | 'Test files' | 'Your files' | 'Start from';
  /** The file as given (run it through prepareFold before folding). */
  create: () => FoldFormat;
}

const parse = (text: string) => () => JSON.parse(text) as FoldFormat;

function creaseCount(f: FoldFormat): number {
  return (f.edges_assignment ?? []).filter((a) => a === 'M' || a === 'V').length;
}

const raw: Omit<PatternEntry, 'meta'>[] = [
  { id: 'miura', title: 'Miura-ori', group: 'Examples', create: () => createMiuraOriPattern(3, 3, 1, 1, 60) },
  { id: 'box', title: 'Box with wing', group: 'Examples', create: parse(boxText) },
  { id: 'box-pleat', title: 'Box-pleated pattern', group: 'Examples', create: parse(test3Text) },
  { id: 'waterbomb', title: 'Waterbomb base', group: 'Bases', create: () => createWaterbombBasePattern(1) },
  { id: 'preliminary', title: 'Preliminary base', group: 'Bases', create: () => createPreliminaryBasePattern(1) },
  { id: 'bird-base', title: 'Bird base', group: 'Bases', create: parse(birdBaseText) },
  { id: 'flat', title: 'Blank sheet', group: 'Start from', create: () => createSquareSheet(1, 1) },
];

/**
 * Every other FOLD file in this folder is listed too, so new files show up in the picker without
 * code changes: numbered ones (01_….fold, generated test cases) under "Test files", the rest
 * (files you drop in, e.g. crease_pattern_1.fold) under "Your files".
 */
const LISTED = new Set(['bird-base.fold', 'box.fold', 'test-3.fold']);
const otherFiles = import.meta.glob('./*.fold', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
for (const [p, text] of Object.entries(otherFiles).sort(([a], [b]) => a.localeCompare(b))) {
  const file = p.replace(/^.*\//, '');
  if (LISTED.has(file)) continue;
  let title = file.replace(/\.fold$/, '');
  try {
    const j = JSON.parse(text);
    title = j.file_title ?? j.frame_title ?? title;
  } catch {
    /* listed by file name; opening it will report the problem */
  }
  const numbered = /^\d\d_/.test(file);
  raw.push({ id: `${numbered ? 'test' : 'file'}:${file}`, title, group: numbered ? 'Test files' : 'Your files', create: parse(text) });
}

const NOTES: Record<string, string> = {
  box: 'Folded form by Jason Ku',
  flat: 'Make your own creases',
};

/** Crease pattern mode. The meta line is the crease count, computed once. */
const GROUP_ORDER = ['Examples', 'Bases', 'Your files', 'Test files', 'Start from'];
export const PATTERNS: PatternEntry[] = raw
  .map((p) => {
    if (NOTES[p.id]) return { ...p, meta: NOTES[p.id] };
    let n = 0;
    try {
      n = creaseCount(p.create());
    } catch {
      return { ...p, meta: 'Unreadable file' };
    }
    return { ...p, meta: `${n.toLocaleString()} creases${/^(test|file):/.test(p.id) ? ` · ${p.id.replace(/^\w+:/, '')}` : ''}` };
  })
  .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));

export const DEFAULT_PATTERN_ID = 'miura';

export function patternById(id: string): PatternEntry | undefined {
  return PATTERNS.find((p) => p.id === id);
}

export function difficultyLabel(d?: string): string {
  if (!d) return 'Unrated';
  return d.charAt(0).toUpperCase() + d.slice(1);
}
