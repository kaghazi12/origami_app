import React, { useState, useMemo, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Grid3X3, RotateCcw } from 'lucide-react';
import { Header } from './components/Header';
import { OrigamiCanvas } from './components/OrigamiCanvas';
import { Scrubber } from './components/Scrubber';
import { AuthoringTool } from './components/AuthoringTool';
import {
  FoldEngine,
  type FoldModel,
  type PosedFace,
  type Locator,
} from './engine';
import {
  HALF_FOLD_MODEL,
  PRELIMINARY_FOLD_MODEL,
  SQUASH_FOLD_MODEL,
  FOLD_AND_UNFOLD_MODEL,
  LETTER_FOLD_MODEL,
  DIAGONAL_TRIANGLE_MODEL,
  QUARTER_SQUARE_MODEL,
  CUP_MODEL,
} from './models/presets';
import { CRANE_MODEL } from './models/crane';
import {
  createPaperShaderMaterial,
  PAPER_THEMES,
} from './materials/PaperShaderMaterial';

import { ModernOrigamiApp } from './components/modern/ModernOrigamiApp';

const INITIAL_MODELS: Record<string, FoldModel> = {
  [PRELIMINARY_FOLD_MODEL.id]: PRELIMINARY_FOLD_MODEL,
  [SQUASH_FOLD_MODEL.id]: SQUASH_FOLD_MODEL,
  [HALF_FOLD_MODEL.id]: HALF_FOLD_MODEL,
  [FOLD_AND_UNFOLD_MODEL.id]: FOLD_AND_UNFOLD_MODEL,
  [LETTER_FOLD_MODEL.id]: LETTER_FOLD_MODEL,
  [CRANE_MODEL.id]: CRANE_MODEL,
  [DIAGONAL_TRIANGLE_MODEL.id]: DIAGONAL_TRIANGLE_MODEL,
  [QUARTER_SQUARE_MODEL.id]: QUARTER_SQUARE_MODEL,
  [CUP_MODEL.id]: CUP_MODEL,
};

const LegacyApp: React.FC = () => {
  // Model state
  const [models, setModels] = useState<Record<string, FoldModel>>(INITIAL_MODELS);
  const [activeModelId, setActiveModelId] = useState<string>(HALF_FOLD_MODEL.id);

  // Active Model
  const currentModel = models[activeModelId] || HALF_FOLD_MODEL;

  // Active Tab
  const [activeTab, setActiveTab] = useState<'viewer' | 'author'>('viewer');

  // Animation & Scrubber state
  const [progress, setProgress] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [isLooping, setIsLooping] = useState<boolean>(true);

  // Appearance / Shader theme
  const [selectedThemeId, setSelectedThemeId] = useState<string>('vermilion');
  const [showCreaseLines, setShowCreaseLines] = useState<boolean>(true);
  const [showCuttingMat, setShowCuttingMat] = useState<boolean>(false);
  const [cameraResetTrigger, setCameraResetTrigger] = useState<number>(0);
  const [selectedFaceIds, setSelectedFaceIds] = useState<Set<string>>(new Set());

  // Instantiate FoldEngine
  const engine = useMemo(() => {
    try {
      return new FoldEngine(currentModel);
    } catch (err) {
      console.error('Error creating engine:', err);
      return new FoldEngine(HALF_FOLD_MODEL);
    }
  }, [currentModel]);

  // Reset progress when model changes
  useEffect(() => {
    setProgress(0);
    setIsPlaying(false);
    setSelectedFaceIds(new Set());
  }, [activeModelId]);

  // Compute posed faces and locator for current progress
  const posedFaces: PosedFace[] = useMemo(() => {
    try {
      return engine.poseAt(progress);
    } catch {
      return [];
    }
  }, [engine, progress]);

  const locator: Locator = useMemo(() => {
    try {
      return engine.locate(progress);
    } catch {
      return { stepIndex: 0, t: 0, step: null };
    }
  }, [engine, progress]);

  // Animation loop
  const lastTimeRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isPlaying) {
      lastTimeRef.current = null;
      return;
    }

    let animId: number;
    const animate = (time: number) => {
      if (lastTimeRef.current !== null) {
        const deltaSeconds = (time - lastTimeRef.current) / 1000;
        // 1 step per 1.5 seconds at 1x speed
        const stepRate = 0.65 * playbackSpeed;
        const nextProgress = progress + deltaSeconds * stepRate;

        if (nextProgress >= engine.stepCount) {
          if (isLooping) {
            setProgress(0);
          } else {
            setProgress(engine.stepCount);
            setIsPlaying(false);
          }
        } else {
          setProgress(nextProgress);
        }
      }
      lastTimeRef.current = time;
      animId = requestAnimationFrame(animate);
    };

    animId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, progress, engine.stepCount, playbackSpeed, isLooping]);

  // Custom Paper Shader Material
  const currentTheme = useMemo(() => {
    return PAPER_THEMES.find((t) => t.id === selectedThemeId) || PAPER_THEMES[0];
  }, [selectedThemeId]);

  const paperMaterial = useMemo(() => {
    return createPaperShaderMaterial(
      currentTheme.front,
      currentTheme.back,
      currentTheme.pattern,
    );
  }, [currentTheme]);

  // Update or add model from authoring tool
  const handleUpdateCurrentModel = (newModel: FoldModel) => {
    setModels((prev) => ({
      ...prev,
      [newModel.id]: newModel,
    }));
    setActiveModelId(newModel.id);
  };

  // Preview step from authoring tool
  const handlePreviewStep = (testModel: FoldModel) => {
    handleUpdateCurrentModel(testModel);
    // Jump to the beginning of the newly tested step
    setProgress(testModel.steps.length - 1);
    setIsPlaying(true);
  };

  const handleFaceClick = (faceId: string) => {
    setSelectedFaceIds((prev) => {
      const next = new Set(prev);
      if (next.has(faceId)) next.delete(faceId);
      else next.add(faceId);
      return next;
    });
  };

  const availableModelList = useMemo(() => {
    return Object.values(models).map((m) => ({ id: m.id, name: m.name }));
  }, [models]);

  return (
    <div className="flex flex-col w-screen h-screen overflow-hidden bg-slate-950 font-sans">
      {/* Top Header */}
      <Header
        currentModel={currentModel}
        onSelectModel={setActiveModelId}
        availableModels={availableModelList}
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        selectedThemeId={selectedThemeId}
        onSelectTheme={setSelectedThemeId}
        showCreaseLines={showCreaseLines}
        onToggleCreaseLines={() => setShowCreaseLines(!showCreaseLines)}
        showCuttingMat={showCuttingMat}
        onToggleCuttingMat={() => setShowCuttingMat(!showCuttingMat)}
      />

      {/* Main Content Area */}
      <div className="flex-1 relative flex flex-col overflow-hidden">
        {/* 3D Canvas Viewport */}
        <div className="flex-1 relative overflow-hidden">
          <OrigamiCanvas
            faces={posedFaces}
            paperMaterial={paperMaterial}
            paperWidth={currentModel.paper.width}
            paperHeight={currentModel.paper.height}
            selectedFaceIds={selectedFaceIds}
            onFaceClick={handleFaceClick}
            showCreaseLines={showCreaseLines}
            showCuttingMat={showCuttingMat}
            resetTrigger={cameraResetTrigger}
          />

          {/* Quick Floating Viewport Controls */}
          <div className="absolute top-4 right-4 z-20 flex items-center gap-2 pointer-events-auto">
            <button
              onClick={() => setCameraResetTrigger((prev) => prev + 1)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border backdrop-blur-md transition-all shadow-lg bg-slate-900/80 text-slate-300 border-slate-700/80 hover:text-white hover:bg-slate-800"
              title="Reset camera view to default position"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset View</span>
            </button>
            <button
              onClick={() => setShowCuttingMat(!showCuttingMat)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border backdrop-blur-md transition-all shadow-lg ${
                showCuttingMat
                  ? 'bg-sky-500/25 text-sky-200 border-sky-400/50 shadow-sky-500/20'
                  : 'bg-slate-900/80 text-slate-400 border-slate-700/80 hover:text-slate-200 hover:bg-slate-800'
              }`}
              title="Toggle background grid in 3D scene"
            >
              <Grid3X3 className="w-3.5 h-3.5" />
              <span>3D Grid: {showCuttingMat ? 'ON' : 'OFF'}</span>
            </button>
          </div>
        </div>

        {/* Lower Controls: Scrubber in Viewer mode, Authoring Suite in Author mode */}
        {activeTab === 'viewer' ? (
          <Scrubber
            engine={engine}
            progress={progress}
            onProgressChange={setProgress}
            isPlaying={isPlaying}
            onTogglePlay={() => setIsPlaying(!isPlaying)}
            playbackSpeed={playbackSpeed}
            onChangeSpeed={setPlaybackSpeed}
            isLooping={isLooping}
            onToggleLoop={() => setIsLooping(!isLooping)}
            locator={locator}
            activeFaceCount={posedFaces.length}
          />
        ) : (
          <AuthoringTool
            currentModel={currentModel}
            onUpdateModel={handleUpdateCurrentModel}
            onPreviewStep={handlePreviewStep}
          />
        )}
      </div>
    </div>
  );
};

export const App: React.FC = () => {
  const [engineMode, setEngineMode] = useState<'modern' | 'legacy'>(() => {
    if (typeof window !== 'undefined' && window.location.hash === '#legacy') {
      return 'legacy';
    }
    return 'modern';
  });

  useEffect(() => {
    const handleHashChange = () => {
      if (window.location.hash === '#legacy') setEngineMode('legacy');
      else setEngineMode('modern');
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-900 text-slate-100">
      {/* Top Engine Route Switcher Bar */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-slate-950 border-b border-slate-800 text-xs z-50">
        <div className="flex items-center space-x-2">
          <span className="font-bold tracking-wider text-slate-300">ENGINE ARCHITECTURE:</span>
          <div className="inline-flex p-0.5 bg-slate-900 rounded-lg border border-slate-800">
            <button
              onClick={() => {
                setEngineMode('modern');
                window.location.hash = '#modern';
              }}
              className={`px-3 py-1 font-semibold rounded-md transition-all ${
                engineMode === 'modern'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Phase 5 Modern Engine (Web Worker + Bar-and-Hinge)
            </button>
            <button
              onClick={() => {
                setEngineMode('legacy');
                window.location.hash = '#legacy';
              }}
              className={`px-3 py-1 font-semibold rounded-md transition-all ${
                engineMode === 'legacy'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Legacy Preset Viewer
            </button>
          </div>
        </div>

        <div className="text-[11px] text-slate-500">
          Route: <code className="text-slate-400">{engineMode === 'legacy' ? '#legacy' : '#modern'}</code>
        </div>
      </div>

      {/* Main Container */}
      <div className="flex-1 w-full h-full min-h-0 overflow-hidden">
        {engineMode === 'modern' ? <ModernOrigamiApp /> : <LegacyApp />}
      </div>
    </div>
  );
};

export default App;
