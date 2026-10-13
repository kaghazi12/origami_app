import React, { useRef, useEffect, useMemo } from 'react';
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

const PinMarker: React.FC<{ position: [number, number, number] }> = ({ position }) => {
  return (
    <group position={position}>
      <mesh position={[0, 0.04, 0]}>
        <sphereGeometry args={[0.015, 16, 16]} />
        <meshStandardMaterial color="#dc2626" roughness={0.3} metalness={0.2} />
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
    </group>
  );
};

const PaperMesh: React.FC<{
  indices: Uint32Array;
  positions: Float32Array;
  creaseEdges: CreaseEdgeInfo[];
  showCreases: boolean;
  frontColor: string;
  backColor: string;
  paperThickness: number;
  onTogglePin?: (vertexIndex: number) => void;
  onDragStart?: (vertexIndex: number) => void;
  onDragMove?: (vertexIndex: number, targetPos: [number, number, number]) => void;
  onDragEnd?: () => void;
  orbitControlsRef: React.MutableRefObject<any>;
}> = ({
  indices,
  positions,
  creaseEdges,
  showCreases,
  frontColor,
  backColor,
  paperThickness,
  onTogglePin,
  onDragStart,
  onDragMove,
  onDragEnd,
  orbitControlsRef,
}) => {
  const isDraggingRef = useRef(false);
  const activeDragVRef = useRef<number | null>(null);
  const dragPlaneYRef = useRef(0);

  const handlePointerDown = (e: any) => {
    e.stopPropagation();
    if (!e.face) return;
    const hitPoint = e.point;

    const physX = hitPoint.x + 0.58;
    const physY = -(hitPoint.z + 0.50);

    const candidates = [e.face.a, e.face.b, e.face.c];
    let nearestV = candidates[0];
    let minDist = Infinity;
    for (const v of candidates) {
      const vx = positions[v * 3 + 0];
      const vy = positions[v * 3 + 1];
      const dist = Math.hypot(vx - physX, vy - physY);
      if (dist < minDist) {
        minDist = dist;
        nearestV = v;
      }
    }

    if (e.shiftKey) {
      onTogglePin?.(nearestV);
      return;
    }

    isDraggingRef.current = true;
    activeDragVRef.current = nearestV;
    dragPlaneYRef.current = hitPoint.y;
    if (orbitControlsRef.current) orbitControlsRef.current.enabled = false;
    onDragStart?.(nearestV);
    try {
      e.target?.setPointerCapture?.(e.pointerId);
    } catch {}
  };

  const handlePointerMove = (e: any) => {
    if (!isDraggingRef.current || activeDragVRef.current === null) return;
    e.stopPropagation();

    const ray = e.ray;
    if (!ray) return;
    const targetY = dragPlaneYRef.current;
    if (Math.abs(ray.direction.y) < 1e-4) return;
    const t = (targetY - ray.origin.y) / ray.direction.y;
    if (t < 0) return;

    const hitX = ray.origin.x + ray.direction.x * t;
    const hitZ = ray.origin.z + ray.direction.z * t;

    const newPhysX = hitX + 0.58;
    const newPhysY = -(hitZ + 0.50);
    const newPhysZ = Math.max(paperThickness * 0.5, targetY);

    onDragMove?.(activeDragVRef.current, [newPhysX, newPhysY, newPhysZ]);
  };

  const handlePointerUp = (e: any) => {
    if (isDraggingRef.current) {
      e.stopPropagation();
      isDraggingRef.current = false;
      activeDragVRef.current = null;
      if (orbitControlsRef.current) orbitControlsRef.current.enabled = true;
      onDragEnd?.();
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
  creaseEdges: CreaseEdgeInfo[];
  showCreases?: boolean;
  frontColor?: string;
  backColor?: string;
  className?: string;
  showTable?: boolean;
  paperThickness?: number;
  pinnedVertices?: number[];
  draggedVertex?: number | null;
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
  creaseEdges,
  showCreases = true,
  frontColor = '#FCFBF7',
  backColor = '#EA580C',
  className = '',
  showTable = true,
  paperThickness = 0.002,
  pinnedVertices = [],
  draggedVertex = null,
  onTogglePin,
  onDragStart,
  onDragMove,
  onDragEnd,
}) => {
  const orbitRef = useRef<any>(null);

  return (
    <div className={`relative w-full h-full min-h-[300px] bg-gradient-to-b from-gray-100 to-gray-200 rounded-lg overflow-hidden border border-gray-300 ${className}`}>
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
              creaseEdges={creaseEdges}
              showCreases={showCreases}
              frontColor={frontColor}
              backColor={backColor}
              paperThickness={paperThickness}
              onTogglePin={onTogglePin}
              onDragStart={onDragStart}
              onDragMove={onDragMove}
              onDragEnd={onDragEnd}
              orbitControlsRef={orbitRef}
            />

            {/* Pinned Vertices Markers */}
            {pinnedVertices.map((v) => {
              const px = positions[v * 3 + 0] - 0.58;
              const pz = -positions[v * 3 + 1] - 0.50;
              const py = positions[v * 3 + 2];
              return <PinMarker key={`pin-${v}`} position={[px, py, pz]} />;
            })}

            {/* Dragged Vertex Marker */}
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
