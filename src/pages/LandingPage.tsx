import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { compileDesign, DesignAnimator } from '../engine/design';
import { DesignViewer3D } from '../components/prototype/DesignViewer3D';
import { TopBar } from '../components/shell/TopBar';
import { Wordmark } from '../components/shell/Wordmark';
import { ButtonLink } from '../components/ui/Button';
import { CreaseThumbnail } from '../components/ui/Thumbnails';
import { cn } from '../components/ui/cn';
import { PATTERNS, STEP_DESIGNS } from '../designs';
import { usePrefersReducedMotion } from '../hooks';
import { ROUTE_HASH, usePageTitle } from '../router';
import { theme } from '../theme';

const HERO_DESIGN = STEP_DESIGNS[0]; // the paper cup: quick to fold, easy to read
/** Steps per second in the hero loop, and how long to hold the finished model. */
const HERO_RATE = 0.55;
const HERO_HOLD_S = 2.4;

/** The paper cup folding on a loop. Pauses while off-screen; shows the finished cup with reduced motion. */
const HeroModel: React.FC = () => {
  const reduced = usePrefersReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const compiled = useMemo(() => {
    try {
      return compileDesign(HERO_DESIGN.json);
    } catch {
      return null;
    }
  }, []);
  const animator = useMemo(() => (compiled ? new DesignAnimator(compiled) : null), [compiled]);
  const steps = animator?.stepCount ?? 0;
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.1 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!steps) return;
    if (reduced) {
      setProgress(steps);
      return;
    }
    if (!visible) return;
    let id = 0;
    let last: number | null = null;
    let hold = 0;
    const tick = (t: number) => {
      const dt = last === null ? 0 : Math.min(0.1, (t - last) / 1000);
      last = t;
      setProgress((p) => {
        if (p >= steps) {
          hold += dt;
          if (hold >= HERO_HOLD_S) {
            hold = 0;
            return 0;
          }
          return steps;
        }
        return Math.min(steps, p + dt * HERO_RATE);
      });
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [steps, reduced, visible]);

  const loc = animator ? animator.locate(progress) : { stepIndex: 0 };
  const done = steps > 0 && progress >= steps;
  const step = compiled && !done ? compiled.steps[loc.stepIndex] : null;

  return (
    <figure ref={box} className="relative overflow-hidden rounded-lg border border-line bg-viewer">
      <div className="aspect-[4/3] w-full">
        {animator && (
          <DesignViewer3D
            animator={animator}
            progress={progress}
            front={HERO_DESIGN.front}
            back={HERO_DESIGN.back}
            showCreases
            resetKey={0}
            controls="rotate"
          />
        )}
      </div>
      <span className="pointer-events-none absolute right-4 top-4 text-xs text-ink-muted">Drag to turn it</span>
      <figcaption className="absolute inset-x-4 bottom-4 rounded-md border border-line bg-surface-raised px-4 py-3 shadow-float">
        <div className="text-xs font-medium tabular-nums text-ink-muted">
          {HERO_DESIGN.title} · {done ? 'finished' : `step ${loc.stepIndex + 1} of ${steps}`}
        </div>
        <div className="mt-0.5 truncate text-sm font-medium text-ink">{done ? 'A cup that really holds water' : step?.caption}</div>
      </figcaption>
    </figure>
  );
};

/** What the Learn sidebar looks like: numbered steps with the current one marked. */
const StepPreview: React.FC = () => {
  const steps = (HERO_DESIGN.json as { steps: { caption: string }[] }).steps.slice(0, 4);
  return (
    <ol className="space-y-0.5 rounded-md border border-line bg-surface-raised p-2" aria-label={`First steps of the ${HERO_DESIGN.title}`}>
      {steps.map((s, i) => (
        <li
          key={i}
          className={cn(
            'relative flex items-start gap-3 rounded-md py-2 pl-3 pr-2 text-sm',
            i === 1 ? 'bg-accent-soft text-ink' : i < 1 ? 'text-ink-muted' : 'text-ink',
          )}
        >
          {i === 1 && <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent" />}
          <span className="w-4 shrink-0 text-right text-xs leading-5 tabular-nums text-ink-faint">{i + 1}</span>
          <span className="leading-5">{s.caption}</span>
        </li>
      ))}
    </ol>
  );
};

const PRINCIPLES = [
  {
    title: 'Exact, not simulated',
    body: 'The engine works out where every face of the paper ends up. Simulating many creases at once crumples complex models, so physics is used only for small moves and for grabbing the paper.',
  },
  {
    title: 'Layers in the right order',
    body: 'A layer-order solver decides which flap lies on top of which, so the folded model is one you could make with real paper.',
  },
  {
    title: 'Standard files',
    body: 'Crease pattern mode opens FOLD files, the format most origami software shares, including folded forms given in 3D.',
  },
];

export const LandingPage: React.FC = () => {
  usePageTitle(null);
  const boxPleat = useMemo(() => PATTERNS.find((p) => p.id === 'box-pleat'), []);
  const boxPleatFold = useMemo(() => boxPleat?.create() ?? null, [boxPleat]);

  return (
    <div className="min-h-dvh bg-canvas">
      <TopBar route="home" className="sticky top-0 z-40" />

      <main>
        {/* hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-16 lg:pt-24">
          <div>
            <p className="text-sm font-medium text-ink-muted">Origami in the browser</p>
            <h1 className="mt-4 font-display text-5xl leading-[1.05] tracking-tight text-ink lg:text-6xl">
              Watch the paper fold, one crease at a time.
            </h1>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-ink-muted">
              Follow a design step by step, the way a good diagram book teaches it. Or open any crease pattern and see it fold
              exactly, layer by layer, in 3D.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href={ROUTE_HASH.learn} variant="primary" size="lg" trailingIcon={ArrowRight}>
                Start with the paper cup
              </ButtonLink>
              <ButtonLink href={ROUTE_HASH.creasePattern} size="lg">
                Open a crease pattern
              </ButtonLink>
            </div>
          </div>
          <HeroModel />
        </section>

        {/* the two modes */}
        <section aria-labelledby="modes" className="border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 id="modes" className="font-display text-3xl tracking-tight text-ink">
              Two ways in
            </h2>
            <p className="mt-2 max-w-lg text-ink-muted">One for people learning their first folds, one for people who read crease patterns.</p>

            <div className="mt-10 grid gap-6 lg:grid-cols-2">
              <article className="flex flex-col rounded-lg border border-line bg-canvas p-8">
                <p className="text-sm text-ink-muted">For beginners</p>
                <h3 className="mt-1 font-display text-2xl text-ink">Learn, step by step</h3>
                <p className="mt-3 text-ink-muted">
                  Each design is a list of steps with plain instructions and hints. Play it through, pause on the fold you're stuck
                  on, and turn the model to see it from any side.
                </p>
                <div className="mt-6 flex-1">
                  <StepPreview />
                </div>
                <a
                  href={ROUTE_HASH.learn}
                  className="mt-6 inline-flex items-center gap-1.5 self-start rounded-sm text-sm font-medium text-ink hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  Open Learn <ArrowRight className="size-4" strokeWidth={1.75} />
                </a>
              </article>

              <article className="flex flex-col rounded-lg border border-line bg-canvas p-8">
                <p className="text-sm text-ink-muted">For experienced folders</p>
                <h3 className="mt-1 font-display text-2xl text-ink">Fold any crease pattern</h3>
                <p className="mt-3 text-ink-muted">
                  Open a .fold file, from a simple base to a box-pleated design, and fold it from flat to finished. Grab the paper to
                  loosen the layers, or pin a point and make new creases yourself.
                </p>
                <div className="mt-6 flex flex-1 flex-col items-start gap-5 rounded-md border border-line bg-surface-raised p-4 sm:flex-row sm:items-center">
                  <CreaseThumbnail fold={boxPleatFold} className="size-36 shrink-0" weight={0.75} title="Box-pleated crease pattern" />
                  <p className="text-sm text-ink-muted">
                    <span className="block font-medium text-ink">{boxPleat?.title}</span>
                    {boxPleat?.meta}, folded exactly with the layers stacked in order.
                  </p>
                </div>
                <a
                  href={ROUTE_HASH.creasePattern}
                  className="mt-6 inline-flex items-center gap-1.5 self-start rounded-sm text-sm font-medium text-ink hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  Open Crease pattern <ArrowRight className="size-4" strokeWidth={1.75} />
                </a>
              </article>
            </div>
          </div>
        </section>

        {/* how it works */}
        <section aria-labelledby="how" className="mx-auto max-w-6xl px-6 py-20">
          <h2 id="how" className="font-display text-3xl tracking-tight text-ink">
            How it works
          </h2>
          <svg className="mt-6 h-1 w-full" aria-hidden="true" preserveAspectRatio="none">
            {/* a valley fold line: the site's one ornament */}
            <line x1="0" y1="2" x2="100%" y2="2" stroke={theme.valley} strokeOpacity="0.45" strokeWidth="1.5" strokeDasharray="6 4" />
          </svg>
          <ol className="mt-10 grid gap-10 md:grid-cols-3">
            {PRINCIPLES.map((p, i) => (
              <li key={p.title}>
                <span className="font-mono text-sm text-ink-faint">{String(i + 1).padStart(2, '0')}</span>
                <h3 className="mt-2 text-base font-semibold text-ink">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{p.body}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8 text-sm text-ink-muted md:flex-row md:items-center md:justify-between">
          <Wordmark />
          <p>The paper cup and crane are traditional designs. Box with wing by Jason Ku.</p>
          <nav aria-label="Footer" className="flex gap-5">
            <a href={ROUTE_HASH.learn} className="hover:text-ink">
              Learn
            </a>
            <a href={ROUTE_HASH.creasePattern} className="hover:text-ink">
              Crease pattern
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
};
