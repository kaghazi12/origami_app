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
  createSquareSheet,
} from '../../engine/fold/templates';

const SAMPLES = [
  { id: 'flat', name: 'Flat Sheet on Table', creator: () => createSquareSheet(1, 1) },
  { id: 'miura', name: 'Miura-ori (3x3)', creator: () => createMiuraOriPattern(3, 3, 1, 1, 60) },
  { id: 'waterbomb', name: 'Waterbomb Base', creator: () => createWaterbombBasePattern(1) },
  { id: 'preliminary', name: 'Preliminary Base', creator: () => createPreliminaryBasePattern(1) },
];

import { BarycentricAttachment } from '../../engine/physics/types';

export const ModernOrigamiApp: React.FC = () => {
  const [selectedSampleId, setSelectedSampleId] = useState<string>('flat');
  const [currentFold, setCurrentFold] = useState<FoldFormat>(() => createSquareSheet(1, 1));
  const [meshDensity, setMeshDensity] = useState<'121' | '441'>('121');

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

  // Phase 6: Table contact, Coulomb friction, gravity & paper stiffness
  const [enableTable, setEnableTable] = useState<boolean>(true);
  const [paperThickness, setPaperThickness] = useState<number>(0.002);
  const [enableGravity, setEnableGravity] = useState<boolean>(true);
  const [gravity, setGravity] = useState<number>(1.0);
  const [muStatic, setMuStatic] = useState<number>(0.5);
  const [muKinetic, setMuKinetic] = useState<number>(0.4);
  const [paperStiffnessPreset, setPaperStiffnessPreset] = useState<number>(50); // 0 (tissue) to 100 (card)
  const [substepsPerFrame, setSubstepsPerFrame] = useState<number>(10);

  // Phase 7: Pivot-and-drag interaction state (barycentric points + tool mode)
  const [activeTool, setActiveTool] = useState<'pivot' | 'drag'>('drag');
  const [barycentricPin, setBarycentricPin] = useState<BarycentricAttachment | null>(null);
  const [barycentricDrag, setBarycentricDrag] = useState<BarycentricAttachment | null>(null);
  const [reachRadius, setReachRadius] = useState<number | null>(null);
  const [pinnedVertices, setPinnedVertices] = useState<number[]>([]);
  const [draggedVertex, setDraggedVertex] = useState<number | null>(null);

  // Performance telemetry
  const [fps, setFps] = useState<number>(60);
  const [latencyMs, setLatencyMs] = useState<number>(0);
  const frameCountRef = useRef<number>(0);
  const lastFpsTimeRef = useRef<number>(performance.now());
  const lastTelemetryTimeRef = useRef<number>(0);

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

      // 1. Immediately update positions for fluid 3D canvas rendering
      setPositions(clientBuf);

      // 2. Coalesce UI telemetry state updates to <= 10 Hz (every 100 ms) via ref gating
      const now = performance.now();
      if (now - lastTelemetryTimeRef.current >= 100) {
        setStats(frameEvent.stats);
        setLatencyMs(frameEvent.latencyMs);
        lastTelemetryTimeRef.current = now;
      }

      // Measure client FPS
      frameCountRef.current++;
      if (now - lastFpsTimeRef.current >= 500) {
        const measured = (frameCountRef.current * 1000) / (now - lastFpsTimeRef.current);
        setFps(Math.round(measured));
        frameCountRef.current = 0;
        lastFpsTimeRef.current = now;
      }

      // 3. Return the worker's buffer back to worker thread for backpressure & zero-allocation recycling
      client.returnBuffer(frameEvent.positions.buffer);
    });

    client.onError((err) => {
      console.error('Worker error:', err);
    });

    // Load initial model
    const targetEdgeLength = meshDensity === '441' ? 0.05 : 0.10;
    const bendingCompliance = 0.05 * Math.pow(10, -4 * (paperStiffnessPreset / 100));
    client.load(
      currentFold,
      {
        axialStiffness,
        creaseStiffness,
        facetStiffness,
        targetEdgeLength,
      },
      {
        enableTable,
        tableZ: 0.0,
        paperThickness,
        enableGravity,
        gravity,
        muStatic,
        muKinetic,
        bendingCompliance,
        substeps: substepsPerFrame,
      }
    );

    return () => {
      client.terminate();
      clientRef.current = null;
    };
  }, []);

  // Handle load model
  const loadFoldModel = useCallback((fold: FoldFormat, density = meshDensity) => {
    setCurrentFold(fold);
    setAlpha(0);
    setIsPlaying(false);
    setPinnedVertices([]);
    setDraggedVertex(null);
    const targetEdgeLength = density === '441' ? 0.05 : 0.10;
    const bendingCompliance = 0.05 * Math.pow(10, -4 * (paperStiffnessPreset / 100));
    clientRef.current?.load(
      fold,
      {
        axialStiffness,
        creaseStiffness,
        facetStiffness,
        targetEdgeLength,
      },
      {
        enableTable,
        tableZ: 0.0,
        paperThickness,
        enableGravity,
        gravity,
        muStatic,
        muKinetic,
        bendingCompliance,
        substeps: substepsPerFrame,
      }
    );
  }, [axialStiffness, creaseStiffness, facetStiffness, meshDensity, paperStiffnessPreset, enableTable, paperThickness, enableGravity, gravity, muStatic, muKinetic, substepsPerFrame]);

  // Handle physics parameter updates to worker
  const updatePhysicsParams = (params: {
    enableTable?: boolean;
    paperThickness?: number;
    enableGravity?: boolean;
    gravity?: number;
    muStatic?: number;
    muKinetic?: number;
    paperStiffnessPreset?: number;
    substepsPerFrame?: number;
  }) => {
    if (params.enableTable !== undefined) setEnableTable(params.enableTable);
    if (params.paperThickness !== undefined) setPaperThickness(params.paperThickness);
    if (params.enableGravity !== undefined) setEnableGravity(params.enableGravity);
    if (params.gravity !== undefined) setGravity(params.gravity);
    if (params.muStatic !== undefined) setMuStatic(params.muStatic);
    if (params.muKinetic !== undefined) setMuKinetic(params.muKinetic);
    if (params.paperStiffnessPreset !== undefined) setPaperStiffnessPreset(params.paperStiffnessPreset);
    if (params.substepsPerFrame !== undefined) setSubstepsPerFrame(params.substepsPerFrame);

    const preset = params.paperStiffnessPreset ?? paperStiffnessPreset;
    const compliance = 0.05 * Math.pow(10, -4 * (preset / 100));

    clientRef.current?.setPhysicsParams({
      enableTable: params.enableTable ?? enableTable,
      paperThickness: params.paperThickness ?? paperThickness,
      enableGravity: params.enableGravity ?? enableGravity,
      gravity: params.gravity ?? gravity,
      muStatic: params.muStatic ?? muStatic,
      muKinetic: params.muKinetic ?? muKinetic,
      bendingCompliance: compliance,
      substeps: params.substepsPerFrame ?? substepsPerFrame,
    });
  };

  // Handle Alpha slider change
  const handleAlphaChange = (newAlpha: number) => {
    setAlpha(newAlpha);
    clientRef.current?.setAlpha(newAlpha);
  };

  // Phase 7: Pivot and Drag Handlers
  const handleTogglePin = useCallback((vIndex: number) => {
    setPinnedVertices((prev) => {
      const next = prev.includes(vIndex) ? prev.filter((p) => p !== vIndex) : [...prev, vIndex];
      clientRef.current?.setPins(next);
      return next;
    });
  }, []);

  const handleClearPins = useCallback(() => {
    setPinnedVertices([]);
    clientRef.current?.setPins([]);
  }, []);

  const handleDragStart = useCallback((vIndex: number) => {
    setDraggedVertex(vIndex);
  }, []);

  const handleDragMove = useCallback((vIndex: number, targetPos: [number, number, number]) => {
    setDraggedVertex(vIndex);
    clientRef.current?.setDrag(vIndex, targetPos);
  }, []);

  const handleSetBarycentricPin = useCallback((pin: BarycentricAttachment | null) => {
    setBarycentricPin(pin);
    if (!pin) setReachRadius(null);
    clientRef.current?.setBarycentricPins(pin ? [pin] : []);
  }, []);

  const handleClearBarycentricPin = useCallback(() => {
    setBarycentricPin(null);
    setReachRadius(null);
    clientRef.current?.setBarycentricPins([]);
  }, []);

  const handleBarycentricDragStart = useCallback((drag: BarycentricAttachment) => {
    setBarycentricDrag(drag);
    if (barycentricPin && drag.point.restU !== undefined && barycentricPin.point.restU !== undefined) {
      const reach = Math.hypot(
        drag.point.restU - barycentricPin.point.restU,
        drag.point.restV! - barycentricPin.point.restV!
      );
      setReachRadius(reach);
    }
    clientRef.current?.setBarycentricDrag(drag);
  }, [barycentricPin]);

  const handleBarycentricDragMove = useCallback((targetPos: [number, number, number]) => {
    setBarycentricDrag((prev) => {
      if (!prev) return null;
      const updated = { ...prev, targetPos };
      clientRef.current?.setBarycentricDrag(updated);
      return updated;
    });
  }, []);

  const handleBarycentricDragEnd = useCallback(() => {
    setBarycentricDrag(null);
    clientRef.current?.setBarycentricDrag(null);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClearBarycentricPin();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClearBarycentricPin]);

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
          {/* Mesh Density Selector */}
          <div className="flex items-center space-x-1 bg-gray-100 p-0.5 rounded-md border border-gray-200 mr-2">
            <button
              onClick={() => {
                setMeshDensity('121');
                loadFoldModel(currentFold, '121');
              }}
              className={`px-2 py-1 text-xs font-semibold rounded transition-colors ${
                meshDensity === '121' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              121 V
            </button>
            <button
              onClick={() => {
                setMeshDensity('441');
                loadFoldModel(currentFold, '441');
              }}
              className={`px-2 py-1 text-xs font-semibold rounded transition-colors ${
                meshDensity === '441' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              441 V
            </button>
          </div>

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

          {/* Tool selector: Pivot vs Drag */}
          <div className="flex items-center bg-gray-100 p-0.5 rounded-md border border-gray-300">
            <button
              onClick={() => setActiveTool('pivot')}
              className={`flex items-center space-x-1 px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                activeTool === 'pivot'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-gray-700 hover:bg-gray-200'
              }`}
              title="Pivot Tool: Click paper to place pivot pin P (Esc to clear)"
            >
              <span>📍 Pivot</span>
            </button>
            <button
              onClick={() => setActiveTool('drag')}
              className={`flex items-center space-x-1 px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                activeTool === 'drag'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-700 hover:bg-gray-200'
              }`}
              title="Drag Tool: Left-drag paper to pull Q with lift (Right-drag to orbit)"
            >
              <span>✋ Drag</span>
            </button>
          </div>

          {barycentricPin && (
            <button
              onClick={handleClearBarycentricPin}
              className="px-2.5 py-1 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-md border border-amber-300 transition-colors"
              title="Clear active pivot pin P (Esc)"
            >
              ✕ Clear Pin P
            </button>
          )}

          <div className="hidden xl:flex items-center space-x-1 text-[11px] text-gray-500 bg-gray-50 px-2 py-1 rounded border border-gray-200">
            <span className="font-semibold text-indigo-600">Tool:</span>
            <span>
              {activeTool === 'pivot'
                ? '📍 Click paper to set Pin P (Esc to clear)'
                : '✋ Left-drag paper to fold/lift Q (Right-drag to orbit)'}
            </span>
          </div>
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
            uvs={loadedInfo?.uvs ?? null}
            creaseEdges={loadedInfo?.creaseEdges ?? []}
            showCreases={showCreases}
            showTable={enableTable}
            paperThickness={paperThickness}
            activeTool={activeTool}
            barycentricPin={barycentricPin}
            barycentricDrag={barycentricDrag}
            reachRadius={reachRadius}
            onSetBarycentricPin={handleSetBarycentricPin}
            onBarycentricDragStart={handleBarycentricDragStart}
            onBarycentricDragMove={handleBarycentricDragMove}
            onBarycentricDragEnd={handleBarycentricDragEnd}
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
              <span className="text-gray-500">Step Time:</span>
              <span className="font-mono text-gray-700">
                {stats?.stepDurationMs ? `${stats.stepDurationMs.toFixed(2)} ms` : stats?.tickDurationMs ? `${stats.tickDurationMs.toFixed(2)} ms` : '-'}
              </span>
            </div>
            <div className="flex items-center justify-between space-x-4">
              <span className="text-gray-500">XPBD Passes:</span>
              <span className="font-mono text-gray-700">
                {stats?.iterationsPerTick ? `${stats.iterationsPerTick} passes` : '-'}
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

      {/* Physics & Table Debug Panel Drawer */}
      <div className="bg-gray-50 border-t border-gray-200 px-6 py-2.5 flex flex-wrap items-center justify-between gap-y-2 text-xs text-gray-600">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {/* Table Toggle */}
          <label className="flex items-center space-x-1.5 cursor-pointer font-medium text-gray-700">
            <input
              type="checkbox"
              checked={enableTable}
              onChange={(e) => updatePhysicsParams({ enableTable: e.target.checked })}
              className="rounded text-indigo-600 focus:ring-indigo-500"
            />
            <span>Table Contact (z &ge; thickness/2)</span>
          </label>

          {/* Thickness */}
          <div className="flex items-center space-x-1.5">
            <span className="text-gray-500">Thickness:</span>
            <input
              type="range"
              min={0.0005}
              max={0.008}
              step={0.0005}
              value={paperThickness}
              onChange={(e) => updatePhysicsParams({ paperThickness: parseFloat(e.target.value) })}
              className="w-16 h-1.5 bg-gray-200 rounded accent-indigo-600 cursor-pointer"
            />
            <span className="font-mono text-[11px]">{(paperThickness * 1000).toFixed(1)}mm</span>
          </div>

          {/* Gravity */}
          <div className="flex items-center space-x-1.5">
            <label className="flex items-center space-x-1 cursor-pointer">
              <input
                type="checkbox"
                checked={enableGravity}
                onChange={(e) => updatePhysicsParams({ enableGravity: e.target.checked })}
                className="rounded text-indigo-600"
              />
              <span className="text-gray-500">Gravity:</span>
            </label>
            <input
              type="range"
              min={0}
              max={9.8}
              step={0.5}
              value={gravity}
              onChange={(e) => updatePhysicsParams({ gravity: parseFloat(e.target.value) })}
              className="w-14 h-1.5 bg-gray-200 rounded accent-indigo-600 cursor-pointer"
            />
            <span className="font-mono text-[11px]">{gravity.toFixed(1)}</span>
          </div>

          {/* mu_static */}
          <div className="flex items-center space-x-1.5">
            <span className="text-gray-500">μ_static:</span>
            <input
              type="range"
              min={0}
              max={1.0}
              step={0.05}
              value={muStatic}
              onChange={(e) => updatePhysicsParams({ muStatic: parseFloat(e.target.value) })}
              className="w-12 h-1.5 bg-gray-200 rounded accent-indigo-600 cursor-pointer"
            />
            <span className="font-mono text-[11px]">{muStatic.toFixed(2)}</span>
          </div>

          {/* mu_kinetic */}
          <div className="flex items-center space-x-1.5">
            <span className="text-gray-500">μ_kinetic:</span>
            <input
              type="range"
              min={0}
              max={1.0}
              step={0.05}
              value={muKinetic}
              onChange={(e) => updatePhysicsParams({ muKinetic: parseFloat(e.target.value) })}
              className="w-12 h-1.5 bg-gray-200 rounded accent-indigo-600 cursor-pointer"
            />
            <span className="font-mono text-[11px]">{muKinetic.toFixed(2)}</span>
          </div>

          {/* Bending Compliance Preset Slider (Dimensionless) */}
          <div className="flex items-center space-x-1.5">
            <span className="text-gray-500">Bending Preset:</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={paperStiffnessPreset}
              onChange={(e) => updatePhysicsParams({ paperStiffnessPreset: parseInt(e.target.value, 10) })}
              className="w-16 h-1.5 bg-gray-200 rounded accent-indigo-600 cursor-pointer"
              title="Dimensionless compliance presets: Tissue (0.05) to Card (1e-5)"
            />
            <span className="font-mono text-[11px] font-medium text-indigo-700">
              {paperStiffnessPreset < 35
                ? 'Tissue (0.05)'
                : paperStiffnessPreset < 70
                ? 'Standard (0.001)'
                : 'Card (1e-5)'}
            </span>
          </div>

          {/* Substeps */}
          <div className="flex items-center space-x-1.5">
            <span className="text-gray-500">Substeps:</span>
            <input
              type="range"
              min={5}
              max={25}
              step={1}
              value={substepsPerFrame}
              onChange={(e) => updatePhysicsParams({ substepsPerFrame: parseInt(e.target.value, 10) })}
              className="w-12 h-1.5 bg-gray-200 rounded accent-indigo-600 cursor-pointer"
            />
            <span className="font-mono text-[11px]">{substepsPerFrame}</span>
          </div>
        </div>

        <div className="text-gray-400 text-[11px]">
          Table XPBD Contact | Coulomb Friction
        </div>
      </div>
    </div>
  );
};
