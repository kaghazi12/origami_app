import React, { useRef, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { TrackballControls, Grid, Center } from '@react-three/drei';
import type { TrackballControls as TrackballControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { PaperMesh } from './PaperMesh';
import type { PosedFace } from '../engine';

interface OrigamiCanvasProps {
  faces: PosedFace[];
  paperMaterial: THREE.ShaderMaterial;
  paperWidth: number;
  paperHeight: number;
  selectedFaceIds?: Set<string>;
  onFaceClick?: (faceId: string) => void;
  showCreaseLines?: boolean;
  showCuttingMat?: boolean;
  resetTrigger?: number;
}

export const OrigamiCanvas: React.FC<OrigamiCanvasProps> = ({
  faces,
  paperMaterial,
  paperWidth,
  paperHeight,
  selectedFaceIds,
  onFaceClick,
  showCreaseLines = true,
  showCuttingMat = false,
  resetTrigger = 0,
}) => {
  const controlsRef = useRef<TrackballControlsImpl>(null);

  useEffect(() => {
    if (resetTrigger > 0 && controlsRef.current) {
      controlsRef.current.reset();
    }
  }, [resetTrigger]);

  return (
    <div className="w-full h-full relative select-none bg-slate-950">
      <Canvas
        camera={{ position: [0.8, -1.2, 1.8], fov: 42, near: 0.05, far: 50 }}
        shadows
        gl={{ antialias: true, alpha: false, preserveDrawingBuffer: true }}
      >
        <color attach="background" args={['#090d16']} />
        
        {/* Studio Lighting */}
        <ambientLight intensity={0.65} color="#dbeafe" />
        <directionalLight
          position={[3, 5, 6]}
          intensity={1.2}
          color="#fffaf0"
          castShadow
          shadow-mapSize={1024}
        />
        <directionalLight
          position={[-3, -4, 4]}
          intensity={0.5}
          color="#93c5fd"
        />
        {/* Backlight under the table for translucency */}
        <directionalLight
          position={[0, 0, -4]}
          intensity={0.4}
          color="#fef08a"
        />

        {/* Origami Paper in Center */}
        <Center position={[0, 0, 0.05]}>
          <group position={[-paperWidth / 2, -paperHeight / 2, 0]}>
            <PaperMesh
              faces={faces}
              paperMaterial={paperMaterial}
              paperWidth={paperWidth}
              paperHeight={paperHeight}
              selectedFaceIds={selectedFaceIds}
              onFaceClick={onFaceClick}
              showCreaseLines={showCreaseLines}
            />
          </group>
        </Center>

        {/* Studio Grid (Non-blocking: no opaque occluding slab, raycast disabled) */}
        {showCuttingMat && (
          <group position={[0, 0, -0.005]} raycast={() => null}>
            <Grid
              position={[0, 0, 0]}
              rotation={[Math.PI / 2, 0, 0]}
              args={[3, 3]}
              cellSize={0.1}
              cellThickness={0.8}
              cellColor="#334155"
              sectionSize={0.5}
              sectionThickness={1.2}
              sectionColor="#475569"
              fadeDistance={15}
              fadeStrength={1}
            />
          </group>
        )}

        {/* Trackball Controls (Full 360° unblocked rotation from top, bottom, and all directions) */}
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
    </div>
  );
};
