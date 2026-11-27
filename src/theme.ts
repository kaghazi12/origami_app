/**
 * Colours for the 3D scenes and SVG drawings, which can't read CSS variables.
 * These mirror the tokens in src/index.css (@theme) — change both together.
 */
export const theme = {
  viewer: '#e2e5dc',
  canvas: '#eceee7',
  surface: '#f6f7f2',
  ink: '#121a30',
  inkMuted: '#4a5267',
  inkFaint: '#81889a',
  line: '#d4d8cd',
  lineStrong: '#b5bbae',
  paper: '#f6f7f2',
  accent: '#f5b301',
  valley: '#2f56c8',
  mountain: '#d6402a',
  paperEdge: '#121a30',
  /** Default paper when a file doesn't give colours: white front, marigold back. */
  paperFront: '#fbfbf8',
  paperBack: '#f5b301',
  /** Hemisphere light: white sky, cool paper-coloured bounce from below. */
  lightSky: '#ffffff',
  lightGround: '#cfd4c8',
} as const;

/** The same colours as 0–1 RGB triples, for vertex-colour buffers. */
export function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
