import React, { useEffect, useState } from 'react';
import { ModernOrigamiApp } from './components/modern/ModernOrigamiApp';
import { PrototypeApp } from './components/prototype/PrototypeApp';

/**
 * Two ways in:
 * - Learn: step-by-step designs with captions, one fold at a time (beginners).
 * - Crease pattern: load any .fold crease pattern or folded form, fold it exactly, grab and inspect
 *   it (experienced folders).
 */
type Mode = 'learn' | 'creasePattern';

const MODES: { id: Mode; hash: string; label: string; hint: string }[] = [
  { id: 'learn', hash: '#learn', label: 'Learn (step-by-step)', hint: 'Follow a design one fold at a time' },
  { id: 'creasePattern', hash: '#crease-pattern', label: 'Crease pattern (advanced)', hint: 'Open and fold any .fold file' },
];

function modeFromHash(): Mode {
  if (typeof window === 'undefined') return 'learn';
  const h = window.location.hash;
  // older links keep working
  if (h === '#crease-pattern' || h === '#modern') return 'creasePattern';
  return 'learn';
}

export const App: React.FC = () => {
  const [mode, setMode] = useState<Mode>(modeFromHash);

  useEffect(() => {
    const onHash = () => setMode(modeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-900 text-slate-100">
      <div className="flex items-center justify-between px-4 py-1.5 bg-slate-950 border-b border-slate-800 text-xs z-50">
        <div className="flex items-center space-x-3">
          <span className="font-bold tracking-wider text-slate-300">ORIGAMI</span>
          <div className="inline-flex p-0.5 bg-slate-900 rounded-lg border border-slate-800">
            {MODES.map((m) => (
              <button
                key={m.id}
                title={m.hint}
                onClick={() => {
                  setMode(m.id);
                  window.location.hash = m.hash;
                }}
                className={`px-3 py-1 font-semibold rounded-md transition-all ${
                  mode === m.id ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div className="text-[11px] text-slate-500">{MODES.find((m) => m.id === mode)?.hint}</div>
      </div>

      <div className="flex-1 w-full h-full min-h-0 overflow-hidden">
        {mode === 'learn' ? <PrototypeApp /> : <ModernOrigamiApp />}
      </div>
    </div>
  );
};

export default App;
