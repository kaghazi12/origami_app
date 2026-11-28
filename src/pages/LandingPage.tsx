import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { compileDesign, DesignAnimator } from '../engine/design';
import type { FoldFormat } from '../engine/types';
import { DesignViewer3D } from '../components/prototype/DesignViewer3D';
import { TopBar } from '../components/shell/TopBar';
import { Wordmark } from '../components/shell/Wordmark';
import { ButtonLink } from '../components/ui/Button';
import { FoldInText, Reveal } from '../components/ui/Motion';
import { CreaseThumbnail } from '../components/ui/Thumbnails';
import { cn } from '../components/ui/cn';
import { PATTERNS, STEP_DESIGNS, patternById } from '../designs';
import { usePrefersReducedMotion } from '../hooks';
import { ROUTE_HASH, usePageTitle } from '../router';
import { useDb } from '../store';
import { DesignCard } from '../components/community/DesignCard';
import { theme } from '../theme';

const HERO_DESIGN = STEP_DESIGNS[0]; // the paper cup: quick to fold, easy to read
/** Steps per second in the hero loop, and how long to hold the finished model. */
const HERO_RATE = 0.55;
const HERO_HOLD_S = 2.4;
const OUT_EASE = [0.2, 0.8, 0.2, 1] as const;

const patternHref = (id: string) => `${ROUTE_HASH.creasePattern}?pattern=${encodeURIComponent(id)}`;

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
  const caption = done ? 'A cup that really holds water' : step?.caption ?? '';

  return (
    <motion.div
      className="relative"
      initial={{ opacity: 0, y: 32 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: 0.35, ease: OUT_EASE }}
    >
      {/* a second sheet of kami behind the viewer, tilted as if just put down */}
      <motion.div
        aria-hidden="true"
        className="absolute inset-0 rounded-lg bg-accent"
        initial={{ rotate: 0 }}
        animate={{ rotate: 3.5 }}
        transition={{ duration: 1.1, delay: 0.7, ease: [0.65, 0, 0.35, 1] }}
      />
      <figure ref={box} className="relative overflow-hidden rounded-lg bg-viewer">
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
        <figcaption className="absolute inset-x-4 bottom-4 flex items-center gap-4 rounded-md bg-surface-raised px-4 py-3 shadow-float">
          {/* step progress as a ring of creases */}
          <span className="relative grid size-9 shrink-0 place-items-center">
            <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden="true">
              <circle cx="18" cy="18" r="15" fill="none" stroke={theme.line} strokeWidth="3" />
              <circle
                cx="18"
                cy="18"
                r="15"
                fill="none"
                stroke={theme.accent}
                strokeWidth="3"
                pathLength={1}
                strokeDasharray="1"
                strokeDashoffset={steps ? 1 - Math.min(1, progress / steps) : 1}
              />
            </svg>
            <span className="text-xs font-semibold tabular-nums text-ink">{done ? steps : loc.stepIndex + 1}</span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-medium tabular-nums text-ink-muted">
              {HERO_DESIGN.title} · {done ? 'finished' : `step ${loc.stepIndex + 1} of ${steps}`}
            </span>
            {/* the caption slides up when the step changes */}
            <span className="relative block h-5 overflow-hidden">
              <motion.span
                key={caption}
                className="absolute inset-0 truncate text-sm font-medium text-ink"
                initial={{ y: '100%', opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.35, ease: OUT_EASE }}
              >
                {caption}
              </motion.span>
            </span>
          </span>
        </figcaption>
      </figure>
    </motion.div>
  );
};

/** The bird base's creases, drawn large and faint behind the hero, stroking themselves in. */
const HeroCreases: React.FC = () => {
  const lines = useMemo(() => {
    const f = patternById('bird-base')?.create() as FoldFormat | undefined;
    if (!f) return [];
    const vs = f.vertices_coords;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const v of vs) {
      x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[0]);
      y0 = Math.min(y0, v[1]); y1 = Math.max(y1, v[1]);
    }
    const s = Math.max(x1 - x0, y1 - y0) || 1;
    return f.edges_vertices
      .map(([a, b], i) => ({
        a: [(vs[a][0] - x0) / s, (y1 - vs[a][1]) / s],
        b: [(vs[b][0] - x0) / s, (y1 - vs[b][1]) / s],
        kind: f.edges_assignment[i],
      }))
      .filter((l) => l.kind === 'M' || l.kind === 'V' || l.kind === 'B');
  }, []);

  return (
    <svg
      viewBox="-0.02 -0.02 1.04 1.04"
      aria-hidden="true"
      className="pointer-events-none absolute -right-48 -top-40 hidden size-[56rem] rotate-12 lg:block"
    >
      {lines.map((l, i) => (
        <path
          key={i}
          d={`M${l.a[0]} ${l.a[1]}L${l.b[0]} ${l.b[1]}`}
          pathLength={1}
          strokeDasharray="1"
          className="animate-draw"
          style={{ animationDelay: `${0.2 + (i % 12) * 0.08}s` }}
          stroke={l.kind === 'V' ? theme.accent : theme.paper}
          strokeOpacity={l.kind === 'V' ? 0.35 : 0.14}
          strokeWidth={l.kind === 'B' ? 2 : 1.25}
          vectorEffect="non-scaling-stroke"
          fill="none"
        />
      ))}
    </svg>
  );
};

/** Every bundled crease pattern, drifting past. Hover pauses it; each opens in Crease pattern mode. */
const PatternStrip: React.FC = () => {
  const reduced = usePrefersReducedMotion();
  const tiles = useMemo(
    () =>
      PATTERNS.filter((p) => p.group !== 'Start from').map((p) => {
        let fold: FoldFormat | null = null;
        try {
          fold = p.create();
        } catch {
          /* unreadable test file: drawn blank */
        }
        return { id: p.id, title: p.title, meta: p.meta, fold };
      }),
    [],
  );
  const row = (copy: number) =>
    tiles.map((t) => (
      <li key={`${copy}-${t.id}`} aria-hidden={copy > 0 || undefined}>
        <a
          href={patternHref(t.id)}
          tabIndex={copy > 0 ? -1 : undefined}
          className={cn(
            'group/tile flex w-56 items-center gap-3 rounded-lg border border-line bg-surface-raised p-3',
            'transition-[border-color,transform,box-shadow] duration-200 ease-out',
            'hover:-translate-y-1 hover:border-line-strong hover:shadow-float',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60',
          )}
        >
          <CreaseThumbnail fold={t.fold} className="size-16 shrink-0 rounded-sm" weight={0.75} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-ink">{t.title}</span>
            <span className="block truncate text-xs text-ink-muted">{t.meta}</span>
            <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent-ink opacity-0 transition-opacity duration-150 group-hover/tile:opacity-100 group-focus-visible/tile:opacity-100">
              Fold it <ArrowUpRight className="size-3" strokeWidth={2} />
            </span>
          </span>
        </a>
      </li>
    ));

  return (
    <section aria-labelledby="patterns" className="border-b border-line bg-canvas py-10">
      <div className="mx-auto mb-5 flex max-w-6xl items-baseline justify-between gap-4 px-6">
        <h2 id="patterns" className="text-sm font-semibold text-ink">
          Crease patterns you can open right now
        </h2>
        <a href={ROUTE_HASH.creasePattern} className="crease-link hidden text-sm font-medium text-ink-muted hover:text-ink sm:inline">
          Or bring your own .fold file
        </a>
      </div>
      {reduced ? (
        <ul className="flex gap-3 overflow-x-auto px-6 pb-2">{row(0)}</ul>
      ) : (
        <div className="group/strip relative overflow-hidden py-2">
          <ul className="flex w-max gap-3 pl-3 animate-marquee group-hover/strip:[animation-play-state:paused] group-focus-within/strip:[animation-play-state:paused]">
            {row(0)}
            {row(1)}
          </ul>
        </div>
      )}
    </section>
  );
};

/** What the Learn sidebar looks like: numbered steps, the current one marked; it steps along on its own. */
const StepPreview: React.FC = () => {
  const reduced = usePrefersReducedMotion();
  const steps = (HERO_DESIGN.json as { steps: { caption: string }[] }).steps.slice(0, 4);
  const [current, setCurrent] = useState(1);
  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => setCurrent((c) => (c + 1) % steps.length), 1800);
    return () => window.clearInterval(id);
  }, [reduced, steps.length]);
  return (
    <ol className="space-y-0.5 rounded-md border border-line bg-surface-raised p-2" aria-label={`First steps of the ${HERO_DESIGN.title}`}>
      {steps.map((s, i) => (
        <li
          key={i}
          className={cn(
            'relative flex items-start gap-3 rounded-md py-2 pl-3 pr-2 text-sm transition-colors duration-300',
            i < current ? 'text-ink-muted' : 'text-ink',
          )}
        >
          {i === current && (
            <motion.span
              layoutId="step-preview-current"
              aria-hidden="true"
              className="absolute inset-0 rounded-md bg-accent-soft"
              transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            >
              <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-sm bg-accent" />
            </motion.span>
          )}
          <span className="relative w-4 shrink-0 text-right text-xs leading-5 tabular-nums text-ink-faint">{i + 1}</span>
          <span className="relative leading-5">{s.caption}</span>
        </li>
      ))}
    </ol>
  );
};

/** The newest designs people shared, and the way into Explore and Create. */
const CommunityStrip: React.FC = () => {
  const latest = useDb((d) => d.designs({ sort: 'new' }).slice(0, 4));
  if (!latest.length) return null;
  return (
    <section aria-labelledby="community" className="border-t border-line bg-canvas">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <Reveal className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 id="community" className="font-display text-4xl font-semibold tracking-tight text-ink">
              Shared by folders
            </h2>
            <p className="mt-3 max-w-lg text-lg text-ink-muted">Make a design fold by fold in the editor, share it, and remix what others made.</p>
          </div>
          <div className="flex gap-2">
            <ButtonLink href={ROUTE_HASH.explore}>Explore all</ButtonLink>
            <ButtonLink href={ROUTE_HASH.create} variant="primary" trailingIcon={ArrowRight}>
              Make a design
            </ButtonLink>
          </div>
        </Reveal>
        <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {latest.map((d, i) => (
            <Reveal as="li" key={d.id} delay={0.05 * i}>
              <DesignCard design={d} />
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
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

const ModeCard: React.FC<{
  eyebrow: string;
  title: string;
  body: string;
  href: string;
  cta: string;
  children: React.ReactNode;
  delay?: number;
}> = ({ eyebrow, title, body, href, cta, children, delay }) => (
  <Reveal as="article" delay={delay} className="h-full">
    <div
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-lg border border-line bg-surface-raised p-8',
        'transition-[border-color,box-shadow,translate] duration-300 ease-out hover:-translate-y-1 hover:border-line-strong hover:shadow-float',
      )}
    >
      <span className="dog-ear" aria-hidden="true" />
      <p className="text-sm font-medium text-accent-ink">{eyebrow}</p>
      <h3 className="mt-1 font-display text-3xl font-semibold tracking-tight text-ink">{title}</h3>
      <p className="mt-3 text-ink-muted">{body}</p>
      <div className="mt-6 flex-1">{children}</div>
      <a
        href={href}
        className="mt-6 inline-flex items-center gap-1.5 self-start rounded-sm text-sm font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60 after:absolute after:inset-0"
      >
        <span className="crease-link">{cta}</span>
        <ArrowRight className="size-4 transition-transform duration-200 ease-out group-hover:translate-x-1" strokeWidth={2} />
      </a>
    </div>
  </Reveal>
);

export const LandingPage: React.FC = () => {
  usePageTitle(null);
  const boxPleat = useMemo(() => PATTERNS.find((p) => p.id === 'box-pleat'), []);
  const boxPleatFold = useMemo(() => boxPleat?.create() ?? null, [boxPleat]);

  return (
    <div className="min-h-dvh bg-canvas">
      <TopBar route="home" className="sticky top-0 z-40" />

      <main>
        {/* hero: an indigo sheet, the model on a kami-yellow one */}
        <section className="relative overflow-hidden bg-ink text-paper">
          <HeroCreases />
          <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-6 pb-24 pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-16 lg:pb-28 lg:pt-24">
            <div>
              <motion.p
                className="inline-flex items-center gap-2 text-sm font-medium text-paper-muted"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, ease: OUT_EASE }}
              >
                <span aria-hidden="true" className="size-2 rotate-45 bg-accent" />
                Origami in the browser
              </motion.p>
              <h1 className="mt-5 text-balance font-display text-5xl font-semibold leading-[1.02] tracking-tight lg:text-6xl xl:text-7xl">
                <FoldInText text="Watch the paper fold, one crease at a time." accent="fold" delay={0.1} />
              </h1>
              <motion.p
                className="mt-7 max-w-md text-lg leading-relaxed text-paper-muted"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.7, ease: OUT_EASE }}
              >
                Follow a design step by step, the way a good diagram book teaches it. Or open any crease pattern and see it fold
                exactly, layer by layer, in 3D.
              </motion.p>
              <motion.div
                className="mt-9 flex flex-wrap gap-3"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.85, ease: OUT_EASE }}
              >
                <ButtonLink href={ROUTE_HASH.learn} variant="primary" size="lg" trailingIcon={ArrowRight}>
                  Start with the paper cup
                </ButtonLink>
                <ButtonLink href={ROUTE_HASH.creasePattern} variant="inverse" size="lg">
                  Open a crease pattern
                </ButtonLink>
              </motion.div>
            </div>
            <HeroModel />
          </div>
        </section>

        <PatternStrip />

        {/* the two modes */}
        <section aria-labelledby="modes" className="bg-canvas">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <Reveal>
              <h2 id="modes" className="font-display text-4xl font-semibold tracking-tight text-ink">
                Two ways in
              </h2>
              <p className="mt-3 max-w-lg text-lg text-ink-muted">
                One for people learning their first folds, one for people who read crease patterns.
              </p>
            </Reveal>

            <div className="mt-12 grid gap-6 lg:grid-cols-2">
              <ModeCard
                eyebrow="For beginners"
                title="Learn, step by step"
                body="Each design is a list of steps with plain instructions and hints. Play it through, pause on the fold you’re stuck on, and turn the model to see it from any side."
                href={ROUTE_HASH.learn}
                cta="Open Learn"
              >
                <StepPreview />
              </ModeCard>
              <ModeCard
                eyebrow="For experienced folders"
                title="Fold any crease pattern"
                body="Open a .fold file, from a simple base to a box-pleated design, and fold it from flat to finished. Grab the paper to loosen the layers, or pin a point and make new creases yourself."
                href={ROUTE_HASH.creasePattern}
                cta="Open Crease pattern"
                delay={0.12}
              >
                <div className="flex flex-col items-start gap-5 rounded-md border border-line bg-canvas p-4 sm:flex-row sm:items-center">
                  <CreaseThumbnail fold={boxPleatFold} className="size-36 shrink-0" weight={0.75} title="Box-pleated crease pattern" />
                  <p className="text-sm text-ink-muted">
                    <span className="block font-medium text-ink">{boxPleat?.title}</span>
                    {boxPleat?.meta}, folded exactly with the layers stacked in order.
                  </p>
                </div>
              </ModeCard>
            </div>
          </div>
        </section>

        <CommunityStrip />

        {/* how it works */}
        <section aria-labelledby="how" className="border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <Reveal>
              <h2 id="how" className="font-display text-4xl font-semibold tracking-tight text-ink">
                How it works
              </h2>
            </Reveal>
            {/* a valley fold line, the site's one ornament, creasing itself across the page */}
            <motion.svg
              className="mt-8 h-1 w-full"
              aria-hidden="true"
              preserveAspectRatio="none"
              initial={{ clipPath: 'inset(0 100% 0 0)' }}
              whileInView={{ clipPath: 'inset(0 0% 0 0)' }}
              viewport={{ once: true }}
              transition={{ duration: 1.4, ease: [0.65, 0, 0.35, 1] }}
            >
              <line x1="0" y1="2" x2="100%" y2="2" stroke={theme.valley} strokeOpacity="0.6" strokeWidth="2" strokeDasharray="8 5" />
            </motion.svg>
            <ol className="mt-12 grid gap-12 md:grid-cols-3">
              {PRINCIPLES.map((p, i) => (
                <Reveal as="li" key={p.title} delay={0.1 + i * 0.12}>
                  <span className="font-display text-5xl font-semibold tabular-nums text-accent-ink" style={{ fontVariationSettings: '"opsz" 96' }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <h3 className="mt-3 text-lg font-semibold text-ink">{p.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-muted">{p.body}</p>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        {/* closing call to action */}
        <section className="bg-accent">
          <Reveal className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-6 py-16 md:flex-row md:items-center">
            <h2 className="max-w-xl font-display text-4xl font-semibold leading-tight tracking-tight text-on-accent">
              Got a square of paper? Fold along.
            </h2>
            <a
              href={ROUTE_HASH.learn}
              className={cn(
                'inline-flex h-11 items-center gap-2 rounded-md bg-ink px-5 text-sm font-semibold text-paper',
                'shadow-[0_3px_0_var(--color-accent-edge)] transition-[transform,box-shadow,background-color] duration-150 ease-out',
                'hover:bg-ink-line active:translate-y-0.5 active:shadow-none',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-accent',
              )}
            >
              Fold the paper cup <ArrowRight className="size-4" strokeWidth={2} />
            </a>
          </Reveal>
        </section>
      </main>

      <footer className="bg-ink text-paper-muted">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-10 text-sm md:flex-row md:items-center md:justify-between">
          <Wordmark tone="inverse" intro={false} />
          <p>The Learn designs are traditional models. Box with wing by Jason Ku.</p>
          <nav aria-label="Footer" className="flex gap-5">
            <a href={ROUTE_HASH.learn} className="crease-link hover:text-paper">
              Learn
            </a>
            <a href={ROUTE_HASH.creasePattern} className="crease-link hover:text-paper">
              Crease pattern
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
};
