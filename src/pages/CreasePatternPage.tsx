import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  ArrowDownToLine,
  ChevronDown,
  FileUp,
  FoldVertical,
  Hand,
  MapPin,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  LocateFixed,
  Undo2,
  X,
} from 'lucide-react';
import { OrigamiWorkerClient, LoadedMeshInfo, FrameEvent } from '../engine/worker/workerClient';
import { OrigamiModernCanvas, CreasePreviewData } from '../components/modern/OrigamiModernCanvas';
import { FoldFormat } from '../engine/types';
import { BarycentricAttachment } from '../engine/physics/types';
import { isFoldedForm, unfoldFoldedForm } from '../engine/fold/unfold';
import { prepareFold, type FoldReport } from '../engine/fold/prepare';
import { TopBar } from '../components/shell/TopBar';
import { Button, IconButton } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { Picker, type PickerItem } from '../components/ui/Picker';
import { MiniSlider, Scrubber } from '../components/ui/Scrubber';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { ShortcutsButton, isTypingTarget } from '../components/ui/ShortcutsButton';
import { Switch } from '../components/ui/Switch';
import { CreaseThumbnail } from '../components/ui/Thumbnails';
import { useToast } from '../components/ui/Toast';
import { cn } from '../components/ui/cn';
import { DEFAULT_PATTERN_ID, PATTERNS, patternById } from '../designs';
import { usePageTitle } from '../router';

/** A flat crease pattern for thumbnails; folded forms are unfolded first. */
function flatPattern(fold: FoldFormat | null): FoldFormat | null {
  if (!fold) return null;
  if (!isFoldedForm(fold)) return fold;
  try {
    return unfoldFoldedForm(fold).fold;
  } catch {
    return null;
  }
}

const PICKER_ITEMS: PickerItem[] = PATTERNS.map((p) => ({
  id: p.id,
  title: p.title,
  meta: p.meta,
  group: p.group,
  thumbnail: (
    <CreaseThumbnail
      fold={flatPattern(p.create())}
      className="size-full rounded-sm border border-line"
      weight={0.75}
    />
  ),
}));

const SHORTCUTS = [
  { keys: ['Space'], label: 'Play or pause' },
  { keys: ['C'], label: 'Make the previewed crease' },
  { keys: ['F'], label: 'Press flat' },
  { keys: ['Ctrl', 'Z'], label: 'Undo' },
  { keys: ['Ctrl', 'Y'], label: 'Redo' },
  { keys: ['Esc'], label: 'Clear pin, exit full screen' },
];

/** One labelled setting in the developer panel. */
const DevRow: React.FC<{ label: string; value?: React.ReactNode; children?: React.ReactNode }> = ({ label, value, children }) => (
  <div className="space-y-1.5">
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-ink-muted">{label}</span>
      {value !== undefined && <span className="font-mono tabular-nums text-ink">{value}</span>}
    </div>
    {children}
  </div>
);

const Stat: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-baseline justify-between gap-2 text-xs">
    <dt className="text-ink-muted">{label}</dt>
    <dd className="font-mono tabular-nums text-ink">{value}</dd>
  </div>
);

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

/**
 * Plain-language findings about the open file: what the pattern can't do (so the model can't look
 * like the file says) and what was repaired on load.
 */
const FileCheck: React.FC<{
  report: FoldReport;
  exact?: { active: boolean; available: boolean; reason?: string };
  folding: boolean;
}> = ({ report, exact, folding }) => {
  const impossible = report.issues.filter((i) => i.kind === 'impossible');
  const repaired = report.issues.filter((i) => i.kind === 'repaired');
  const notes = report.issues.filter((i) => i.kind === 'note');
  // The exact folder's verdict, when the file didn't already explain it
  let angleProblem: string | null = null;
  if (!folding && exact && !exact.available && exact.reason && impossible.length === 0) {
    if (exact.reason.includes('tear')) {
      angleProblem = report.flatTarget
        ? 'The creases can’t all fold flat at once without tearing the paper.'
        : 'The fold angles in this file don’t fit together: no shape has every crease at its angle without bending or tearing the paper.';
    } else if (exact.reason.includes('stacking')) {
      angleProblem = 'There is no order of layers that lets this pattern lie flat without paper passing through paper.';
    }
  }
  if (!impossible.length && !repaired.length && !notes.length && !angleProblem) {
    return (
      <div className="space-y-2 border-t border-line px-5 py-5">
        <h2 className="text-sm font-semibold text-ink">File check</h2>
        <p className="text-xs leading-relaxed text-ink-muted">No problems found.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3 border-t border-line px-5 py-5">
      <h2 className="text-sm font-semibold text-ink">File check</h2>
      {impossible.map((i) => (
        <Callout key={i.title} title={i.title}>
          {i.detail}
        </Callout>
      ))}
      {angleProblem && (
        <Callout title="The model can’t match this file exactly.">
          {angleProblem} It is folded as close as the paper allows.
        </Callout>
      )}
      {repaired.map((i) => (
        <Callout key={i.title} tone="info" title={i.title}>
          {i.detail}
        </Callout>
      ))}
      {notes.map((i) => (
        <p key={i.title} className="text-xs leading-relaxed text-ink-muted">
          {i.title}
        </p>
      ))}
    </div>
  );
};

export const CreasePatternPage: React.FC = () => {
  const toast = useToast();
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

  const [selectedSampleId, setSelectedSampleId] = useState<string>(DEFAULT_PATTERN_ID);
  const [initial] = useState(() => prepareFold(patternById(DEFAULT_PATTERN_ID)!.create()));
  const [currentFold, setCurrentFold] = useState<FoldFormat>(initial.fold);
  /** What prepareFold found in the open file: repairs, and what the pattern can't do. */
  const [report, setReport] = useState<FoldReport>(initial.report);
  /** Title and details of what's open: the bundled entry, or the uploaded file's own metadata. */
  const [fileName, setFileName] = useState<string | null>(null);
  const [folding, setFolding] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
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
  const [enableTable, setEnableTable] = useState<boolean>(false);
  const [paperThickness, setPaperThickness] = useState<number>(0.002);
  const [enableGravity, setEnableGravity] = useState<boolean>(false);
  const [gravity, setGravity] = useState<number>(1.0);
  const [muStatic, setMuStatic] = useState<number>(0.5);
  const [muKinetic, setMuKinetic] = useState<number>(0.4);
  const [paperStiffnessPreset, setPaperStiffnessPreset] = useState<number>(50); // 0 (tissue) to 100 (card)
  const [substepsPerFrame, setSubstepsPerFrame] = useState<number>(20);
  const [enableSelfCollision, setEnableSelfCollision] = useState<boolean>(true);
  // Complex crease patterns: fold exactly instead of simulating ('auto' = when the pattern is complex)
  const [exactFoldMode, setExactFoldMode] = useState<'auto' | 'on' | 'off'>('auto');
  // The 2D crease pattern is hidden by default so the 3D model gets the full width
  const [showPattern2D, setShowPattern2D] = useState<boolean>(false);
  // Frame the camera on the folded model the first time a fold finishes after loading
  const [fitModelKey, setFitModelKey] = useState(0);
  const autoFittedRef = useRef(false);
  const exactFoldModeRef = useRef<'auto' | 'on' | 'off'>('auto');

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
      setFolding(false);
      autoFittedRef.current = false;
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
      // coalesce to 10 Hz, but never drop the frame that says the paper stopped
      if (now - lastTelemetryTimeRef.current >= 100 || frameEvent.stats.converged) {
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

    client.onStateChanged(({ alpha: a }) => {
      setAlpha(a);
      setIsPlaying(false);
    });

    client.onError((err) => {
      console.error('Worker error:', err);
      setFolding(false);
      toast.show({ tone: 'error', title: 'The fold engine stopped', detail: 'Try opening the design again. Details are in the browser console.' });
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
        enableSelfCollision,
      },
      exactFoldModeRef.current
    );

    return () => {
      client.terminate();
      clientRef.current = null;
    };
  }, []);

  // Handle load model
  const loadFoldModel = useCallback((input: FoldFormat, density = meshDensity) => {
    // A FOLD file may give the folded (3D) form instead of the crease pattern: unfold it into the
    // flat sheet with a fold angle per crease, then fold that back like any other pattern.
    let fold = input;
    if (isFoldedForm(input)) {
      try {
        fold = unfoldFoldedForm(input).fold;
      } catch (err) {
        toast.show({ tone: 'error', title: 'This folded form can’t be unfolded', detail: (err as Error).message });
        return;
      }
    }
    setCurrentFold(fold);
    setFolding(true);
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
        enableSelfCollision,
      },
      exactFoldModeRef.current
    );
  }, [axialStiffness, creaseStiffness, facetStiffness, meshDensity, paperStiffnessPreset, enableTable, paperThickness, enableGravity, gravity, muStatic, muKinetic, substepsPerFrame, enableSelfCollision]);

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
    enableSelfCollision?: boolean;
  }) => {
    if (params.enableTable !== undefined) setEnableTable(params.enableTable);
    if (params.paperThickness !== undefined) setPaperThickness(params.paperThickness);
    if (params.enableGravity !== undefined) setEnableGravity(params.enableGravity);
    if (params.gravity !== undefined) setGravity(params.gravity);
    if (params.muStatic !== undefined) setMuStatic(params.muStatic);
    if (params.muKinetic !== undefined) setMuKinetic(params.muKinetic);
    if (params.paperStiffnessPreset !== undefined) setPaperStiffnessPreset(params.paperStiffnessPreset);
    if (params.substepsPerFrame !== undefined) setSubstepsPerFrame(params.substepsPerFrame);
    if (params.enableSelfCollision !== undefined) setEnableSelfCollision(params.enableSelfCollision);

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
      enableSelfCollision: params.enableSelfCollision ?? enableSelfCollision,
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
      if (isTypingTarget(e.target)) return;
      if (e.key === ' ' && !e.ctrlKey && !e.metaKey) {
        if ((e.target as HTMLElement)?.tagName === 'BUTTON') return;
        e.preventDefault();
        setIsPlaying((p) => !p);
        return;
      }
      if (e.key === 'Escape') {
        if (is3dFullscreen) {
          toggle3dFullscreen();
          return;
        }
        handleClearBarycentricPin();
        previewCreaseRef.current = null;
        canCommitRef.current = false;
        setCanCommit(false);
      } else if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey) {
        handleCommitCrease();
      } else if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey) {
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

  // Opening files: the picker's file button, or a drop anywhere on the page
  const openFile = useCallback(
    (file: File) => {
      file
        .text()
        .then((text) => {
          let data: unknown;
          try {
            data = JSON.parse(text);
          } catch {
            toast.show({ tone: 'error', title: `Couldn’t read ${file.name}`, detail: 'The file isn’t valid JSON. Crease pattern mode opens FOLD files (.fold).' });
            return;
          }
          let prepared: ReturnType<typeof prepareFold>;
          try {
            prepared = prepareFold(data);
          } catch (err) {
            toast.show({ tone: 'error', title: `${file.name} can’t be opened`, detail: (err as Error).message });
            return;
          }
          setSelectedSampleId('custom');
          setFileName(file.name);
          setReport(prepared.report);
          loadFoldModel(prepared.fold);
        })
        .catch(() => toast.show({ tone: 'error', title: `Couldn’t open ${file.name}` }));
    },
    [loadFoldModel, toast],
  );

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) openFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) openFile(file);
  };

  const chooseSample = (id: string) => {
    const entry = patternById(id);
    if (!entry) return;
    let prepared: ReturnType<typeof prepareFold>;
    try {
      prepared = prepareFold(entry.create());
    } catch (err) {
      toast.show({ tone: 'error', title: `${entry.title} can’t be opened`, detail: (err as Error).message });
      return;
    }
    setSelectedSampleId(id);
    setFileName(null);
    setReport(prepared.report);
    loadFoldModel(prepared.fold);
  };

  const isConverged = stats?.converged ?? false;

  useEffect(() => {
    if (autoFittedRef.current || !stats) return;
    const settled = stats.converged && (stats.targetAlpha ?? 0) >= 0.85 && Math.abs(stats.alpha - (stats.targetAlpha ?? 0)) < 1e-3;
    if (settled) {
      autoFittedRef.current = true;
      setFitModelKey((k) => k + 1);
    }
  }, [stats]);
  const resForce = stats?.maxResidualForce ?? 0;

  const entry = selectedSampleId !== 'custom' ? patternById(selectedSampleId) : undefined;
  const info = { file_author: report.author, file_description: report.description };
  const title = entry?.title ?? report.title ?? fileName ?? 'Untitled pattern';
  usePageTitle(title);
  const flat = useMemo(() => flatPattern(currentFold), [currentFold]);
  const creaseTotal = useMemo(
    () => (flat?.edges_assignment ?? []).filter((a) => a === 'M' || a === 'V').length,
    [flat],
  );
  const exact = loadedInfo?.exact;
  const settling = !!stats && !isConverged && !folding;

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden bg-canvas"
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
      }}
      onDrop={handleDrop}
    >
      <TopBar route="creasePattern">
        <Picker
          className="w-40 sm:w-64"
          label="Crease pattern"
          items={PICKER_ITEMS}
          value={selectedSampleId === 'custom' ? null : selectedSampleId}
          fallbackTitle={fileName ?? undefined}
          onChange={chooseSample}
          footer={
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-muted hover:bg-sunken hover:text-ink"
            >
              <FileUp className="size-4" strokeWidth={1.75} /> Open a .fold file…
            </button>
          }
        />
        <div className="hidden lg:block">
          <Button icon={FileUp} onClick={() => fileInputRef.current?.click()}>
            Open file
          </Button>
        </div>
        <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".fold,.json" className="hidden" />
        <div className="hidden sm:block">
          <ShortcutsButton shortcuts={SHORTCUTS} />
        </div>
      </TopBar>

      <div className="flex min-h-0 flex-1">
        {/* sidebar: what's open, its pattern, and the developer panel */}
        <aside className="hidden w-72 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface md:flex">
          <div className="px-5 pb-5 pt-6">
            <h1 className="font-display text-2xl leading-tight text-ink">{title}</h1>
            <p className="mt-1.5 text-xs text-ink-muted">
              {[info.file_author, creaseTotal ? `${creaseTotal.toLocaleString()} creases` : null].filter(Boolean).join(' · ') ||
                'Crease pattern'}
            </p>
            {info.file_description && (
              <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-ink-muted">{info.file_description}</p>
            )}
          </div>

          <div className="border-t border-line px-5 py-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Crease pattern</h2>
              <button
                type="button"
                onClick={() => setShowPattern2D((v) => !v)}
                className="hidden rounded-sm text-xs font-medium text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 lg:block"
              >
                {showPattern2D ? 'Hide beside model' : 'Show beside model'}
              </button>
            </div>
            <div className="mt-3 aspect-square w-full rounded-md border border-line bg-surface-raised p-3">
              <CreaseThumbnail
                fold={flat}
                className="size-full"
                weight={1}
                creasesOnly={creaseTotal > 400}
                title={`Crease pattern of ${title}`}
              />
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted" aria-label="Legend">
              <li className="flex items-center gap-1.5">
                <svg width="16" height="4" aria-hidden="true">
                  <line x1="0" y1="2" x2="16" y2="2" className="stroke-mountain" strokeWidth="1.5" />
                </svg>
                Mountain
              </li>
              <li className="flex items-center gap-1.5">
                <svg width="16" height="4" aria-hidden="true">
                  <line x1="0" y1="2" x2="16" y2="2" className="stroke-valley" strokeWidth="1.5" strokeDasharray="3 2" />
                </svg>
                Valley
              </li>
              <li className="flex items-center gap-1.5">
                <svg width="16" height="4" aria-hidden="true">
                  <line x1="0" y1="2" x2="16" y2="2" className="stroke-ink" strokeWidth="2" />
                </svg>
                Paper edge
              </li>
            </ul>
          </div>

          <div className="space-y-4 border-t border-line px-5 py-5">
            <h2 className="text-sm font-semibold text-ink">View</h2>
            <Switch label="Show creases on the model" checked={showCreases} onChange={setShowCreases} />
            {exact && (
              <p className="text-xs leading-relaxed text-ink-muted">
                {exact.active
                  ? exact.layers && exact.layers > 1
                    ? `Folded exactly, ${exact.layers.toLocaleString()} layers. Grab the paper to loosen it.`
                    : 'Folded exactly to the angles in the file. Grab the paper to bend it.'
                  : 'Folded by simulation. Grab and pull the paper to shape it.'}
              </p>
            )}
          </div>

          {/* what's wrong with the file, and what was repaired */}
          <FileCheck report={report} exact={exact} folding={folding} />

          {/* developer panel: engine settings and numbers, hidden by default */}
          <div className="mt-auto border-t border-line">
            <button
              type="button"
              aria-expanded={devOpen}
              onClick={() => setDevOpen((o) => !o)}
              className="flex w-full items-center justify-between px-5 py-3.5 text-sm font-medium text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
            >
              Developer
              <ChevronDown className={cn('size-4 transition-transform duration-150', devOpen && 'rotate-180')} strokeWidth={1.75} />
            </button>
            {devOpen && (
              <div className="space-y-6 px-5 pb-6">
                <dl className="space-y-1.5 rounded-md bg-sunken px-3 py-2.5">
                  <Stat label="Render" value={`${fps} fps`} />
                  <Stat label="Worker latency" value={`${latencyMs.toFixed(1)} ms`} />
                  <Stat
                    label="Step time"
                    value={
                      stats?.stepDurationMs
                        ? `${stats.stepDurationMs.toFixed(2)} ms`
                        : stats?.tickDurationMs
                          ? `${stats.tickDurationMs.toFixed(2)} ms`
                          : '–'
                    }
                  />
                  <Stat label="XPBD passes" value={stats?.iterationsPerTick ?? '–'} />
                  <Stat label="Max strain" value={`${((stats?.maxStrain ?? 0) * 100).toFixed(2)}%`} />
                  <Stat label="Residual force" value={`${resForce.toExponential(2)} N`} />
                  <Stat label="Fold, achieved" value={`${((stats?.alpha ?? 0) * 100).toFixed(1)}%`} />
                  <Stat label="Vertices" value={loadedInfo?.numVertices ?? '–'} />
                  {exact?.timeMs !== undefined && <Stat label="Exact fold time" value={`${exact.timeMs.toFixed(0)} ms`} />}
                </dl>

                <DevRow label="Exact folding">
                  <SegmentedControl<'auto' | 'on' | 'off'>
                    label="Exact folding"
                    size="sm"
                    className="w-full"
                    value={exactFoldMode}
                    onChange={(mode) => {
                      setExactFoldMode(mode);
                      exactFoldModeRef.current = mode;
                      setAlpha(0);
                      setIsPlaying(false);
                      clientRef.current?.setExactFold(mode);
                    }}
                    segments={[
                      { value: 'auto', label: 'Auto' },
                      { value: 'on', label: 'On' },
                      { value: 'off', label: 'Physics' },
                    ]}
                  />
                  {exact && !exact.active && exact.reason && <p className="text-xs text-ink-muted">{exact.reason}</p>}
                </DevRow>

                <DevRow label="Mesh density">
                  <SegmentedControl<'121' | '441'>
                    label="Mesh density"
                    size="sm"
                    className="w-full"
                    value={meshDensity}
                    onChange={(d) => {
                      setMeshDensity(d);
                      loadFoldModel(currentFold, d);
                    }}
                    segments={[
                      { value: '121', label: 'Normal' },
                      { value: '441', label: 'Fine' },
                    ]}
                  />
                </DevRow>

                <div className="space-y-3">
                  <Switch
                    label="Self-collision"
                    checked={enableSelfCollision}
                    onChange={(v) => updatePhysicsParams({ enableSelfCollision: v })}
                  />
                  <Switch label="Table contact" checked={enableTable} onChange={(v) => updatePhysicsParams({ enableTable: v })} />
                  <Switch label="Gravity" checked={enableGravity} onChange={(v) => updatePhysicsParams({ enableGravity: v })} />
                  <Switch label="Fold only the top layer" checked={foldOnlyTopLayer} onChange={setFoldOnlyTopLayer} />
                </div>

                {enableGravity && (
                  <DevRow label="Gravity" value={gravity.toFixed(1)}>
                    <MiniSlider label="Gravity" min={0} max={9.8} step={0.5} value={gravity} onChange={(v) => updatePhysicsParams({ gravity: v })} />
                  </DevRow>
                )}
                <DevRow label="Paper thickness" value={`${(paperThickness * 1000).toFixed(1)} mm`}>
                  <MiniSlider
                    label="Paper thickness"
                    min={0.0005}
                    max={0.008}
                    step={0.0005}
                    value={paperThickness}
                    onChange={(v) => updatePhysicsParams({ paperThickness: v })}
                  />
                </DevRow>
                <DevRow label="Paper stiffness" value={paperStiffnessPreset < 35 ? 'Tissue' : paperStiffnessPreset < 70 ? 'Standard' : 'Card'}>
                  <MiniSlider
                    label="Paper stiffness"
                    min={0}
                    max={100}
                    step={1}
                    value={paperStiffnessPreset}
                    onChange={(v) => updatePhysicsParams({ paperStiffnessPreset: Math.round(v) })}
                  />
                </DevRow>
                <DevRow label="Static friction" value={muStatic.toFixed(2)}>
                  <MiniSlider label="Static friction" min={0} max={1} step={0.05} value={muStatic} onChange={(v) => updatePhysicsParams({ muStatic: v })} />
                </DevRow>
                <DevRow label="Kinetic friction" value={muKinetic.toFixed(2)}>
                  <MiniSlider label="Kinetic friction" min={0} max={1} step={0.05} value={muKinetic} onChange={(v) => updatePhysicsParams({ muKinetic: v })} />
                </DevRow>
                <DevRow label="Substeps per frame" value={substepsPerFrame}>
                  <MiniSlider
                    label="Substeps per frame"
                    min={5}
                    max={25}
                    step={1}
                    value={substepsPerFrame}
                    onChange={(v) => updatePhysicsParams({ substepsPerFrame: Math.round(v) })}
                  />
                </DevRow>
                <DevRow label="Max drag speed" value={`${maxDragSpeed.toFixed(1)} m/s`}>
                  <MiniSlider
                    label="Max drag speed"
                    min={0.2}
                    max={3}
                    step={0.1}
                    value={maxDragSpeed}
                    onChange={(v) => {
                      setMaxDragSpeed(v);
                      clientRef.current?.setMaxDragSpeed(v);
                    }}
                  />
                </DevRow>
                <Button size="sm" className="w-full" onClick={() => clientRef.current?.seedFromFlat()}>
                  Nudge the flat sheet
                </Button>
              </div>
            )}
          </div>
        </aside>

        {/* viewer + transport; this whole column goes full screen */}
        <main ref={viewport3dRef} className={cn('flex min-w-0 flex-1 flex-col bg-viewer', is3dFullscreen && 'fixed inset-0 z-50')}>
          <div className={cn('relative grid min-h-0 flex-1', showPattern2D && 'lg:grid-cols-2')}>
            {showPattern2D && (
              <div className="hidden items-center justify-center border-r border-line bg-surface p-8 lg:flex">
                <CreaseThumbnail
                  fold={flat}
                  className="aspect-square max-h-full w-full max-w-xl"
                  weight={1.25}
                  creasesOnly={creaseTotal > 400}
                  title={`Crease pattern of ${title}`}
                />
              </div>
            )}

            <div className="relative min-h-0">
              {folding && (
                <div className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden" role="progressbar" aria-label="Folding">
                  <div className="h-full w-2/5 animate-progress bg-accent" />
                </div>
              )}

              <OrigamiModernCanvas
                indices={loadedInfo?.indices ?? null}
                positions={positions}
                uvs={loadedInfo?.uvs ?? null}
                creaseEdges={loadedInfo?.creaseEdges ?? []}
                showCreases={showCreases}
                showTable={false}
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
                fitModelKey={fitModelKey}
              />

              {folding && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className="rounded-md bg-surface-raised px-3 py-1.5 text-sm text-ink-muted shadow-float">Folding…</span>
                </div>
              )}

              {/* tools */}
              <div className="absolute left-4 top-4 flex items-center gap-1 rounded-lg border border-line bg-surface-raised p-0.5 shadow-float">
                <SegmentedControl<'drag' | 'pivot'>
                  label="Tool"
                  value={activeTool}
                  onChange={setActiveTool}
                  className="bg-transparent"
                  segments={[
                    {
                      value: 'drag',
                      title: 'Grab',
                      label: (
                        <>
                          <Hand className="size-4" strokeWidth={1.75} />
                          <span className="hidden sm:inline">Grab</span>
                        </>
                      ),
                    },
                    {
                      value: 'pivot',
                      title: 'Pin',
                      label: (
                        <>
                          <MapPin className="size-4" strokeWidth={1.75} />
                          <span className="hidden sm:inline">Pin</span>
                        </>
                      ),
                    },
                  ]}
                />
                {barycentricPin && (
                  <Button variant="ghost" icon={X} onClick={handleClearBarycentricPin}>
                    Clear pin
                  </Button>
                )}
                <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-line" />
                <IconButton label="Make crease" shortcut="C" icon={FoldVertical} onClick={handleCommitCrease} disabled={!canCommit} />
                <IconButton label="Press flat" shortcut="F" icon={ArrowDownToLine} onClick={handlePressFlat} />
                <IconButton label="Undo" shortcut="Ctrl Z" icon={Undo2} onClick={handleUndo} />
                <IconButton label="Redo" shortcut="Ctrl Y" icon={Redo2} onClick={handleRedo} />
              </div>

              <div className="absolute right-4 top-4 flex items-center gap-0.5 rounded-lg border border-line bg-surface-raised p-0.5 shadow-float">
                <IconButton label="Fit to model" icon={LocateFixed} onClick={() => setFitModelKey((k) => k + 1)} />
                <IconButton
                  label={is3dFullscreen ? 'Exit full screen' : 'Full screen'}
                  shortcut={is3dFullscreen ? 'Esc' : undefined}
                  icon={is3dFullscreen ? Minimize2 : Maximize2}
                  onClick={toggle3dFullscreen}
                />
              </div>

              <p className="pointer-events-none absolute bottom-4 left-4 right-4 hidden text-xs text-ink-muted sm:block">
                {activeTool === 'pivot'
                  ? 'Click the paper to pin a point. Esc clears it.'
                  : canCommit
                    ? 'Release to let go, or press C to make this crease.'
                    : 'Drag the paper to pull it · Right-drag to turn the view · Double-click to fit'}
              </p>

              {dragOver && (
                <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-valley bg-surface/80">
                  <span className="text-sm font-medium text-ink">Drop a .fold file to open it</span>
                </div>
              )}
            </div>
          </div>

          {/* transport */}
          <div className="flex h-14 shrink-0 items-center justify-center border-t border-line bg-surface px-4">
            <div className="flex w-full max-w-3xl items-center gap-3">
              <div className="flex items-center gap-1">
                <IconButton
                  label={isPlaying ? 'Pause' : 'Play'}
                  shortcut="Space"
                  icon={isPlaying ? Pause : Play}
                  variant="primary"
                  tooltipSide="top"
                  onClick={() => setIsPlaying(!isPlaying)}
                />
                <IconButton
                  label="Back to flat"
                  icon={RotateCcw}
                  tooltipSide="top"
                  onClick={() => {
                    setIsPlaying(false);
                    handleAlphaChange(0);
                    clientRef.current?.reset();
                  }}
                />
              </div>
              <span className="hidden w-24 shrink-0 text-right text-xs tabular-nums text-ink-muted sm:inline">Folded {(alpha * 100).toFixed(0)}%</span>
              <Scrubber
                label="Fold amount"
                valueText={`${(alpha * 100).toFixed(0)} percent folded`}
                value={alpha}
                max={1}
                step={0.005}
                onChange={(v) => {
                  setIsPlaying(false);
                  handleAlphaChange(v);
                }}
              />
              <span
                className={cn('hidden w-20 shrink-0 items-center gap-1.5 text-xs text-ink-muted sm:flex', !settling && 'invisible')}
                aria-live="polite"
              >
                <span aria-hidden="true" className="size-1.5 rounded-full bg-ink-faint" />
                Settling…
              </span>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};
