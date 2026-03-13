// ─── Liquid Glass Refraction Fragment Shader ────────────────────
// Simulates frosted-glass refraction over a static warm-gradient
// background texture. Uses barrel distortion for IOR simulation,
// Fresnel edge brightening, and mouse-driven specular highlights.

precision mediump float;

uniform float uTime;
uniform vec2  uResolution;   // viewport size in px
uniform vec2  uMouse;        // mouse position in normalised [0..1]
uniform float uIOR;          // index of refraction (~1.05)
uniform float uBlurStrength; // frosted blur intensity
uniform float uOpacity;      // overall panel opacity

varying vec2 vUv;

// ─── Warm gradient background (matches #FAF9F6 → #F0EFEB) ──
vec3 warmGradient(vec2 uv) {
  vec3 top    = vec3(0.980, 0.976, 0.965); // #FAF9F6
  vec3 bottom = vec3(0.941, 0.937, 0.922); // #F0EFEB
  return mix(bottom, top, uv.y);
}

// ─── Barrel distortion for refraction ────────────────────────
vec2 barrelDistort(vec2 uv, float strength) {
  vec2 centered = uv - 0.5;
  float r2 = dot(centered, centered);
  vec2 distorted = centered * (1.0 + strength * r2);
  return distorted + 0.5;
}

// ─── Fresnel approximation ──────────────────────────────────
float fresnel(vec2 uv, float power) {
  vec2 centered = uv - 0.5;
  float edge = length(centered) * 2.0;
  return pow(clamp(edge, 0.0, 1.0), power);
}

void main() {
  vec2 uv = vUv;

  // 1) Barrel distortion simulating IOR
  float distortionStrength = (uIOR - 1.0) * 2.0;
  vec2 refractedUv = barrelDistort(uv, distortionStrength);

  // 2) Sample the warm background at the refracted UV
  vec3 bg = warmGradient(refractedUv);

  // 3) Frosted overlay — slight white tint
  float frost = uBlurStrength * 0.15;
  bg = mix(bg, vec3(1.0), frost);

  // 4) Fresnel edge brightening — volumetric depth
  float fresnelFactor = fresnel(uv, 3.0);
  bg += vec3(fresnelFactor * 0.08);

  // 5) Specular highlight from mouse position
  vec2 mouseOffset = uMouse - uv;
  float specDist = length(mouseOffset);
  float specular = smoothstep(0.5, 0.0, specDist) * 0.25;
  bg += vec3(specular);

  // 6) Subtle inner shadow at edges
  float edgeShadow = smoothstep(0.0, 0.15, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
  bg *= mix(0.95, 1.0, edgeShadow);

  // 7) Inset highlight on top edge
  float topHighlight = smoothstep(0.02, 0.0, uv.y) * 0.3;
  bg += vec3(topHighlight);

  gl_FragColor = vec4(bg, uOpacity);
}
