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
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { OrigamiWorkerClient, LoadedMeshInfo, FrameEvent } from '../../engine/worker/workerClient';
import { CreasePattern2D } from './CreasePattern2D';
import { OrigamiModernCanvas, CreasePreviewData } from './OrigamiModernCanvas';
import { FoldFormat, TriMesh } from '../../engine/types';
import { computeBisectorPlane, sliceMeshWithPlane, floodFillFlap } from '../../engine/mesh/creaseSlice';
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

function getOrigamiProfiling() {
  if (typeof window === 'undefined') return null;
  const p = ((window as any).__ORIGAMI_PROFILING__ = (window as any).__ORIGAMI_PROFILING__ || {});
  p.workerTickDurationMs = p.workerTickDurationMs || [];
  p.timeBetweenWorkerPostsMs = p.timeBetweenWorkerPostsMs || [];
  p.postMessageToOnFrameMs = p.postMessageToOnFrameMs || [];
  p.mainThreadBufferCopyMs = p.mainThreadBufferCopyMs || [];
  p.computeVertexNormalsMs = p.computeVertexNormalsMs || [];
  p.threeRenderMs = p.threeRenderMs || [];
  p.gpuTimerQueryMs = p.gpuTimerQueryMs || [];
  p.previewSlicingMs = p.previewSlicingMs || [];
  p.geometryUpdateMs = p.geometryUpdateMs || [];
  p.longTasks = p.longTasks || [];
  p.reactRenderCount = p.reactRenderCount || 0;
  p.creasePatternRenderCount = p.creasePatternRenderCount || 0;
  p.rendererInfo = p.rendererInfo || { calls: 0, triangles: 0, points: 0, lines: 0, frame: 0 };
  return p;
}

export const ModernOrigamiApp: React.FC = () => {
  const prof = getOrigamiProfiling();
  if (prof) {
    prof.reactRenderCount = (prof.reactRenderCount || 0) + 1;
  }

  // Monitor main-thread longtasks (> 50 ms) via PerformanceObserver
  useEffect(() => {
    if (typeof window !== 'undefined' && 'PerformanceObserver' in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          const p = getOrigamiProfiling();
          if (!p) return;
          for (const entry of list.getEntries()) {
            p.longTasks.push(entry.duration);
            if (p.longTasks.length > 500) p.longTasks.shift();
          }
        });
        observer.observe({ entryTypes: ['longtask'] });
        return () => observer.disconnect();
      } catch {}
    }
  }, []);

  const [selectedSampleId, setSelectedSampleId] = useState<string>('flat');
  const [currentFold, setCurrentFold] = useState<FoldFormat>(() => createSquareSheet(1, 1));
  const [meshDensity, setMeshDensity] = useState<'121' | '441'>('121');

  // Mesh & Physics state from Worker
  const [loadedInfo, setLoadedInfo] = useState<LoadedMeshInfo | null>(null);
  const [positions, setPositions] = useState<Float32Array | null>(null);
  const [stats, setStats] = useState<FrameEvent['stats'] | null>(null);

  // Phase 8: Plastic Emergent Crease Preview and Layer Selection
  const [canCommit, setCanCommit] = useState<boolean>(false);
  const canCommitRef = useRef<boolean>(false);
  const previewCreaseRef = useRef<CreasePreviewData | null>(null);
  const [foldOnlyTopLayer, setFoldOnlyTopLayer] = useState<boolean>(false);

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
  const [maxDragSpeed, setMaxDragSpeed] = useState<number>(1.0);
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

  const loadedInfoRef = useRef<LoadedMeshInfo | null>(null);
  const positionsRef = useRef<Float32Array | null>(null);

  // Worker client ref
  const clientRef = useRef<OrigamiWorkerClient | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 3D Fullscreen state & DOM ref
  const viewport3dRef = useRef<HTMLDivElement>(null);
  const [is3dFullscreen, setIs3dFullscreen] = useState<boolean>(false);

  const toggle3dFullscreen = useCallback(async () => {
    if (!is3dFullscreen) {
      if (viewport3dRef.current && document.fullscreenEnabled && !document.fullscreenElement) {
        try {
          await viewport3dRef.current.requestFullscreen();
        } catch {
          // Native fullscreen blocked or denied, fallback to CSS fullscreen
        }
      }
      setIs3dFullscreen(true);
    } else {
      if (document.fullscreenElement) {
        try {
          await document.exitFullscreen();
        } catch {}
      }
      setIs3dFullscreen(false);
    }
  }, [is3dFullscreen]);

  // Sync fullscreen state if user exits via browser native key (e.g., Esc)
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isNative = !!document.fullscreenElement;
      if (!isNative && is3dFullscreen) {
        setIs3dFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [is3dFullscreen]);

  // Initialize Worker Client
  useEffect(() => {
    const client = new OrigamiWorkerClient();
    clientRef.current = client;

    client.onLoaded((info) => {
      loadedInfoRef.current = info;
      setLoadedInfo(info);
      setPositions(null);
      if (info.bakedFold) {
        setCurrentFold(info.bakedFold);
      }
    });

    client.onFrame((frameEvent) => {
      // Profiling telemetry breakdown collection
      const prof = getOrigamiProfiling();
      if (prof) {

        if (frameEvent.stats.postTimestamp) {
          const nowAbs = (typeof performance !== 'undefined' && performance.timeOrigin)
            ? (performance.timeOrigin + performance.now())
            : Date.now();
          prof.postMessageToOnFrameMs.push(Math.max(0, nowAbs - frameEvent.stats.postTimestamp));
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
      positionsRef.current = clientBuf;
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

  const barycentricPinRef = useRef<BarycentricAttachment | null>(null);
  const barycentricDragRef = useRef<BarycentricAttachment | null>(null);

  const handleSetBarycentricPin = useCallback((pin: BarycentricAttachment | null) => {
    barycentricPinRef.current = pin;
    setBarycentricPin(pin);
    if (!pin) setReachRadius(null);
    clientRef.current?.setBarycentricPins(pin ? [pin] : []);
  }, []);

  const handleClearBarycentricPin = useCallback(() => {
    barycentricPinRef.current = null;
    setBarycentricPin(null);
    setReachRadius(null);
    clientRef.current?.setBarycentricPins([]);
  }, []);

  const dragStartPosRef = useRef<[number, number, number] | null>(null);

  const handleBarycentricDragStart = useCallback((drag: BarycentricAttachment) => {
    barycentricDragRef.current = drag;
    setBarycentricDrag(drag);
    dragStartPosRef.current = [...drag.targetPos];
    const pin = barycentricPinRef.current || barycentricPin;
    if (pin && drag.point.restU !== undefined && pin.point.restU !== undefined) {
      const reach = Math.hypot(
        drag.point.restU - pin.point.restU,
        drag.point.restV! - pin.point.restV!
      );
      setReachRadius(reach);
    }
    clientRef.current?.setBarycentricDrag(drag);
  }, [barycentricPin]);

  const handlePreviewChange = useCallback((preview: CreasePreviewData | null) => {
    previewCreaseRef.current = preview;
    const hasPreview = !!(preview && preview.segments3D.length > 0);
    if (hasPreview !== canCommitRef.current) {
      canCommitRef.current = hasPreview;
      setCanCommit(hasPreview);
    }
  }, []);

  const handleBarycentricDragMove = useCallback((targetPos: [number, number, number]) => {
    const curDrag = barycentricDragRef.current;
    if (curDrag) {
      curDrag.targetPos = targetPos;
      clientRef.current?.setBarycentricDrag(curDrag);
    }
  }, []);

  const handleBarycentricDragEnd = useCallback(() => {
    barycentricDragRef.current = null;
    dragStartPosRef.current = null;
    previewCreaseRef.current = null;
    canCommitRef.current = false;
    setCanCommit(false);
    setBarycentricDrag(null);
    clientRef.current?.setBarycentricDrag(null);
  }, []);

  const handleCommitCrease = useCallback(() => {
    const prev = previewCreaseRef.current;
    if (!prev || prev.polylinesUV.length === 0) return;
    clientRef.current?.commitCrease(
      prev.polylinesUV,
      prev.assignment,
      prev.foldAngleDeg,
      500
    );
    previewCreaseRef.current = null;
    canCommitRef.current = false;
    setCanCommit(false);
  }, []);

  const handlePressFlat = useCallback(() => {
    clientRef.current?.pressFlat(3.0);
  }, []);

  const handleUndo = useCallback(() => {
    clientRef.current?.undo();
    previewCreaseRef.current = null;
    canCommitRef.current = false;
    setCanCommit(false);
  }, []);

  const handleRedo = useCallback(() => {
    clientRef.current?.redo();
    previewCreaseRef.current = null;
    canCommitRef.current = false;
    setCanCommit(false);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (is3dFullscreen) {
          toggle3dFullscreen();
          return;
        }
        handleClearBarycentricPin();
        previewCreaseRef.current = null;
        canCommitRef.current = false;
        setCanCommit(false);
      } else if (e.key === 'c' || e.key === 'C') {
        handleCommitCrease();
      } else if (e.key === 'f' || e.key === 'F') {
        handlePressFlat();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClearBarycentricPin, handleCommitCrease, handlePressFlat, handleUndo, handleRedo, is3dFullscreen, toggle3dFullscreen]);

  useEffect(() => {
    (window as any).__ORIGAMI_TEST_API__ = {
      setPin: handleSetBarycentricPin,
      dragStart: handleBarycentricDragStart,
      dragMove: handleBarycentricDragMove,
      dragEnd: handleBarycentricDragEnd,
      commitCrease: handleCommitCrease,
      pressFlat: handlePressFlat,
      undo: handleUndo,
      redo: handleRedo,
      getPreview: () => previewCreaseRef.current,
      getFold: () => currentFold,
      foldOnlyTopLayer,
      setFoldOnlyTopLayer,
      getClient: () => clientRef.current,
      getStats: () => stats,
      getLatency: () => latencyMs,
      getPositions: () => positions,
      toggle3dFullscreen,
      is3dFullscreen,
    };
  }, [handleSetBarycentricPin, handleBarycentricDragStart, handleBarycentricDragMove, handleBarycentricDragEnd, handleCommitCrease, handlePressFlat, handleUndo, handleRedo, canCommit, currentFold, foldOnlyTopLayer, stats, latencyMs, positions, toggle3dFullscreen, is3dFullscreen]);

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

          {/* Full Screen 3D Button in Toolbar */}
          <button
            onClick={toggle3dFullscreen}
            className="flex items-center space-x-1.5 px-2.5 py-1 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 hover:text-indigo-600 rounded-md border border-gray-300 transition-colors"
            title="Toggle 3D Simulation Full Screen (Esc to exit)"
          >
            {is3dFullscreen ? (
              <>
                <Minimize2 className="w-3.5 h-3.5 text-indigo-600" />
                <span>Exit Fullscreen</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5 text-indigo-600" />
                <span>Full Screen 3D</span>
              </>
            )}
          </button>

          {barycentricPin && (
            <button
              onClick={handleClearBarycentricPin}
              className="px-2.5 py-1 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-md border border-amber-300 transition-colors"
              title="Clear active pivot pin P (Esc)"
            >
              ✕ Clear Pin P
            </button>
          )}

          {/* Emergent Crease & Plastic Actions */}
          <div className="flex items-center space-x-1 pl-2 border-l border-gray-200">
            <button
              onClick={handleCommitCrease}
              disabled={!canCommit}
              className={`flex items-center space-x-1 px-2.5 py-1 text-xs font-semibold rounded border transition-colors ${
                canCommit
                  ? 'bg-emerald-600 text-white border-emerald-700 shadow-sm'
                  : 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
              }`}
              title="Commit emergent crease line into mesh (C)"
            >
              <span>Commit Crease (C)</span>
            </button>

            <button
              onClick={handlePressFlat}
              className="px-2 py-1 text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 rounded transition-colors"
              title="Press flat to plastic yield limit ±(180°-δ) (F)"
            >
              <span>Press Flat (F)</span>
            </button>

            <button
              onClick={handleUndo}
              className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 rounded border border-gray-300 transition-colors"
              title="Undo crease split (Ctrl+Z)"
            >
              <span>Undo</span>
            </button>

            <button
              onClick={handleRedo}
              className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 rounded border border-gray-300 transition-colors"
              title="Redo crease split (Ctrl+Y)"
            >
              <span>Redo</span>
            </button>

            <button
              onClick={() => setFoldOnlyTopLayer((prev) => !prev)}
              className={`px-2 py-1 text-xs font-medium rounded border transition-colors ${
                foldOnlyTopLayer
                  ? 'bg-purple-100 text-purple-800 border-purple-300 font-semibold'
                  : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
              }`}
              title="Toggle All Layers vs Top Layer Only"
            >
              <span>{foldOnlyTopLayer ? 'Top Layer' : 'All Layers'}</span>
            </button>
          </div>

          <div className="hidden xl:flex items-center space-x-1 text-[11px] text-gray-500 bg-gray-50 px-2 py-1 rounded border border-gray-200">
            <span className="font-semibold text-indigo-600">Tool:</span>
            <span>
              {activeTool === 'pivot'
                ? '📍 Click paper to set Pin P (Esc to clear)'
                : '✋ Drag Q to preview crease (C to commit, F to press flat)'}
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
        <div
          ref={viewport3dRef}
          className={
            is3dFullscreen
              ? 'fixed inset-0 z-50 bg-slate-950 flex flex-col w-screen h-screen overflow-hidden select-none p-0'
              : 'relative flex flex-col h-full min-h-[350px]'
          }
        >
          {/* Top-left Full Screen toggle button in standard view */}
          {!is3dFullscreen && (
            <div className="absolute top-3 left-3 z-20">
              <button
                onClick={toggle3dFullscreen}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-white/90 hover:bg-white text-gray-700 hover:text-indigo-600 backdrop-blur-sm border border-gray-200 rounded-lg shadow-sm text-xs font-semibold transition-all hover:shadow cursor-pointer"
                title="Full Screen 3D Simulation (Esc to exit)"
              >
                <Maximize2 className="w-3.5 h-3.5 text-indigo-600" />
                <span>Full Screen</span>
              </button>
            </div>
          )}

          {/* Fullscreen Overlay Header Bar */}
          {is3dFullscreen && (
            <div className="absolute top-3 left-3 right-3 z-30 flex items-center justify-between pointer-events-none">
              {/* Left action pill */}
              <div className="pointer-events-auto flex items-center space-x-2 bg-slate-900/90 backdrop-blur-md border border-slate-700/80 rounded-xl px-3 py-2 shadow-xl text-xs text-slate-200">
                <span className="font-semibold text-indigo-400 flex items-center space-x-1 mr-1">
                  <Layers className="w-4 h-4" />
                  <span>3D Simulation</span>
                </span>
                <div className="h-4 w-px bg-slate-700 mx-1" />
                
                {/* Tool selector */}
                <div className="flex items-center bg-slate-800 p-0.5 rounded-lg border border-slate-700">
                  <button
                    onClick={() => setActiveTool('pivot')}
                    className={`flex items-center space-x-1 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                      activeTool === 'pivot'
                        ? 'bg-amber-600 text-white shadow-sm'
                        : 'text-slate-300 hover:bg-slate-700'
                    }`}
                    title="Pivot Tool: Click paper to place pivot pin P (Esc to clear)"
                  >
                    <span>📍 Pivot</span>
                  </button>
                  <button
                    onClick={() => setActiveTool('drag')}
                    className={`flex items-center space-x-1 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                      activeTool === 'drag'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-300 hover:bg-slate-700'
                    }`}
                    title="Drag Tool: Left-drag paper to pull Q with lift (Right-drag to orbit)"
                  >
                    <span>✋ Drag</span>
                  </button>
                </div>

                {barycentricPin && (
                  <button
                    onClick={handleClearBarycentricPin}
                    className="px-2 py-1 text-xs font-medium text-amber-300 bg-amber-950/80 hover:bg-amber-900/80 rounded-md border border-amber-700/60 transition-colors"
                    title="Clear active pivot pin P"
                  >
                    ✕ Clear Pin
                  </button>
                )}

                <div className="h-4 w-px bg-slate-700 mx-1" />

                <button
                  onClick={handleCommitCrease}
                  disabled={!canCommit}
                  className={`flex items-center space-x-1 px-2.5 py-1 text-xs font-semibold rounded-md border transition-colors ${
                    canCommit
                      ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                      : 'bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed'
                  }`}
                  title="Commit emergent crease line into mesh (C)"
                >
                  <span>Commit Crease (C)</span>
                </button>

                <button
                  onClick={handlePressFlat}
                  className="px-2 py-1 text-xs font-medium bg-blue-950/80 text-blue-300 border border-blue-700/60 hover:bg-blue-900/80 rounded-md transition-colors"
                  title="Press flat (F)"
                >
                  <span>Press Flat (F)</span>
                </button>

                <button
                  onClick={handleUndo}
                  className="px-2 py-1 text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 rounded-md border border-slate-700 transition-colors"
                  title="Undo (Ctrl+Z)"
                >
                  <span>Undo</span>
                </button>

                <button
                  onClick={handleRedo}
                  className="px-2 py-1 text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 rounded-md border border-slate-700 transition-colors"
                  title="Redo (Ctrl+Y)"
                >
                  <span>Redo</span>
                </button>
              </div>

              {/* Right pill: Telemetry badge + Exit Fullscreen button */}
              <div className="pointer-events-auto flex items-center space-x-3">
                <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700/80 rounded-xl px-3 py-1.5 shadow-xl text-xs flex items-center space-x-4 text-slate-300">
                  <div>
                    <span className="text-slate-400 mr-1.5">FPS:</span>
                    <span className="font-mono font-semibold text-emerald-400">{fps}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 mr-1.5">Latency:</span>
                    <span className="font-mono text-slate-200">{latencyMs.toFixed(1)} ms</span>
                  </div>
                  <div>
                    <span className="text-slate-400 mr-1.5">Step:</span>
                    <span className="font-mono text-slate-200">
                      {stats?.stepDurationMs ? `${stats.stepDurationMs.toFixed(2)} ms` : stats?.tickDurationMs ? `${stats.tickDurationMs.toFixed(2)} ms` : '-'}
                    </span>
                  </div>
                </div>

                <button
                  onClick={toggle3dFullscreen}
                  className="flex items-center space-x-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl shadow-xl text-xs font-semibold transition-all hover:scale-105 active:scale-95 cursor-pointer border border-indigo-400/30"
                  title="Exit Full Screen (Esc)"
                >
                  <Minimize2 className="w-4 h-4" />
                  <span>Exit Full Screen</span>
                  <span className="text-[10px] bg-indigo-700 px-1.5 py-0.5 rounded text-indigo-200 font-mono">Esc</span>
                </button>
              </div>
            </div>
          )}

          {/* Floating Bottom Playback Pill in Fullscreen Mode */}
          {is3dFullscreen && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 pointer-events-auto flex items-center space-x-3 bg-slate-900/90 backdrop-blur-md border border-slate-700/80 rounded-2xl px-5 py-2.5 shadow-2xl text-xs text-slate-200 min-w-[340px] max-w-lg">
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className={`p-2 rounded-full transition-colors shadow-sm ${
                  isPlaying
                    ? 'bg-amber-500 hover:bg-amber-600 text-white'
                    : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                }`}
                title={isPlaying ? 'Pause' : 'Play Fold Animation'}
              >
                {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
              </button>
              <button
                onClick={() => {
                  handleAlphaChange(0);
                  clientRef.current?.reset();
                }}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                title="Reset to Flat"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => clientRef.current?.seedFromFlat()}
                className="flex items-center space-x-1 px-2 py-1 text-xs font-medium text-indigo-300 bg-indigo-950/70 hover:bg-indigo-900/70 rounded-lg border border-indigo-700/50 transition-colors"
                title="Apply One-Time Seed Perturbation"
              >
                <Sparkles className="w-3 h-3 text-indigo-400" />
                <span>Perturb</span>
              </button>
              <div className="flex-1 flex items-center space-x-2">
                <span className="font-mono text-slate-400 text-[11px] min-w-[35px]">{(alpha * 100).toFixed(0)}%</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.005"
                  value={alpha}
                  onChange={(e) => handleAlphaChange(parseFloat(e.target.value))}
                  className="flex-1 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
              </div>
            </div>
          )}

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
            previewCrease={previewCreaseRef.current}
            foldOnlyTopLayer={foldOnlyTopLayer}
            onPreviewChange={handlePreviewChange}
            onSetBarycentricPin={handleSetBarycentricPin}
            onBarycentricDragStart={handleBarycentricDragStart}
            onBarycentricDragMove={handleBarycentricDragMove}
            onBarycentricDragEnd={handleBarycentricDragEnd}
            className="h-full w-full"
          />

          {/* Floating Telemetry Badge on 3D View (standard view) */}
          {!is3dFullscreen && (
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
          )}
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

          {/* Max Drag Speed (Slew Limit) */}
          <div className="flex items-center space-x-1.5">
            <span className="text-gray-500">Max Drag Speed:</span>
            <input
              type="range"
              min={0.2}
              max={3.0}
              step={0.1}
              value={maxDragSpeed}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setMaxDragSpeed(val);
                clientRef.current?.setMaxDragSpeed(val);
              }}
              className="w-14 h-1.5 bg-gray-200 rounded accent-indigo-600 cursor-pointer"
              title="Limits drag target displacement per frame to prevent shock buckling"
            />
            <span className="font-mono text-[11px]">{maxDragSpeed.toFixed(1)} m/s</span>
          </div>
        </div>

        <div className="text-gray-400 text-[11px] italic">
          Note: Paper layers will interpenetrate until collision phase is added.
        </div>
      </div>
    </div>
  );
};
