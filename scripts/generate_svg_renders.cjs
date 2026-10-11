const fs = require('fs');
const path = require('path');

const artifactDir = 'C:/Users/Gulraiz/.gemini/antigravity/brain/5eb405bc-ed6f-4994-9e61-977e5c6e7156';
const dumpFile = path.join(artifactDir, 'phase4_trajectory_dump.json');
const dumps = JSON.parse(fs.readFileSync(dumpFile, 'utf8'));

// Isometric 3D to 2D projection
// Camera angles: azimuth = 35 deg, elevation = 30 deg
function project3D(x, y, z, cx = 0.5, cy = 0.5, cz = 0.0, scale = 260, outW = 400, outH = 340) {
  // Center coordinates
  const px = x - cx;
  const py = y - cy;
  const pz = z - cz;

  // Rotation angles
  const az = (35 * Math.PI) / 180;
  const el = (28 * Math.PI) / 180;

  // Rotate azimuth (around z)
  const x1 = Math.cos(az) * px - Math.sin(az) * py;
  const y1 = Math.sin(az) * px + Math.cos(az) * py;
  const z1 = pz;

  // Rotate elevation (around x)
  const x2 = x1;
  const y2 = Math.cos(el) * y1 - Math.sin(el) * z1;
  const z2 = Math.sin(el) * y1 + Math.cos(el) * z1;

  // Orthographic projection to screen (y flipped)
  const sx = outW / 2 + x2 * scale;
  const sy = outH / 2 - z2 * scale + 20;

  return { sx, sy, depth: y2 };
}

// Compute normal of 3D triangle
function calcNormal(p0, p1, p2) {
  const ax = p1.x - p0.x, ay = p1.y - p0.y, az = p1.z - p0.z;
  const bx = p2.x - p0.x, by = p2.y - p0.y, bz = p2.z - p0.z;
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return { nx: nx / len, ny: ny / len, nz: nz / len };
}

// Generate SVG for a single model at a given frame
function renderModelFrameSVG(model, frameIndex, title) {
  const frame = model.alphaFrames[frameIndex];
  const pos = frame.positions;
  const indices = model.indices;

  // Collect triangles
  const triangles = [];
  for (let t = 0; t < model.numTriangles; t++) {
    const i0 = indices[t * 3 + 0];
    const i1 = indices[t * 3 + 1];
    const i2 = indices[t * 3 + 2];

    const p0 = { x: pos[i0 * 3], y: pos[i0 * 3 + 1], z: pos[i0 * 3 + 2] };
    const p1 = { x: pos[i1 * 3], y: pos[i1 * 3 + 1], z: pos[i1 * 3 + 2] };
    const p2 = { x: pos[i2 * 3], y: pos[i2 * 3 + 1], z: pos[i2 * 3 + 2] };

    const pr0 = project3D(p0.x, p0.y, p0.z);
    const pr1 = project3D(p1.x, p1.y, p1.z);
    const pr2 = project3D(p2.x, p2.y, p2.z);

    const norm = calcNormal(p0, p1, p2);
    // Simple directional lighting (light from [0.5, -0.6, 0.8])
    const lx = 0.5, ly = -0.6, lz = 0.8;
    const lLen = Math.hypot(lx, ly, lz);
    const dot = Math.abs((norm.nx * lx + norm.ny * ly + norm.nz * lz) / lLen);
    const brightness = Math.min(255, Math.max(80, Math.floor(100 + dot * 140)));
    const color = `rgb(${brightness}, ${Math.floor(brightness * 0.95)}, ${Math.floor(brightness * 0.9)})`;

    const avgDepth = (pr0.depth + pr1.depth + pr2.depth) / 3;

    triangles.push({
      pts: `${pr0.sx.toFixed(1)},${pr0.sy.toFixed(1)} ${pr1.sx.toFixed(1)},${pr1.sy.toFixed(1)} ${pr2.sx.toFixed(1)},${pr2.sy.toFixed(1)}`,
      color,
      depth: avgDepth,
    });
  }

  // Painter's algorithm sort by depth
  triangles.sort((a, b) => a.depth - b.depth);

  const polyElements = triangles
    .map(t => `<polygon points="${t.pts}" fill="${t.color}" stroke="#2c3e50" stroke-width="1.2" stroke-linejoin="round" />`)
    .join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 340" width="100%" height="100%" style="background:#0f172a; border-radius:8px;">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1e293b"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
  </defs>
  <rect width="400" height="340" fill="url(#bgGrad)" rx="8"/>
  <text x="20" y="32" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="14" font-weight="600">${model.modelName} (α = ${frame.alpha.toFixed(1)})</text>
  <text x="20" y="52" fill="#94a3b8" font-family="monospace" font-size="11">Max Strain: ${(frame.maxStrain * 100).toFixed(4)}%</text>
  <g>
    ${polyElements}
  </g>
</svg>`;
}

// Generate animated SVG showing the fold progression for each model
function renderAnimatedModelSVG(model) {
  const frames = model.alphaFrames;
  const numFrames = frames.length;
  const frameDuration = 0.4; // 0.4s per frame
  const totalDuration = numFrames * frameDuration;

  let framesMarkup = '';
  frames.forEach((frame, idx) => {
    const pos = frame.positions;
    const indices = model.indices;
    const triangles = [];

    for (let t = 0; t < model.numTriangles; t++) {
      const i0 = indices[t * 3 + 0];
      const i1 = indices[t * 3 + 1];
      const i2 = indices[t * 3 + 2];

      const p0 = { x: pos[i0 * 3], y: pos[i0 * 3 + 1], z: pos[i0 * 3 + 2] };
      const p1 = { x: pos[i1 * 3], y: pos[i1 * 3 + 1], z: pos[i1 * 3 + 2] };
      const p2 = { x: pos[i2 * 3], y: pos[i2 * 3 + 1], z: pos[i2 * 3 + 2] };

      const pr0 = project3D(p0.x, p0.y, p0.z);
      const pr1 = project3D(p1.x, p1.y, p1.z);
      const pr2 = project3D(p2.x, p2.y, p2.z);

      const norm = calcNormal(p0, p1, p2);
      const lx = 0.5, ly = -0.6, lz = 0.8;
      const lLen = Math.hypot(lx, ly, lz);
      const dot = Math.abs((norm.nx * lx + norm.ny * ly + norm.nz * lz) / lLen);
      const brightness = Math.min(255, Math.max(90, Math.floor(110 + dot * 135)));
      const color = `rgb(${brightness}, ${Math.floor(brightness * 0.95)}, ${Math.floor(brightness * 0.9)})`;
      const avgDepth = (pr0.depth + pr1.depth + pr2.depth) / 3;

      triangles.push({
        pts: `${pr0.sx.toFixed(1)},${pr0.sy.toFixed(1)} ${pr1.sx.toFixed(1)},${pr1.sy.toFixed(1)} ${pr2.sx.toFixed(1)},${pr2.sy.toFixed(1)}`,
        color,
        depth: avgDepth,
      });
    }

    triangles.sort((a, b) => a.depth - b.depth);

    const polys = triangles
      .map(t => `<polygon points="${t.pts}" fill="${t.color}" stroke="#334155" stroke-width="1.2" stroke-linejoin="round"/>`)
      .join('\n      ');

    const keyframePercent = ((idx / numFrames) * 100).toFixed(1);
    const nextPercent = (((idx + 1) / numFrames) * 100).toFixed(1);

    framesMarkup += `
    <g class="frame-${idx}">
      <text x="20" y="52" fill="#38bdf8" font-family="monospace" font-size="12">α = ${frame.alpha.toFixed(1)} | Max Strain: ${(frame.maxStrain * 100).toFixed(4)}%</text>
      ${polys}
    </g>`;
  });

  // CSS keyframe animation switching frame visibility
  let cssRules = '';
  for (let i = 0; i < numFrames; i++) {
    const startP = ((i / numFrames) * 100).toFixed(2);
    const endP = (((i + 0.99) / numFrames) * 100).toFixed(2);
    cssRules += `
    .frame-${i} {
      animation: showFrame${i} ${totalDuration}s infinite;
    }
    @keyframes showFrame${i} {
      0%, 100% { display: none; opacity: 0; }
      ${startP}%, ${endP}% { display: inline; opacity: 1; }
    }`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 340" width="100%" height="100%">
  <style>
    g { display: none; }
    ${cssRules}
  </style>
  <rect width="400" height="340" fill="#0f172a" rx="8"/>
  <text x="20" y="30" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="15" font-weight="700">${model.modelName} Collapse</text>
  ${framesMarkup}
</svg>`;
}

// Generate static keyframe SVGs for each model at alpha = 0.0, 0.3, 0.6, 1.0
dumps.forEach(model => {
  const safeName = model.modelName.toLowerCase().replace(/[^a-z0-9]/g, '_');

  [0, 3, 6, 10].forEach(idx => {
    const alphaStr = (idx * 0.1).toFixed(1);
    const svgContent = renderModelFrameSVG(model, idx, `${model.modelName} (α=${alphaStr})`);
    const fileName = `${safeName}_alpha_${alphaStr}.svg`;
    fs.writeFileSync(path.join(artifactDir, fileName), svgContent, 'utf8');
    console.log(`Rendered: ${fileName}`);
  });

  // Animated SVG
  const animContent = renderAnimatedModelSVG(model);
  const animFileName = `${safeName}_animated.svg`;
  fs.writeFileSync(path.join(artifactDir, animFileName), animContent, 'utf8');
  console.log(`Rendered animated: ${animFileName}`);
});

console.log('Done generating SVG visualizations!');
