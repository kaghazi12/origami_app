import React, { useRef, useEffect, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Center } from '@react-three/drei';
import * as THREE from 'three';
import { CreaseEdgeInfo } from '../../engine/worker/types';

interface OrigamiModernCanvasProps {
  indices: Uint32Array | null;
  positions: Float32Array | null;
  creaseEdges: CreaseEdgeInfo[];
  showCreases?: boolean;
  frontColor?: string;
  backColor?: string;
  className?: string;
}

const PaperMesh: React.FC<{
  indices: Uint32Array;
  positions: Float32Array;
  creaseEdges: CreaseEdgeInfo[];
  showCreases: boolean;
  frontColor: string;
  backColor: string;
}> = ({ indices, positions, creaseEdges, showCreases, frontColor, backColor }) => {
  // Create persistent BufferGeometry instance once
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(new Float32Array(positions.length), 3);
    geo.setAttribute('position', posAttr);
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
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
    }

    // Update crease lines
    if (creaseGeometry && showCreases) {
      const linePosAttr = creaseGeometry.getAttribute('position') as THREE.BufferAttribute;
      if (linePosAttr) {
        const lineArr = linePosAttr.array as Float32Array;
        for (let i = 0; i < creaseEdges.length; i++) {
          const e = creaseEdges[i];
          const v0 = e.v0;
          const v1 = e.v1;
          const idx0 = v0 * 3;
          const idx1 = v1 * 3;

          // Lift slightly along Z to avoid z-fighting with paper surface
          lineArr[i * 6 + 0] = positions[idx0 + 0];
          lineArr[i * 6 + 1] = positions[idx0 + 1];
          lineArr[i * 6 + 2] = positions[idx0 + 2] + 0.001;

          lineArr[i * 6 + 3] = positions[idx1 + 0];
          lineArr[i * 6 + 1 + 3] = positions[idx1 + 1];
          lineArr[i * 6 + 2 + 3] = positions[idx1 + 2] + 0.001;
        }
        linePosAttr.needsUpdate = true;
      }
    }
  }, [positions, geometry, creaseGeometry, creaseEdges, showCreases]);

  return (
    <group>
      {/* Front Face: crisp origami paper color */}
      <mesh geometry={geometry}>
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

export const OrigamiModernCanvas: React.FC<OrigamiModernCanvasProps> = ({
  indices,
  positions,
  creaseEdges,
  showCreases = true,
  frontColor = '#FCFBF7',
  backColor = '#EA580C', // Vibrant Origami Amber/Orange
  className = '',
}) => {
  return (
    <div className={`relative w-full h-full min-h-[300px] bg-gradient-to-b from-gray-100 to-gray-200 rounded-lg overflow-hidden border border-gray-300 ${className}`}>
      <Canvas
        camera={{ position: [0.8, 1.2, 1.6], fov: 45 }}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.75} />
        <directionalLight position={[4, 8, 5]} intensity={1.1} castShadow />
        <directionalLight position={[-4, -4, -3]} intensity={0.4} />

        <Center top position={[0, 0, 0]}>
          {indices && positions && (
            <PaperMesh
              indices={indices}
              positions={positions}
              creaseEdges={creaseEdges}
              showCreases={showCreases}
              frontColor={frontColor}
              backColor={backColor}
            />
          )}
        </Center>

        <OrbitControls
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
