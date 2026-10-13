import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  Upload,
  Layers,
  Activity,
  Sliders,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { OrigamiWorkerClient, LoadedMeshInfo, FrameEvent } from '../../engine/worker/workerClient';
import { CreasePattern2D } from './CreasePattern2D';
import { OrigamiModernCanvas } from './OrigamiModernCanvas';
import { FoldFormat } from '../../engine/types';
import {
  createMiuraOriPattern,
  createWaterbombBasePattern,
  createPreliminaryBasePattern,
} from '../../engine/fold/templates';

const SAMPLES = [
  { id: 'miura', name: 'Miura-ori (3x3, gamma=60°)', creator: () => createMiuraOriPattern(3, 3, 1, 1, 60) },
  { id: 'waterbomb', name: 'Waterbomb Base (Dual 8-Line)', creator: () => createWaterbombBasePattern(1) },
  { id: 'preliminary', name: 'Preliminary Base (Dual 8-Line)', creator: () => createPreliminaryBasePattern(1) },
];

export const ModernOrigamiApp: React.FC = () => {
  const [selectedSampleId, setSelectedSampleId] = useState<string>('miura');
  const [currentFold, setCurrentFold] = useState<FoldFormat>(() => createMiuraOriPattern(3, 3, 1, 1, 60));

  // Mesh & Physics state from Worker
  const [loadedInfo, setLoadedInfo] = useState<LoadedMeshInfo | null>(null);
  const [positions, setPositions] = useState<Float32Array | null>(null);
  const [stats, setStats] = useState<FrameEvent['stats'] | null>(null);

  // Interaction controls
  const [alpha, setAlpha] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playDirection, setPlayDirection] = useState<number>(1);
  const [showCreases, setShowCreases] = useState<boolean>(true);

  // Physical stiffness
  const [axialStiffness, setAxialStiffness] = useState<number>(40000);
  const [creaseStiffness, setCreaseStiffness] = useState<number>(40);
  const [facetStiffness, setFacetStiffness] = useState<number>(200);

  // Performance telemetry
  const [fps, setFps] = useState<number>(60);
  const [latencyMs, setLatencyMs] = useState<number>(0);
  const frameCountRef = useRef<number>(0);
  const lastFpsTimeRef = useRef<number>(performance.now());

  // Ping-pong buffers for client-side zero-allocation rendering while returning worker buffers
  const pingPongRef = useRef<{ bufA: Float32Array | null; bufB: Float32Array | null; flag: boolean }>({
    bufA: null,
    bufB: null,
    flag: false,
  });

  // Worker client ref
  const clientRef = useRef<OrigamiWorkerClient | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize Worker Client
  useEffect(() => {
    const client = new OrigamiWorkerClient();
    clientRef.current = client;

    client.onLoaded((info) => {
      setLoadedInfo(info);
      setPositions(null);
    });

    client.onFrame((frameEvent) => {
      // Profiling telemetry breakdown collection
      if (typeof window !== 'undefined') {
        const prof = ((window as any).__ORIGAMI_PROFILING__ = (window as any).__ORIGAMI_PROFILING__ || {
          workerTickDurationMs: [],
          timeBetweenWorkerPostsMs: [],
          postMessageToOnFrameMs: [],
          mainThreadBufferCopyMs: [],
          computeVertexNormalsMs: [],
          threeRenderMs: [],
          gpuTimerQueryMs: [],
          rendererInfo: { calls: 0, triangles: 0, points: 0, lines: 0, frame: 0 },
        });

        if (frameEvent.stats.postTimestamp) {
          prof.postMessageToOnFrameMs.push(performance.now() - frameEvent.stats.postTimestamp);
          if (prof.postMessageToOnFrameMs.length > 500) prof.postMessageToOnFrameMs.shift();
        }
        if (frameEvent.stats.tickDurationMs) {
          prof.workerTickDurationMs.push(frameEvent.stats.tickDurationMs);
          if (prof.workerTickDurationMs.length > 500) prof.workerTickDurationMs.shift();
        }
        if (frameEvent.stats.timeBetweenPostsMs) {
          prof.timeBetweenWorkerPostsMs.push(frameEvent.stats.timeBetweenPostsMs);
          if (prof.timeBetweenWorkerPostsMs.length > 500) prof.timeBetweenWorkerPostsMs.shift();
        }
      }

      // 1. Copy into alternating client ping-pong buffer so Three.js renders a valid, non-detached buffer
      const tCopy0 = performance.now();
      const n = frameEvent.positions.length;
      const pp = pingPongRef.current;
      if (!pp.bufA || pp.bufA.length !== n) {
        pp.bufA = new Float32Array(n);
        pp.bufB = new Float32Array(n);
      }
      const clientBuf = pp.flag ? pp.bufA! : pp.bufB!;
      pp.flag = !pp.flag;
      clientBuf.set(frameEvent.positions);
      const copyMs = performance.now() - tCopy0;

      if (typeof window !== 'undefined' && (window as any).__ORIGAMI_PROFILING__) {
        (window as any).__ORIGAMI_PROFILING__.mainThreadBufferCopyMs.push(copyMs);
        if ((window as any).__ORIGAMI_PROFILING__.mainThreadBufferCopyMs.length > 500) {
          (window as any).__ORIGAMI_PROFILING__.mainThreadBufferCopyMs.shift();
        }
      }

      setPositions(clientBuf);
      setStats(frameEvent.stats);
      setLatencyMs(frameEvent.latencyMs);

      // Measure client FPS
      frameCountRef.current++;
      const now = performance.now();
      if (now - lastFpsTimeRef.current >= 500) {
        const measured = (frameCountRef.current * 1000) / (now - lastFpsTimeRef.current);
        setFps(Math.round(measured));
        frameCountRef.current = 0;
        lastFpsTimeRef.current = now;
      }

      // 2. Return the worker's buffer back to worker thread for immediate zero-allocation recycling
      client.returnBuffer(frameEvent.positions.buffer);
    });

    client.onError((err) => {
      console.error('Worker error:', err);
    });

    // Load initial model
    client.load(currentFold, {
      axialStiffness,
      creaseStiffness,
      facetStiffness,
    });

    return () => {
      client.terminate();
      clientRef.current = null;
    };
  }, []);

  // Handle load model
  const loadFoldModel = useCallback((fold: FoldFormat) => {
    setCurrentFold(fold);
    setAlpha(0);
    setIsPlaying(false);
    clientRef.current?.load(fold, {
      axialStiffness,
      creaseStiffness,
      facetStiffness,
    });
  }, [axialStiffness, creaseStiffness, facetStiffness]);

  // Handle Alpha slider change
  const handleAlphaChange = (newAlpha: number) => {
    setAlpha(newAlpha);
    clientRef.current?.setAlpha(newAlpha);
  };

  // Play / Pause animation loop
  useEffect(() => {
    if (!isPlaying) return;

    let animId: number;
    let lastTime = performance.now();

    const loop = (time: number) => {
      const dt = (time - lastTime) / 1000;
      lastTime = time;

      setAlpha((prev) => {
        let next = prev + playDirection * dt * 0.4; // 2.5s per cycle
        if (next >= 1) {
          next = 1;
          setPlayDirection(-1);
        } else if (next <= 0) {
          next = 0;
          setPlayDirection(1);
        }
        clientRef.current?.setAlpha(next);
        return next;
      });

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, playDirection]);

  // Update stiffness settings
  const handleStiffnessUpdate = (axial: number, crease: number, facet: number) => {
    setAxialStiffness(axial);
    setCreaseStiffness(crease);
    setFacetStiffness(facet);
    clientRef.current?.setStiffness({
      axialStiffness: axial,
      creaseStiffness: crease,
      facetStiffness: facet,
    });
  };

  // File upload / Drag & Drop
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target?.result as string;
        const foldData = JSON.parse(text) as FoldFormat;
        setSelectedSampleId('custom');
        loadFoldModel(foldData);
      } catch (err) {
        alert('Failed to parse FOLD file: ' + String(err));
      }
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target?.result as string;
        const foldData = JSON.parse(text) as FoldFormat;
        setSelectedSampleId('custom');
        loadFoldModel(foldData);
      } catch (err) {
        alert('Failed to parse FOLD file: ' + String(err));
      }
    };
    reader.readAsText(file);
  };

  const isConverged = stats?.converged ?? false;
  const resForce = stats?.maxResidualForce ?? 0;

  return (
    <div
      className="flex flex-col h-full w-full bg-gray-50 text-gray-900 select-none overflow-hidden"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {/* Top Header & Presets */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200 shadow-sm z-10">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <span className="p-1.5 bg-indigo-600 text-white rounded-md font-bold text-sm">AG</span>
            <h1 className="font-bold text-base tracking-tight text-gray-900">
              Origami Fold Engine
            </h1>
            <span className="px-2 py-0.5 text-xs bg-indigo-50 text-indigo-700 font-semibold rounded-full border border-indigo-200">
              Web Worker Bar-and-Hinge
            </span>
          </div>
        </div>

        {/* Model Presets & File Picker */}
        <div className="flex items-center space-x-2">
          {SAMPLES.map((sample) => (
            <button
              key={sample.id}
              onClick={() => {
                setSelectedSampleId(sample.id);
                loadFoldModel(sample.creator());
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                selectedSampleId === sample.id
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
              }`}
            >
              {sample.name.split(' (')[0]}
            </button>
          ))}

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".fold,.json"
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition-colors border border-gray-300"
            title="Upload or Drag-and-Drop .fold file"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Load .FOLD</span>
          </button>
        </div>
      </div>

      {/* Main Dual-Viewport Area */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 p-4 min-h-0 overflow-hidden">
        {/* Left Viewport: 2D Crease Pattern */}
        <div className="flex flex-col h-full min-h-[350px]">
          <CreasePattern2D fold={currentFold} className="h-full" />
        </div>

        {/* Right Viewport: 3D Interactive Three.js Canvas */}
        <div className="relative flex flex-col h-full min-h-[350px]">
          <OrigamiModernCanvas
            indices={loadedInfo?.indices ?? null}
            positions={positions}
            creaseEdges={loadedInfo?.creaseEdges ?? []}
            showCreases={showCreases}
            className="h-full"
          />

          {/* Floating Telemetry Badge on 3D View */}
          <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg shadow-sm px-3 py-2 text-xs space-y-1">
            <div className="flex items-center justify-between space-x-4">
              <span className="text-gray-500">Render FPS:</span>
              <span className="font-mono font-semibold text-emerald-600">{fps} FPS</span>
            </div>
            <div className="flex items-center justify-between space-x-4">
              <span className="text-gray-500">Worker Latency:</span>
              <span className="font-mono font-semibold text-gray-700">{latencyMs.toFixed(1)} ms</span>
            </div>
            <div className="flex items-center justify-between space-x-4">
              <span className="text-gray-500">Physics Tick:</span>
              <span className="font-mono text-gray-700">
                {stats?.tickDurationMs ? `${stats.tickDurationMs.toFixed(2)} ms` : '-'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Controls & Physics Inspector Bar */}
      <div className="bg-white border-t border-gray-200 px-6 py-3 flex flex-col md:flex-row items-center justify-between gap-4 shadow-sm z-10">
        {/* Playback & Alpha Scrubber */}
        <div className="flex items-center space-x-4 w-full md:w-auto flex-1 max-w-2xl">
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className={`p-2.5 rounded-full transition-colors shadow-sm ${
              isPlaying
                ? 'bg-amber-500 hover:bg-amber-600 text-white'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white'
            }`}
            title={isPlaying ? 'Pause' : 'Play Fold Animation'}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>

          <button
            onClick={() => {
              handleAlphaChange(0);
              clientRef.current?.reset();
            }}
            className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
            title="Reset to Flat"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <button
            onClick={() => clientRef.current?.seedFromFlat()}
            className="flex items-center space-x-1 px-2.5 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-md border border-indigo-200 transition-colors"
            title="Apply One-Time Seed Perturbation"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
            <span>Seed Perturb</span>
          </button>

          {/* Alpha Slider with Target vs Achieved Alpha Display */}
          <div className="flex-1 flex items-center space-x-3">
            <div className="flex flex-col text-xs font-semibold text-gray-700 min-w-[130px]">
              <div>Target α: <span className="font-mono text-indigo-600">{(alpha * 100).toFixed(0)}%</span></div>
              <div className="text-[11px] text-gray-500 font-normal">
                Achieved α: <span className="font-mono text-emerald-600">{((stats?.alpha ?? 0) * 100).toFixed(1)}%</span>
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.005}
              value={alpha}
              onChange={(e) => handleAlphaChange(parseFloat(e.target.value))}
              className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            />
          </div>
        </div>

        {/* Live Convergence & Physical Status */}
        <div className="flex items-center space-x-3 text-xs">
          {/* Max Strain Badge */}
          <div className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-md">
            <span className="text-gray-500">Max Strain:</span>
            <span className={`font-mono font-semibold ${
              (stats?.maxStrain ?? 0) < 0.01 ? 'text-emerald-600' : 'text-amber-600'
            }`}>
              {((stats?.maxStrain ?? 0) * 100).toFixed(2)}%
            </span>
          </div>

          {/* Convergence Status */}
          <div className="flex items-center space-x-1.5 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-md">
            {isConverged ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-500 animate-pulse" />
            )}
            <span className="font-medium text-gray-700">
              {isConverged ? 'Equilibrium Sunk' : 'Settling...'}
            </span>
            <span className="font-mono text-gray-500">
              | Res: {resForce.toExponential(2)} N
            </span>
          </div>

          {/* Toggle Crease Overlay */}
          <label className="flex items-center space-x-1.5 cursor-pointer text-gray-700 font-medium">
            <input
              type="checkbox"
              checked={showCreases}
              onChange={(e) => setShowCreases(e.target.checked)}
              className="rounded text-indigo-600 focus:ring-indigo-500"
            />
            <span>3D Creases</span>
          </label>
        </div>
      </div>

      {/* Physics Tuning Accordion Drawer */}
      <div className="bg-gray-50 border-t border-gray-200 px-6 py-2 flex items-center justify-between text-xs text-gray-600">
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-2">
            <span>k_axial:</span>
            <input
              type="range"
              min={5000}
              max={80000}
              step={5000}
              value={axialStiffness}
              onChange={(e) => handleStiffnessUpdate(parseFloat(e.target.value), creaseStiffness, facetStiffness)}
              className="w-20 h-1.5 bg-gray-200 rounded accent-indigo-600 cursor-pointer"
            />
            <span className="font-mono">{axialStiffness}</span>
          </div>

          <div className="flex items-center space-x-2">
            <span>k_crease:</span>
            <input
              type="range"
              min={5}
              max={150}
              step={5}
              value={creaseStiffness}
              onChange={(e) => handleStiffnessUpdate(axialStiffness, parseFloat(e.target.value), facetStiffness)}
              className="w-20 h-1.5 bg-gray-200 rounded accent-indigo-600 cursor-pointer"
            />
            <span className="font-mono">{creaseStiffness}</span>
          </div>

          <div className="flex items-center space-x-2">
            <span>k_facet:</span>
            <input
              type="range"
              min={20}
              max={600}
              step={20}
              value={facetStiffness}
              onChange={(e) => handleStiffnessUpdate(axialStiffness, creaseStiffness, parseFloat(e.target.value))}
              className="w-20 h-1.5 bg-gray-200 rounded accent-indigo-600 cursor-pointer"
            />
            <span className="font-mono">{facetStiffness}</span>
          </div>
        </div>

        <div className="text-gray-400">
          Double-Buffering Zero-Copy | Pure TS Engine
        </div>
      </div>
    </div>
  );
};
