import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Pause,
  Play,
  RotateCcw,
  Upload,
} from 'lucide-react';
import { compileDesign, DesignAnimator, DesignError, type CompiledDesign } from '../../engine/design';
import { DesignViewer3D } from './DesignViewer3D';
import craneJson from '../../designs/crane.json';
import cupJson from '../../designs/paper-cup.json';
import prelimJson from '../../designs/preliminary-base.json';

const BUNDLED: { id: string; json: unknown }[] = [
  { id: 'paper-cup', json: cupJson },
  { id: 'preliminary-base', json: prelimJson },
  { id: 'crane', json: craneJson },
];

interface Loaded {
  compiled: CompiledDesign | null;
  animator: DesignAnimator | null;
  /** Parse error (the file itself is invalid). */
  fileError: string | null;
  source: string;
}

function load(json: unknown, source: string): Loaded {
  try {
    const compiled = compileDesign(json);
    return { compiled, animator: new DesignAnimator(compiled), fileError: null, source };
  } catch (e) {
    const msg = e instanceof DesignError ? `Invalid design file — ${e.message}` : `Could not load design: ${(e as Error).message}`;
    return { compiled: null, animator: null, fileError: msg, source };
  }
}

const SPEEDS = [0.5, 1, 2];

export const PrototypeApp: React.FC = () => {
  const [loaded, setLoaded] = useState<Loaded>(() => load(BUNDLED[0].json, BUNDLED[0].id));
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showCreases, setShowCreases] = useState(true);
  const [resetKey, setResetKey] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const { compiled, animator } = loaded;
  const stepCount = animator?.stepCount ?? 0;

  const choose = useCallback((l: Loaded) => {
    setLoaded(l);
    setProgress(0);
    setPlaying(false);
    setResetKey((k) => k + 1);
  }, []);

  // playback loop: one step per ~1.6 s at 1x
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!playing) { last.current = null; return; }
    let id = 0;
    const tick = (t: number) => {
      if (last.current !== null) {
        const dt = (t - last.current) / 1000;
        setProgress((p) => {
          const next = p + dt * 0.62 * speed;
          if (next >= stepCount) { setPlaying(false); return stepCount; }
          return next;
        });
      }
      last.current = t;
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, speed, stepCount]);

  const loc = animator ? animator.locate(progress) : { stepIndex: 0, t: 0 };
  const current = compiled && loc.stepIndex < compiled.steps.length ? compiled.steps[loc.stepIndex] : null;
  const atEnd = stepCount > 0 && progress >= stepCount;

  const goStep = (i: number) => {
    setPlaying(false);
    setProgress(Math.max(0, Math.min(stepCount, i)));
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      choose(load(JSON.parse(text), f.name));
    } catch (err) {
      choose({ compiled: null, animator: null, fileError: `Could not read ${f.name}: ${(err as Error).message}`, source: f.name });
    }
    e.target.value = '';
  };

  const stats = useMemo(() => {
    if (!compiled) return null;
    return { faces: compiled.final.topo.faces.length, ms: compiled.timeMs };
  }, [compiled]);

  const design = compiled?.design;
  const front = design?.paper.front ?? '#dc2626';
  const back = design?.paper.back ?? '#f8fafc';

  return (
    <div className="flex h-full w-full bg-slate-950 text-slate-100">
      {/* sidebar */}
      <aside className="w-80 shrink-0 border-r border-slate-800 flex flex-col min-h-0">
        <div className="p-4 border-b border-slate-800 space-y-3">
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Design</div>
          <select
            className="w-full bg-slate-900 border border-slate-700 rounded-md px-2 py-1.5 text-sm"
            value={BUNDLED.some((b) => b.id === loaded.source) ? loaded.source : ''}
            onChange={(e) => {
              const b = BUNDLED.find((x) => x.id === e.target.value);
              if (b) choose(load(b.json, b.id));
            }}
          >
            {!BUNDLED.some((b) => b.id === loaded.source) && <option value="">{loaded.source}</option>}
            {BUNDLED.map((b) => (
              <option key={b.id} value={b.id}>
                {(b.json as { meta: { title: string } }).meta.title}
              </option>
            ))}
          </select>
          <button
            onClick={() => fileInput.current?.click()}
            className="w-full flex items-center justify-center gap-2 text-sm px-3 py-1.5 rounded-md border border-slate-700 bg-slate-900 hover:bg-slate-800"
          >
            <Upload className="w-4 h-4" /> Open .json design
          </button>
          <input ref={fileInput} type="file" accept=".json,application/json" className="hidden" onChange={onFile} />
        </div>

        {design && (
          <div className="p-4 border-b border-slate-800 space-y-1">
            <div className="text-base font-semibold">{design.meta.title}</div>
            <div className="text-xs text-slate-400">
              {design.meta.author ? `${design.meta.author} · ` : ''}
              {design.meta.difficulty ?? 'unrated'} · {design.steps.length} steps
            </div>
            {design.meta.description && <p className="text-xs text-slate-400 pt-1">{design.meta.description}</p>}
            {stats && (
              <div className="text-[11px] text-slate-500 pt-1">
                Folded in {stats.ms.toFixed(0)} ms · {stats.faces} faces
              </div>
            )}
          </div>
        )}

        {(loaded.fileError || compiled?.error) && (
          <div className="m-3 p-3 rounded-md border border-amber-700/60 bg-amber-950/40 text-amber-200 text-xs flex gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              {loaded.fileError ?? (
                <>
                  <div className="font-semibold">Step {compiled!.error!.step + 1} can't be folded</div>
                  <div className="mt-0.5">{compiled!.error!.message}</div>
                  <div className="mt-1 text-amber-300/70">Steps before it play normally.</div>
                </>
              )}
            </div>
          </div>
        )}

        <ol className="flex-1 overflow-y-auto p-2 space-y-0.5 text-sm">
          {compiled?.steps.map((s, i) => {
            const active = i === loc.stepIndex && !atEnd;
            const done = i < loc.stepIndex || atEnd;
            return (
              <li key={i}>
                <button
                  onClick={() => goStep(i)}
                  className={`w-full text-left px-2 py-1.5 rounded-md flex gap-2 ${
                    active ? 'bg-indigo-600/30 text-white' : done ? 'text-slate-400 hover:bg-slate-900' : 'text-slate-300 hover:bg-slate-900'
                  }`}
                >
                  <span className="w-6 shrink-0 text-right tabular-nums text-slate-500">{i + 1}</span>
                  <span>{s.caption}</span>
                </button>
              </li>
            );
          })}
          {compiled?.error && design && (
            <li className="px-2 py-1.5 text-slate-600 flex gap-2">
              <span className="w-6 shrink-0 text-right tabular-nums">{compiled.error.step + 1}</span>
              <span className="line-through">{design.steps[compiled.error.step].caption}</span>
            </li>
          )}
          {compiled && compiled.steps.length > 0 && (
            <li>
              <button
                onClick={() => goStep(stepCount)}
                className={`w-full text-left px-2 py-1.5 rounded-md flex gap-2 ${atEnd ? 'bg-emerald-600/25 text-white' : 'text-slate-400 hover:bg-slate-900'}`}
              >
                <span className="w-6 shrink-0" />
                <span>Finished model</span>
              </button>
            </li>
          )}
        </ol>
      </aside>

      {/* viewer */}
      <main className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 relative min-h-0">
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
            <div className="h-full flex items-center justify-center text-slate-500 text-sm">No design loaded</div>
          )}
          <div className="absolute top-3 right-3 flex gap-2">
            <button
              onClick={() => setShowCreases((v) => !v)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md bg-slate-900/80 border border-slate-700 hover:bg-slate-800"
            >
              {showCreases ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />} Creases
            </button>
            <button
              onClick={() => setResetKey((k) => k + 1)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md bg-slate-900/80 border border-slate-700 hover:bg-slate-800"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Reset view
            </button>
          </div>
          <div className="absolute left-0 right-0 bottom-0 p-4 pointer-events-none">
            <div className="max-w-2xl mx-auto bg-slate-950/80 backdrop-blur border border-slate-800 rounded-lg px-4 py-3">
              <div className="text-xs text-slate-500">
                {atEnd ? 'Done' : stepCount ? `Step ${loc.stepIndex + 1} of ${stepCount}` : ''}
              </div>
              <div className="text-base font-medium">{atEnd ? design?.meta.title : current?.caption ?? 'Flat sheet'}</div>
              {!atEnd && current?.hint && <div className="text-sm text-slate-400 mt-0.5">{current.hint}</div>}
            </div>
          </div>
        </div>

        {/* transport */}
        <div className="border-t border-slate-800 px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => goStep(Math.ceil(progress) - 1)}
            disabled={progress <= 0}
            className="p-2 rounded-md border border-slate-700 bg-slate-900 hover:bg-slate-800 disabled:opacity-40"
            title="Previous step"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              if (atEnd) setProgress(0);
              setPlaying((p) => !p);
            }}
            disabled={stepCount === 0}
            className="p-2 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40"
            title={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button
            onClick={() => goStep(Math.floor(progress) + 1)}
            disabled={atEnd || stepCount === 0}
            className="p-2 rounded-md border border-slate-700 bg-slate-900 hover:bg-slate-800 disabled:opacity-40"
            title="Next step"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(stepCount, 0.0001)}
            step={0.001}
            value={progress}
            onChange={(e) => {
              setPlaying(false);
              setProgress(parseFloat(e.target.value));
            }}
            className="flex-1 accent-indigo-500"
          />
          <div className="flex rounded-md border border-slate-700 overflow-hidden text-xs">
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={`px-2 py-1 ${speed === s ? 'bg-slate-700 text-white' : 'bg-slate-900 text-slate-400 hover:text-slate-200'}`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
};
