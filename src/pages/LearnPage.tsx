import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Eye, EyeOff, FileUp, Pause, Play, RotateCcw, LocateFixed } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { compileDesign, DesignAnimator, DesignError, type CompiledDesign } from '../engine/design';
import { DesignViewer3D } from '../components/prototype/DesignViewer3D';
import { TopBar } from '../components/shell/TopBar';
import { Button, IconButton } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { Picker, type PickerItem } from '../components/ui/Picker';
import { Scrubber } from '../components/ui/Scrubber';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { ShortcutsButton, isTypingTarget } from '../components/ui/ShortcutsButton';
import { PaperSwatch } from '../components/ui/Thumbnails';
import { useToast } from '../components/ui/Toast';
import { cn } from '../components/ui/cn';
import { STEP_DESIGNS, difficultyLabel } from '../designs';
import { usePrefersReducedMotion } from '../hooks';
import { usePageTitle } from '../router';
import { theme } from '../theme';

interface Loaded {
  compiled: CompiledDesign | null;
  animator: DesignAnimator | null;
  /** The file itself is invalid. */
  fileError: string | null;
  /** Bundled design id, or the uploaded file name. */
  source: string;
}

function load(json: unknown, source: string): Loaded {
  try {
    const compiled = compileDesign(json);
    return { compiled, animator: new DesignAnimator(compiled), fileError: null, source };
  } catch (e) {
    const msg = e instanceof DesignError ? e.message : (e as Error).message;
    return { compiled: null, animator: null, fileError: msg, source };
  }
}

/** The current step's highlight. One shared layoutId, so it slides from step to step. */
const CurrentStepMark: React.FC = () => (
  <motion.span
    layoutId="learn-current-step"
    aria-hidden="true"
    className="absolute inset-0 rounded-md bg-accent-soft"
    transition={{ type: 'spring', stiffness: 420, damping: 36 }}
  >
    <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-sm bg-accent" />
  </motion.span>
);

type Speed = '0.5' | '1' | '2';
/** Steps per second at 1×: one fold takes about 1.6 s. */
const STEP_RATE = 0.62;

const PICKER_ITEMS: PickerItem[] = STEP_DESIGNS.map((d) => ({
  id: d.id,
  title: d.title,
  meta: `${difficultyLabel(d.difficulty)} · ${d.stepCount} steps`,
  thumbnail: <PaperSwatch front={d.front} back={d.back} className="size-full" />,
}));

const SHORTCUTS = [
  { keys: ['Space'], label: 'Play or pause' },
  { keys: ['←', '→'], label: 'Previous or next step' },
  { keys: ['Home'], label: 'Back to the flat sheet' },
  { keys: ['End'], label: 'Finished model' },
  { keys: ['C'], label: 'Show or hide creases' },
];

export const LearnPage: React.FC = () => {
  const toast = useToast();
  const reducedMotion = usePrefersReducedMotion();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [folding, setFolding] = useState(true);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>('1');
  const [showCreases, setShowCreases] = useState(true);
  const [resetKey, setResetKey] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const compiled = loaded?.compiled ?? null;
  const animator = loaded?.animator ?? null;
  const design = compiled?.design;
  const stepCount = animator?.stepCount ?? 0;

  usePageTitle(design?.meta.title ?? 'Learn');

  /** Compile off the current frame so the "Folding…" state can paint first. */
  const choose = useCallback((json: unknown, source: string) => {
    setFolding(true);
    setPlaying(false);
    window.setTimeout(() => {
      const l = load(json, source);
      setLoaded(l);
      setProgress(0);
      setResetKey((k) => k + 1);
      setFolding(false);
    }, 16);
  }, []);

  useEffect(() => {
    choose(STEP_DESIGNS[0].json, STEP_DESIGNS[0].id);
  }, [choose]);

  // Playback. With reduced motion, jump a whole step at a time instead of easing through it.
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!playing) {
      last.current = null;
      return;
    }
    const rate = STEP_RATE * parseFloat(speed);
    if (reducedMotion) {
      const id = window.setInterval(() => {
        setProgress((p) => {
          const next = Math.floor(p) + 1;
          if (next >= stepCount) {
            setPlaying(false);
            return stepCount;
          }
          return next;
        });
      }, 1000 / rate);
      return () => window.clearInterval(id);
    }
    let id = 0;
    const tick = (t: number) => {
      if (last.current !== null) {
        const dt = (t - last.current) / 1000;
        setProgress((p) => {
          const next = p + dt * rate;
          if (next >= stepCount) {
            setPlaying(false);
            return stepCount;
          }
          return next;
        });
      }
      last.current = t;
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, speed, stepCount, reducedMotion]);

  const loc = animator ? animator.locate(progress) : { stepIndex: 0, t: 0 };
  const current = compiled && loc.stepIndex < compiled.steps.length ? compiled.steps[loc.stepIndex] : null;
  const atEnd = stepCount > 0 && progress >= stepCount;
  const atStart = progress <= 0;

  // keep the current step visible in the list as playback moves on
  const stepList = useRef<HTMLOListElement>(null);
  const activeKey = atEnd ? 'end' : String(loc.stepIndex);
  useEffect(() => {
    stepList.current?.querySelector('[aria-current="step"]')?.scrollIntoView({ block: 'nearest' });
  }, [activeKey]);

  const goStep = useCallback(
    (i: number) => {
      setPlaying(false);
      setProgress(Math.max(0, Math.min(stepCount, i)));
    },
    [stepCount],
  );

  const togglePlay = useCallback(() => {
    if (stepCount === 0) return;
    if (!playing && progress >= stepCount) setProgress(0);
    setPlaying((p) => !p);
  }, [playing, progress, stepCount]);

  const prev = useCallback(() => goStep(Math.ceil(progress) - 1), [goStep, progress]);
  const next = useCallback(() => goStep(Math.floor(progress) + 1), [goStep, progress]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (e.key === ' ') {
        // let a focused button handle its own Space press
        if ((e.target as HTMLElement)?.tagName === 'BUTTON') return;
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prev();
      } else if (e.key === 'Home') {
        goStep(0);
      } else if (e.key === 'End') {
        goStep(stepCount);
      } else if (e.key === 'c' || e.key === 'C') {
        setShowCreases((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, next, prev, goStep, stepCount]);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const text = await f.text();
      choose(JSON.parse(text), f.name);
    } catch (err) {
      toast.show({ tone: 'error', title: `Couldn't read ${f.name}`, detail: 'The file isn’t valid JSON. Learn mode opens .json step designs.' });
      console.error(err);
    }
  };

  const bundled = loaded && STEP_DESIGNS.some((d) => d.id === loaded.source);
  const front = design?.paper.front ?? theme.paperBack;
  const back = design?.paper.back ?? theme.paperFront;
  const stepLabel = atEnd ? 'Finished' : stepCount ? `Step ${loc.stepIndex + 1} of ${stepCount}` : '';
  const failedStep = compiled?.error ? compiled.error.step : null;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas">
      <TopBar route="learn">
        <Picker
          className="w-40 sm:w-64"
          label="Design"
          items={PICKER_ITEMS}
          value={bundled ? loaded!.source : null}
          fallbackTitle={loaded?.source}
          onChange={(id) => {
            const d = STEP_DESIGNS.find((x) => x.id === id);
            if (d) choose(d.json, d.id);
          }}
          footer={
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-muted hover:bg-sunken hover:text-ink"
            >
              <FileUp className="size-4" strokeWidth={1.75} /> Open a .json design…
            </button>
          }
        />
        <div className="hidden lg:block">
          <Button icon={FileUp} onClick={() => fileInput.current?.click()}>
            Open file
          </Button>
        </div>
        <input ref={fileInput} type="file" accept=".json,application/json" className="hidden" onChange={onFile} />
        <div className="hidden sm:block">
          <ShortcutsButton shortcuts={SHORTCUTS} />
        </div>
      </TopBar>

      <div className="flex min-h-0 flex-1">
        {/* sidebar: the design and its steps */}
        <aside className="hidden w-72 shrink-0 flex-col border-r border-line bg-surface md:flex">
          <div className="border-b border-line px-5 pb-5 pt-6">
            {design ? (
              <>
                <motion.h1
                  key={design.meta.title}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
                  className="font-display text-3xl font-semibold leading-tight tracking-tight text-ink"
                >
                  {design.meta.title}
                </motion.h1>
                <p className="mt-1.5 text-xs text-ink-muted">
                  {[design.meta.author, difficultyLabel(design.meta.difficulty), `${design.steps.length} steps`]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {design.meta.description && (
                  <p className="mt-3 text-sm leading-relaxed text-ink-muted">{design.meta.description}</p>
                )}
              </>
            ) : (
              <div className="h-16" />
            )}
          </div>

          {loaded?.fileError && (
            <Callout className="mx-4 mt-4" tone="danger" title="This design can’t be opened">
              {loaded.fileError}
            </Callout>
          )}
          {compiled?.error && (
            <Callout className="mx-4 mt-4" title={`Step ${compiled.error.step + 1} can’t be folded`}>
              {compiled.error.message} The steps before it still play.
            </Callout>
          )}

          {compiled && compiled.steps.length > 0 && (
            <>
              <h2 className="px-5 pb-2 pt-5 text-sm font-semibold text-ink">Steps</h2>
              <ol ref={stepList} className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
                {compiled.steps.map((s, i) => {
                  const active = i === loc.stepIndex && !atEnd;
                  const done = i < loc.stepIndex || atEnd;
                  return (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => goStep(i)}
                        aria-current={active ? 'step' : undefined}
                        className={cn(
                          'relative flex w-full items-start gap-3 rounded-md py-2 pl-3 pr-2 text-left text-sm',
                          'transition-colors duration-150 ease-out',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus/60',
                          active ? 'text-ink' : done ? 'text-ink-muted hover:bg-sunken' : 'text-ink hover:bg-sunken',
                        )}
                      >
                        {active && <CurrentStepMark />}
                        <span className="relative flex h-5 w-5 shrink-0 items-center justify-center text-xs tabular-nums text-ink-faint">
                          {done ? (
                            <motion.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 24 }}>
                              <Check className="size-3.5 text-ink-muted" strokeWidth={2.25} />
                            </motion.span>
                          ) : (
                            i + 1
                          )}
                        </span>
                        <span className="relative leading-5">{s.caption}</span>
                      </button>
                    </li>
                  );
                })}
                {failedStep !== null && design && (
                  <li className="flex items-start gap-3 py-2 pl-3 pr-2 text-sm text-ink-faint">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center text-xs tabular-nums">{failedStep + 1}</span>
                    <span className="leading-5">{design.steps[failedStep].caption}</span>
                  </li>
                )}
                <li>
                  <button
                    type="button"
                    onClick={() => goStep(stepCount)}
                    aria-current={atEnd ? 'step' : undefined}
                    className={cn(
                      'relative mt-1 flex w-full items-center gap-3 rounded-md py-2 pl-3 pr-2 text-left text-sm font-medium',
                      'transition-colors duration-150 ease-out',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus/60',
                      atEnd ? 'text-ink' : 'text-ink-muted hover:bg-sunken hover:text-ink',
                    )}
                  >
                    {atEnd && <CurrentStepMark />}
                    <span className="w-5 shrink-0" />
                    <span className="relative">Finished model</span>
                  </button>
                </li>
              </ol>
            </>
          )}
        </aside>

        {/* viewer */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1 bg-viewer">
            {folding && (
              <div className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden" role="progressbar" aria-label="Folding">
                <div className="h-full w-2/5 animate-progress bg-accent" />
              </div>
            )}
            {animator ? (
              <DesignViewer3D
                animator={animator}
                progress={progress}
                front={front}
                back={back}
                showCreases={showCreases}
                resetKey={resetKey}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-ink-muted">
                {folding ? 'Folding…' : 'Choose a design to start.'}
              </div>
            )}

            <div className="absolute right-4 top-4 flex items-center gap-0.5 rounded-lg border border-line bg-surface-raised p-0.5 shadow-float">
              <IconButton
                label={showCreases ? 'Hide creases' : 'Show creases'}
                shortcut="C"
                icon={showCreases ? Eye : EyeOff}
                active={showCreases}
                onClick={() => setShowCreases((v) => !v)}
              />
              <IconButton label="Reset view" icon={LocateFixed} onClick={() => setResetKey((k) => k + 1)} />
            </div>

            {/* the instruction */}
            {animator && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4">
                <motion.div
                  layout
                  aria-live="polite"
                  transition={{ layout: { duration: 0.25, ease: [0.2, 0.8, 0.2, 1] } }}
                  className="relative w-full max-w-xl overflow-hidden rounded-lg border border-line bg-surface-raised px-5 py-3.5 shadow-float"
                >
                  {/* progress through the current step, along the card's top edge */}
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 top-0 h-[3px] origin-left bg-accent"
                    style={{ transform: `scaleX(${atEnd ? 1 : loc.t})` }}
                  />
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={atEnd ? 'end' : loc.stepIndex}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
                    >
                      <div className="text-xs font-medium tabular-nums text-ink-muted">{stepLabel}</div>
                      <div className="mt-0.5 font-display text-xl font-semibold leading-snug tracking-tight text-ink">
                        {atEnd ? design?.meta.title : current?.caption ?? 'Start with a flat sheet'}
                      </div>
                      {!atEnd && current?.hint && <div className="mt-1 text-sm text-ink-muted">{current.hint}</div>}
                    </motion.div>
                  </AnimatePresence>
                </motion.div>
              </div>
            )}
          </div>

          {/* transport */}
          <div className="flex h-14 shrink-0 items-center justify-center border-t border-line bg-surface px-4">
            <div className="flex w-full max-w-3xl items-center gap-3">
              <div className="flex items-center gap-1">
                <IconButton label="Previous step" shortcut="←" icon={ChevronLeft} tooltipSide="top" onClick={prev} disabled={atStart || !stepCount} />
                <IconButton
                  label={playing ? 'Pause' : atEnd ? 'Play again' : 'Play'}
                  shortcut="Space"
                  icon={playing ? Pause : atEnd ? RotateCcw : Play}
                  variant="primary"
                  tooltipSide="top"
                  onClick={togglePlay}
                  disabled={!stepCount}
                />
                <IconButton label="Next step" shortcut="→" icon={ChevronRight} tooltipSide="top" onClick={next} disabled={atEnd || !stepCount} />
              </div>
              <span className="w-12 shrink-0 text-right text-xs tabular-nums text-ink-muted">
                {stepCount ? `${atEnd ? stepCount : loc.stepIndex + 1}/${stepCount}` : '–'}
              </span>
              <Scrubber
                label="Fold progress"
                valueText={stepLabel}
                value={progress}
                max={Math.max(stepCount, 0.0001)}
                ticks={Array.from({ length: Math.max(0, stepCount - 1) }, (_, i) => i + 1)}
                disabled={!stepCount}
                onChange={(v) => {
                  setPlaying(false);
                  setProgress(v);
                }}
              />
              <SegmentedControl<Speed>
                label="Playback speed"
                size="sm"
                value={speed}
                onChange={setSpeed}
                segments={[
                  { value: '0.5', label: '0.5×' },
                  { value: '1', label: '1×' },
                  { value: '2', label: '2×' },
                ]}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};
