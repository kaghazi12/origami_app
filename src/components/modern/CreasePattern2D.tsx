import React, { useMemo } from 'react';
import { FoldFormat } from '../../engine/types';

interface CreasePattern2DProps {
  fold: FoldFormat | null;
  className?: string;
}

export const CreasePattern2D: React.FC<CreasePattern2DProps> = React.memo(({ fold, className = '' }) => {
  if (typeof window !== 'undefined') {
    const prof = ((window as any).__ORIGAMI_PROFILING__ = (window as any).__ORIGAMI_PROFILING__ || {});
    prof.creasePatternRenderCount = (prof.creasePatternRenderCount || 0) + 1;
  }

  const { bounds, elements } = useMemo(() => {
    if (!fold || !fold.vertices_coords || fold.vertices_coords.length === 0) {
      return {
        bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1, width: 1, height: 1 },
        elements: [],
      };
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of fold.vertices_coords) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    const pad = Math.max((maxX - minX) * 0.08, 0.05);
    const boxMinX = minX - pad;
    const boxMaxX = maxX + pad;
    const boxMinY = minY - pad;
    const boxMaxY = maxY + pad;
    const width = boxMaxX - boxMinX;
    const height = boxMaxY - boxMinY;

    const lines: Array<{
      id: number;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      stroke: string;
      strokeWidth: number;
      dash?: string;
      assignment: string;
      foldAngle: number;
    }> = [];

    const edges = fold.edges_vertices || [];
    const assignments = fold.edges_assignment || [];
    const foldAngles = fold.edges_foldAngle || [];

    for (let i = 0; i < edges.length; i++) {
      const [u, v] = edges[i];
      const p1 = fold.vertices_coords[u];
      const p2 = fold.vertices_coords[v];
      if (!p1 || !p2) continue;

      const assign = assignments[i] || 'U';
      const angle = foldAngles[i] ?? 0;

      let stroke = '#9CA3AF'; // grey
      let strokeWidth = 1.5;
      let dash: string | undefined = undefined;

      switch (assign) {
        case 'B':
          stroke = '#111827'; // black
          strokeWidth = 2.5;
          break;
        case 'M':
          stroke = '#EF4444'; // red
          strokeWidth = 2.0;
          break;
        case 'V':
          stroke = '#3B82F6'; // blue
          strokeWidth = 2.0;
          dash = '4 2';
          break;
        case 'F':
          stroke = '#6B7280'; // darker grey
          strokeWidth = 1.2;
          dash = '2 2';
          break;
        default:
          stroke = '#9CA3AF';
          strokeWidth = 1.0;
          break;
      }

      lines.push({
        id: i,
        x1: p1[0],
        y1: p1[1],
        x2: p2[0],
        y2: p2[1],
        stroke,
        strokeWidth,
        dash,
        assignment: assign,
        foldAngle: angle,
      });
    }

    return {
      bounds: { minX: boxMinX, maxX: boxMaxX, minY: boxMinY, maxY: boxMaxY, width, height },
      elements: lines,
    };
  }, [fold]);

  if (!fold) {
    return (
      <div className={`flex items-center justify-center bg-gray-50 text-gray-400 text-sm ${className}`}>
        No crease pattern loaded
      </div>
    );
  }

  // Flip Y coordinate so SVG matches standard cartesian (0,0 bottom-left)
  return (
    <div className={`relative flex flex-col bg-white border border-gray-200 rounded-lg overflow-hidden ${className}`}>
      {/* Title & Legend Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs">
        <span className="font-semibold text-gray-700">{fold.file_title || '2D Crease Pattern'}</span>
        <div className="flex items-center space-x-3">
          <span className="flex items-center space-x-1">
            <span className="w-3 h-0.5 bg-black inline-block"></span>
            <span className="text-gray-600">Boundary</span>
          </span>
          <span className="flex items-center space-x-1">
            <span className="w-3 h-0.5 bg-red-500 inline-block"></span>
            <span className="text-red-600 font-medium">Mountain (M)</span>
          </span>
          <span className="flex items-center space-x-1">
            <span className="w-3 h-0.5 border-t border-blue-500 border-dashed inline-block"></span>
            <span className="text-blue-600 font-medium">Valley (V)</span>
          </span>
          <span className="flex items-center space-x-1">
            <span className="w-3 h-0.5 bg-gray-400 inline-block"></span>
            <span className="text-gray-500">Flat / Unassigned</span>
          </span>
        </div>
      </div>

      {/* SVG Canvas */}
      <div className="flex-1 w-full h-full min-h-[300px] flex items-center justify-center p-4">
        <svg
          viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
          className="w-full h-full max-h-[500px]"
          style={{ transform: 'scaleY(-1)' }} // Cartesian Y-up orientation
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Background paper rect */}
          <rect
            x={bounds.minX}
            y={bounds.minY}
            width={bounds.width}
            height={bounds.height}
            fill="#FAFAFA"
          />

          {/* Crease Edges */}
          {elements.map((line) => (
            <line
              key={line.id}
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              stroke={line.stroke}
              strokeWidth={line.strokeWidth * (bounds.width / 400)}
              strokeDasharray={line.dash}
              strokeLinecap="round"
            >
              <title>{`Edge ${line.id}: [${line.assignment}] ${line.foldAngle}°`}</title>
            </line>
          ))}

          {/* Vertex Dots */}
          {fold.vertices_coords.map(([x, y], idx) => (
            <circle
              key={idx}
              cx={x}
              cy={y}
              r={1.8 * (bounds.width / 400)}
              fill="#374151"
            >
              <title>{`Vertex ${idx}: (${x.toFixed(3)}, ${y.toFixed(3)})`}</title>
            </circle>
          ))}
        </svg>
      </div>

      {/* Footer Details */}
      <div className="px-4 py-1.5 bg-gray-50 border-t border-gray-200 text-[11px] text-gray-500 flex justify-between">
        <span>Vertices: {fold.vertices_coords.length} | Edges: {fold.edges_vertices.length}</span>
        <span>Spec: FOLD {fold.file_spec || 1.1}</span>
      </div>
    </div>
  );
});
