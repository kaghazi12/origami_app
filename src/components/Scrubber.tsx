import React, { useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  Repeat,
  Layers,
  Sparkles,
  Info,
  ChevronRight,
} from 'lucide-react';
import type { FoldEngine, Locator } from '../engine';

interface ScrubberProps {
  engine: FoldEngine;
  progress: number;
  onProgressChange: (newProgress: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  playbackSpeed: number;
  onChangeSpeed: (speed: number) => void;
  isLooping: boolean;
  onToggleLoop: () => void;
  locator: Locator;
  activeFaceCount: number;
}

export const Scrubber: React.FC<ScrubberProps> = ({
  engine,
  progress,
  onProgressChange,
  isPlaying,
  onTogglePlay,
  playbackSpeed,
  onChangeSpeed,
  isLooping,
  onToggleLoop,
  locator,
  activeFaceCount,
}) => {
  const stepCount = engine.stepCount;

  // Jump to specific step
  const handleStepJump = (stepIndex: number) => {
    onProgressChange(Math.max(0, Math.min(stepIndex, stepCount)));
  };

  const handlePrevStep = () => {
    const current = Math.floor(progress);
    if (progress - current > 0.05) {
      handleStepJump(current);
    } else {
      handleStepJump(Math.max(0, current - 1));
    }
  };

  const handleNextStep = () => {
    const current = Math.floor(progress);
    handleStepJump(Math.min(stepCount, current + 1));
  };

  // Keyboard shortcut handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if focus is inside an input/textarea
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        onTogglePlay();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        onProgressChange(Math.max(0, progress - (e.shiftKey ? 1 : 0.05)));
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        onProgressChange(Math.min(stepCount, progress + (e.shiftKey ? 1 : 0.05)));
      } else if (e.code === 'Home') {
        e.preventDefault();
        onProgressChange(0);
      } else if (e.code === 'End') {
        e.preventDefault();
        onProgressChange(stepCount);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [progress, stepCount, onTogglePlay, onProgressChange]);

  const currentStep = locator.step;
  const isFinished = progress >= stepCount;
  const stepPercent = Math.round(locator.t * 100);

  return (
    <div className="w-full flex flex-col gap-3 px-6 py-4 bg-slate-900/90 backdrop-blur-xl border-t border-slate-800 text-slate-100 shadow-2xl">
      {/* Current Step Instruction Card */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-rose-500/20 text-rose-400 font-bold text-sm border border-rose-500/30">
            {isFinished ? '✓' : locator.stepIndex + 1}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold truncate text-slate-100">
                {isFinished
                  ? 'All folds complete!'
                  : currentStep?.title ?? 'Unfolded Sheet'}
              </span>
              {currentStep && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <span
                    className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border ${
                      currentStep.kind === 'valley'
                        ? 'bg-sky-500/20 text-sky-300 border-sky-500/30'
                        : currentStep.kind === 'mountain'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                        : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                    }`}
                  >
                    {currentStep.kind === 'unfold' ? 'Unfold' : `${currentStep.kind} fold`}
                  </span>
                  <span className="text-[10px] font-medium text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded-full border border-slate-700">
                    moving {currentStep.moving}
                  </span>
                </div>
              )}
            </div>
            {currentStep?.hint && (
              <p className="text-xs text-slate-400 truncate mt-0.5">{currentStep.hint}</p>
            )}
          </div>
        </div>

        {/* Stats: Faces & Step Info */}
        <div className="flex items-center gap-4 text-xs font-mono text-slate-400 shrink-0">
          <div className="flex items-center gap-1 bg-slate-800/60 px-2.5 py-1 rounded-md border border-slate-700/60">
            <Layers className="w-3.5 h-3.5 text-rose-400" />
            <span>{activeFaceCount} faces</span>
          </div>
          <div className="bg-slate-800/60 px-2.5 py-1 rounded-md border border-slate-700/60">
            <span className="text-rose-400 font-bold">{progress.toFixed(2)}</span> / {stepCount}.00
          </div>
        </div>
      </div>

      {/* Main Scrubber Track */}
      <div className="relative flex flex-col gap-1 w-full group">
        <div className="relative flex items-center h-6 cursor-pointer">
          {/* Track background */}
          <div className="absolute w-full h-2 rounded-full bg-slate-800 border border-slate-700/60 overflow-hidden">
            {/* Active progress bar */}
            <div
              className="h-full bg-gradient-to-r from-rose-600 via-rose-500 to-amber-500 rounded-full transition-all duration-75"
              style={{ width: `${stepCount > 0 ? (progress / stepCount) * 100 : 0}%` }}
            />
          </div>

          {/* Step markers along the rail */}
          {Array.from({ length: stepCount + 1 }).map((_, i) => {
            const leftPct = stepCount > 0 ? (i / stepCount) * 100 : 0;
            const isPassed = progress >= i;
            return (
              <div
                key={i}
                onClick={(e) => {
                  e.stopPropagation();
                  handleStepJump(i);
                }}
                className="absolute -translate-x-1/2 flex flex-col items-center cursor-pointer group/marker"
                style={{ left: `${leftPct}%` }}
                title={`Step ${i}`}
              >
                <div
                  className={`w-3 h-3 rounded-full border-2 transition-all duration-150 ${
                    isPassed
                      ? 'bg-rose-500 border-white scale-110 shadow-md shadow-rose-500/50'
                      : 'bg-slate-800 border-slate-600 group-hover/marker:border-rose-400'
                  }`}
                />
              </div>
            );
          })}

          {/* HTML range input over top for silky smooth dragging */}
          <input
            type="range"
            min={0}
            max={stepCount}
            step={0.005}
            value={progress}
            onChange={(e) => onProgressChange(parseFloat(e.target.value))}
            className="absolute w-full h-full opacity-0 cursor-ew-resize z-20"
          />
        </div>

        {/* Step numbers below rail */}
        <div className="flex justify-between items-center text-[11px] text-slate-500 px-1 font-mono">
          <span>Start (Unfolded)</span>
          {Array.from({ length: stepCount }).map((_, i) => (
            <button
              key={i}
              onClick={() => handleStepJump(i + 1)}
              className={`hover:text-rose-400 transition-colors ${
                Math.floor(progress) === i ? 'text-rose-400 font-bold' : ''
              }`}
            >
              Step {i + 1}
            </button>
          ))}
          <span>Finished</span>
        </div>
      </div>

      {/* Control Buttons Bar */}
      <div className="flex items-center justify-between pt-1">
        {/* Playback Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onProgressChange(0)}
            className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors border border-slate-700/60"
            title="Reset to beginning (Home)"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            onClick={handlePrevStep}
            className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors border border-slate-700/60"
            title="Previous step (Left Arrow)"
          >
            <SkipBack className="w-4 h-4" />
          </button>
          <button
            onClick={onTogglePlay}
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold shadow-lg shadow-rose-600/30 transition-all hover:scale-105 active:scale-95"
            title="Play / Pause (Space)"
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-white" />}
            <span>{isPlaying ? 'Pause' : 'Fold'}</span>
          </button>
          <button
            onClick={handleNextStep}
            className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors border border-slate-700/60"
            title="Next step (Right Arrow)"
          >
            <SkipForward className="w-4 h-4" />
          </button>
          <button
            onClick={onToggleLoop}
            className={`p-2 rounded-lg transition-colors border ${
              isLooping
                ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                : 'bg-slate-800/80 hover:bg-slate-700 text-slate-400 border-slate-700/60'
            }`}
            title="Toggle loop"
          >
            <Repeat className="w-4 h-4" />
          </button>
        </div>

        {/* Speed Controls */}
        <div className="flex items-center gap-1.5 bg-slate-800/80 p-1 rounded-lg border border-slate-700/60">
          {[0.5, 1, 1.5, 2].map((spd) => (
            <button
              key={spd}
              onClick={() => onChangeSpeed(spd)}
              className={`px-2 py-1 text-xs font-semibold rounded-md transition-all ${
                playbackSpeed === spd
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {spd}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
