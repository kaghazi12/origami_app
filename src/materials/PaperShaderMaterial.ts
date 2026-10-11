import * as THREE from 'three';

export interface PaperShaderUniforms {
  uFrontColor: { value: THREE.Color };
  uBackColor: { value: THREE.Color };
  uKeyLightDir: { value: THREE.Vector3 };
  uFillLightDir: { value: THREE.Vector3 };
  uKeyLightColor: { value: THREE.Color };
  uFillLightColor: { value: THREE.Color };
  uAmbientColor: { value: THREE.Color };
  uSubsurface: { value: number };
  uRoughness: { value: number };
  uPatternType: { value: number };
}

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying vec3 vLocalNormal;

  void main() {
    vUv = uv;
    vLocalNormal = normal;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    // World space normal
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uFrontColor;
  uniform vec3 uBackColor;
  uniform vec3 uKeyLightDir;
  uniform vec3 uFillLightDir;
  uniform vec3 uKeyLightColor;
  uniform vec3 uFillLightColor;
  uniform vec3 uAmbientColor;
  uniform float uSubsurface;
  uniform float uRoughness;
  uniform int uPatternType;

  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying vec3 vLocalNormal;

  // Procedural noise for paper fiber
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    v += 0.5 * noise(p); p *= 2.02;
    v += 0.25 * noise(p); p *= 2.03;
    v += 0.125 * noise(p);
    return v;
  }

  void main() {
    // Determine whether this fragment is the front surface, back surface, or cut rim edge
    // vLocalNormal.z is +1 on top surface, -1 on bottom surface, and ~0 on side edges.
    bool isTop = vLocalNormal.z > 0.4;
    bool isBottom = vLocalNormal.z < -0.4;

    vec3 baseColor;
    if (isTop) {
      baseColor = uFrontColor;
      // Pattern variations
      if (uPatternType == 1) {
        // Subtle elegant diagonal kami pattern
        float diag = sin((vUv.x + vUv.y) * 40.0) * 0.5 + 0.5;
        baseColor = mix(baseColor, baseColor * 1.15, diag * 0.3);
      } else if (uPatternType == 2) {
        // Chiyogami gold dots pattern
        vec2 grid = fract(vUv * 20.0) - 0.5;
        float dotMask = smoothstep(0.2, 0.15, length(grid));
        baseColor = mix(baseColor, vec3(0.95, 0.85, 0.4), dotMask * 0.4);
      }
    } else if (isBottom) {
      baseColor = uBackColor;
    } else {
      // Paper cut rim edge: realistic paper fiber core (soft warm pulp tone)
      baseColor = mix(uBackColor, vec3(0.93, 0.92, 0.88), 0.5);
    }

    // Delicate tactile paper fiber grain (micro-texture)
    float fiber = fbm(vUv * 180.0);
    baseColor *= (0.96 + 0.08 * fiber);

    vec3 N = normalize(vNormal);
    if (!gl_FrontFacing) {
      N = -N;
    }

    vec3 L1 = normalize(uKeyLightDir);
    vec3 L2 = normalize(uFillLightDir);
    vec3 V = normalize(cameraPosition - vWorldPosition);

    // Two-sided diffuse lighting from key light and fill light
    float NdotL1 = max(dot(N, L1), 0.0);
    float NdotL2 = max(dot(N, L2), 0.0);

    // Translucency / Subsurface backlight through thin paper
    float backlight = max(dot(-N, L1), 0.0) * pow(max(dot(V, -L1), 0.0), 2.5) * uSubsurface;

    // Soft specular sheen
    vec3 H = normalize(L1 + V);
    float NdotH = max(dot(N, H), 0.0);
    float spec = pow(NdotH, 16.0) * (1.0 - uRoughness) * 0.15;

    // Subtle edge rim light for paper crispness
    float rim = 1.0 - max(dot(V, N), 0.0);
    vec3 rimLight = vec3(0.08) * pow(rim, 2.0);

    // Composite total lighting
    vec3 totalLight = uAmbientColor + uKeyLightColor * (NdotL1 + backlight) + uFillLightColor * NdotL2;
    vec3 finalColor = baseColor * totalLight + spec + rimLight;

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

export function createPaperShaderMaterial(
  frontColorHex = '#e11d48', // Rich Japanese Kami Red
  backColorHex = '#ffffff',  // Bright Natural Washi Paper
  patternType = 0,
): THREE.ShaderMaterial {
  const uniforms = {
    uFrontColor: { value: new THREE.Color(frontColorHex) },
    uBackColor: { value: new THREE.Color(backColorHex) },
    uKeyLightDir: { value: new THREE.Vector3(0.5, 0.8, 1.0).normalize() },
    uFillLightDir: { value: new THREE.Vector3(-0.5, -0.6, 0.8).normalize() },
    uKeyLightColor: { value: new THREE.Color(0xfff8f0).multiplyScalar(0.75) },
    uFillLightColor: { value: new THREE.Color(0xdbeafe).multiplyScalar(0.45) },
    uAmbientColor: { value: new THREE.Color(0x707580) },
    uSubsurface: { value: 0.25 },
    uRoughness: { value: 0.7 },
    uPatternType: { value: patternType },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1.0,
    polygonOffsetUnits: 1.0,
  });

  return material;
}

export function clonePaperMaterialWithSelection(baseMat: THREE.ShaderMaterial, isSelected: boolean): THREE.ShaderMaterial {
  if (!isSelected) return baseMat;
  const cloned = new THREE.ShaderMaterial({
    vertexShader: baseMat.vertexShader,
    fragmentShader: baseMat.fragmentShader,
    uniforms: {
      uFrontColor: { value: new THREE.Color('#38bdf8') },
      uBackColor: { value: new THREE.Color('#e0f2fe') },
      uKeyLightDir: { value: baseMat.uniforms.uKeyLightDir.value.clone() },
      uFillLightDir: { value: baseMat.uniforms.uFillLightDir.value.clone() },
      uKeyLightColor: { value: baseMat.uniforms.uKeyLightColor.value.clone() },
      uFillLightColor: { value: baseMat.uniforms.uFillLightColor.value.clone() },
      uAmbientColor: { value: baseMat.uniforms.uAmbientColor.value.clone() },
      uSubsurface: { value: baseMat.uniforms.uSubsurface.value },
      uRoughness: { value: baseMat.uniforms.uRoughness.value },
      uPatternType: { value: 0 },
    },
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1.0,
    polygonOffsetUnits: 1.0,
  });
  return cloned;
}

export const PAPER_THEMES = [
  { id: 'vermilion', name: 'Vermilion Kami (Red / White)', front: '#e11d48', back: '#ffffff', pattern: 0 },
  { id: 'indigo', name: 'Aizome Indigo (Blue / White)', front: '#1d4ed8', back: '#f8fafc', pattern: 0 },
  { id: 'matcha', name: 'Matcha Green (Green / Cream)', front: '#15803d', back: '#fdfbf7', pattern: 0 },
  { id: 'golden', name: 'Golden Yamabuki (Amber / White)', front: '#d97706', back: '#fffbeb', pattern: 0 },
  { id: 'sakura', name: 'Sakura Blossom (Pink / Floral)', front: '#db2777', back: '#fdf2f8', pattern: 1 },
  { id: 'chiyogami', name: 'Chiyogami Gold (Purple / Gold)', front: '#7e22ce', back: '#faf5ff', pattern: 2 },
  { id: 'sumi', name: 'Sumi Charcoal (Dark Slate / White)', front: '#1e293b', back: '#ffffff', pattern: 0 },
];
