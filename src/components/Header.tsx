import React from 'react';
import {
  Palette,
  Eye,
  Grid3X3,
  PenTool,
  Boxes,
  Sparkles,
} from 'lucide-react';
import { PAPER_THEMES } from '../materials/PaperShaderMaterial';
import type { FoldModel } from '../engine';

interface HeaderProps {
  currentModel: FoldModel;
  onSelectModel: (modelId: string) => void;
  availableModels: { id: string; name: string }[];
  activeTab: 'viewer' | 'author';
  onChangeTab: (tab: 'viewer' | 'author') => void;
  selectedThemeId: string;
  onSelectTheme: (themeId: string) => void;
  showCreaseLines: boolean;
  onToggleCreaseLines: () => void;
  showCuttingMat: boolean;
  onToggleCuttingMat: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentModel,
  onSelectModel,
  availableModels,
  activeTab,
  onChangeTab,
  selectedThemeId,
  onSelectTheme,
  showCreaseLines,
  onToggleCreaseLines,
  showCuttingMat,
  onToggleCuttingMat,
}) => {
  return (
    <header className="h-16 px-6 bg-slate-900/90 backdrop-blur-xl border-b border-slate-800 flex items-center justify-between text-slate-100 z-30 select-none shadow-md">
      {/* Brand & Model Selector */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-rose-600 to-amber-500 flex items-center justify-center shadow-lg shadow-rose-600/30">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-sm leading-tight text-white flex items-center gap-1.5">
              Origami Studio <span className="text-[10px] font-mono px-1.5 py-0.2 bg-rose-500/20 text-rose-300 rounded border border-rose-500/30">3D</span>
            </h1>
            <p className="text-[11px] text-slate-400">R3F Fold Engine</p>
          </div>
        </div>

        {/* Model Dropdown */}
        <div className="flex items-center gap-2 bg-slate-950/80 px-3 py-1.5 rounded-lg border border-slate-800">
          <span className="text-xs text-slate-400 font-medium">Model:</span>
          <select
            value={currentModel.id}
            onChange={(e) => onSelectModel(e.target.value)}
            className="bg-transparent text-xs font-semibold text-rose-300 focus:outline-none cursor-pointer"
          >
            {availableModels.map((m) => (
              <option key={m.id} value={m.id} className="bg-slate-900 text-slate-200">
                {m.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tab Switcher: Viewer vs Authoring */}
      <div className="flex items-center bg-slate-950/80 p-1 rounded-xl border border-slate-800">
        <button
          onClick={() => onChangeTab('viewer')}
          className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'viewer'
              ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Boxes className="w-3.5 h-3.5" />
          <span>3D Viewer & Scrubber</span>
        </button>
        <button
          onClick={() => onChangeTab('author')}
          className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'author'
              ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <PenTool className="w-3.5 h-3.5" />
          <span>Authoring Suite</span>
        </button>
      </div>

      {/* Style & Display Toggles */}
      <div className="flex items-center gap-3">
        {/* Paper Theme Selector */}
        <div className="flex items-center gap-2 bg-slate-950/80 px-3 py-1.5 rounded-lg border border-slate-800">
          <Palette className="w-3.5 h-3.5 text-rose-400" />
          <select
            value={selectedThemeId}
            onChange={(e) => onSelectTheme(e.target.value)}
            className="bg-transparent text-xs font-medium text-slate-200 focus:outline-none cursor-pointer"
          >
            {PAPER_THEMES.map((th) => (
              <option key={th.id} value={th.id} className="bg-slate-900 text-slate-200">
                {th.name}
              </option>
            ))}
          </select>
        </div>

        {/* Crease Lines Toggle */}
        <button
          onClick={onToggleCreaseLines}
          className={`p-2 rounded-lg border transition-colors ${
            showCreaseLines
              ? 'bg-slate-800 text-rose-400 border-rose-500/30'
              : 'bg-slate-950 text-slate-500 border-slate-800'
          }`}
          title="Toggle crease lines visibility"
        >
          <Eye className="w-4 h-4" />
        </button>

        {/* Cutting Mat / 3D Grid Toggle */}
        <button
          onClick={onToggleCuttingMat}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
            showCuttingMat
              ? 'bg-sky-500/20 text-sky-300 border-sky-500/40 shadow-sm'
              : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-900'
          }`}
          title="Toggle 3D background grid on/off"
        >
          <Grid3X3 className="w-3.5 h-3.5" />
          <span>Grid: {showCuttingMat ? 'ON' : 'OFF'}</span>
        </button>
      </div>
    </header>
  );
};
