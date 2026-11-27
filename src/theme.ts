/**
 * Colours for the 3D scenes and SVG drawings, which can't read CSS variables.
 * These mirror the tokens in src/index.css (@theme) — change both together.
 */
export const theme = {
  viewer: '#ece8df',
  canvas: '#f4f1ea',
  surface: '#fbfaf6',
  ink: '#1c1a17',
  inkMuted: '#5e5950',
  inkFaint: '#8f897d',
  line: '#ddd8cc',
  lineStrong: '#c7c1b3',
  accent: '#c2412d',
  valley: '#2f5da8',
  mountain: '#c2412d',
  paperEdge: '#1c1a17',
  /** Default paper when a file doesn't give colours: white front, kami-red back. */
  paperFront: '#fbfaf6',
  paperBack: '#c2412d',
  /** Hemisphere light: white sky, warm paper-coloured bounce from below. */
  lightSky: '#ffffff',
  lightGround: '#d8d2c4',
} as const;

/** The same colours as 0–1 RGB triples, for vertex-colour buffers. */
export function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
