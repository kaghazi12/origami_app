import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  Check,
  Download,
  Eye,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  FoldVertical,
  Layers,
  MousePointerClick,
  PenLine,
  Pin,
  Plus,
  RotateCcw,
  RotateCw,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import type { CreaseFold, CollapseCrease, DesignAction, DesignStep, LayerSelector, OrigamiDesign, Vec2 } from '../../engine/design';
import { db, LIMITS, type DesignRecord } from '../../store';
import { href, navigate } from '../../router';
import { difficultyLabel } from '../../designs';
import { outlineOf } from '../community/designFiles';
import { StepPlayer } from '../community/StepPlayer';
import { Button, IconButton } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { InlineInput, TextArea, TextField } from '../ui/Field';
import { MiniSlider } from '../ui/Scrubber';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Tooltip } from '../ui/Tooltip';
import { useToast } from '../ui/Toast';
import { cn } from '../ui/cn';
import { theme } from '../../theme';
import { actionIcon, actionLabel, compileCached, defaultCaption, withSteps, type Tool } from './actions';
import { CollapseCanvas, nextFold, type CollapseMode, type NewSegment } from './CollapseCanvas';
import { FoldCanvas } from './FoldCanvas';

const SWATCHES = ['#fbfbf8', '#b8232f', '#2f56c8', '#2f7a52', '#f5b301', '#9c5a2b', '#121a30', '#6b4fa0', '#0e7490', '#f4ead8'];
const PAPERS: { value: string; label: string; w: number; h: number }[] = [
  { value: 'square', label: 'Square', w: 1, h: 1 },
  { value: 'a4', label: 'A4', w: 1, h: Math.SQRT2 },
  { value: 'letter', label: 'Letter', w: 8.5, h: 11 },
];

type SaveState = 'saved' | 'saving' | 'error';

/** Where the next step goes: inserted at `index`, or replacing the step at `index`. */
interface Cursor {
  index: number;
  replace: boolean;
}

const sameDoc = (a: OrigamiDesign, b: OrigamiDesign) => JSON.stringify(a) === JSON.stringify(b);

export const StepEditor: React.FC<{ record: DesignRecord; initial: OrigamiDesign }> = ({ record, initial }) => {
  const toast = useToast();
  const [doc, setDoc] = useState<OrigamiDesign>(initial);
  const [panel, setPanel] = useState<'steps' | 'details'>('steps');
  const [cursor, setCursor] = useState<Cursor>({ index: initial.steps.length, replace: false });
  const [showPreview, setShowPreview] = useState(true);
  const [save, setSave] = useState<SaveState>('saved');

  // the step being drawn
  const [tool, setTool] = useState<Tool>('fold');
  const [points, setPoints] = useState<Vec2[]>([]);
  const [moving, setMoving] = useState<Vec2 | null>(null);
  const [direction, setDirection] = useState<'valley' | 'mountain'>('valley');
  const [layers, setLayers] = useState<'all' | 'top' | 'count'>('all');
  const [layerCount, setLayerCount] = useState(2);
  const [angle, setAngle] = useState(180);
  const [reverseMode, setReverseMode] = useState<'inside' | 'outside'>('inside');
  const [targets, setTargets] = useState<Record<number, CreaseFold>>({});
  const [newSegs, setNewSegs] = useState<NewSegment[]>([]);
  const [fixed, setFixed] = useState<Vec2 | null>(null);
  const [collapseMode, setCollapseMode] = useState<CollapseMode>('pick');
  const [caption, setCaption] = useState('');
  const [hint, setHint] = useState('');

  // ---------------------------------------------------------------- compiling
  const full = useMemo(() => compileCached(doc), [doc]);
  const before = useMemo(() => compileCached(withSteps(doc, doc.steps.slice(0, cursor.index))), [doc, cursor.index]);
  const scale = before.scale;
  const beforeState = before.final;
  const outline = useMemo(() => outlineOf(beforeState), [beforeState]);
  const front = doc.paper.front ?? theme.paperBack;
  const back = doc.paper.back ?? theme.paperFront;

  const layerSel: LayerSelector = layers === 'count' ? layerCount : layers;
  const toDesign = (p: Vec2): Vec2 => [round(p[0] / scale), round(p[1] / scale)];

  /** The step as drawn so far, or null while it's incomplete. */
  const draftAction: DesignAction | null = useMemo(() => {
    if (tool === 'collapse') {
      const creases: CollapseCrease[] = [
        ...Object.entries(targets).map(([k, fold]) => {
          const c = beforeState.topo.creases[+k];
          return { from: toDesign(c.p0), to: toDesign(c.p1), fold };
        }),
        ...newSegs.map((s) => ({ from: toDesign(s.from), to: toDesign(s.to), fold: s.fold })),
      ];
      if (!creases.length) return null;
      return { type: 'collapse', creases, ...(fixed ? { fixed: toDesign(fixed) } : {}) };
    }
    if (points.length < 2 || !moving) return null;
    const line: [Vec2, Vec2] = [toDesign(points[0]), toDesign(points[1])];
    if (tool === 'reverseFold') return { type: 'reverseFold', line, moving: toDesign(moving), mode: reverseMode, ...(layers !== 'all' ? { layers: layerSel } : {}) };
    return {
      type: 'fold',
      line,
      moving: toDesign(moving),
      direction,
      ...(layers !== 'all' ? { layers: layerSel } : {}),
      ...(angle < 180 ? { angle } : {}),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, targets, newSegs, fixed, points, moving, reverseMode, layers, layerSel, direction, angle, beforeState, scale]);

  const stepsWith = (action: DesignAction, cap: string, h: string): DesignStep[] => {
    const step: DesignStep = { caption: cap.trim() || defaultCaption(action), ...(h.trim() ? { hint: h.trim() } : {}), action };
    const steps = doc.steps.slice();
    steps.splice(cursor.index, cursor.replace ? 1 : 0, step);
    return steps;
  };
  const preview = useMemo(() => {
    if (!draftAction) return null;
    return compileCached(withSteps(doc, stepsWith(draftAction, caption, hint)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftAction, doc, cursor]);
  const draftError = preview?.error && preview.error.step === cursor.index ? preview.error.message : null;

  // ---------------------------------------------------------------- saving
  const firstSave = useRef(true);
  useEffect(() => {
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
    setSave('saving');
    const t = window.setTimeout(() => {
      try {
        db.updateDesign(record.id, {
          title: doc.meta.title || 'Untitled design',
          description: doc.meta.description ?? '',
          credit: doc.meta.author,
          difficulty: doc.meta.difficulty,
          tags: doc.meta.tags ?? [],
          source: { type: 'inline', data: doc },
          size: doc.steps.length,
          front: doc.paper.front,
          back: doc.paper.back,
        });
        setSave('saved');
      } catch (e) {
        setSave('error');
        toast.show({ tone: 'error', title: 'Couldn’t save', detail: (e as Error).message });
      }
    }, 500);
    return () => window.clearTimeout(t);
  }, [doc, record.id, toast]);

  // ---------------------------------------------------------------- drafting
  const resetDraft = useCallback(() => {
    setPoints([]);
    setMoving(null);
    setTargets({});
    setNewSegs([]);
    setFixed(null);
    setCaption('');
    setHint('');
  }, []);

  const moveCursor = (c: Cursor) => {
    setCursor(c);
    resetDraft();
  };

  /** Open a step to change it: load its action into the drawing tools. */
  const editStep = (i: number) => {
    const s = doc.steps[i];
    const c = compileCached(withSteps(doc, doc.steps.slice(0, i)));
    const k = c.scale;
    setCursor({ index: i, replace: true });
    resetDraft();
    setCaption(s.caption);
    setHint(s.hint ?? '');
    const a = s.action;
    const toModel = (p: Vec2): Vec2 => [p[0] * k, p[1] * k];
    if (a.type === 'fold' || a.type === 'reverseFold') {
      setTool(a.type);
      setPoints([toModel(a.line[0]), toModel(a.line[1])]);
      setMoving(toModel(a.moving));
      const l = a.layers ?? 'all';
      if (typeof l === 'number') { setLayers('count'); setLayerCount(l); }
      else setLayers(l === 'bottom' ? 'all' : l);
      if (a.type === 'fold') { setDirection(a.direction); setAngle(a.angle ?? 180); }
      else setReverseMode(a.mode);
    } else if (a.type === 'collapse') {
      setTool('collapse');
      setNewSegs(a.creases.map((cr) => ({ from: toModel(cr.from), to: toModel(cr.to), fold: cr.fold })));
      setFixed(a.fixed ? toModel(a.fixed) : null);
    }
  };

  const commit = (action: DesignAction | null = draftAction) => {
    if (!action) return;
    const steps = stepsWith(action, caption, hint);
    const check = compileCached(withSteps(doc, steps));
    if (check.error && check.error.step === cursor.index) {
      toast.show({ tone: 'error', title: `Step ${cursor.index + 1} can’t be folded`, detail: check.error.message });
      return;
    }
    if (steps.length > 400) return;
    setDoc({ ...doc, steps });
    moveCursor({ index: cursor.index + 1, replace: false });
  };

  const removeStep = (i: number) => {
    const steps = doc.steps.filter((_, j) => j !== i);
    setDoc({ ...doc, steps });
    moveCursor({ index: Math.min(i, steps.length), replace: false });
  };

  const moveStep = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= doc.steps.length) return;
    const steps = doc.steps.slice();
    [steps[i], steps[j]] = [steps[j], steps[i]];
    setDoc({ ...doc, steps });
    moveCursor({ index: doc.steps.length, replace: false });
  };

  // Enter adds the step, Escape clears the drawing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'Escape') resetDraft();
      else if (e.key === 'Enter' && draftAction && !draftError) commit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const publish = () => {
    if (!doc.meta.title.trim()) return toast.show({ tone: 'error', title: 'Give the design a title first' });
    if (!doc.steps.length) return toast.show({ tone: 'error', title: 'Add at least one step first' });
    if (full.error) return toast.show({ tone: 'error', title: `Step ${full.error.step + 1} can’t be folded`, detail: 'Fix or delete it, then publish.' });
    try {
      db.updateDesign(record.id, { title: doc.meta.title, source: { type: 'inline', data: doc }, size: doc.steps.length, front: doc.paper.front, back: doc.paper.back, description: doc.meta.description ?? '', difficulty: doc.meta.difficulty, tags: doc.meta.tags ?? [], credit: doc.meta.author });
      db.publish(record.id);
      toast.show({ title: 'Published', detail: 'It’s in Explore and on your profile.' });
      navigate(href.design(record.id));
    } catch (e) {
      toast.show({ tone: 'error', title: (e as Error).message });
    }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(doc.meta.title || 'design').replace(/[\\/:*?"<>|]+/g, ' ').trim()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const setMeta = (patch: Partial<OrigamiDesign['meta']>) => setDoc((d) => ({ ...d, meta: { ...d.meta, ...patch } }));
  const setPaper = (patch: Partial<OrigamiDesign['paper']>) => setDoc((d) => ({ ...d, paper: { ...d.paper, ...patch } }));

  const stage =
    tool === 'collapse'
      ? draftAction ? 'ready' : 'collapse'
      : points.length === 0 ? 'first' : points.length === 1 ? 'second' : !moving ? 'side' : 'ready';
  const instruction: Record<string, string> = {
    first: 'Click where the fold line starts. Points snap to corners, edge middles and edges.',
    second: 'Click a second point on the fold line.',
    side: 'Click the side of the line that moves.',
    collapse:
      collapseMode === 'pick'
        ? 'Click creases to choose how they end up: valley, mountain, flat, or “either” (the engine picks).'
        : collapseMode === 'draw'
          ? 'Click two points to draw a new crease. It must run from edge to edge or crease to crease.'
          : 'Click the face that stays where it is.',
    ready: 'Check the 3D preview, adjust the options, then add the step (Enter).',
  };
  const published = record.status === 'published';
  const publishedRecord = db.design(record.id);

  return (
    <div className="flex min-h-0 flex-1">
      {/* ---------------- sidebar: steps and details */}
      <aside className="hidden w-80 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div className="border-b border-line px-5 pb-4 pt-5">
          <input
            aria-label="Title"
            value={doc.meta.title}
            maxLength={LIMITS.titleLength}
            onChange={(e) => setMeta({ title: e.target.value })}
            placeholder="Untitled design"
            className="-mx-1.5 h-10 w-[calc(100%+0.75rem)] rounded-md bg-transparent px-1.5 font-display text-2xl font-semibold tracking-tight text-ink placeholder:text-ink-faint transition-colors hover:bg-sunken focus:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-focus/40"
          />
          <div className="mt-1 flex items-center gap-2 text-xs text-ink-muted" aria-live="polite">
            {save === 'saving' ? 'Saving…' : save === 'error' ? 'Not saved' : (
              <>
                <Check className="size-3.5 text-success" strokeWidth={2.25} /> Saved {published ? '· published' : 'as a draft'}
              </>
            )}
          </div>
          <SegmentedControl<'steps' | 'details'>
            label="Panel"
            className="mt-4 w-full"
            value={panel}
            onChange={setPanel}
            segments={[
              { value: 'steps', label: `Steps (${doc.steps.length})` },
              { value: 'details', label: 'Details' },
            ]}
          />
        </div>

        {panel === 'steps' ? (
          <ol className="min-h-0 flex-1 overflow-y-auto p-2">
            <li>
              <button
                type="button"
                onClick={() => moveCursor({ index: 0, replace: false })}
                className={cn('relative flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-ink-muted hover:bg-sunken', cursor.index === 0 && !cursor.replace && doc.steps.length > 0 && 'text-ink')}
              >
                <span className="grid size-6 place-items-center rounded-sm border border-line-strong bg-paper" aria-hidden="true">
                  <span className="size-3" style={{ backgroundColor: front }} />
                </span>
                Flat sheet
              </button>
            </li>
            {doc.steps.map((s, i) => {
              const Icon = actionIcon(s.action);
              const broken = full.error && i >= full.error.step;
              const current = cursor.replace && cursor.index === i;
              return (
                <li key={i} className="group relative">
                  {!cursor.replace && cursor.index === i && <InsertMarker />}
                  <button
                    type="button"
                    onClick={() => editStep(i)}
                    aria-current={current ? 'step' : undefined}
                    className={cn(
                      'relative flex w-full items-start gap-3 rounded-md py-2 pl-3 pr-16 text-left text-sm transition-colors',
                      current ? 'text-ink' : 'text-ink hover:bg-sunken',
                      broken && 'text-danger',
                    )}
                  >
                    {current && (
                      <motion.span layoutId="editor-current" className="absolute inset-0 rounded-md bg-accent-soft" transition={{ type: 'spring', stiffness: 420, damping: 36 }}>
                        <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-sm bg-accent" />
                      </motion.span>
                    )}
                    <span className="relative w-5 shrink-0 pt-0.5 text-right text-xs tabular-nums text-ink-faint">{i + 1}</span>
                    <Icon className="relative mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={1.75} />
                    <span className="relative leading-5">{s.caption}</span>
                  </button>
                  <div className="absolute right-1 top-1 flex opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <IconButton size="sm" label="Move up" icon={ArrowUp} onClick={() => moveStep(i, -1)} disabled={i === 0} />
                    <IconButton size="sm" label="Move down" icon={ArrowDown} onClick={() => moveStep(i, 1)} disabled={i === doc.steps.length - 1} />
                    <IconButton size="sm" label="Delete step" icon={Trash2} onClick={() => removeStep(i)} />
                  </div>
                  {full.error && full.error.step === i && <p className="px-3 pb-2 pl-11 text-xs text-danger">{full.error.message}</p>}
                </li>
              );
            })}
            <li className="relative">
              {!cursor.replace && cursor.index === doc.steps.length && doc.steps.length > 0 && <InsertMarker />}
              <button
                type="button"
                onClick={() => moveCursor({ index: doc.steps.length, replace: false })}
                className="mt-1 flex w-full items-center gap-2 rounded-md border border-dashed border-line-strong px-3 py-2 text-sm font-medium text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
              >
                <Plus className="size-4" strokeWidth={1.75} /> Add a step at the end
              </button>
            </li>
          </ol>
        ) : (
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
            <TextArea label="Description" value={doc.meta.description ?? ''} maxCount={LIMITS.descriptionLength} onChange={(e) => setMeta({ description: e.target.value })} placeholder="What it is, what paper to use" />
            <TextField label="Designed by" value={doc.meta.author ?? ''} onChange={(e) => setMeta({ author: e.target.value || undefined })} hint="Leave empty if it’s your own design. “Traditional” for classic models." />
            <div className="space-y-1.5">
              <span className="text-sm font-medium text-ink">Difficulty</span>
              <SegmentedControl<NonNullable<OrigamiDesign['meta']['difficulty']>>
                label="Difficulty"
                size="sm"
                className="w-full"
                value={doc.meta.difficulty ?? 'beginner'}
                onChange={(v) => setMeta({ difficulty: v })}
                segments={(['beginner', 'intermediate', 'advanced', 'expert'] as const).map((v) => ({ value: v, label: difficultyLabel(v) }))}
              />
            </div>
            <TextField
              label="Tags"
              value={(doc.meta.tags ?? []).join(', ')}
              onChange={(e) => setMeta({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean).slice(0, LIMITS.tags) })}
              hint="Separate with commas: animal, simple folds"
            />
            <div className="space-y-1.5">
              <span className="text-sm font-medium text-ink">Paper</span>
              <SegmentedControl<string>
                label="Paper size"
                size="sm"
                className="w-full"
                value={PAPERS.find((p) => Math.abs(p.h / p.w - doc.paper.height / doc.paper.width) < 1e-6)?.value ?? 'square'}
                onChange={(v) => {
                  const p = PAPERS.find((x) => x.value === v)!;
                  setPaper({ width: p.w, height: p.h });
                }}
                segments={PAPERS.map((p) => ({ value: p.value, label: p.label }))}
              />
              {doc.steps.length > 0 && <p className="text-xs text-ink-muted">Changing the paper can break steps drawn on the old shape.</p>}
            </div>
            <ColorRow label="Front (face up at the start)" value={front} onChange={(c) => setPaper({ front: c })} />
            <ColorRow label="Back" value={back} onChange={(c) => setPaper({ back: c })} />
          </div>
        )}

        <div className="flex gap-2 border-t border-line p-3">
          <Button icon={Download} size="sm" onClick={exportJson}>
            Download .json
          </Button>
          {published && publishedRecord ? (
            <Button size="sm" className="ml-auto" onClick={() => navigate(href.design(record.id))}>
              View page
            </Button>
          ) : (
            <Button variant="primary" size="sm" icon={Upload} className="ml-auto" onClick={publish}>
              Publish
            </Button>
          )}
        </div>
      </aside>

      {/* ---------------- canvas */}
      <main className="relative flex min-w-0 flex-1 flex-col bg-viewer">
        {/* tools */}
        <div className="absolute inset-x-4 top-4 z-10 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-lg border border-line bg-surface-raised p-0.5 shadow-float" role="toolbar" aria-label="Fold tools">
            <ToolButton active={tool === 'fold'} icon={FoldVertical} label="Fold" onClick={() => { setTool('fold'); setTargets({}); setNewSegs([]); }} />
            <ToolButton active={tool === 'reverseFold'} icon={ArrowDownUp} label="Reverse fold" onClick={() => { setTool('reverseFold'); setTargets({}); setNewSegs([]); }} />
            <ToolButton active={tool === 'collapse'} icon={Layers} label="Collapse" hint="Squash, petal and other moves along several creases" onClick={() => { setTool('collapse'); setPoints([]); setMoving(null); }} />
          </div>
          <div className="flex items-center gap-0.5 rounded-lg border border-line bg-surface-raised p-0.5 shadow-float" role="toolbar" aria-label="Moves">
            <IconButton label="Turn over (left to right)" icon={FlipHorizontal2} onClick={() => commit({ type: 'turnOver' })} />
            <IconButton label="Turn over (top to bottom)" icon={FlipVertical2} onClick={() => commit({ type: 'turnOver', axis: 'horizontal' })} />
            <IconButton label="Rotate 45° left" icon={RotateCcw} onClick={() => commit({ type: 'rotate', degrees: 45 })} />
            <IconButton label="Rotate 45° right" icon={RotateCw} onClick={() => commit({ type: 'rotate', degrees: -45 })} />
            <IconButton label="Unfold the last fold" icon={Undo2} onClick={() => commit({ type: 'unfold' })} disabled={cursor.index === 0} />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="rounded-md bg-surface-raised px-2.5 py-1.5 text-xs font-medium tabular-nums text-ink-muted shadow-float">
              {cursor.replace ? `Changing step ${cursor.index + 1}` : `New step ${cursor.index + 1}`}
            </span>
            <IconButton label={showPreview ? 'Hide 3D preview' : 'Show 3D preview'} icon={showPreview ? EyeOff : Eye} variant="secondary" onClick={() => setShowPreview((v) => !v)} />
          </div>
        </div>

        <p className="absolute inset-x-4 top-16 z-10 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning md:hidden">
          The editor needs a wider screen for its step list and 3D preview. You can still draw folds here.
        </p>

        {tool === 'collapse' && (
          <div className="absolute left-4 top-16 z-10 flex items-center gap-0.5 rounded-lg border border-line bg-surface-raised p-0.5 shadow-float" role="toolbar" aria-label="Collapse tools">
            <ToolButton active={collapseMode === 'pick'} icon={MousePointerClick} label="Set creases" onClick={() => setCollapseMode('pick')} />
            <ToolButton active={collapseMode === 'draw'} icon={PenLine} label="Draw a crease" onClick={() => setCollapseMode('draw')} />
            <ToolButton active={collapseMode === 'fixed'} icon={Pin} label="Face that stays" onClick={() => setCollapseMode('fixed')} />
          </div>
        )}

        <div className="min-h-0 flex-1 px-6 pb-56 pt-24">
          {tool === 'collapse' ? (
            <CollapseCanvas
              state={beforeState}
              targets={targets}
              newSegments={newSegs}
              fixed={fixed}
              mode={collapseMode}
              onToggleCrease={(k) =>
                setTargets((t) => {
                  const n = nextFold(t[k]);
                  const next = { ...t };
                  if (n) next[k] = n;
                  else delete next[k];
                  return next;
                })
              }
              onToggleNew={(i) =>
                setNewSegs((segs) => {
                  const n = nextFold(segs[i].fold);
                  return n ? segs.map((s, j) => (j === i ? { ...s, fold: n } : s)) : segs.filter((_, j) => j !== i);
                })
              }
              onAddSegment={(from, to) => setNewSegs((s) => [...s, { from, to, fold: 'valley' }])}
              onFixed={setFixed}
            />
          ) : (
            <FoldCanvas
              outline={outline}
              front={front}
              back={back}
              points={points}
              moving={moving}
              direction={tool === 'reverseFold' ? 'mountain' : direction}
              interactive
              onPoint={(p) => setPoints((ps) => (ps.length >= 2 ? [p] : [...ps, p]))}
              onMoving={setMoving}
            />
          )}
        </div>

        {before.error && cursor.index > before.error.step && (
          <Callout className="absolute left-4 top-28 z-10 max-w-sm" tone="danger" title={`Step ${before.error.step + 1} can’t be folded`}>
            {before.error.message} The model shows the steps before it.
          </Callout>
        )}

        {/* options and the step's words */}
        <div className="absolute inset-x-4 bottom-4 z-10 rounded-lg border border-line bg-surface-raised p-4 shadow-dialog">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <p className="flex min-w-0 flex-1 basis-64 items-center gap-2 text-sm text-ink-muted">
              <span className={cn('grid size-5 shrink-0 place-items-center rounded-full text-xs font-semibold', stage === 'ready' ? 'bg-success text-paper' : 'bg-accent text-on-accent')}>
                {stage === 'ready' ? <Check className="size-3" strokeWidth={3} /> : stage === 'first' ? 1 : stage === 'second' ? 2 : 3}
              </span>
              {instruction[stage]}
            </p>
            {tool === 'fold' && (
              <SegmentedControl<'valley' | 'mountain'>
                label="Fold direction"
                size="sm"
                value={direction}
                onChange={setDirection}
                segments={[
                  { value: 'valley', label: 'Valley (toward you)' },
                  { value: 'mountain', label: 'Mountain (behind)' },
                ]}
              />
            )}
            {tool === 'reverseFold' && (
              <SegmentedControl<'inside' | 'outside'>
                label="Reverse fold"
                size="sm"
                value={reverseMode}
                onChange={setReverseMode}
                segments={[
                  { value: 'inside', label: 'Inside' },
                  { value: 'outside', label: 'Outside' },
                ]}
              />
            )}
            {tool !== 'collapse' && (
              <div className="flex items-center gap-2">
                <SegmentedControl<'all' | 'top' | 'count'>
                  label="Layers"
                  size="sm"
                  value={layers}
                  onChange={setLayers}
                  segments={[
                    { value: 'all', label: 'All layers', title: 'Every layer under the point, and the paper attached to it' },
                    { value: 'top', label: 'Top layer' },
                    { value: 'count', label: 'Top…' },
                  ]}
                />
                {layers === 'count' && (
                  <InlineInput
                    aria-label="Number of layers"
                    type="number"
                    min={1}
                    max={64}
                    value={layerCount}
                    onChange={(e) => setLayerCount(Math.max(1, Math.min(64, parseInt(e.target.value, 10) || 1)))}
                    className="h-7 w-16"
                  />
                )}
              </div>
            )}
            {tool === 'fold' && (
              <div className="flex w-48 items-center gap-2">
                <span className="text-xs text-ink-muted">Angle</span>
                <MiniSlider label="Fold angle" value={angle} min={10} max={180} step={5} onChange={setAngle} />
                <span className="w-9 text-right text-xs tabular-nums text-ink">{angle}°</span>
              </div>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-line pt-3">
            <InlineInput
              aria-label="Instruction"
              value={caption}
              maxLength={200}
              onChange={(e) => setCaption(e.target.value)}
              placeholder={draftAction ? defaultCaption(draftAction) : 'Instruction, e.g. “Fold the bottom corner up to the top”'}
              className="min-w-0 flex-[2_1_16rem]"
            />
            <InlineInput aria-label="Hint" value={hint} maxLength={300} onChange={(e) => setHint(e.target.value)} placeholder="Hint (optional)" className="min-w-0 flex-[1_1_10rem]" />
            <div className="flex gap-2">
              {(points.length > 0 || Object.keys(targets).length > 0 || newSegs.length > 0 || cursor.replace) && (
                <Button size="md" icon={X} onClick={() => (cursor.replace ? moveCursor({ index: doc.steps.length, replace: false }) : resetDraft())}>
                  {cursor.replace ? 'Done' : 'Clear'}
                </Button>
              )}
              <Button variant="primary" icon={cursor.replace ? Check : Plus} disabled={!draftAction || !!draftError} onClick={() => commit()}>
                {cursor.replace ? 'Update step' : 'Add step'}
              </Button>
            </div>
          </div>
          <AnimatePresence>
            {draftError && (
              <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} role="alert" className="mt-2 text-sm text-danger">
                This can’t be folded: {draftError}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* ---------------- 3D preview */}
      <AnimatePresence initial={false}>
        {showPreview && (
          <motion.aside
            key="preview"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 352, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
            className="hidden shrink-0 overflow-hidden border-l border-line bg-surface lg:block"
          >
            <div className="flex h-full w-[22rem] flex-col p-4">
              <h2 className="text-sm font-semibold text-ink">3D preview</h2>
              <p className="mt-0.5 text-xs text-ink-muted">
                {preview && !draftError ? `With the step you’re drawing (${actionLabel(draftAction!).toLowerCase()})` : doc.steps.length ? 'The steps so far' : 'Add a step to see it fold'}
              </p>
              <StepPlayer
                key={`${cursor.index}-${cursor.replace}`}
                compiled={preview && !draftError ? preview : full}
                upTo={preview && !draftError ? cursor.index + 1 : cursor.replace ? cursor.index + 1 : cursor.index}
                startAtEnd
                className="mt-3 flex min-h-0 flex-1 flex-col"
              />
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
};

const round = (x: number) => Math.round(x * 1e9) / 1e9;

const InsertMarker: React.FC = () => (
  <motion.span layoutId="editor-current" aria-hidden="true" className="pointer-events-none absolute -top-px left-2 right-2 z-10 h-0.5 rounded-full bg-accent" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />
);

const ToolButton: React.FC<{ active: boolean; icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; label: string; hint?: string; onClick: () => void }> = ({
  active,
  icon: Icon,
  label,
  hint,
  onClick,
}) => (
  <Tooltip content={hint ?? label}>
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'relative inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60',
        active ? 'bg-ink text-paper' : 'text-ink-muted hover:bg-sunken hover:text-ink',
      )}
    >
      <Icon className="size-4" strokeWidth={1.75} />
      {label}
    </button>
  </Tooltip>
);

const ColorRow: React.FC<{ label: string; value: string; onChange: (c: string) => void }> = ({ label, value, onChange }) => (
  <fieldset>
    <legend className="text-sm font-medium text-ink">{label}</legend>
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Colour ${c}`}
          aria-pressed={c.toLowerCase() === value.toLowerCase()}
          onClick={() => onChange(c)}
          className={cn(
            'size-6 rounded-sm border border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60',
            c.toLowerCase() === value.toLowerCase() && 'ring-2 ring-ink ring-offset-2 ring-offset-surface',
          )}
          style={{ backgroundColor: c }}
        />
      ))}
      <label className="relative size-6 cursor-pointer overflow-hidden rounded-sm border border-dashed border-ink-faint" title="Another colour">
        <span className="sr-only">Another colour</span>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 size-full cursor-pointer opacity-0" />
        <Plus className="absolute inset-0 m-auto size-3 text-ink-muted" strokeWidth={2} />
      </label>
    </div>
  </fieldset>
);
