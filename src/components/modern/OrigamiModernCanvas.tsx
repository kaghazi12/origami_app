import React, { useRef, useEffect, useMemo, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Center } from '@react-three/drei';
import * as THREE from 'three';
import { CreaseEdgeInfo } from '../../engine/worker/types';


const ThreeProfiler: React.FC = () => {
  const { gl } = useThree();

  useEffect(() => {
    if (!gl) return;
    const origRender = gl.render.bind(gl);
    const glCtx = gl.getContext() as WebGL2RenderingContext;
    const extTimer = glCtx?.getExtension?.('EXT_disjoint_timer_query_webgl2');

    let activeQuery: WebGLQuery | null = null;

    gl.render = (scene: THREE.Scene, camera: THREE.Camera) => {
      // Check previous query result
      if (extTimer && activeQuery && glCtx) {
        const available = glCtx.getQueryParameter(activeQuery, glCtx.QUERY_RESULT_AVAILABLE);
        const disjoint = glCtx.getParameter(extTimer.GPU_DISJOINT_EXT);
        if (available && !disjoint) {
          const timeElapsedNs = glCtx.getQueryParameter(activeQuery, glCtx.QUERY_RESULT);
          const timeElapsedMs = Number(timeElapsedNs) / 1e6;
          const prof = (window as any).__ORIGAMI_PROFILING__;
          if (prof) {
            prof.gpuTimerQueryMs.push(timeElapsedMs);
            if (prof.gpuTimerQueryMs.length > 500) prof.gpuTimerQueryMs.shift();
          }
        }
        if (available) {
          glCtx.deleteQuery(activeQuery);
          activeQuery = null;
        }
      }

      // Start new timer query if supported
      if (extTimer && !activeQuery && glCtx) {
        activeQuery = glCtx.createQuery();
        if (activeQuery) {
          glCtx.beginQuery(extTimer.TIME_ELAPSED_EXT, activeQuery);
        }
      }

      const t0 = performance.now();
      origRender(scene, camera);
      const renderMs = performance.now() - t0;

      if (extTimer && activeQuery && glCtx) {
        glCtx.endQuery(extTimer.TIME_ELAPSED_EXT);
      }

      const prof = (window as any).__ORIGAMI_PROFILING__;
      if (prof) {
        prof.threeRenderMs.push(renderMs);
        if (prof.threeRenderMs.length > 500) prof.threeRenderMs.shift();
        prof.rendererInfo = {
          calls: gl.info.render.calls,
          triangles: gl.info.render.triangles,
          points: gl.info.render.points,
          lines: gl.info.render.lines,
          frame: gl.info.render.frame,
        };
      }
    };

    return () => {
      gl.render = origRender;
    };
  }, [gl]);

  return null;
};

import { BarycentricAttachment } from '../../engine/physics/types';

function computeBarycentric(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): [number, number, number] {
  const v0 = new THREE.Vector3().subVectors(b, a);
  const v1 = new THREE.Vector3().subVectors(c, a);
  const v2 = new THREE.Vector3().subVectors(p, a);

  const d00 = v0.dot(v0);
  const d01 = v0.dot(v1);
  const d11 = v1.dot(v1);
  const d20 = v2.dot(v0);
  const d21 = v2.dot(v1);

  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-12) return [0.3333, 0.3333, 0.3334];

  const w1 = Math.max(0, Math.min(1, (d11 * d20 - d01 * d21) / denom));
  const w2 = Math.max(0, Math.min(1, (d00 * d21 - d01 * d20) / denom));
  const w0 = Math.max(0, Math.min(1, 1.0 - w1 - w2));
  const sum = w0 + w1 + w2;
  return [w0 / sum, w1 / sum, w2 / sum];
}

const ReachCircle: React.FC<{ center: [number, number, number]; radius: number }> = ({ center, radius }) => {
  const lineGeo = useMemo(() => {
    const points: THREE.Vector3[] = [];
    const segments = 64;
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      points.push(new THREE.Vector3(radius * Math.cos(theta), 0, radius * Math.sin(theta)));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.LineLoop(geo);
    line.computeLineDistances();
    return geo;
  }, [radius]);

  return (
    <group position={center}>
      <lineLoop geometry={lineGeo}>
        <lineDashedMaterial color="#d97706" dashSize={0.03} gapSize={0.02} />
      </lineLoop>
    </group>
  );
};

const PinMarker: React.FC<{ position: [number, number, number] }> = ({ position }) => {
  return (
    <group position={position}>
      <mesh position={[0, 0.04, 0]}>
        <sphereGeometry args={[0.015, 16, 16]} />
        <meshStandardMaterial color="#f59e0b" roughness={0.2} metalness={0.6} emissive="#b45309" emissiveIntensity={0.5} />
      </mesh>
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.002, 0.002, 0.04, 8]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.2} metalness={0.8} />
      </mesh>
    </group>
  );
};

const DragHandleMarker: React.FC<{ position: [number, number, number] }> = ({ position }) => {
  return (
    <group position={position}>
      <mesh>
        <sphereGeometry args={[0.02, 16, 16]} />
        <meshStandardMaterial color="#06b6d4" roughness={0.2} metalness={0.5} emissive="#0891b2" emissiveIntensity={0.6} />
      </mesh>
      {/* Visual orientation ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.025, 0.03, 24]} />
        <meshBasicMaterial color="#22d3ee" side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
};

const PaperMesh: React.FC<{
  indices: Uint32Array;
  positions: Float32Array;
  uvs?: Float32Array | null;
  creaseEdges: CreaseEdgeInfo[];
  showCreases: boolean;
  frontColor: string;
  backColor: string;
  paperThickness: number;
  activeTool?: 'pivot' | 'drag';
  barycentricPin?: BarycentricAttachment | null;
  barycentricDrag?: BarycentricAttachment | null;
  onSetBarycentricPin?: (pin: BarycentricAttachment | null) => void;
  onBarycentricDragStart?: (drag: BarycentricAttachment) => void;
  onBarycentricDragMove?: (targetPos: [number, number, number]) => void;
  onBarycentricDragEnd?: () => void;
  orbitControlsRef: React.MutableRefObject<any>;
  onDragStateChange?: (dragging: boolean) => void;
}> = ({
  indices,
  positions,
  uvs,
  creaseEdges,
  showCreases,
  frontColor,
  backColor,
  paperThickness,
  activeTool = 'drag',
  barycentricPin = null,
  barycentricDrag = null,
  onSetBarycentricPin,
  onBarycentricDragStart,
  onBarycentricDragMove,
  onBarycentricDragEnd,
  orbitControlsRef,
  onDragStateChange,
}) => {
  const isDraggingRef = useRef(false);
  const activeDragRef = useRef<BarycentricAttachment | null>(null);
  const dragPlaneRef = useRef<THREE.Plane | null>(null);
  const latestTargetRef = useRef<[number, number, number] | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const { camera } = useThree();

  const handlePointerDown = (e: any) => {
    if (e.nativeEvent?.button !== 0) return; // Right click orbits
    e.stopPropagation();
    if (!e.face) return;

    const hitWorld = e.point;
    const physPos: [number, number, number] = [
      hitWorld.x + 0.58,
      -(hitWorld.z + 0.50),
      Math.max(paperThickness * 0.5, hitWorld.y),
    ];

    const a = e.face.a;
    const b = e.face.b;
    const c = e.face.c;

    const pA = new THREE.Vector3(positions[a * 3 + 0], positions[a * 3 + 1], positions[a * 3 + 2]);
    const pB = new THREE.Vector3(positions[b * 3 + 0], positions[b * 3 + 1], positions[b * 3 + 2]);
    const pC = new THREE.Vector3(positions[c * 3 + 0], positions[c * 3 + 1], positions[c * 3 + 2]);

    const hitPhys = new THREE.Vector3(physPos[0], physPos[1], physPos[2]);
    const [w0, w1, w2] = computeBarycentric(hitPhys, pA, pB, pC);

    let restU = 0, restV = 0;
    if (uvs && uvs.length >= (Math.max(a, b, c) + 1) * 2) {
      restU = w0 * uvs[a * 2 + 0] + w1 * uvs[b * 2 + 0] + w2 * uvs[c * 2 + 0];
      restV = w0 * uvs[a * 2 + 1] + w1 * uvs[b * 2 + 1] + w2 * uvs[c * 2 + 1];
    }

    if (activeTool === 'pivot') {
      if (barycentricPin) {
        onSetBarycentricPin?.(null);
      } else {
        onSetBarycentricPin?.({
          point: {
            triangleIndex: e.faceIndex,
            v0: a, v1: b, v2: c,
            w0, w1, w2,
            restU, restV,
          },
          targetPos: physPos,
          compliance: 0,
        });
      }
      return;
    }

    if (activeTool === 'drag') {
      isDraggingRef.current = true;
      onDragStateChange?.(true);
      if (orbitControlsRef.current) orbitControlsRef.current.enabled = false;

      const newDrag: BarycentricAttachment = {
        point: {
          triangleIndex: e.faceIndex,
          v0: a, v1: b, v2: c,
          w0, w1, w2,
          restU, restV,
        },
        targetPos: physPos,
        compliance: 0,
      };
      activeDragRef.current = newDrag;

      // Camera-facing drag plane through hit point
      const camDir = new THREE.Vector3();
      camera.getWorldDirection(camDir);
      dragPlaneRef.current = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir.clone().negate(), hitWorld);

      onBarycentricDragStart?.(newDrag);
      try {
        e.target?.setPointerCapture?.(e.pointerId);
      } catch {}
    }
  };

  const handlePointerMove = (e: any) => {
    if (!isDraggingRef.current || !activeDragRef.current || !dragPlaneRef.current) return;
    e.stopPropagation();

    const ray = e.ray;
    if (!ray) return;
    const targetWorld = new THREE.Vector3();
    if (!ray.intersectPlane(dragPlaneRef.current, targetWorld)) return;

    let newPhysX = targetWorld.x + 0.58;
    let newPhysY = -(targetWorld.z + 0.50);
    let newPhysZ = Math.max(paperThickness * 0.5, targetWorld.y);

    // Reach clamp if pin P is active
    if (barycentricPin && activeDragRef.current.point.restU !== undefined && barycentricPin.point.restU !== undefined) {
      const reach = Math.hypot(
        activeDragRef.current.point.restU - barycentricPin.point.restU,
        activeDragRef.current.point.restV! - barycentricPin.point.restV!
      );
      const pTarget = barycentricPin.targetPos;
      const dx = newPhysX - pTarget[0];
      const dy = newPhysY - pTarget[1];
      const dz = newPhysZ - pTarget[2];
      const d = Math.hypot(dx, dy, dz);
      if (d > reach && d > 1e-6) {
        const scale = reach / d;
        newPhysX = pTarget[0] + dx * scale;
        newPhysY = pTarget[1] + dy * scale;
        newPhysZ = Math.max(paperThickness * 0.5, pTarget[2] + dz * scale);
      }
    }

    // Coalesce updates to 1 per animation frame
    latestTargetRef.current = [newPhysX, newPhysY, newPhysZ];
    if (!rafIdRef.current) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        if (latestTargetRef.current) {
          onBarycentricDragMove?.(latestTargetRef.current);
        }
      });
    }
  };

  const handlePointerUp = (e: any) => {
    if (isDraggingRef.current) {
      e.stopPropagation();
      isDraggingRef.current = false;
      activeDragRef.current = null;
      dragPlaneRef.current = null;
      onDragStateChange?.(false);
      if (orbitControlsRef.current) orbitControlsRef.current.enabled = true;
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      onBarycentricDragEnd?.();
      try {
        e.target?.releasePointerCapture?.(e.pointerId);
      } catch {}
    }
  };

  // Create persistent BufferGeometry instance once
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(new Float32Array(positions), 3);
    geo.setAttribute('position', posAttr);
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
    geo.computeVertexNormals();
    return geo;
  }, [indices.length]);

  // Persistent crease line geometry
  const creaseGeometry = useMemo(() => {
    if (creaseEdges.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    const numLineVerts = creaseEdges.length * 2;
    const linePosAttr = new THREE.BufferAttribute(new Float32Array(numLineVerts * 3), 3);
    const lineColAttr = new THREE.BufferAttribute(new Float32Array(numLineVerts * 3), 3);

    // Prepopulate colors: Mountain red, Valley blue, Boundary dark
    for (let i = 0; i < creaseEdges.length; i++) {
      const e = creaseEdges[i];
      let r = 0.5, g = 0.5, b = 0.5;
      if (e.assignment === 'M') {
        r = 0.94; g = 0.27; b = 0.27; // Red
      } else if (e.assignment === 'V') {
        r = 0.23; g = 0.51; b = 0.96; // Blue
      } else if (e.assignment === 'B') {
        r = 0.10; g = 0.10; b = 0.10; // Dark
      }
      lineColAttr.setXYZ(i * 2 + 0, r, g, b);
      lineColAttr.setXYZ(i * 2 + 1, r, g, b);
    }

    geo.setAttribute('position', linePosAttr);
    geo.setAttribute('color', lineColAttr);
    return geo;
  }, [creaseEdges]);

  // Update geometry in-place on each incoming position buffer without reallocation
  useEffect(() => {
    if (!geometry || !positions) return;

    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    if (posAttr && posAttr.array.length === positions.length) {
      (posAttr.array as Float32Array).set(positions);
      posAttr.needsUpdate = true;
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
    }

    // Update crease lines
    if (creaseGeometry && showCreases) {
      const linePosAttr = creaseGeometry.getAttribute('position') as THREE.BufferAttribute;
      if (linePosAttr) {
        const lineArr = linePosAttr.array as Float32Array;
        for (let i = 0; i < creaseEdges.length; i++) {
          const e = creaseEdges[i];
          const idx0 = e.v0 * 3;
          const idx1 = e.v1 * 3;

          // Lift slightly along Z to avoid z-fighting with paper surface
          lineArr[i * 6 + 0] = positions[idx0 + 0];
          lineArr[i * 6 + 1] = positions[idx0 + 1];
          lineArr[i * 6 + 2] = positions[idx0 + 2] + 0.001;

          lineArr[i * 6 + 3] = positions[idx1 + 0];
          lineArr[i * 6 + 4] = positions[idx1 + 1];
          lineArr[i * 6 + 5] = positions[idx1 + 2] + 0.001;
        }
        linePosAttr.needsUpdate = true;
      }
    }
  }, [positions, geometry, creaseGeometry, creaseEdges, showCreases]);

  return (
    <group position={[-0.58, 0, -0.50]} rotation={[-Math.PI / 2, 0, 0]}>
      {/* Front Face: crisp origami paper color */}
      <mesh
        geometry={geometry}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <meshStandardMaterial
          color={frontColor}
          side={THREE.FrontSide}
          roughness={0.7}
          metalness={0.05}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>

      {/* Back Face: contrasting reverse paper color */}
      <mesh geometry={geometry}>
        <meshStandardMaterial
          color={backColor}
          side={THREE.BackSide}
          roughness={0.7}
          metalness={0.05}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>

      {/* 3D Crease Lines */}
      {showCreases && creaseGeometry && (
        <lineSegments geometry={creaseGeometry}>
          <lineBasicMaterial vertexColors linewidth={2} />
        </lineSegments>
      )}
    </group>
  );
};

export interface OrigamiModernCanvasProps {
  indices: Uint32Array | null;
  positions: Float32Array | null;
  uvs?: Float32Array | null;
  creaseEdges: CreaseEdgeInfo[];
  showCreases?: boolean;
  frontColor?: string;
  backColor?: string;
  className?: string;
  showTable?: boolean;
  paperThickness?: number;
  activeTool?: 'pivot' | 'drag';
  barycentricPin?: BarycentricAttachment | null;
  barycentricDrag?: BarycentricAttachment | null;
  reachRadius?: number | null;
  pinnedVertices?: number[];
  draggedVertex?: number | null;
  onSetBarycentricPin?: (pin: BarycentricAttachment | null) => void;
  onBarycentricDragStart?: (drag: BarycentricAttachment) => void;
  onBarycentricDragMove?: (targetPos: [number, number, number]) => void;
  onBarycentricDragEnd?: () => void;
  onTogglePin?: (vertexIndex: number) => void;
  onDragStart?: (vertexIndex: number) => void;
  onDragMove?: (vertexIndex: number, targetPos: [number, number, number]) => void;
  onDragEnd?: () => void;
}

const TableSurface: React.FC<{ paperThickness?: number }> = ({ paperThickness = 0.002 }) => {
  return (
    <group position={[0, 0, 0]}>
      {/* Subtle tabletop grid */}
      <gridHelper args={[3, 30, '#94a3b8', '#e2e8f0']} position={[0, -0.0005, 0]} />

      {/* Tabletop receiver plane */}
      <mesh position={[0, -0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[4, 4]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.85} metalness={0.05} />
      </mesh>

      {/* Soft Contact Shadow beneath paper sheet */}
      <mesh position={[0, -0.0002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.3, 1.3]} />
        <meshBasicMaterial
          color="#0f172a"
          transparent
          opacity={0.15}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
};

export const OrigamiModernCanvas: React.FC<OrigamiModernCanvasProps> = ({
  indices,
  positions,
  uvs = null,
  creaseEdges,
  showCreases = true,
  frontColor = '#FCFBF7',
  backColor = '#EA580C',
  className = '',
  showTable = true,
  paperThickness = 0.002,
  activeTool = 'drag',
  barycentricPin = null,
  barycentricDrag = null,
  reachRadius = null,
  pinnedVertices = [],
  draggedVertex = null,
  onSetBarycentricPin,
  onBarycentricDragStart,
  onBarycentricDragMove,
  onBarycentricDragEnd,
  onTogglePin,
  onDragStart,
  onDragMove,
  onDragEnd,
}) => {
  const orbitRef = useRef<any>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Compute 3D world position for barycentric pin marker
  const pinWorldPos = useMemo<[number, number, number] | null>(() => {
    if (!barycentricPin || !positions) return null;
    const pt = barycentricPin.point;
    const p0 = pt.v0 * 3, p1 = pt.v1 * 3, p2 = pt.v2 * 3;
    const curX = pt.w0 * positions[p0 + 0] + pt.w1 * positions[p1 + 0] + pt.w2 * positions[p2 + 0];
    const curY = pt.w0 * positions[p0 + 1] + pt.w1 * positions[p1 + 1] + pt.w2 * positions[p2 + 1];
    const curZ = pt.w0 * positions[p0 + 2] + pt.w1 * positions[p1 + 2] + pt.w2 * positions[p2 + 2];
    return [curX - 0.58, curZ, -curY - 0.50];
  }, [barycentricPin, positions]);

  // Compute 3D world position for barycentric drag marker
  const dragWorldPos = useMemo<[number, number, number] | null>(() => {
    if (!barycentricDrag) return null;
    return [
      barycentricDrag.targetPos[0] - 0.58,
      barycentricDrag.targetPos[2],
      -barycentricDrag.targetPos[1] - 0.50,
    ];
  }, [barycentricDrag]);

  // Reach circle center on the table
  const reachCenter = useMemo<[number, number, number] | null>(() => {
    if (!barycentricPin) return null;
    return [
      barycentricPin.targetPos[0] - 0.58,
      0.0005,
      -barycentricPin.targetPos[1] - 0.50,
    ];
  }, [barycentricPin]);

  const cursorClass =
    activeTool === 'pivot'
      ? 'cursor-crosshair'
      : isDragging
      ? 'cursor-grabbing'
      : 'cursor-grab';

  return (
    <div className={`relative w-full h-full min-h-[300px] bg-gradient-to-b from-gray-100 to-gray-200 rounded-lg overflow-hidden border border-gray-300 ${cursorClass} ${className}`}>
      <Canvas
        camera={{ position: [0.0, 1.4, 1.2], fov: 45 }}
        gl={{ antialias: true, alpha: true }}
      >
        <ThreeProfiler />
        <ambientLight intensity={0.8} />
        <directionalLight position={[3, 6, 4]} intensity={1.2} castShadow />
        <directionalLight position={[-3, 4, -2]} intensity={0.4} />

        {showTable && <TableSurface paperThickness={paperThickness} />}

        {indices && positions && (
          <>
            <PaperMesh
              indices={indices}
              positions={positions}
              uvs={uvs}
              creaseEdges={creaseEdges}
              showCreases={showCreases}
              frontColor={frontColor}
              backColor={backColor}
              paperThickness={paperThickness}
              activeTool={activeTool}
              barycentricPin={barycentricPin}
              barycentricDrag={barycentricDrag}
              onSetBarycentricPin={onSetBarycentricPin}
              onBarycentricDragStart={onBarycentricDragStart}
              onBarycentricDragMove={onBarycentricDragMove}
              onBarycentricDragEnd={onBarycentricDragEnd}
              orbitControlsRef={orbitRef}
              onDragStateChange={setIsDragging}
            />

            {/* Pinned Attachment P Marker */}
            {pinWorldPos && <PinMarker position={pinWorldPos} />}

            {/* Drag Handle Q Marker */}
            {dragWorldPos && <DragHandleMarker position={dragWorldPos} />}

            {/* Dashed Reach Circle around P on table */}
            {reachCenter && reachRadius && reachRadius > 0 && (
              <ReachCircle center={reachCenter} radius={reachRadius} />
            )}

            {/* Legacy vertex pin markers */}
            {pinnedVertices.map((v) => {
              const px = positions[v * 3 + 0] - 0.58;
              const pz = -positions[v * 3 + 1] - 0.50;
              const py = positions[v * 3 + 2];
              return <PinMarker key={`pin-${v}`} position={[px, py, pz]} />;
            })}

            {/* Legacy vertex drag marker */}
            {draggedVertex !== null && (
              <DragHandleMarker
                position={[
                  positions[draggedVertex * 3 + 0] - 0.58,
                  positions[draggedVertex * 3 + 2],
                  -positions[draggedVertex * 3 + 1] - 0.50,
                ]}
              />
            )}
          </>
        )}

        <OrbitControls
          ref={orbitRef}
          makeDefault
          enableDamping
          dampingFactor={0.05}
          minDistance={0.3}
          maxDistance={10}
        />
      </Canvas>
    </div>
  );
};
