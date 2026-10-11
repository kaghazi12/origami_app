import React, { useState, useRef, useMemo } from 'react';
import type { Face, FoldSide, FoldKind, Vec2 } from '../engine';
import { worldPolygon } from '../engine';
import { Grid3X3, Slash } from 'lucide-react';

interface AuthoringCanvas2DProps {
  faces: readonly Face[];
  paperWidth: number;
  paperHeight: number;
  creaseFrom: Vec2 | null;
  creaseTo: Vec2 | null;
  onCreaseChange: (from: Vec2 | null, to: Vec2 | null) => void;
  movingSide: FoldSide;
  foldKind: FoldKind;
  selectedFaceIds: Set<string>;
  onToggleFaceSelect: (faceId: string) => void;
  isSpecificFaceMode: boolean;
  validationError: string | null;
}

export const AuthoringCanvas2D: React.FC<AuthoringCanvas2DProps> = ({
  faces,
  paperWidth,
  paperHeight,
  creaseFrom,
  creaseTo,
  onCreaseChange,
  movingSide,
  foldKind,
  selectedFaceIds,
  onToggleFaceSelect,
  isSpecificFaceMode,
  validationError,
}) => {
  const [activeDragPoint, setActiveDragPoint] = useState<'from' | 'to' | null>(null);

  // Exactly 2 options: 'none' (No grid) or 'custom' (Grid N by N)
  const [gridOption, setGridOption] = useState<'none' | 'grid'>('grid');
  const [gridDivisions, setGridDivisions] = useState<number>(3); // e.g. 3 for 3x3, 2 for 2x2, etc.

  const svgRef = useRef<SVGSVGElement>(null);

  // SVG dimensions
  const viewSize = 360;
  const padding = 25;
  const contentSize = viewSize - padding * 2;

  // Convert paper/world coords to SVG coords (SVG y goes down, paper y goes up)
  const toSvgX = (x: number) => padding + (x / paperWidth) * contentSize;
  const toSvgY = (y: number) => viewSize - padding - (y / paperHeight) * contentSize;

  // Convert SVG coords to paper coords
  const fromSvgCoords = (svgX: number, svgY: number): Vec2 => {
    const rawX = Math.max(0, Math.min(paperWidth, ((svgX - padding) / contentSize) * paperWidth));
    const rawY = Math.max(0, Math.min(paperHeight, ((viewSize - padding - svgY) / contentSize) * paperHeight));

    if (gridOption === 'none') {
      return [Number(rawX.toFixed(3)), Number(rawY.toFixed(3))];
    }

    // Snap to user-selected N x N grid
    const N = Math.max(1, Math.min(64, gridDivisions));
    const stepX = paperWidth / N;
    const stepY = paperHeight / N;

    const snappedX = Math.round(rawX / stepX) * stepX;
    const snappedY = Math.round(rawY / stepY) * stepY;

    return [
      Number(Math.max(0, Math.min(paperWidth, snappedX)).toFixed(4)),
      Number(Math.max(0, Math.min(paperHeight, snappedY)).toFixed(4)),
    ];
  };

  const handlePointerDownOnCanvas = (e: React.PointerEvent) => {
    if (activeDragPoint) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const paperPt = fromSvgCoords(clickX, clickY);

    if (!creaseFrom) {
      onCreaseChange(paperPt, null);
      setActiveDragPoint('to');
    } else if (!creaseTo) {
      onCreaseChange(creaseFrom, paperPt);
      setActiveDragPoint(null);
    } else {
      // Start new line from here
      onCreaseChange(paperPt, null);
      setActiveDragPoint('to');
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!activeDragPoint) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const curX = e.clientX - rect.left;
    const curY = e.clientY - rect.top;
    const paperPt = fromSvgCoords(curX, curY);

    if (activeDragPoint === 'to') {
      onCreaseChange(creaseFrom, paperPt);
    } else if (activeDragPoint === 'from') {
      onCreaseChange(paperPt, creaseTo);
    }
  };

  const handlePointerUp = () => {
    setActiveDragPoint(null);
  };

  // Crease line normal and moving direction indicator
  const creaseInfo = useMemo(() => {
    if (!creaseFrom || !creaseTo) return null;
    const dx = creaseTo[0] - creaseFrom[0];
    const dy = creaseTo[1] - creaseFrom[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-5) return null;

    const dirX = dx / len;
    const dirY = dy / len;
    const leftNormX = -dirY;
    const leftNormY = dirX;

    const midX = (creaseFrom[0] + creaseTo[0]) / 2;
    const midY = (creaseFrom[1] + creaseTo[1]) / 2;

    const arrowLen = 0.08;
    const mult = movingSide === 'left' ? 1 : -1;
    const arrowEndX = midX + leftNormX * arrowLen * mult;
    const arrowEndY = midY + leftNormY * arrowLen * mult;

    return {
      midX,
      midY,
      arrowEndX,
      arrowEndY,
      dirX,
      dirY,
      len,
    };
  }, [creaseFrom, creaseTo, movingSide]);

  // Compute Grid overlay lines for N x N
  const gridLines = useMemo(() => {
    if (gridOption === 'none') return null;
    const N = Math.max(1, Math.min(64, gridDivisions));
    const lines: { x1: number; y1: number; x2: number; y2: number; key: string }[] = [];

    // Vertical grid lines
    for (let i = 1; i < N; i++) {
      const x = (i / N) * paperWidth;
      lines.push({
        x1: toSvgX(x),
        y1: toSvgY(0),
        x2: toSvgX(x),
        y2: toSvgY(paperHeight),
        key: `v-${i}`,
      });
    }

    // Horizontal grid lines
    for (let j = 1; j < N; j++) {
      const y = (j / N) * paperHeight;
      lines.push({
        x1: toSvgX(0),
        y1: toSvgY(y),
        x2: toSvgX(paperWidth),
        y2: toSvgY(y),
        key: `h-${j}`,
      });
    }

    return lines;
  }, [gridOption, gridDivisions, paperWidth, paperHeight]);

  return (
    <div className="flex flex-col gap-2.5 w-full max-w-[390px] bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl select-none">
      {/* Header & The 2 Grid Options */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
            2D Fold Plane
          </h3>
          <button
            onClick={() => onCreaseChange(null, null)}
            className="text-[11px] text-rose-400 hover:text-rose-300 underline"
          >
            Clear line
          </button>
        </div>

        {/* 2 Options Only: [No Grid] or [Grid (N x N)] */}
        <div className="flex items-center justify-between bg-slate-950 p-1.5 rounded-lg border border-slate-800 text-xs">
          {/* Option 1: No Grid */}
          <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 hover:text-white px-2 py-1 rounded transition-colors">
            <input
              type="radio"
              name="gridOption"
              checked={gridOption === 'none'}
              onChange={() => setGridOption('none')}
              className="text-rose-500 focus:ring-0"
            />
            <span className="flex items-center gap-1 font-medium text-[11px]">
              <Slash className="w-3 h-3 text-slate-500" />
              No Grid
            </span>
          </label>

          {/* Option 2: Grid N x N */}
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 hover:text-white px-2 py-1 rounded transition-colors">
              <input
                type="radio"
                name="gridOption"
                checked={gridOption === 'grid'}
                onChange={() => setGridOption('grid')}
                className="text-rose-500 focus:ring-0"
              />
              <span className="flex items-center gap-1 font-medium text-[11px]">
                <Grid3X3 className="w-3 h-3 text-sky-400" />
                Grid:
              </span>
            </label>

            <div className="flex items-center gap-1 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-700">
              <input
                type="number"
                min={1}
                max={32}
                value={gridDivisions}
                disabled={gridOption === 'none'}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val) && val >= 1) {
                    setGridDivisions(val);
                    setGridOption('grid');
                  }
                }}
                className={`w-10 text-center font-mono font-bold text-xs bg-transparent focus:outline-none ${
                  gridOption === 'grid' ? 'text-sky-300' : 'text-slate-600'
                }`}
              />
              <span className="text-[10px] text-slate-400 font-mono">
                by {gridDivisions}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive SVG Canvas */}
      <div className="relative border border-slate-800 rounded-lg overflow-hidden bg-slate-950 flex items-center justify-center shadow-inner">
        <svg
          ref={svgRef}
          width={viewSize}
          height={viewSize}
          className="cursor-crosshair"
          onPointerDown={handlePointerDownOnCanvas}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {/* Paper Boundary Background */}
          <rect
            x={toSvgX(0)}
            y={toSvgY(paperHeight)}
            width={contentSize}
            height={contentSize}
            fill="#090d16"
            stroke="#334155"
            strokeWidth="1.5"
          />

          {/* Grid Overlay lines (when Grid option is active) */}
          {gridLines && (
            <g className="pointer-events-none">
              {gridLines.map((line) => (
                <line
                  key={line.key}
                  x1={line.x1}
                  y1={line.y1}
                  x2={line.x2}
                  y2={line.y2}
                  stroke="#38bdf8"
                  strokeOpacity="0.35"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                />
              ))}

              {/* Grid Intersection Snap Dots */}
              {Array.from({ length: gridDivisions + 1 }).map((_, i) =>
                Array.from({ length: gridDivisions + 1 }).map((_, j) => {
                  const x = (i / gridDivisions) * paperWidth;
                  const y = (j / gridDivisions) * paperHeight;
                  return (
                    <circle
                      key={`pt-${i}-${j}`}
                      cx={toSvgX(x)}
                      cy={toSvgY(y)}
                      r="1.5"
                      fill="#38bdf8"
                      fillOpacity="0.45"
                    />
                  );
                }),
              )}
            </g>
          )}

          {/* Existing Faces */}
          {faces.map((face) => {
            const poly = worldPolygon(face);
            const pointsStr = poly.map(([x, y]) => `${toSvgX(x)},${toSvgY(y)}`).join(' ');
            const isSelected = selectedFaceIds.has(face.id);

            return (
              <polygon
                key={face.id}
                points={pointsStr}
                fill={isSelected ? '#0284c7' : isSpecificFaceMode ? '#334155' : '#e11d48'}
                fillOpacity={isSelected ? 0.8 : 0.65}
                stroke="#f8fafc"
                strokeWidth={isSelected ? '2' : '1'}
                className="transition-colors hover:fill-rose-400/80 cursor-pointer"
                onClick={(e) => {
                  if (isSpecificFaceMode) {
                    e.stopPropagation();
                    onToggleFaceSelect(face.id);
                  }
                }}
              />
            );
          })}

          {/* Preserved Crease Edges (drawn on unfolded/flat faces so precreases remain permanently visible!) */}
          {faces.map((face) => {
            const poly = worldPolygon(face);
            const n = poly.length;
            return face.creaseEdges.map((isCrease, i) => {
              if (!isCrease) return null;
              const j = (i + 1) % n;
              const p1 = poly[i];
              const p2 = poly[j];
              return (
                <line
                  key={`${face.id}-crease-${i}`}
                  x1={toSvgX(p1[0])}
                  y1={toSvgY(p1[1])}
                  x2={toSvgX(p2[0])}
                  y2={toSvgY(p2[1])}
                  stroke="#f59e0b"
                  strokeWidth="2.5"
                  strokeDasharray="4 2"
                  strokeLinecap="round"
                />
              );
            });
          })}

          {/* Active Crease Line being drawn */}
          {creaseFrom && creaseTo && (
            <g>
              <line
                x1={toSvgX(creaseFrom[0])}
                y1={toSvgY(creaseFrom[1])}
                x2={toSvgX(creaseTo[0])}
                y2={toSvgY(creaseTo[1])}
                stroke={foldKind === 'valley' ? '#38bdf8' : foldKind === 'mountain' ? '#fbbf24' : '#10b981'}
                strokeWidth="2.5"
                strokeDasharray={foldKind === 'mountain' ? '6 4' : foldKind === 'unfold' ? '2 2' : undefined}
              />

              {/* Moving Direction Arrow */}
              {creaseInfo && (
                <g>
                  <line
                    x1={toSvgX(creaseInfo.midX)}
                    y1={toSvgY(creaseInfo.midY)}
                    x2={toSvgX(creaseInfo.arrowEndX)}
                    y2={toSvgY(creaseInfo.arrowEndY)}
                    stroke="#ffffff"
                    strokeWidth="2"
                    markerEnd="url(#arrow)"
                  />
                  <text
                    x={toSvgX(creaseInfo.arrowEndX) + 6}
                    y={toSvgY(creaseInfo.arrowEndY) + 4}
                    fill="#ffffff"
                    fontSize="10"
                    fontWeight="bold"
                  >
                    {foldKind === 'unfold' ? 'UNFOLD' : 'MOVING'} ({movingSide.toUpperCase()})
                  </text>
                </g>
              )}

              {/* Point From Handle */}
              <circle
                cx={toSvgX(creaseFrom[0])}
                cy={toSvgY(creaseFrom[1])}
                r="6"
                fill="#38bdf8"
                stroke="#ffffff"
                strokeWidth="2"
                className="cursor-grab active:cursor-grabbing"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setActiveDragPoint('from');
                }}
              />

              {/* Point To Handle */}
              <circle
                cx={toSvgX(creaseTo[0])}
                cy={toSvgY(creaseTo[1])}
                r="6"
                fill="#f43f5e"
                stroke="#ffffff"
                strokeWidth="2"
                className="cursor-grab active:cursor-grabbing"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setActiveDragPoint('to');
                }}
              />
            </g>
          )}

          {/* Arrow marker definition */}
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="5"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#ffffff" />
            </marker>
          </defs>
        </svg>

        {/* Status indicator on bottom */}
        <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between text-[11px] pointer-events-none">
          {validationError ? (
            <span className="bg-rose-950/90 text-rose-300 border border-rose-800/80 px-2 py-0.5 rounded shadow">
              ⚠️ {validationError}
            </span>
          ) : foldKind === 'unfold' ? (
            <span className="bg-emerald-950/90 text-emerald-300 border border-emerald-800/80 px-2 py-0.5 rounded shadow">
              ↺ Ready: Unfold will return previous flap flat & preserve crease
            </span>
          ) : creaseFrom && creaseTo ? (
            <span className="bg-emerald-950/90 text-emerald-300 border border-emerald-800/80 px-2 py-0.5 rounded shadow">
              ✓ Valid crease line
            </span>
          ) : (
            <span className="bg-slate-900/90 text-slate-400 border border-slate-800 px-2 py-0.5 rounded shadow">
              Click 2 points on the paper to set crease
            </span>
          )}
        </div>
      </div>

      {/* Coordinate & Crease Legend Readout */}
      {foldKind !== 'unfold' && (
        <div className="flex items-center justify-between text-xs font-mono text-slate-400 px-1">
          <div>From: {creaseFrom ? `[${creaseFrom[0]}, ${creaseFrom[1]}]` : 'None'}</div>
          <div>To: {creaseTo ? `[${creaseTo[0]}, ${creaseTo[1]}]` : 'None'}</div>
        </div>
      )}
      <div className="flex items-center gap-2 text-[10px] text-slate-500 font-sans px-1">
        <span className="inline-block w-3 h-0.5 bg-amber-500 border-dashed border-b" />
        <span>Golden dashed lines = existing creases</span>
      </div>
    </div>
  );
};
