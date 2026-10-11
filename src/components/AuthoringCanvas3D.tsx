import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { TrackballControls } from '@react-three/drei';
import type { TrackballControls as TrackballControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { PaperMesh } from './PaperMesh';
import { createPaperShaderMaterial } from '../materials/PaperShaderMaterial';
import {
  FoldEngine,
  type Face,
  type FoldSide,
  type FoldKind,
  type FoldModel,
  type PosedFace,
  type Vec2,
} from '../engine';
import {
  RotateCcw,
  Play,
  Pause,
  Crosshair,
  Layers,
  ArrowRight,
  Trash2,
} from 'lucide-react';

export interface AuthoringCanvas3DProps {
  faces: readonly Face[];
  paperWidth: number;
  paperHeight: number;
  creaseFrom: Vec2 | null;
  creaseTo: Vec2 | null;
  onCreaseChange: (from: Vec2 | null, to: Vec2 | null) => void;
  movingSide: FoldSide;
  foldKind: FoldKind;
  foldAngle: number;
  selectedFaceIds: Set<string>;
  onToggleFaceSelect: (faceId: string) => void;
  isSpecificFaceMode: boolean;
  validationError: string | null;
  testModel?: FoldModel | null;
  activePickingTarget?: 'from' | 'to' | 'auto' | null;
  onActivePickingTargetChange?: (target: 'from' | 'to' | 'auto') => void;
}

/** 3D Solid Rod for the fold axis */
const RodMesh: React.FC<{
  p0: [number, number, number];
  p1: [number, number, number];
  radius?: number;
  color?: string;
}> = ({ p0, p1, radius = 0.009, color = '#f59e0b' }) => {
  const { position, quaternion, length } = useMemo(() => {
    const v0 = new THREE.Vector3(...p0);
    const v1 = new THREE.Vector3(...p1);
    const dir = new THREE.Vector3().subVectors(v1, v0);
    const len = dir.length();
    const pos = new THREE.Vector3().addVectors(v0, v1).multiplyScalar(0.5);
    const quat = new THREE.Quaternion();
    if (len > 1e-5) {
      dir.normalize();
      quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    }
    return { position: pos, quaternion: quat, length: Math.max(1e-4, len) };
  }, [p0, p1]);

  return (
    <mesh position={position} quaternion={quaternion}>
      <cylinderGeometry args={[radius, radius, length, 16]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.6}
        roughness={0.2}
      />
    </mesh>
  );
};

/** Directional Arrow in 3D showing which side of the axis hinges */
const DirectionArrow3D: React.FC<{
  from: Vec2;
  to: Vec2;
  movingSide: FoldSide;
}> = ({ from, to, movingSide }) => {
  const data = useMemo(() => {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) return null;
    const midX = (from[0] + to[0]) / 2;
    const midY = (from[1] + to[1]) / 2;

    const mult = movingSide === 'left' ? 1 : -1;
    const normX = (-dy / len) * mult;
    const normY = (dx / len) * mult;

    const arrowDir = new THREE.Vector3(normX, normY, 0).normalize();
    const pos = new THREE.Vector3(midX + normX * 0.065, midY + normY * 0.065, 0.008);
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), arrowDir);
    return { position: pos, quaternion: quat };
  }, [from, to, movingSide]);

  if (!data) return null;

  return (
    <group position={data.position} quaternion={data.quaternion}>
      <mesh position={[0, -0.015, 0]}>
        <cylinderGeometry args={[0.004, 0.004, 0.03, 8]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <mesh position={[0, 0.01, 0]}>
        <coneGeometry args={[0.016, 0.03, 12]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
    </group>
  );
};

/** Interactive Snap Pin for origami corners, vertices, and midpoints */
const SnapPin: React.FC<{
  point: [number, number];
  isFrom: boolean;
  isTo: boolean;
  onPick: (pt: Vec2) => void;
}> = ({ point, isFrom, isTo, onPick }) => {
  const [hovered, setHovered] = useState(false);

  const color = isFrom
    ? '#38bdf8' // Cyan for Point 1 (From)
    : isTo
    ? '#f43f5e' // Rose for Point 2 (To)
    : hovered
    ? '#fef08a' // Bright yellow on hover
    : '#f59e0b'; // Amber default

  const radius = isFrom || isTo ? 0.024 : hovered ? 0.02 : 0.012;

  return (
    <mesh
      position={[point[0], point[1], 0.006]}
      onClick={(e) => {
        e.stopPropagation();
        onPick(point);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      <sphereGeometry args={[radius, 16, 16]} />
      <meshStandardMaterial
        color={color}
        emissive={isFrom || isTo || hovered ? color : '#000000'}
        emissiveIntensity={isFrom || isTo ? 0.6 : hovered ? 0.9 : 0}
        roughness={0.2}
      />
    </mesh>
  );
};

export const AuthoringCanvas3D: React.FC<AuthoringCanvas3DProps> = ({
  faces,
  paperWidth,
  paperHeight,
  creaseFrom,
  creaseTo,
  onCreaseChange,
  movingSide,
  foldKind,
  foldAngle,
  selectedFaceIds,
  onToggleFaceSelect,
  isSpecificFaceMode,
  validationError,
  testModel,
  activePickingTarget,
  onActivePickingTargetChange,
}) => {
  const controlsRef = useRef<TrackballControlsImpl>(null);
  const [previewT, setPreviewT] = useState<number>(1);
  const [isAnimatingPreview, setIsAnimatingPreview] = useState<boolean>(false);

  // Canvas Mode: 'pick-axis' (place Point 1 & Point 2) vs 'select-layer' (click layers)
  const [canvasMode, setCanvasMode] = useState<'pick-axis' | 'select-layer'>('pick-axis');

  // Picking Target: 'from' | 'to' | 'auto'
  const [localPickingTarget, setLocalPickingTarget] = useState<'from' | 'to' | 'auto'>('auto');
  const pickingTarget = activePickingTarget ?? localPickingTarget;
  const setPickingTarget = (t: 'from' | 'to' | 'auto') => {
    setLocalPickingTarget(t);
    onActivePickingTargetChange?.(t);
  };

  // Material for 3D authoring preview
  const authorMaterial = useMemo(() => {
    return createPaperShaderMaterial('#e11d48', '#ffffff');
  }, []);

  // Compute test engine from testModel if valid
  const testEngine = useMemo(() => {
    if (!testModel) return null;
    try {
      return new FoldEngine(testModel);
    } catch {
      return null;
    }
  }, [testModel]);

  // Posed faces to display in 3D
  const displayFaces: PosedFace[] = useMemo(() => {
    if (foldKind === 'unfold') {
      if (testEngine) {
        return testEngine.poseAt(testEngine.stepCount - 1 + previewT);
      }
      return faces.map((f) => ({ ...f, moving: false }));
    }

    if (testEngine && testModel) {
      try {
        const stepIdx = testModel.steps.length - 1;
        return testEngine.poseAt(stepIdx + previewT);
      } catch {
        // Fallback
      }
    }

    return faces.map((f) => ({
      ...f,
      moving: selectedFaceIds.has(f.id),
    }));
  }, [testEngine, testModel, previewT, faces, foldKind, selectedFaceIds]);

  // Collect unique snap vertices from paper corners, midpoints, and face polygons
  const snapVertices = useMemo(() => {
    const pts: [number, number][] = [
      // 4 corners
      [0, 0],
      [paperWidth, 0],
      [paperWidth, paperHeight],
      [0, paperHeight],
      // Center
      [Number((paperWidth / 2).toFixed(4)), Number((paperHeight / 2).toFixed(4))],
      // 4 edge midpoints
      [Number((paperWidth / 2).toFixed(4)), 0],
      [Number((paperWidth / 2).toFixed(4)), paperHeight],
      [0, Number((paperHeight / 2).toFixed(4))],
      [paperWidth, Number((paperHeight / 2).toFixed(4))],
    ];

    for (const face of faces) {
      for (const pt of face.polygon) {
        pts.push([Number(pt[0].toFixed(4)), Number(pt[1].toFixed(4))]);
      }
    }

    const unique: [number, number][] = [];
    for (const p of pts) {
      if (!unique.some((u) => Math.hypot(u[0] - p[0], u[1] - p[1]) < 0.005)) {
        unique.push(p);
      }
    }
    return unique;
  }, [faces, paperWidth, paperHeight]);

  // Handle picking a point (from snap pin or paper plane click)
  const handlePickPoint = (pt: Vec2) => {
    if (pickingTarget === 'from') {
      onCreaseChange(pt, creaseTo);
      setPickingTarget('to'); // Advance to point 2
    } else if (pickingTarget === 'to') {
      onCreaseChange(creaseFrom, pt);
      setPickingTarget('auto');
    } else {
      // 'auto' mode
      if (!creaseFrom) {
        onCreaseChange(pt, null);
        setPickingTarget('to');
      } else if (!creaseTo) {
        onCreaseChange(creaseFrom, pt);
        setPickingTarget('auto');
      } else {
        // Both exist: clicking starts a fresh axis with Point 1
        onCreaseChange(pt, null);
        setPickingTarget('to');
      }
    }
  };

  // Surface click handler on the paper plane in 3D
  const handlePaperSurfaceClick = (e: { stopPropagation: () => void; point: THREE.Vector3 }) => {
    if (canvasMode !== 'pick-axis') return;
    e.stopPropagation();

    // The paper group is positioned at [-paperWidth/2, -paperHeight/2, 0] inside [0, 0, 0.02]
    // e.point is in world space where the paper center is at (0, 0, 0.02)
    const rawX = e.point.x + paperWidth / 2;
    const rawY = e.point.y + paperHeight / 2;
    const clampedX = Math.max(0, Math.min(paperWidth, rawX));
    const clampedY = Math.max(0, Math.min(paperHeight, rawY));

    // Snap to nearest vertex if within 0.035 units
    const nearest = snapVertices.find(
      (v) => Math.hypot(v[0] - clampedX, v[1] - clampedY) < 0.035
    );

    if (nearest) {
      handlePickPoint(nearest);
    } else {
      handlePickPoint([
        Number(clampedX.toFixed(3)),
        Number(clampedY.toFixed(3)),
      ]);
    }
  };

  // Live animation loop
  useEffect(() => {
    if (!isAnimatingPreview) return;
    let animId: number;
    const start = performance.now();

    const frame = (now: number) => {
      const elapsed = (now - start) / 1000;
      const phase = (elapsed % 1.5) / 1.5;
      const t = Math.sin(phase * Math.PI);
      setPreviewT(t);
      animId = requestAnimationFrame(frame);
    };

    animId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animId);
  }, [isAnimatingPreview]);

  const handleResetCamera = () => {
    controlsRef.current?.reset();
  };

  return (
    <div className="w-[360px] h-[390px] relative rounded-xl border border-slate-800 overflow-hidden bg-slate-950 flex flex-col shadow-inner select-none">
      {/* Top Interactive Mode & Point Selector Header */}
      <div className="bg-slate-900/95 border-b border-slate-800 px-2.5 py-1.5 flex items-center justify-between text-xs z-30">
        {/* Tool Mode Buttons */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCanvasMode('pick-axis')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold transition-colors ${
              canvasMode === 'pick-axis'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Pick the two points of the hinge axis on the 3D paper"
          >
            <Crosshair className="w-3 h-3 text-amber-400" />
            <span>Pick Axis</span>
          </button>
          <button
            type="button"
            onClick={() => setCanvasMode('select-layer')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold transition-colors ${
              canvasMode === 'select-layer'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Click faces in 3D to select which layers fold"
          >
            <Layers className="w-3 h-3 text-sky-400" />
            <span>Layers ({selectedFaceIds.size})</span>
          </button>
        </div>

        {/* Axis Points Badges / Quick Target Buttons */}
        <div className="flex items-center gap-1 font-mono text-[10px]">
          <button
            type="button"
            onClick={() => {
              setCanvasMode('pick-axis');
              setPickingTarget('from');
            }}
            className={`px-1.5 py-0.5 rounded border transition-colors ${
              pickingTarget === 'from'
                ? 'bg-sky-500 text-white border-sky-400 font-bold'
                : creaseFrom
                ? 'bg-slate-950 text-sky-300 border-sky-700/60'
                : 'bg-slate-950 text-slate-500 border-slate-800'
            }`}
            title="Click to place Point 1 (From) on the 3D canvas"
          >
            P1: {creaseFrom ? `${creaseFrom[0]},${creaseFrom[1]}` : 'Set'}
          </button>

          <ArrowRight className="w-2.5 h-2.5 text-slate-500" />

          <button
            type="button"
            onClick={() => {
              setCanvasMode('pick-axis');
              setPickingTarget('to');
            }}
            className={`px-1.5 py-0.5 rounded border transition-colors ${
              pickingTarget === 'to'
                ? 'bg-rose-500 text-white border-rose-400 font-bold'
                : creaseTo
                ? 'bg-slate-950 text-rose-300 border-rose-700/60'
                : 'bg-slate-950 text-slate-500 border-slate-800'
            }`}
            title="Click to place Point 2 (To) on the 3D canvas"
          >
            P2: {creaseTo ? `${creaseTo[0]},${creaseTo[1]}` : 'Set'}
          </button>

          {(creaseFrom || creaseTo) && (
            <button
              type="button"
              onClick={() => {
                onCreaseChange(null, null);
                setPickingTarget('auto');
              }}
              className="p-1 text-slate-400 hover:text-rose-400 transition-colors ml-0.5"
              title="Clear Axis"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* 3D WebGL Canvas */}
      <div className="flex-1 relative w-full h-full">
        <Canvas
          camera={{ position: [0.8, -1.2, 1.6], fov: 42, near: 0.05, far: 50 }}
          gl={{ antialias: true, alpha: false }}
        >
          <color attach="background" args={['#080c14']} />

          <ambientLight intensity={0.7} color="#dbeafe" />
          <directionalLight position={[3, 5, 6]} intensity={1.2} color="#fffaf0" />
          <directionalLight position={[-3, -4, 4]} intensity={0.5} color="#93c5fd" />
          <directionalLight position={[0, 0, -3]} intensity={0.3} color="#fef08a" />

          {/* Centered Origami Model & 3D Interactive Gizmos */}
          <group position={[0, 0, 0.02]}>
            <group position={[-paperWidth / 2, -paperHeight / 2, 0]}>
              {/* Paper Faces Mesh */}
              <PaperMesh
                faces={displayFaces}
                paperMaterial={authorMaterial}
                paperWidth={paperWidth}
                paperHeight={paperHeight}
                selectedFaceIds={selectedFaceIds}
                onFaceClick={canvasMode === 'select-layer' ? onToggleFaceSelect : undefined}
                showCreaseLines={true}
              />

              {/* Clickable paper plane surface for arbitrary point picking */}
              {canvasMode === 'pick-axis' && (
                <mesh
                  position={[paperWidth / 2, paperHeight / 2, 0.002]}
                  onClick={handlePaperSurfaceClick}
                >
                  <planeGeometry args={[paperWidth, paperHeight]} />
                  <meshBasicMaterial visible={false} />
                </mesh>
              )}

              {/* Snap Vertex Pins at all corners, midpoints, and crease intersections */}
              {canvasMode === 'pick-axis' &&
                snapVertices.map((pt, idx) => (
                  <SnapPin
                    key={`snap-${idx}-${pt[0]}-${pt[1]}`}
                    point={pt}
                    isFrom={Boolean(
                      creaseFrom && Math.hypot(creaseFrom[0] - pt[0], creaseFrom[1] - pt[1]) < 0.005
                    )}
                    isTo={Boolean(
                      creaseTo && Math.hypot(creaseTo[0] - pt[0], creaseTo[1] - pt[1]) < 0.005
                    )}
                    onPick={handlePickPoint}
                  />
                ))}

              {/* 3D Hinge Axis Visualization */}
              {creaseFrom && creaseTo && (
                <group>
                  {/* Amber Axis Rod */}
                  <RodMesh
                    p0={[creaseFrom[0], creaseFrom[1], 0.006]}
                    p1={[creaseTo[0], creaseTo[1], 0.006]}
                    radius={0.008}
                    color="#f59e0b"
                  />

                  {/* Point 1 (From) Handle Sphere */}
                  <mesh
                    position={[creaseFrom[0], creaseFrom[1], 0.006]}
                    onClick={(e) => {
                      e.stopPropagation();
                      setCanvasMode('pick-axis');
                      setPickingTarget('from');
                    }}
                  >
                    <sphereGeometry args={[0.026, 16, 16]} />
                    <meshStandardMaterial
                      color="#38bdf8"
                      emissive="#38bdf8"
                      emissiveIntensity={0.6}
                      roughness={0.2}
                    />
                  </mesh>

                  {/* Point 2 (To) Handle Sphere */}
                  <mesh
                    position={[creaseTo[0], creaseTo[1], 0.006]}
                    onClick={(e) => {
                      e.stopPropagation();
                      setCanvasMode('pick-axis');
                      setPickingTarget('to');
                    }}
                  >
                    <sphereGeometry args={[0.026, 16, 16]} />
                    <meshStandardMaterial
                      color="#f43f5e"
                      emissive="#f43f5e"
                      emissiveIntensity={0.6}
                      roughness={0.2}
                    />
                  </mesh>

                  {/* Directional arrow showing fold side */}
                  <DirectionArrow3D
                    from={creaseFrom}
                    to={creaseTo}
                    movingSide={movingSide}
                  />
                </group>
              )}
            </group>
          </group>

          {/* Trackball Controls (Full 360° unblocked rotation) */}
          <TrackballControls
            ref={controlsRef}
            makeDefault
            rotateSpeed={2.4}
            zoomSpeed={1.2}
            panSpeed={0.8}
            staticMoving={false}
            dynamicDampingFactor={0.18}
            minDistance={0.2}
            maxDistance={8}
          />
        </Canvas>

        {/* Viewport Floating Quick Buttons */}
        <div className="absolute top-2.5 right-2.5 z-20 flex items-center gap-1.5 pointer-events-auto">
          <button
            onClick={handleResetCamera}
            className="p-1.5 rounded-lg bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/80 shadow"
            title="Reset 3D camera"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          {testEngine && (
            <button
              onClick={() => setIsAnimatingPreview(!isAnimatingPreview)}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors shadow ${
                isAnimatingPreview
                  ? 'bg-rose-500/30 text-rose-200 border-rose-500/60'
                  : 'bg-slate-900/80 text-sky-300 border-slate-700/80 hover:bg-slate-800'
              }`}
              title="Animate hinge live in 3D"
            >
              {isAnimatingPreview ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              <span>{isAnimatingPreview ? 'Pause' : 'Hinge Live'}</span>
            </button>
          )}
        </div>

        {/* Live Hinge Scrub Slider */}
        {testEngine && (
          <div className="absolute top-2.5 left-2.5 z-20 flex items-center gap-2 bg-slate-900/85 backdrop-blur px-2.5 py-1 rounded-lg border border-slate-800 shadow pointer-events-auto">
            <span className="text-[10px] font-semibold text-slate-400">Pose:</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={previewT}
              onChange={(e) => {
                setIsAnimatingPreview(false);
                setPreviewT(Number(e.target.value));
              }}
              className="w-20 accent-rose-500 h-1 cursor-pointer"
            />
            <span className="text-[10px] font-mono text-rose-300 w-7 text-right">
              {Math.round(previewT * foldAngle)}°
            </span>
          </div>
        )}

        {/* Visual Helper Banner at Bottom */}
        <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between text-[11px] pointer-events-none">
          {validationError ? (
            <span className="bg-rose-950/90 text-rose-300 border border-rose-800/80 px-2 py-0.5 rounded shadow">
              ⚠️ {validationError}
            </span>
          ) : foldKind === 'unfold' ? (
            <span className="bg-emerald-950/90 text-emerald-300 border border-emerald-800/80 px-2 py-0.5 rounded shadow">
              ↺ Unfolding previous fold
            </span>
          ) : canvasMode === 'pick-axis' ? (
            pickingTarget === 'from' || !creaseFrom ? (
              <span className="bg-sky-950/90 text-sky-200 border border-sky-700/80 px-2 py-0.5 rounded shadow">
                📍 Click paper or a corner/dot for Point 1 (From)
              </span>
            ) : pickingTarget === 'to' || !creaseTo ? (
              <span className="bg-rose-950/90 text-rose-200 border border-rose-700/80 px-2 py-0.5 rounded shadow">
                📍 Click paper or a corner/dot for Point 2 (To)
              </span>
            ) : (
              <span className="bg-emerald-950/90 text-emerald-300 border border-emerald-800/80 px-2 py-0.5 rounded shadow">
                ✓ Axis placed. Click handles or paper to reposition.
              </span>
            )
          ) : (
            <span className="bg-slate-900/90 text-slate-300 border border-slate-800 px-2 py-0.5 rounded shadow">
              Click paper faces to toggle layers for folding
            </span>
          )}
        </div>
      </div>

      {/* Axis & Selection Legend */}
      <div className="bg-slate-900/95 border-t border-slate-800 px-3 py-1.5 flex items-center justify-between text-[11px] font-mono text-slate-400">
        <div className="flex items-center gap-2">
          <span className="text-sky-400">● P1 (From)</span>
          <span className="text-rose-400">● P2 (To)</span>
          <span className="text-amber-400">― Axis</span>
        </div>
        <div className="text-slate-300 font-sans text-[10px]">
          {selectedFaceIds.size > 0
            ? `${selectedFaceIds.size} face(s) selected`
            : 'All layers active'}
        </div>
      </div>
    </div>
  );
};
