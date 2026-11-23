import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { DesignAnimator, Pose } from '../../engine/design';

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
            <lineBasicMaterial color="#0f172a" transparent opacity={0.55} />
          </lineSegments>
          <lineSegments geometry={flat}>
            <lineBasicMaterial color="#334155" transparent opacity={0.25} />
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
      camera.position.set(center.x, center.y - 1.1, center.z + 1.5);
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
}

export const DesignViewer3D: React.FC<DesignViewer3DProps> = ({ animator, progress, front, back, showCreases, resetKey }) => {
  const pose = useMemo(() => animator.pose(progress), [animator, progress]);
  return (
    <Canvas
      shadows
      camera={{ position: [0.5, -0.6, 1.6], fov: 40, near: 0.01, far: 50, up: [0, 0, 1] }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={['#0b1020']} />
      <hemisphereLight args={['#e2e8f0', '#1e293b', 0.7]} />
      <directionalLight position={[1.5, -1.5, 3]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-2, 1.5, 1.5]} intensity={0.45} />
      <directionalLight position={[0, 0, -3]} intensity={0.35} />
      <Paper pose={pose} front={front} back={back} showCreases={showCreases} />
      <gridHelper args={[4, 40, '#1e293b', '#141c2f']} rotation={[Math.PI / 2, 0, 0]} position={[0.5, 0.5, -0.02]} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} />
      <FollowModel pose={pose} resetKey={resetKey} />
    </Canvas>
  );
};
