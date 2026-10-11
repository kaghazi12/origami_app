import React, { useState, useMemo } from 'react';
import {
  Plus,
  Trash2,
  Download,
  Upload,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  FileCode,
  Sparkles,
  Box,
  Grid3X3,
  Layers,
  Sliders,
  Crosshair,
  ArrowLeftRight,
} from 'lucide-react';
import { AuthoringCanvas2D } from './AuthoringCanvas2D';
import { AuthoringCanvas3D } from './AuthoringCanvas3D';
import { PRELIMINARY_FOLD_MODEL } from '../models/presets';
import {
  FoldEngine,
  type Face,
  type FoldModel,
  type FoldStep,
  type FoldSide,
  type FoldKind,
  type Vec2,
} from '../engine';

interface AuthoringToolProps {
  currentModel: FoldModel;
  onUpdateModel: (newModel: FoldModel) => void;
  onPreviewStep: (testModel: FoldModel) => void;
}

export const AuthoringTool: React.FC<AuthoringToolProps> = ({
  currentModel,
  onUpdateModel,
  onPreviewStep,
}) => {
  // Canvas view mode: 3D interactive vs 2D crease pattern
  const [viewMode, setViewMode] = useState<'3d' | '2d'>('3d');

  // Step parameters being authored
  const [title, setTitle] = useState<string>('Hinge flap at 90°');
  const [hint, setHint] = useState<string>('');
  const [movingSide, setMovingSide] = useState<FoldSide>('left');
  const [foldKind, setFoldKind] = useState<FoldKind>('valley');
  const [creaseFrom, setCreaseFrom] = useState<Vec2 | null>([0.5, 0]);
  const [creaseTo, setCreaseTo] = useState<Vec2 | null>([0.5, 1]);
  const [foldAngle, setFoldAngle] = useState<number>(90); // default 90 deg 3D fold, or 180 for flat fold
  const [isSpecificFaceMode, setIsSpecificFaceMode] = useState<boolean>(false);
  const [selectedFaceIds, setSelectedFaceIds] = useState<Set<string>>(new Set());
  const [pickingTarget, setPickingTarget] = useState<'from' | 'to' | 'auto'>('auto');
  const [squashWarning, setSquashWarning] = useState<string | null>(null);

  // JSON Import modal state
  const [showJsonModal, setShowJsonModal] = useState<boolean>(false);
  const [jsonText, setJsonText] = useState<string>('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Compute the current flat faces after all existing steps in currentModel
  const currentEngine = useMemo(() => {
    try {
      return new FoldEngine(currentModel);
    } catch {
      return null;
    }
  }, [currentModel]);

  const flatFaces = useMemo(() => {
    if (!currentEngine) return [];
    return currentEngine.stateAt(currentEngine.stepCount);
  }, [currentEngine]);

  // Construct draft step
  const draftStep: FoldStep | null = useMemo(() => {
    if (foldKind === 'unfold') {
      return {
        title: title.trim() || 'Unfold back flat',
        ...(hint.trim() ? { hint: hint.trim() } : {}),
        kind: 'unfold',
      };
    }
    if (!creaseFrom || !creaseTo) return null;
    const s: FoldStep = {
      title: title.trim() || (foldAngle !== 180 ? `Hinge flap at ${foldAngle}°` : 'New Fold Step'),
      ...(hint.trim() ? { hint: hint.trim() } : {}),
      crease: { from: creaseFrom, to: creaseTo },
      moving: movingSide,
      kind: foldKind,
      ...(foldAngle !== 180 ? { angle: foldAngle } : {}),
      ...(isSpecificFaceMode && selectedFaceIds.size > 0
        ? { select: { faces: Array.from(selectedFaceIds) } }
        : {}),
    };
    return s;
  }, [title, hint, creaseFrom, creaseTo, movingSide, foldKind, foldAngle, isSpecificFaceMode, selectedFaceIds]);

  // Validate the draft step against the engine
  const validationResult = useMemo(() => {
    if (!draftStep) {
      if (foldKind === 'unfold') {
        if (currentModel.steps.length === 0) {
          return { valid: false, error: 'Cannot unfold: no previous fold step to unfold.' };
        }
      }
      return { valid: false, error: 'Please set hinge axis start and end points.' };
    }
    try {
      const testModel: FoldModel = {
        ...currentModel,
        steps: [...currentModel.steps, draftStep],
      };
      const testEngine = new FoldEngine(testModel);
      return { valid: true, error: null, testModel, testEngine };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { valid: false, error: msg };
    }
  }, [currentModel, draftStep, foldKind]);

  // Apply quick crease preset
  const applyPreset = (preset: 'v-half' | 'h-half' | 'diag-main' | 'diag-anti' | 'third-l' | 'third-r' | 'bottom-edge' | 'top-edge' | 'left-edge' | 'right-edge') => {
    const w = currentModel.paper.width;
    const h = currentModel.paper.height;
    switch (preset) {
      case 'v-half':
        setCreaseFrom([w / 2, 0]);
        setCreaseTo([w / 2, h]);
        setTitle(foldAngle === 180 ? 'Fold vertically in half' : `Hinge vertical half at ${foldAngle}°`);
        break;
      case 'h-half':
        setCreaseFrom([0, h / 2]);
        setCreaseTo([w, h / 2]);
        setTitle(foldAngle === 180 ? 'Fold horizontally in half' : `Hinge horizontal half at ${foldAngle}°`);
        break;
      case 'diag-main':
        setCreaseFrom([0, 0]);
        setCreaseTo([w, h]);
        setTitle(foldAngle === 180 ? 'Fold diagonally in half' : `Hinge diagonal flap at ${foldAngle}°`);
        break;
      case 'diag-anti':
        setCreaseFrom([0, h]);
        setCreaseTo([w, 0]);
        setTitle(foldAngle === 180 ? 'Fold diagonally in half' : `Hinge diagonal flap at ${foldAngle}°`);
        break;
      case 'third-l':
        setCreaseFrom([Number((w / 3).toFixed(4)), 0]);
        setCreaseTo([Number((w / 3).toFixed(4)), h]);
        setTitle(`Hinge left third at ${foldAngle}°`);
        break;
      case 'third-r':
        setCreaseFrom([Number(((w * 2) / 3).toFixed(4)), 0]);
        setCreaseTo([Number(((w * 2) / 3).toFixed(4)), h]);
        setTitle(`Hinge right third at ${foldAngle}°`);
        break;
      case 'bottom-edge':
        setCreaseFrom([0, 0]);
        setCreaseTo([w, 0]);
        setTitle(`Hinge along bottom edge at ${foldAngle}°`);
        break;
      case 'top-edge':
        setCreaseFrom([0, h]);
        setCreaseTo([w, h]);
        setTitle(`Hinge along top edge at ${foldAngle}°`);
        break;
      case 'left-edge':
        setCreaseFrom([0, 0]);
        setCreaseTo([0, h]);
        setTitle(`Hinge along left edge at ${foldAngle}°`);
        break;
      case 'right-edge':
        setCreaseFrom([w, 0]);
        setCreaseTo([w, h]);
        setTitle(`Hinge along right edge at ${foldAngle}°`);
        break;
    }
  };

  // Check if current state is compatible with a squash fold (e.g. Preliminary Base)
  const isPreliminaryBaseCompatible = useMemo(() => {
    if (currentModel.id.includes('preliminary') || currentModel.name.toLowerCase().includes('preliminary')) {
      return true;
    }
    if (flatFaces.length >= 4) {
      const w = currentModel.paper.width;
      const h = currentModel.paper.height;
      return flatFaces.some((f) =>
        f.polygon.some((pt) => Math.hypot(pt[0] - w / 2, pt[1] - h / 2) < 0.02)
      );
    }
    return false;
  }, [currentModel, flatFaces]);

  const handleSquashPreset = () => {
    if (!isPreliminaryBaseCompatible) {
      setSquashWarning(
        '⚠️ A Squash Fold can only be performed from a compatible base (such as a Preliminary Base). Load the Preliminary Base to apply this fold.'
      );
      return;
    }

    setSquashWarning(null);
    const w = currentModel.paper.width;
    const h = currentModel.paper.height;
    const bisectorR = Number((h / 2 + (h / 2) * (Math.SQRT2 - 1)).toFixed(6));
    const bisectorL = Number((w / 2 + (w / 2) * (Math.SQRT2 - 1)).toFixed(6));

    const hasRightFlap = flatFaces.some((f) => f.id === 'f0.r.r.r');
    const hasLeftFlap = flatFaces.some((f) => f.id === 'f0.r.r.l');

    if (hasRightFlap) {
      // Step 1: Fold front-right flap edge onto center spine
      setCreaseFrom([w / 2, h / 2]);
      setCreaseTo([w, bisectorR]);
      setMovingSide('right');
      setFoldKind('valley');
      setFoldAngle(180);
      setSelectedFaceIds(new Set(['f0.r.r.r']));
      setIsSpecificFaceMode(true);
      setTitle('Squash fold: Crease right flap to center spine');
      setHint('Valley fold the outer edge of the front-right flap along the 22.5° angle bisector onto the center spine.');
    } else if (hasLeftFlap) {
      // Step 2: Fold front-left flap edge onto center spine, completing symmetrical kite
      setCreaseFrom([w / 2, h / 2]);
      setCreaseTo([bisectorL, h]);
      setMovingSide('left');
      setFoldKind('valley');
      setFoldAngle(180);
      setSelectedFaceIds(new Set(['f0.r.r.l']));
      setIsSpecificFaceMode(true);
      setTitle('Squash fold: Crease left flap to center spine');
      setHint('Valley fold the outer edge of the front-left flap along the matching angle bisector onto the center spine, completing the symmetrical kite.');
    } else {
      // Default: configure right flap
      setCreaseFrom([w / 2, h / 2]);
      setCreaseTo([w, bisectorR]);
      setMovingSide('right');
      setFoldKind('valley');
      setFoldAngle(180);
      setTitle('Squash fold: Crease flap to center spine');
      setHint('Valley fold along the angle bisector to squash the triangular flap flat along the center spine.');
    }
  };

  // Pick edge of a face as hinge axis
  const handlePickFaceEdgeAsAxis = (face: Face, edgeIndex = 0) => {
    const n = face.polygon.length;
    const i = edgeIndex % n;
    const j = (i + 1) % n;
    const p0 = face.polygon[i];
    const p1 = face.polygon[j];
    setCreaseFrom([Number(p0[0].toFixed(4)), Number(p0[1].toFixed(4))]);
    setCreaseTo([Number(p1[0].toFixed(4)), Number(p1[1].toFixed(4))]);
    setIsSpecificFaceMode(true);
    setSelectedFaceIds(new Set([face.id]));
    setTitle(`Hinge ${face.id} along edge at ${foldAngle}°`);
  };

  const handleAddStep = () => {
    if (!validationResult.valid || !validationResult.testModel) return;
    onUpdateModel(validationResult.testModel);
    // Reset draft fields
    setTitle('Hinge step ' + (currentModel.steps.length + 2));
    setHint('');
    setSelectedFaceIds(new Set());
    setIsSpecificFaceMode(false);
  };

  const handleDeleteStep = (index: number) => {
    const newSteps = currentModel.steps.filter((_, i) => i !== index);
    onUpdateModel({
      ...currentModel,
      steps: newSteps,
    });
  };

  const handleToggleFace = (faceId: string) => {
    const next = new Set(selectedFaceIds);
    if (next.has(faceId)) next.delete(faceId);
    else next.add(faceId);
    setSelectedFaceIds(next);
  };

  const handleExportJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(currentModel, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `${currentModel.id}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleImportJson = () => {
    try {
      const parsed = JSON.parse(jsonText);
      const testEngine = FoldEngine.fromJSON(parsed);
      onUpdateModel(testEngine.model);
      setShowJsonModal(false);
      setJsonError(null);
    } catch (err: unknown) {
      setJsonError(err instanceof Error ? err.message : 'Invalid model JSON');
    }
  };

  const handleUnfoldLast = () => {
    if (currentModel.steps.length === 0) return;
    const lastStep = currentModel.steps[currentModel.steps.length - 1];
    setFoldKind('unfold');
    const prevTitle = lastStep.title ? lastStep.title.toLowerCase().replace(/^fold\s+/i, '') : 'last fold';
    setTitle(`Unfold ${prevTitle}`);
    setHint('Undoes the last fold completely, laying paper flat with a crisp crease');
  };

  return (
    <div className="w-full flex flex-col md:flex-row gap-5 p-4 bg-slate-950/90 backdrop-blur border-t border-slate-800 text-slate-100 overflow-y-auto">
      {/* Left Column: Interactive Canvas (3D primary with 2D toggle) */}
      <div className="flex flex-col items-center">
        {/* View Switcher Header */}
        <div className="flex items-center justify-between w-full mb-2 px-1">
          <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Canvas View</span>
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-0.5 shadow">
            <button
              type="button"
              onClick={() => setViewMode('3d')}
              className={`px-3 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition-all ${
                viewMode === '3d'
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Interactive 3D authoring view with thickness and live hinge preview"
            >
              <Box className="w-3.5 h-3.5" />
              <span>3D Canvas</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('2d')}
              className={`px-3 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition-all ${
                viewMode === '2d'
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="2D crease pattern with grid snap options"
            >
              <Grid3X3 className="w-3.5 h-3.5" />
              <span>2D Pattern</span>
            </button>
          </div>
        </div>

        {/* Viewport: 3D or 2D */}
        {viewMode === '3d' ? (
          <AuthoringCanvas3D
            faces={flatFaces}
            paperWidth={currentModel.paper.width}
            paperHeight={currentModel.paper.height}
            creaseFrom={creaseFrom}
            creaseTo={creaseTo}
            onCreaseChange={(from, to) => {
              setCreaseFrom(from);
              setCreaseTo(to);
            }}
            activePickingTarget={pickingTarget}
            onActivePickingTargetChange={setPickingTarget}
            movingSide={movingSide}
            foldKind={foldKind}
            foldAngle={foldAngle}
            selectedFaceIds={selectedFaceIds}
            onToggleFaceSelect={handleToggleFace}
            isSpecificFaceMode={isSpecificFaceMode}
            validationError={validationResult.error}
            testModel={validationResult.testModel}
          />
        ) : (
          <AuthoringCanvas2D
            faces={flatFaces}
            paperWidth={currentModel.paper.width}
            paperHeight={currentModel.paper.height}
            creaseFrom={creaseFrom}
            creaseTo={creaseTo}
            onCreaseChange={(from, to) => {
              setCreaseFrom(from);
              setCreaseTo(to);
            }}
            movingSide={movingSide}
            foldKind={foldKind}
            selectedFaceIds={selectedFaceIds}
            onToggleFaceSelect={handleToggleFace}
            isSpecificFaceMode={isSpecificFaceMode}
            validationError={validationResult.error}
          />
        )}
      </div>

      {/* Middle Column: Step Configuration Form */}
      <div className="flex-1 flex flex-col gap-4 bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-rose-500" />
            <h3 className="font-bold text-sm text-slate-200">
              Author Step #{currentModel.steps.length + 1}
            </h3>
          </div>
          {/* Quick Presets */}
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[11px] text-slate-400 mr-1">Presets:</span>
            {currentModel.steps.length > 0 && (
              <button
                onClick={handleUnfoldLast}
                className="text-[10px] font-bold bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-700/60 px-2 py-1 rounded transition-colors"
                title="Automatically set up unfolding the previous fold"
              >
                ↺ Unfold Last
              </button>
            )}
            <button
              onClick={() => applyPreset('v-half')}
              className="text-[10px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded"
            >
              V-Half
            </button>
            <button
              onClick={() => applyPreset('h-half')}
              className="text-[10px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded"
            >
              H-Half
            </button>
            <button
              onClick={() => applyPreset('diag-main')}
              className="text-[10px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded"
            >
              Diagonal
            </button>
            <button
              onClick={() => applyPreset('third-l')}
              className="text-[10px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded"
            >
              1/3 Left
            </button>
            <button
              type="button"
              onClick={handleSquashPreset}
              className={`text-[10px] font-bold px-2 py-1 rounded transition-colors border ${
                isPreliminaryBaseCompatible
                  ? 'bg-amber-950/90 hover:bg-amber-900 text-amber-300 border-amber-600/70 shadow-sm'
                  : 'bg-slate-800/90 hover:bg-slate-700 text-amber-400/80 border-slate-700'
              }`}
              title={
                isPreliminaryBaseCompatible
                  ? 'Squash fold a triangular flap onto the center spine'
                  : 'Squash Fold (Requires Preliminary Base or compatible base)'
              }
            >
              ✦ Squash Fold
            </button>
          </div>
        </div>

        {/* Warning banner when squash fold is requested from incompatible base */}
        {squashWarning && (
          <div className="bg-amber-950/80 border border-amber-700/80 text-amber-200 text-xs p-3 rounded-xl flex items-center justify-between shadow-lg">
            <span className="flex-1 mr-3 leading-relaxed">{squashWarning}</span>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                type="button"
                onClick={() => {
                  onUpdateModel(PRELIMINARY_FOLD_MODEL);
                  setSquashWarning(null);
                }}
                className="text-[11px] font-bold bg-amber-600 hover:bg-amber-500 text-white px-3 py-1 rounded-lg shadow transition-colors"
              >
                Load Preliminary Base
              </button>
              <button
                type="button"
                onClick={() => setSquashWarning(null)}
                className="text-[11px] text-amber-400 hover:text-white px-2 py-1"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Inputs: Step Title & Hint */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-400 block mb-1">Step Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Hinge wing up at 45°"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-rose-500"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-400 block mb-1">Optional Hint / Tip</label>
            <input
              type="text"
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder="e.g. Lift flap to form standing side wall"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-rose-500"
            />
          </div>
        </div>

        {/* Fold Kind & Moving Side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-slate-400 block mb-1.5">Fold Kind</label>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setFoldKind('valley')}
                className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg border transition-all ${
                  foldKind === 'valley'
                    ? 'bg-sky-500/20 text-sky-300 border-sky-500/50 shadow-sm'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800'
                }`}
              >
                Valley (Up)
              </button>
              <button
                type="button"
                onClick={() => setFoldKind('mountain')}
                className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg border transition-all ${
                  foldKind === 'mountain'
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-sm'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800'
                }`}
              >
                Mountain (Down)
              </button>
              <button
                type="button"
                onClick={() => setFoldKind('unfold')}
                className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg border transition-all ${
                  foldKind === 'unfold'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-sm'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800'
                }`}
              >
                Unfold
              </button>
            </div>
          </div>

          <div>
            {foldKind === 'unfold' ? (
              <div className="h-full flex flex-col justify-center bg-emerald-950/40 border border-emerald-800/60 rounded-lg p-2.5">
                <span className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
                  <span>↺</span> Undo Previous Fold
                </span>
                <span className="text-[11px] text-emerald-400/80 mt-0.5">
                  Swings the last folded flap back flat and leaves behind a permanent crease mark.
                </span>
              </div>
            ) : (
              <>
                <label className="text-xs font-semibold text-slate-400 block mb-1.5">Moving Side of Axis</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setMovingSide('left')}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                      movingSide === 'left'
                        ? 'bg-rose-500/20 text-rose-300 border-rose-500/50 shadow-sm'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800'
                    }`}
                  >
                    Left side hinges
                  </button>
                  <button
                    type="button"
                    onClick={() => setMovingSide('right')}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                      movingSide === 'right'
                        ? 'bg-rose-500/20 text-rose-300 border-rose-500/50 shadow-sm'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800'
                    }`}
                  >
                    Right side hinges
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Fold Degree (Angle) Controls - Enabled for custom 3D non-flat folding */}
        {foldKind !== 'unfold' && (
          <div className="border border-slate-800/80 bg-slate-950/40 rounded-xl p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-rose-400" />
                <span>Fold Degree (Angle):</span>
                <span className="text-rose-400 font-mono text-sm">{foldAngle}°</span>
                {foldAngle !== 180 && (
                  <span className="text-[10px] font-mono px-1.5 py-0.2 bg-amber-500/20 text-amber-300 rounded border border-amber-500/30">
                    3D Fold
                  </span>
                )}
              </label>

              {/* Quick Degree Buttons */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setFoldAngle(45)}
                  className={`text-[10px] px-2 py-0.5 rounded font-semibold transition-colors ${
                    foldAngle === 45 ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  45°
                </button>
                <button
                  type="button"
                  onClick={() => setFoldAngle(90)}
                  className={`text-[10px] px-2 py-0.5 rounded font-semibold transition-colors ${
                    foldAngle === 90 ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  90° (Wall)
                </button>
                <button
                  type="button"
                  onClick={() => setFoldAngle(135)}
                  className={`text-[10px] px-2 py-0.5 rounded font-semibold transition-colors ${
                    foldAngle === 135 ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  135°
                </button>
                <button
                  type="button"
                  onClick={() => setFoldAngle(180)}
                  className={`text-[10px] px-2 py-0.5 rounded font-semibold transition-colors ${
                    foldAngle === 180 ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  180° (Flat)
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="range"
                min={-180}
                max={180}
                step={1}
                value={foldAngle}
                onChange={(e) => setFoldAngle(Number(e.target.value))}
                className="flex-1 accent-rose-500 h-1.5 bg-slate-900 rounded cursor-pointer"
              />
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={-180}
                  max={180}
                  value={foldAngle}
                  onChange={(e) => setFoldAngle(Number(e.target.value))}
                  className="w-16 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-right font-mono text-slate-200 focus:outline-none focus:border-rose-500"
                />
                <span className="text-xs text-slate-400 font-mono">°</span>
              </div>
            </div>
          </div>
        )}

        {/* Manual Layer & Face Manager */}
        {foldKind !== 'unfold' && (
          <div className="border border-slate-800/80 bg-slate-950/60 rounded-xl p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-sky-400" />
                <span>Manage Paper Layers</span>
                <span className="text-[11px] text-slate-400 font-normal">
                  ({flatFaces.length} face{flatFaces.length === 1 ? '' : 's'} available)
                </span>
              </span>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setIsSpecificFaceMode(false);
                    setSelectedFaceIds(new Set());
                  }}
                  className={`text-[10px] px-2 py-0.5 rounded font-semibold transition-colors ${
                    !isSpecificFaceMode
                      ? 'bg-rose-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Hinge All Layers
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsSpecificFaceMode(true);
                    setSelectedFaceIds(new Set(flatFaces.map((f) => f.id)));
                  }}
                  className="text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsSpecificFaceMode(true);
                    setSelectedFaceIds(new Set());
                  }}
                  className="text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                >
                  Clear
                </button>
              </div>
            </div>

            {/* List of layers and individual face chips */}
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pr-1">
              {flatFaces.map((f) => {
                const isSelected = selectedFaceIds.has(f.id);
                return (
                  <div
                    key={f.id}
                    onClick={() => {
                      setIsSpecificFaceMode(true);
                      handleToggleFace(f.id);
                    }}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs cursor-pointer border transition-all ${
                      isSpecificFaceMode && isSelected
                        ? 'bg-sky-500/25 border-sky-400 text-sky-200 shadow-sm'
                        : isSpecificFaceMode
                        ? 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                        : 'bg-slate-900/90 border-slate-800 text-slate-300'
                    }`}
                    title={`Click to toggle selection. Layer ${f.layer}, ${f.polygon.length} vertices`}
                  >
                    <span className="font-mono text-[11px] font-bold">{f.id}</span>
                    <span className="text-[10px] px-1 py-0.2 rounded bg-slate-800 text-slate-400">
                      L{f.layer}
                    </span>
                    {/* Hinge axis shortcut: Pick edge from this face */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePickFaceEdgeAsAxis(f);
                      }}
                      className="text-[10px] text-amber-400 hover:text-amber-200 ml-1 underline transition-colors"
                      title="Set hinge axis along an edge of this face"
                    >
                      Hinge Edge ⤸
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Hinge Axis Controls & Interactive Point Pickers */}
        {foldKind !== 'unfold' && (
          <div className="border border-slate-800/80 bg-slate-950/60 rounded-xl p-3 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <Crosshair className="w-3.5 h-3.5 text-amber-400" />
                <span>Hinge Axis (Line of Rotation)</span>
              </span>

              <div className="flex items-center gap-1.5">
                {creaseFrom && creaseTo && (
                  <button
                    type="button"
                    onClick={() => {
                      const temp = creaseFrom;
                      setCreaseFrom(creaseTo);
                      setCreaseTo(temp);
                    }}
                    className="text-[10px] px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 transition-colors flex items-center gap-1"
                    title="Swap Point 1 and Point 2"
                  >
                    <ArrowLeftRight className="w-3 h-3 text-amber-400" />
                    <span>Swap ⇄</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setCreaseFrom(null);
                    setCreaseTo(null);
                    setPickingTarget('auto');
                  }}
                  className="text-[10px] px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-rose-400 hover:text-rose-300 border border-slate-800 transition-colors"
                >
                  Clear Axis
                </button>
              </div>
            </div>

            {/* Point 1 (From) and Point 2 (To) Numeric & Pick Inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* Point 1 (From) */}
              <div
                className={`p-2.5 rounded-lg border transition-colors ${
                  pickingTarget === 'from'
                    ? 'bg-sky-950/40 border-sky-500/80 ring-1 ring-sky-500/40'
                    : 'bg-slate-900/90 border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-bold text-sky-400 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-sky-400" />
                    Point 1 (From)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setViewMode('3d');
                      setPickingTarget('from');
                    }}
                    className={`text-[10px] px-2 py-0.5 rounded font-semibold transition-colors ${
                      pickingTarget === 'from'
                        ? 'bg-sky-500 text-white shadow-sm'
                        : 'bg-slate-800 text-sky-300 hover:bg-slate-700'
                    }`}
                    title="Click here, then click on the 3D canvas or corner pin to place Point 1"
                  >
                    {pickingTarget === 'from' ? '● Click 3D Paper' : '📍 Pick on Canvas'}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded border border-slate-800">
                    <span className="text-[10px] font-mono text-slate-500">X:</span>
                    <input
                      type="number"
                      step={0.05}
                      min={0}
                      max={currentModel.paper.width}
                      value={creaseFrom ? creaseFrom[0] : ''}
                      placeholder="0.0"
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setCreaseFrom([isNaN(val) ? 0 : val, creaseFrom ? creaseFrom[1] : 0]);
                      }}
                      className="w-full bg-transparent text-xs font-mono text-slate-200 focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded border border-slate-800">
                    <span className="text-[10px] font-mono text-slate-500">Y:</span>
                    <input
                      type="number"
                      step={0.05}
                      min={0}
                      max={currentModel.paper.height}
                      value={creaseFrom ? creaseFrom[1] : ''}
                      placeholder="0.0"
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setCreaseFrom([creaseFrom ? creaseFrom[0] : 0, isNaN(val) ? 0 : val]);
                      }}
                      className="w-full bg-transparent text-xs font-mono text-slate-200 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Quick Corner Presets for Point 1 */}
                <div className="flex items-center gap-1 mt-1.5 overflow-x-auto">
                  <span className="text-[9px] text-slate-500">Snap:</span>
                  {[
                    { label: '(0,0)', pt: [0, 0] },
                    { label: '(1,0)', pt: [currentModel.paper.width, 0] },
                    { label: '(0,1)', pt: [0, currentModel.paper.height] },
                    { label: '(1,1)', pt: [currentModel.paper.width, currentModel.paper.height] },
                    { label: 'Mid', pt: [currentModel.paper.width / 2, currentModel.paper.height / 2] },
                  ].map((p, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setCreaseFrom(p.pt as Vec2)}
                      className="text-[9px] font-mono bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-slate-200 px-1 py-0.5 rounded border border-slate-800/80"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Point 2 (To) */}
              <div
                className={`p-2.5 rounded-lg border transition-colors ${
                  pickingTarget === 'to'
                    ? 'bg-rose-950/40 border-rose-500/80 ring-1 ring-rose-500/40'
                    : 'bg-slate-900/90 border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-bold text-rose-400 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-rose-400" />
                    Point 2 (To)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setViewMode('3d');
                      setPickingTarget('to');
                    }}
                    className={`text-[10px] px-2 py-0.5 rounded font-semibold transition-colors ${
                      pickingTarget === 'to'
                        ? 'bg-rose-500 text-white shadow-sm'
                        : 'bg-slate-800 text-rose-300 hover:bg-slate-700'
                    }`}
                    title="Click here, then click on the 3D canvas or corner pin to place Point 2"
                  >
                    {pickingTarget === 'to' ? '● Click 3D Paper' : '📍 Pick on Canvas'}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded border border-slate-800">
                    <span className="text-[10px] font-mono text-slate-500">X:</span>
                    <input
                      type="number"
                      step={0.05}
                      min={0}
                      max={currentModel.paper.width}
                      value={creaseTo ? creaseTo[0] : ''}
                      placeholder="0.0"
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setCreaseTo([isNaN(val) ? 0 : val, creaseTo ? creaseTo[1] : 0]);
                      }}
                      className="w-full bg-transparent text-xs font-mono text-slate-200 focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded border border-slate-800">
                    <span className="text-[10px] font-mono text-slate-500">Y:</span>
                    <input
                      type="number"
                      step={0.05}
                      min={0}
                      max={currentModel.paper.height}
                      value={creaseTo ? creaseTo[1] : ''}
                      placeholder="0.0"
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setCreaseTo([creaseTo ? creaseTo[0] : 0, isNaN(val) ? 0 : val]);
                      }}
                      className="w-full bg-transparent text-xs font-mono text-slate-200 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Quick Corner Presets for Point 2 */}
                <div className="flex items-center gap-1 mt-1.5 overflow-x-auto">
                  <span className="text-[9px] text-slate-500">Snap:</span>
                  {[
                    { label: '(0,0)', pt: [0, 0] },
                    { label: '(1,0)', pt: [currentModel.paper.width, 0] },
                    { label: '(0,1)', pt: [0, currentModel.paper.height] },
                    { label: '(1,1)', pt: [currentModel.paper.width, currentModel.paper.height] },
                    { label: 'Mid', pt: [currentModel.paper.width / 2, currentModel.paper.height / 2] },
                  ].map((p, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setCreaseTo(p.pt as Vec2)}
                      className="text-[9px] font-mono bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-slate-200 px-1 py-0.5 rounded border border-slate-800/80"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Quick Axis Presets */}
            <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-slate-800/60 text-[10px]">
              <span className="text-slate-500">Axis Presets:</span>
              <button
                type="button"
                onClick={() => applyPreset('v-half')}
                className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800"
              >
                V-Center
              </button>
              <button
                type="button"
                onClick={() => applyPreset('h-half')}
                className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800"
              >
                H-Center
              </button>
              <button
                type="button"
                onClick={() => applyPreset('diag-main')}
                className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800"
              >
                Diagonal ↗
              </button>
              <button
                type="button"
                onClick={() => applyPreset('diag-anti')}
                className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800"
              >
                Diagonal ↘
              </button>
              <button
                type="button"
                onClick={() => applyPreset('bottom-edge')}
                className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800"
              >
                Bottom Edge
              </button>
              <button
                type="button"
                onClick={() => applyPreset('top-edge')}
                className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800"
              >
                Top Edge
              </button>
              <button
                type="button"
                onClick={() => applyPreset('left-edge')}
                className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800"
              >
                Left Edge
              </button>
              <button
                type="button"
                onClick={() => applyPreset('right-edge')}
                className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800"
              >
                Right Edge
              </button>
            </div>
          </div>
        )}

        {/* Bottom Action Buttons */}
        <div className="flex items-center justify-between border-t border-slate-800 pt-3">
          <div className="text-xs text-slate-400">
            {validationResult.valid ? (
              <span className="text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Ready to commit {foldAngle !== 180 ? `${foldAngle}° 3D fold` : 'fold'}</span>
              </span>
            ) : (
              <span className="text-rose-400 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" />
                <span className="truncate max-w-[240px]">{validationResult.error}</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {validationResult.valid && validationResult.testModel && (
              <button
                type="button"
                onClick={() => onPreviewStep(validationResult.testModel!)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-400 text-xs font-semibold transition-colors border border-slate-700"
                title="Preview this fold animated in the 3D viewer"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Test in 3D</span>
              </button>
            )}
            <button
              type="button"
              disabled={!validationResult.valid}
              onClick={handleAddStep}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                validationResult.valid
                  ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
              }`}
            >
              <Plus className="w-4 h-4" />
              <span>Commit Step</span>
            </button>
          </div>
        </div>
      </div>

      {/* Right Column: Model Step List & JSON Controls */}
      <div className="w-full md:w-80 flex flex-col gap-3 bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
            Model Steps ({currentModel.steps.length})
          </h4>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleExportJson}
              className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
              title="Export Model JSON"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                setJsonText(JSON.stringify(currentModel, null, 2));
                setShowJsonModal(true);
              }}
              className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
              title="Import / Edit Model JSON"
            >
              <Upload className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Step list items */}
        <div className="flex flex-col gap-2 max-h-[360px] overflow-y-auto pr-1">
          {currentModel.steps.length === 0 ? (
            <div className="text-xs text-slate-500 text-center py-6">
              No fold steps yet. Use the 3D canvas and form to author step #1.
            </div>
          ) : (
            currentModel.steps.map((st, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80 hover:border-slate-700 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-5 h-5 rounded-full bg-slate-800 text-[10px] font-bold text-slate-300 flex items-center justify-center shrink-0">
                    {idx + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-200 truncate">{st.title}</p>
                    <p className="text-[10px] text-slate-400 capitalize">
                      {st.kind === 'unfold'
                        ? 'Unfold step'
                        : `${st.kind} fold ${st.angle !== undefined ? `(${st.angle}°)` : ''} • moving ${st.moving}`}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteStep(idx)}
                  className="p-1 text-slate-500 hover:text-rose-400 transition-colors rounded"
                  title="Delete step"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* JSON Import Modal */}
      {showJsonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm text-slate-200 flex items-center gap-2">
                <FileCode className="w-4 h-4 text-rose-500" />
                Model JSON (Import / Edit)
              </h3>
              <button
                onClick={() => setShowJsonModal(false)}
                className="text-xs text-slate-400 hover:text-white"
              >
                Close
              </button>
            </div>
            {jsonError && (
              <div className="text-xs text-rose-400 bg-rose-950/60 border border-rose-800/80 p-2 rounded">
                ⚠️ {jsonError}
              </div>
            )}
            <textarea
              rows={12}
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono text-xs text-slate-200 focus:outline-none focus:border-rose-500"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowJsonModal(false)}
                className="px-3 py-1.5 rounded-lg text-xs bg-slate-800 text-slate-300 hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={handleImportJson}
                className="px-4 py-1.5 rounded-lg text-xs font-bold bg-rose-600 text-white hover:bg-rose-500 shadow"
              >
                Load Model
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
