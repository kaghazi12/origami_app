import React, { useMemo, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { triangulateFan, type PosedFace } from '../engine';
import { clonePaperMaterialWithSelection } from '../materials/PaperShaderMaterial';

interface PaperMeshProps {
  faces: PosedFace[];
  paperMaterial: THREE.ShaderMaterial;
  paperWidth?: number;
  paperHeight?: number;
  selectedFaceIds?: Set<string>;
  onFaceClick?: (faceId: string) => void;
  showCreaseLines?: boolean;
}

export const PaperMesh: React.FC<PaperMeshProps> = ({
  faces,
  paperMaterial,
  paperWidth = 1,
  paperHeight = 1,
  selectedFaceIds,
  onFaceClick,
  showCreaseLines = true,
}) => {
  return (
    <group>
      {faces.map((face) => (
        <SingleFaceMesh
          key={face.id}
          face={face}
          paperMaterial={paperMaterial}
          paperWidth={paperWidth}
          paperHeight={paperHeight}
          isSelected={selectedFaceIds?.has(face.id) ?? false}
          onFaceClick={onFaceClick}
          showCreaseLines={showCreaseLines}
        />
      ))}
    </group>
  );
};

interface SingleFaceMeshProps {
  face: PosedFace;
  paperMaterial: THREE.ShaderMaterial;
  paperWidth: number;
  paperHeight: number;
  isSelected: boolean;
  onFaceClick?: (faceId: string) => void;
  showCreaseLines: boolean;
}

/** Realistic physical paper thickness (half-thickness for symmetrical prism extrusion) */
export const PAPER_HALF_THICKNESS = 0.0016; // ~0.0032 total thickness (tangible paper sheet depth)

const SingleFaceMesh: React.FC<SingleFaceMeshProps> = ({
  face,
  paperMaterial,
  paperWidth,
  paperHeight,
  isSelected,
  onFaceClick,
  showCreaseLines,
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const creaseLinesRef = useRef<THREE.LineSegments>(null);
  const borderLinesRef = useRef<THREE.LineSegments>(null);

  // Build 3D solid prism geometry from face polygon with physical thickness
  const geometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const poly = face.polygon;
    const n = poly.length;
    if (n < 3) return geom;

    const h = PAPER_HALF_THICKNESS;

    // Vertex count:
    // Top surface: n vertices
    // Bottom surface: n vertices
    // Side cut walls: n segments * 4 vertices = 4n vertices
    const totalVertices = n * 6;
    const positions = new Float32Array(totalVertices * 3);
    const normals = new Float32Array(totalVertices * 3);
    const uvs = new Float32Array(totalVertices * 2);

    let vIdx = 0;

    // 1. Top Cap (Front Kami face: normal = (0, 0, 1), z = +h)
    const topStartIndex = vIdx;
    for (let i = 0; i < n; i++) {
      const [u, v] = poly[i];
      positions[vIdx * 3 + 0] = u;
      positions[vIdx * 3 + 1] = v;
      positions[vIdx * 3 + 2] = h;

      normals[vIdx * 3 + 0] = 0;
      normals[vIdx * 3 + 1] = 0;
      normals[vIdx * 3 + 2] = 1;

      uvs[vIdx * 2 + 0] = u / paperWidth;
      uvs[vIdx * 2 + 1] = v / paperHeight;
      vIdx++;
    }

    // 2. Bottom Cap (Back Washi face: normal = (0, 0, -1), z = -h)
    const bottomStartIndex = vIdx;
    for (let i = 0; i < n; i++) {
      const [u, v] = poly[i];
      positions[vIdx * 3 + 0] = u;
      positions[vIdx * 3 + 1] = v;
      positions[vIdx * 3 + 2] = -h;

      normals[vIdx * 3 + 0] = 0;
      normals[vIdx * 3 + 1] = 0;
      normals[vIdx * 3 + 2] = -1;

      uvs[vIdx * 2 + 0] = u / paperWidth;
      uvs[vIdx * 2 + 1] = v / paperHeight;
      vIdx++;
    }

    // 3. Side Walls (Cut rim around edges connecting top and bottom caps)
    const sideStartIndex = vIdx;
    let area = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1];
    }
    const isCCW = area >= 0;

    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const p1 = poly[i];
      const p2 = poly[j];
      const dx = p2[0] - p1[0];
      const dy = p2[1] - p1[1];
      const len = Math.hypot(dx, dy) || 1;

      // Outward 2D normal
      const nx = isCCW ? dy / len : -dy / len;
      const ny = isCCW ? -dx / len : dx / len;

      const quadPts = [
        [p1[0], p1[1], h],
        [p2[0], p2[1], h],
        [p2[0], p2[1], -h],
        [p1[0], p1[1], -h],
      ];

      for (let k = 0; k < 4; k++) {
        const pt = quadPts[k];
        positions[vIdx * 3 + 0] = pt[0];
        positions[vIdx * 3 + 1] = pt[1];
        positions[vIdx * 3 + 2] = pt[2];

        normals[vIdx * 3 + 0] = nx;
        normals[vIdx * 3 + 1] = ny;
        normals[vIdx * 3 + 2] = 0;

        uvs[vIdx * 2 + 0] = pt[0] / paperWidth;
        uvs[vIdx * 2 + 1] = pt[1] / paperHeight;
        vIdx++;
      }
    }

    // Build Index buffer
    const indices: number[] = [];

    // Top cap fan (CCW from +Z: 0, i, i+1)
    for (let i = 1; i < n - 1; i++) {
      indices.push(topStartIndex, topStartIndex + i, topStartIndex + i + 1);
    }

    // Bottom cap fan (Reversed winding so it faces -Z: 0, i+1, i)
    for (let i = 1; i < n - 1; i++) {
      indices.push(bottomStartIndex, bottomStartIndex + i + 1, bottomStartIndex + i);
    }

    // Side wall quads: 2 triangles per edge
    for (let i = 0; i < n; i++) {
      const base = sideStartIndex + i * 4;
      indices.push(base + 0, base + 3, base + 1);
      indices.push(base + 1, base + 3, base + 2);
    }

    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geom.setIndex(indices);
    return geom;
  }, [face.polygon, paperWidth, paperHeight]);

  // Crease edge line geometry (visible on both top and bottom surfaces of the face)
  const creaseGeom = useMemo(() => {
    const points: number[] = [];
    const poly = face.polygon;
    const n = poly.length;
    const h = PAPER_HALF_THICKNESS;
    for (let i = 0; i < n; i++) {
      if (face.creaseEdges[i]) {
        const j = (i + 1) % n;
        // Offset on both +z and -z so crease mark is clearly visible on both surfaces
        points.push(poly[i][0], poly[i][1], h + 0.0003);
        points.push(poly[j][0], poly[j][1], h + 0.0003);
        points.push(poly[i][0], poly[i][1], -h - 0.0003);
        points.push(poly[j][0], poly[j][1], -h - 0.0003);
      }
    }
    if (points.length === 0) return null;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    return geom;
  }, [face.polygon, face.creaseEdges]);

  // Outer paper border line geometry (crisp cut boundary along top and bottom rims)
  const borderGeom = useMemo(() => {
    const points: number[] = [];
    const poly = face.polygon;
    const n = poly.length;
    const h = PAPER_HALF_THICKNESS;
    for (let i = 0; i < n; i++) {
      if (!face.creaseEdges[i]) {
        const j = (i + 1) % n;
        points.push(poly[i][0], poly[i][1], h + 0.0001);
        points.push(poly[j][0], poly[j][1], h + 0.0001);
        points.push(poly[i][0], poly[i][1], -h - 0.0001);
        points.push(poly[j][0], poly[j][1], -h - 0.0001);
      }
    }
    if (points.length === 0) return null;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    return geom;
  }, [face.polygon, face.creaseEdges]);

  // Update transform matrix directly from face.matrix
  useEffect(() => {
    const m = new THREE.Matrix4().fromArray(face.matrix);
    if (meshRef.current) {
      meshRef.current.matrix.copy(m);
      meshRef.current.matrixWorldNeedsUpdate = true;
    }
    if (creaseLinesRef.current) {
      creaseLinesRef.current.matrix.copy(m);
      creaseLinesRef.current.matrixWorldNeedsUpdate = true;
    }
    if (borderLinesRef.current) {
      borderLinesRef.current.matrix.copy(m);
      borderLinesRef.current.matrixWorldNeedsUpdate = true;
    }
  }, [face.matrix]);

  // Highlight material if selected
  const materialToUse = useMemo(() => {
    return clonePaperMaterialWithSelection(paperMaterial, isSelected);
  }, [isSelected, paperMaterial]);

  return (
    <group>
      <mesh
        ref={meshRef}
        geometry={geometry}
        material={materialToUse}
        matrixAutoUpdate={false}
        onClick={(e) => {
          if (onFaceClick) {
            e.stopPropagation();
            onFaceClick(face.id);
          }
        }}
      />
      {showCreaseLines && creaseGeom && (
        <lineSegments ref={creaseLinesRef} geometry={creaseGeom} matrixAutoUpdate={false}>
          <lineBasicMaterial color="#f59e0b" linewidth={2} opacity={0.9} transparent />
        </lineSegments>
      )}
      {borderGeom && (
        <lineSegments ref={borderLinesRef} geometry={borderGeom} matrixAutoUpdate={false}>
          <lineBasicMaterial color="#64748b" linewidth={1} opacity={0.4} transparent />
        </lineSegments>
      )}
    </group>
  );
};
