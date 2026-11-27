import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Center } from '@react-three/drei';
import * as THREE from 'three';
import { theme, rgb } from '../../theme';

import { CreaseEdgeInfo } from '../../engine/worker/types';
import { computeBisectorPlane, sliceMeshWithPlane, floodFillFlap, BisectorPlane } from '../../engine/mesh/creaseSlice';
import { TriMesh, EdgeAssignment } from '../../engine/types';

/** Crease line colours (diagram notation) as RGB for the vertex-colour buffer. */
const MOUNTAIN_RGB = rgb(theme.mountain);
const VALLEY_RGB = rgb(theme.valley);
const EDGE_RGB = rgb(theme.paperEdge);
const OTHER_RGB = rgb(theme.lineStrong);

export interface CreasePreviewData {
  plane: BisectorPlane;
  segments3D: [ [number, number, number], [number, number, number] ][];
  polylinesUV: [number, number][][];
  flapTriangles: Set<number>;
  assignment: EdgeAssignment;
  foldAngleDeg: number;
}

const ThreeProfiler: React.FC = () => {
  const { gl, scene, camera } = useThree();

  useEffect(() => {
    if (!gl) return;
    if (typeof window !== 'undefined') {
      (window as any).__ORIGAMI_THREE__ = { gl, scene, camera };
    }
    const origRender = gl.render.bind(gl);
    const glCtx = gl.getContext() as WebGL2RenderingContext;
    const extTimer = glCtx?.getExtension?.('EXT_disjoint_timer_query_webgl2');

    let activeQuery: WebGLQuery | null = null;
    let queryInProgress = false;

    gl.render = (scene: THREE.Scene, camera: THREE.Camera) => {
      // Check previous query result
      if (extTimer && activeQuery && glCtx && !queryInProgress) {
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
          queryInProgress = true;
        }
      }

      const t0 = performance.now();
      origRender(scene, camera);
      const renderMs = performance.now() - t0;

      if (extTimer && queryInProgress && glCtx) {
        glCtx.endQuery(extTimer.TIME_ELAPSED_EXT);
        queryInProgress = false;
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
        <lineDashedMaterial color={theme.inkMuted} dashSize={0.03} gapSize={0.02} />
      </lineLoop>
    </group>
  );
};

const PinMarker: React.FC<{ position: [number, number, number] }> = ({ position }) => {
  return (
    <group position={position}>
      <mesh position={[0, 0.04, 0]}>
        <sphereGeometry args={[0.015, 16, 16]} />
        <meshStandardMaterial color={theme.accent} roughness={0.5} metalness={0} />
      </mesh>
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.002, 0.002, 0.04, 8]} />
        <meshStandardMaterial color={theme.ink} roughness={0.6} metalness={0} />
      </mesh>
    </group>
  );
};

const DragHandleMarker: React.FC<{ position: [number, number, number] }> = ({ position }) => {
  return (
    <group position={position}>
      <mesh>
        <sphereGeometry args={[0.02, 16, 16]} />
        <meshStandardMaterial color={theme.ink} roughness={0.5} metalness={0} />
      </mesh>
      {/* Visual orientation ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.025, 0.03, 24]} />
        <meshBasicMaterial color={theme.ink} transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
};

/**
 * Physics coordinates (paper units, z up) <-> scene coordinates (y up). The loaded sheet is
 * centred at the scene origin and scaled so its longest side is VIEW_SIZE units, whatever the
 * FOLD file's own coordinates are. Set once per render by OrigamiModernCanvas.
 */
const VIEW_SIZE = 2;
const VIEW = { cx: 0.5, cy: 0.5, s: VIEW_SIZE, clampZ: false };
const physToWorld = (x: number, y: number, z: number): [number, number, number] => [
  (x - VIEW.cx) * VIEW.s,
  z * VIEW.s,
  -(y - VIEW.cy) * VIEW.s,
];
const worldToPhys = (w: THREE.Vector3, minZ: number): [number, number, number] => [
  w.x / VIEW.s + VIEW.cx,
  -w.z / VIEW.s + VIEW.cy,
  VIEW.clampZ ? Math.max(minZ, w.y / VIEW.s) : w.y / VIEW.s,
];

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
  previewCrease?: CreasePreviewData | null;
  foldOnlyTopLayer?: boolean;
  onPreviewChange?: (preview: CreasePreviewData | null) => void;
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
  previewCrease = null,
  foldOnlyTopLayer = false,
  onPreviewChange,
  onSetBarycentricPin,
  onBarycentricDragStart,
  onBarycentricDragMove,
  onBarycentricDragEnd,
  orbitControlsRef,
  onDragStateChange,
}) => {
  const isDraggingRef = useRef(false);
  const dragStartPosRef = useRef<[number, number, number] | null>(null);
  const activeDragRef = useRef<BarycentricAttachment | null>(null);
  const dragPlaneRef = useRef<THREE.Plane | null>(null);
  const latestTargetRef = useRef<[number, number, number] | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const lastSliceQRef = useRef<[number, number, number]>([0, 0, 0]);
  const lastPreviewDataRef = useRef<CreasePreviewData | null>(null);
  const updatePreviewGeometryRef = useRef<(preview: CreasePreviewData | null) => void>(() => {});
  const { camera, gl } = useThree();
  const dragRaycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const dragPointerVec2 = useRef<THREE.Vector2>(new THREE.Vector2());

  const handlePointerDown = (e: any) => {
    if (e.nativeEvent?.button !== 0) return; // Right click orbits
    e.stopPropagation();
    if (!e.face) return;

    const hitWorld = e.point;
    const physPos = worldToPhys(hitWorld, paperThickness * 0.5);

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
      dragStartPosRef.current = physPos;
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

  const processDragMove = useCallback((clientX: number, clientY: number) => {
    if (!isDraggingRef.current || !activeDragRef.current || !dragPlaneRef.current) return;

    const canvas = gl.domElement;
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;

    dragPointerVec2.current.set(ndcX, ndcY);
    dragRaycasterRef.current.setFromCamera(dragPointerVec2.current, camera);
    const ray = dragRaycasterRef.current.ray;

    const targetWorld = new THREE.Vector3();
    if (!ray.intersectPlane(dragPlaneRef.current, targetWorld)) return;

    let [newPhysX, newPhysY, newPhysZ] = worldToPhys(targetWorld, paperThickness * 0.5);

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
        newPhysZ = VIEW.clampZ ? Math.max(paperThickness * 0.5, pTarget[2] + dz * scale) : pTarget[2] + dz * scale;
      }
    }

    // Coalesce updates to 1 per animation frame
    latestTargetRef.current = [newPhysX, newPhysY, newPhysZ];
    if (!rafIdRef.current) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        if (latestTargetRef.current) {
          onBarycentricDragMove?.(latestTargetRef.current);

          // Compute live crease preview if pin P exists
          if (barycentricPin && dragStartPosRef.current && activeDragRef.current && positions && indices && uvs) {
            const q0 = dragStartPosRef.current;
            const qPrime = latestTargetRef.current;
            const pinPos = barycentricPin.targetPos;

            const dx = qPrime[0] - lastSliceQRef.current[0];
            const dy = qPrime[1] - lastSliceQRef.current[1];
            const dz = qPrime[2] - lastSliceQRef.current[2];
            const movedDist = Math.hypot(dx, dy, dz);

            if (movedDist >= 0.0005 || !lastPreviewDataRef.current) {
              lastSliceQRef.current = [qPrime[0], qPrime[1], qPrime[2]];
              const tSlice0 = performance.now();
              const plane = computeBisectorPlane(q0, qPrime, pinPos);
              if (plane) {
                const meshView: TriMesh = {
                  numVertices: positions.length / 3,
                  numTriangles: indices.length / 3,
                  positions: positions as unknown as Float64Array,
                  uvs: uvs as unknown as Float64Array,
                  masses: new Float64Array(0),
                  velocities: new Float64Array(0),
                  indices,
                  bars: [],
                  hinges: [],
                };

                let triIndices: number[] | undefined = undefined;
                if (foldOnlyTopLayer) {
                  const startTri = activeDragRef.current.point.triangleIndex;
                  const topIndices: number[] = [];
                  const zThreshold = positions[indices[startTri * 3 + 0] * 3 + 2] - 0.002;
                  for (let t = 0; t < meshView.numTriangles; t++) {
                    const v0 = indices[t * 3 + 0];
                    if (positions[v0 * 3 + 2] >= zThreshold) {
                      topIndices.push(t);
                    }
                  }
                  triIndices = topIndices;
                }

                const sliceRes = sliceMeshWithPlane(meshView, plane, {
                  snapEps: 0.0005,
                  triangleIndices: triIndices,
                });

                if (sliceRes.segments3D.length > 0 && sliceRes.polylinesUV.length > 0) {
                  const isValley = (qPrime[2] - q0[2]) >= -1e-4;
                  const flap = floodFillFlap(
                    meshView,
                    activeDragRef.current.point.triangleIndex,
                    sliceRes.creaseEdgeKeys
                  );

                  const previewData: CreasePreviewData = {
                    plane,
                    segments3D: sliceRes.segments3D,
                    polylinesUV: sliceRes.polylinesUV,
                    flapTriangles: flap.flapTriangles,
                    assignment: isValley ? 'V' : 'M',
                    foldAngleDeg: 177,
                  };
                  lastPreviewDataRef.current = previewData;
                  updatePreviewGeometryRef.current(previewData);
                  onPreviewChange?.(previewData);
                } else {
                  lastPreviewDataRef.current = null;
                  updatePreviewGeometryRef.current(null);
                  onPreviewChange?.(null);
                }
              } else {
                lastPreviewDataRef.current = null;
                updatePreviewGeometryRef.current(null);
                onPreviewChange?.(null);
              }

              const sliceMs = performance.now() - tSlice0;
              if (typeof window !== 'undefined' && (window as any).__ORIGAMI_PROFILING__) {
                const prof = (window as any).__ORIGAMI_PROFILING__;
                prof.previewSlicingMs = prof.previewSlicingMs || [];
                prof.previewSlicingMs.push(sliceMs);
                if (prof.previewSlicingMs.length > 500) prof.previewSlicingMs.shift();
              }
            }
          }
        }
      });
    }
  }, [camera, gl, barycentricPin, positions, indices, uvs, foldOnlyTopLayer, onBarycentricDragMove, onPreviewChange, paperThickness]);

  const handlePointerMove = (e: any) => {
    if (!isDraggingRef.current) return;
    e.stopPropagation();
    processDragMove(e.clientX, e.clientY);
  };

  const endDrag = useCallback(() => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      activeDragRef.current = null;
      dragPlaneRef.current = null;
      lastPreviewDataRef.current = null;
      updatePreviewGeometryRef.current(null);
      onDragStateChange?.(false);
      if (orbitControlsRef.current) orbitControlsRef.current.enabled = true;
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      onBarycentricDragEnd?.();
    }
  }, [onDragStateChange, onBarycentricDragEnd, orbitControlsRef]);

  const handlePointerUp = (e: any) => {
    if (isDraggingRef.current) {
      e.stopPropagation();
      endDrag();
      try {
        e.target?.releasePointerCapture?.(e.pointerId);
      } catch {}
    }
  };

  useEffect(() => {
    const onWindowMove = (e: PointerEvent) => {
      if (isDraggingRef.current) {
        processDragMove(e.clientX, e.clientY);
      }
    };
    const onWindowUp = () => {
      endDrag();
    };
    window.addEventListener('pointermove', onWindowMove);
    window.addEventListener('pointerup', onWindowUp);
    return () => {
      window.removeEventListener('pointermove', onWindowMove);
      window.removeEventListener('pointerup', onWindowUp);
    };
  }, [processDragMove, endDrag]);

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
      // diagram notation: mountain red, valley blue, paper edge ink, the rest faint
      const [r, g, b] =
        e.assignment === 'M' ? MOUNTAIN_RGB : e.assignment === 'V' ? VALLEY_RGB : e.assignment === 'B' ? EDGE_RGB : OTHER_RGB;
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

  // 1. Persistent in-place BufferGeometry for Live Dashed Crease Preview Line
  const previewLineGeoRef = useRef<THREE.BufferGeometry | null>(null);
  const previewLinePosBuf = useRef<Float32Array>(new Float32Array(3000)); // up to 500 segments
  const previewLinePosAttr = useRef<THREE.BufferAttribute | null>(null);
  const previewLineRef = useRef<THREE.LineSegments | null>(null);

  if (!previewLineGeoRef.current) {
    const geo = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(previewLinePosBuf.current, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr);
    geo.setDrawRange(0, 0);
    previewLineGeoRef.current = geo;
    previewLinePosAttr.current = attr;
  }

  // 2. Persistent in-place BufferGeometry for Moving Flap Overlay
  const flapOverlayGeoRef = useRef<THREE.BufferGeometry | null>(null);
  const flapIndexBuf = useRef<Uint32Array>(new Uint32Array(12000)); // up to 4000 triangles
  const flapIndexAttr = useRef<THREE.BufferAttribute | null>(null);

  if (!flapOverlayGeoRef.current) {
    const geo = new THREE.BufferGeometry();
    const indexAttr = new THREE.BufferAttribute(flapIndexBuf.current, 1);
    indexAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setIndex(indexAttr);
    geo.setDrawRange(0, 0);
    flapOverlayGeoRef.current = geo;
    flapIndexAttr.current = indexAttr;
  }

  // Bind flap overlay positions and normals directly to main paper geometry (zero reallocation)
  useEffect(() => {
    if (geometry && flapOverlayGeoRef.current) {
      const posAttr = geometry.getAttribute('position');
      const normAttr = geometry.getAttribute('normal');
      if (posAttr) flapOverlayGeoRef.current.setAttribute('position', posAttr);
      if (normAttr) flapOverlayGeoRef.current.setAttribute('normal', normAttr);
    }
  }, [geometry]);

  // Update preview line and flap index buffer in-place
  const updatePreviewGeometry = useCallback((preview: CreasePreviewData | null) => {
    const previewGeo = previewLineGeoRef.current;
    const flapGeo = flapOverlayGeoRef.current;
    if (!previewGeo || !flapGeo) return;

    const t0 = performance.now();

    if (!preview || preview.segments3D.length === 0) {
      previewGeo.setDrawRange(0, 0);
      flapGeo.setDrawRange(0, 0);
      return;
    }

    // In-place update of dashed line vertices (zero allocation)
    const segs = preview.segments3D;
    const numPts = segs.length * 2;
    const posArr = previewLinePosBuf.current;
    let pIdx = 0;
    for (let i = 0; i < segs.length; i++) {
      const s0 = segs[i][0];
      const s1 = segs[i][1];
      posArr[pIdx++] = s0[0];
      posArr[pIdx++] = s0[1];
      posArr[pIdx++] = s0[2] + 0.002;
      posArr[pIdx++] = s1[0];
      posArr[pIdx++] = s1[1];
      posArr[pIdx++] = s1[2] + 0.002;
    }
    previewLinePosAttr.current!.needsUpdate = true;
    previewGeo.setDrawRange(0, numPts);
    if (previewLineRef.current) {
      previewLineRef.current.computeLineDistances();
      if (preview.assignment) {
        ((previewLineRef.current.material as THREE.Material) as any)?.color?.set?.(
          preview.assignment === 'M' ? theme.mountain : theme.valley
        );
      }
    }

    // In-place update of flap indices (zero allocation)
    if (preview.flapTriangles.size > 0 && indices) {
      const idxArr = flapIndexBuf.current;
      let fIdx = 0;
      for (const tri of preview.flapTriangles) {
        idxArr[fIdx++] = indices[tri * 3 + 0];
        idxArr[fIdx++] = indices[tri * 3 + 1];
        idxArr[fIdx++] = indices[tri * 3 + 2];
      }
      flapIndexAttr.current!.needsUpdate = true;
      flapGeo.setDrawRange(0, fIdx);
    } else {
      flapGeo.setDrawRange(0, 0);
    }

    if (typeof window !== 'undefined' && (window as any).__ORIGAMI_PROFILING__) {
      const prof = (window as any).__ORIGAMI_PROFILING__;
      prof.geometryUpdateMs = prof.geometryUpdateMs || [];
      prof.geometryUpdateMs.push(performance.now() - t0);
      if (prof.geometryUpdateMs.length > 500) prof.geometryUpdateMs.shift();
    }
  }, [indices]);

  updatePreviewGeometryRef.current = updatePreviewGeometry;

  useEffect(() => {
    updatePreviewGeometry(previewCrease || null);
  }, [previewCrease, updatePreviewGeometry]);

  return (
    <group
      position={[-VIEW.cx * VIEW.s, 0, VIEW.cy * VIEW.s]}
      rotation={[-Math.PI / 2, 0, 0]}
      scale={[VIEW.s, VIEW.s, VIEW.s]}
    >
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
      <mesh geometry={geometry} raycast={() => null}>
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

      {/* Moving Flap Shading Overlay (In-Place Dynamic Draw Range) */}
      <mesh geometry={flapOverlayGeoRef.current!} raycast={() => null}>
        <meshStandardMaterial
          color={theme.valley}
          transparent
          opacity={0.18}
          roughness={0.5}
          side={THREE.DoubleSide}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </mesh>

      {/* 3D Crease Lines */}
      {showCreases && creaseGeometry && (
        <lineSegments geometry={creaseGeometry} raycast={() => null}>
          <lineBasicMaterial vertexColors linewidth={2} />
        </lineSegments>
      )}

      {/* Live Dashed Crease Preview Line (In-Place Dynamic Draw Range) */}
      <lineSegments ref={previewLineRef} geometry={previewLineGeoRef.current!} raycast={() => null}>
        <lineDashedMaterial
          color={previewCrease?.assignment === 'M' ? theme.mountain : theme.valley}
          dashSize={0.02}
          gapSize={0.015}
          linewidth={3}
        />
      </lineSegments>
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
  previewCrease?: CreasePreviewData | null;
  foldOnlyTopLayer?: boolean;
  onPreviewChange?: (preview: CreasePreviewData | null) => void;
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
  /** Bump to frame the camera on the model as it is now (e.g. when a fold finishes). */
  fitModelKey?: number;
}

const TableSurface: React.FC<{ paperThickness?: number }> = ({ paperThickness = 0.002 }) => {
  return (
    <group position={[0, 0, 0]}>
      {/* Subtle tabletop grid */}
      <gridHelper args={[3, 30, theme.lineStrong, theme.line]} position={[0, -0.0005, 0]} raycast={() => null} />

      {/* Tabletop receiver plane */}
      <mesh position={[0, -0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow raycast={() => null}>
        <planeGeometry args={[4, 4]} />
        <meshStandardMaterial color={theme.canvas} roughness={0.9} metalness={0} />
      </mesh>

      {/* Soft Contact Shadow beneath paper sheet */}
      <mesh position={[0, -0.0002, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <planeGeometry args={[1.3, 1.3]} />
        <meshBasicMaterial
          color={theme.ink}
          transparent
          opacity={0.1}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
};

/**
 * Camera framing. On load: frame the whole sheet. When fitModelKey changes (fold finished, or the
 * user double-clicked): frame the model as it is now, keeping the current viewing direction.
 */
const CameraFit: React.FC<{
  loadKey: unknown;
  fitModelKey: number;
  positions: Float32Array | null;
  controlsRef: React.MutableRefObject<any>;
}> = ({ loadKey, fitModelKey, positions, controlsRef }) => {
  const { camera, size } = useThree();
  const frame = (center: THREE.Vector3, radius: number, dir: THREE.Vector3) => {
    const persp = camera as THREE.PerspectiveCamera;
    const fov = ((persp.fov ?? 45) * Math.PI) / 180;
    const aspect = size.width / Math.max(1, size.height);
    const halfAngle = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * aspect)) / 2;
    const dist = Math.max(0.25, radius / Math.sin(halfAngle));
    camera.position.copy(center).add(dir.clone().normalize().multiplyScalar(dist));
    camera.lookAt(center);
    if (controlsRef.current) {
      controlsRef.current.target.copy(center);
      controlsRef.current.update();
    }
  };
  useEffect(() => {
    frame(new THREE.Vector3(0, 0, 0), VIEW_SIZE * 0.62, new THREE.Vector3(0, 0.82, 0.57));
  }, [loadKey]);
  useEffect(() => {
    if (fitModelKey === 0 || !positions || positions.length < 3) return;
    const box = new THREE.Box3();
    const p = new THREE.Vector3();
    for (let i = 0; i < positions.length; i += 3) {
      const w = physToWorld(positions[i], positions[i + 1], positions[i + 2]);
      box.expandByPoint(p.set(w[0], w[1], w[2]));
    }
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const target = controlsRef.current?.target ?? new THREE.Vector3();
    const dir = camera.position.clone().sub(target);
    if (dir.lengthSq() < 1e-9) dir.set(0, 0.82, 0.57);
    frame(sphere.center, Math.max(sphere.radius * 1.15, 0.05), dir);
  }, [fitModelKey]);
  return null;
};

export const OrigamiModernCanvas: React.FC<OrigamiModernCanvasProps> = ({
  indices,
  positions,
  uvs = null,
  creaseEdges,
  showCreases = true,
  frontColor = theme.paperFront,
  backColor = theme.paperBack,
  className = '',
  showTable = false,
  paperThickness = 0.002,
  activeTool = 'drag',
  barycentricPin = null,
  barycentricDrag = null,
  reachRadius = null,
  previewCrease = null,
  foldOnlyTopLayer = false,
  onPreviewChange,
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
  fitModelKey = 0,
}) => {
  const orbitRef = useRef<any>(null);
  const [dblClickFit, setDblClickFit] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const sheetBounds = useMemo(() => {
    if (!uvs || uvs.length < 2) return { cx: 0.5, cy: 0.5, size: 1 };
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < uvs.length; i += 2) {
      x0 = Math.min(x0, uvs[i]); x1 = Math.max(x1, uvs[i]);
      y0 = Math.min(y0, uvs[i + 1]); y1 = Math.max(y1, uvs[i + 1]);
    }
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, size: Math.max(x1 - x0, y1 - y0) || 1 };
  }, [uvs]);
  VIEW.cx = sheetBounds.cx;
  VIEW.cy = sheetBounds.cy;
  VIEW.s = VIEW_SIZE / sheetBounds.size;
  VIEW.clampZ = showTable;

  // Compute 3D world position for barycentric pin marker
  const pinWorldPos = useMemo<[number, number, number] | null>(() => {
    if (!barycentricPin || !positions) return null;
    const pt = barycentricPin.point;
    const p0 = pt.v0 * 3, p1 = pt.v1 * 3, p2 = pt.v2 * 3;
    const curX = pt.w0 * positions[p0 + 0] + pt.w1 * positions[p1 + 0] + pt.w2 * positions[p2 + 0];
    const curY = pt.w0 * positions[p0 + 1] + pt.w1 * positions[p1 + 1] + pt.w2 * positions[p2 + 1];
    const curZ = pt.w0 * positions[p0 + 2] + pt.w1 * positions[p1 + 2] + pt.w2 * positions[p2 + 2];
    return physToWorld(curX, curY, curZ);
  }, [barycentricPin, positions]);

  // Compute 3D world position for barycentric drag marker
  // The app moves the drag target in place (no re-render per pointer move), so re-read it on every
  // frame (positions change each frame) instead of memoising on the drag object.
  const dragWorldPos = useMemo<[number, number, number] | null>(() => {
    if (!barycentricDrag) return null;
    return physToWorld(barycentricDrag.targetPos[0], barycentricDrag.targetPos[1], barycentricDrag.targetPos[2]);
  }, [barycentricDrag, barycentricDrag?.targetPos, positions]);

  // Reach circle center on the table
  const reachCenter = useMemo<[number, number, number] | null>(() => {
    if (!barycentricPin) return null;
    return physToWorld(barycentricPin.targetPos[0], barycentricPin.targetPos[1], 0.0005);
  }, [barycentricPin]);

  const cursorClass =
    activeTool === 'pivot'
      ? 'cursor-crosshair'
      : isDragging
      ? 'cursor-grabbing'
      : 'cursor-grab';

  return (
    <div className={`relative w-full h-full overflow-hidden ${cursorClass} ${className}`}>
      <Canvas
        onDoubleClick={() => setDblClickFit((k) => k + 1)}
        camera={{ position: [0.0, 2.8, 2.0], fov: 45, near: 0.01, far: 100 }}
        gl={{ antialias: true, alpha: true }}
      >
        <ThreeProfiler />
        {/* soft, neutral light: one key, one fill, warm bounce */}
        <hemisphereLight args={[theme.lightSky, theme.lightGround, 1.6]} />
        <directionalLight position={[3, 6, 4]} intensity={1.6} castShadow />
        <directionalLight position={[-3, 4, -2]} intensity={0.5} />

        {showTable && <TableSurface paperThickness={paperThickness} />}
        <CameraFit loadKey={indices} fitModelKey={fitModelKey + dblClickFit} positions={positions} controlsRef={orbitRef} />

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
              previewCrease={previewCrease}
              foldOnlyTopLayer={foldOnlyTopLayer}
              onPreviewChange={onPreviewChange}
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
              <ReachCircle center={reachCenter} radius={reachRadius * VIEW.s} />
            )}

            {/* Legacy vertex pin markers */}
            {pinnedVertices.map((v) => {
              return <PinMarker key={`pin-${v}`} position={physToWorld(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2])} />;
            })}

            {/* Legacy vertex drag marker */}
            {draggedVertex !== null && (
              <DragHandleMarker
                position={physToWorld(positions[draggedVertex * 3], positions[draggedVertex * 3 + 1], positions[draggedVertex * 3 + 2])}
              />
            )}
          </>
        )}

        <OrbitControls
          ref={orbitRef}
          makeDefault
          enableDamping
          dampingFactor={0.05}
          minDistance={0.2}
          maxDistance={30}
        />
      </Canvas>
    </div>
  );
};
