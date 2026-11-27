import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { DesignAnimator, Pose } from '../../engine/design';
import { theme } from '../../theme';

interface PaperProps {
  pose: Pose;
  front: string;
  back: string;
  showCreases: boolean;
}

/** The folded sheet: one geometry per step topology, positions rewritten every frame. */
const Paper: React.FC<PaperProps> = ({ pose, front, back, showCreases }) => {
  const g = pose.geometry;
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setIndex(new THREE.BufferAttribute(g.indices, 1));
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(g.cornerCount * 3), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(g.uvs, 2));
    return geo;
  }, [g]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const folded = useMemo(() => new THREE.BufferGeometry(), []);
  const flat = useMemo(() => new THREE.BufferGeometry(), []);
  useEffect(() => () => { folded.dispose(); flat.dispose(); }, [folded, flat]);

  useLayoutEffect(() => {
    const attr = geometry.getAttribute('position') as THREE.BufferAttribute;
    (attr.array as Float32Array).set(pose.positions);
    attr.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    folded.setAttribute('position', new THREE.BufferAttribute(pose.foldedLines, 3));
    flat.setAttribute('position', new THREE.BufferAttribute(pose.flatLines, 3));
    folded.computeBoundingSphere();
    flat.computeBoundingSphere();
  }, [pose, geometry, folded, flat]);

  return (
    <group>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial
          color={front}
          side={THREE.FrontSide}
          roughness={0.85}
          metalness={0}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial
          color={back}
          side={THREE.BackSide}
          roughness={0.9}
          metalness={0}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>
      {showCreases && (
        <>
          <lineSegments geometry={folded}>
            <lineBasicMaterial color={theme.ink} transparent opacity={0.5} />
          </lineSegments>
          <lineSegments geometry={flat}>
            <lineBasicMaterial color={theme.inkMuted} transparent opacity={0.22} />
          </lineSegments>
        </>
      )}
    </group>
  );
};

/** Keeps the orbit target on the model as it moves around the table. */
const FollowModel: React.FC<{ pose: Pose; resetKey: number }> = ({ pose, resetKey }) => {
  const controls = useThree((s) => s.controls) as unknown as OrbitControlsImpl | null;
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const target = useRef(new THREE.Vector3());
  const first = useRef(true);

  const center = useMemo(() => {
    const p = pose.positions;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]);
      minY = Math.min(minY, p[i + 1]); maxY = Math.max(maxY, p[i + 1]);
      minZ = Math.min(minZ, p[i + 2]); maxZ = Math.max(maxZ, p[i + 2]);
    }
    return new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
  }, [pose]);

  useEffect(() => {
    first.current = true;
  }, [resetKey]);

  useFrame(() => {
    if (!controls) return;
    if (first.current) {
      target.current.copy(center);
      controls.target.copy(center);
      // pull back on portrait screens so the sheet fits the width too
      const k = Math.max(1, 1.25 / Math.max(size.width / Math.max(size.height, 1), 0.01));
      camera.position.set(center.x, center.y - 1.4 * k, center.z + 1.9 * k);
      camera.up.set(0, 0, 1);
      camera.lookAt(center);
      first.current = false;
    } else {
      // move target and camera together so the user's orbit angle is kept
      const delta = center.clone().sub(target.current).multiplyScalar(0.08);
      target.current.add(delta);
      controls.target.add(delta);
      camera.position.add(delta);
    }
    controls.update();
  });
  return null;
};

export interface DesignViewer3DProps {
  animator: DesignAnimator;
  progress: number;
  front: string;
  back: string;
  showCreases: boolean;
  resetKey: number;
  /** Scene background. Defaults to the viewer token. */
  background?: string;
  /** 'rotate' turns off zoom and pan, for embeds where the mouse wheel should scroll the page. */
  controls?: 'full' | 'rotate';
}

export const DesignViewer3D: React.FC<DesignViewer3DProps> = ({
  animator,
  progress,
  front,
  back,
  showCreases,
  resetKey,
  background = theme.viewer,
  controls = 'full',
}) => {
  const pose = useMemo(() => animator.pose(progress), [animator, progress]);
  return (
    <Canvas
      shadows
      camera={{ position: [0.5, -0.6, 1.6], fov: 40, near: 0.01, far: 50, up: [0, 0, 1] }}
      gl={{ antialias: true }}
      dpr={[1, 2]}
    >
      <color attach="background" args={[background]} />
      {/* soft, neutral light: paper colours come from the design */}
      <hemisphereLight args={[theme.lightSky, theme.lightGround, 1.1]} position={[0, 0, 1]} />
      <directionalLight position={[1.5, -1.5, 3]} intensity={1.35} castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-0.0005} />
      <directionalLight position={[-2, 1.5, 1.5]} intensity={0.35} />
      <directionalLight position={[0, 0, -3]} intensity={0.3} />
      <Paper pose={pose} front={front} back={back} showCreases={showCreases} />
      {/* barely-there shadow catcher instead of a grid */}
      <mesh position={[0.5, 0.5, -0.004]} receiveShadow>
        <planeGeometry args={[8, 8]} />
        <shadowMaterial transparent opacity={0.12} />
      </mesh>
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.12}
        enableZoom={controls === 'full'}
        enablePan={controls === 'full'}
      />
      <FollowModel pose={pose} resetKey={resetKey} />
    </Canvas>
  );
};
