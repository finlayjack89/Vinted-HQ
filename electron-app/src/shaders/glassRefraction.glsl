// ─── Liquid Glass Refraction Fragment Shader ────────────────────
// Live DOM refraction + volumetric specular rim lighting.
// Samples a live DOM texture captured via context.drawElement,
// applies barrel distortion for IOR simulation, Fresnel edge
// brightening, and mouse-driven specular highlights with
// concentrated rim light on panel borders.
//
// This file is the reference copy — the shader is inlined
// in GlassCanvas.tsx for bundle compatibility.

precision highp float;

uniform float uTime;
uniform vec2  uResolution;
uniform vec2  uMouse;
uniform float uIOR;
uniform float uBlurStrength;
uniform float uOpacity;
uniform sampler2D uDOMTexture;
uniform vec2 uTexSize;
uniform vec4 uMeshRect;

varying vec2 vUv;
varying vec2 vWorldPos;

vec2 barrelDistort(vec2 uv, float strength) {
  vec2 centered = uv - 0.5;
  float r2 = dot(centered, centered);
  vec2 distorted = centered * (1.0 + strength * r2);
  return distorted + 0.5;
}

float fresnel(vec2 uv, float power) {
  vec2 centered = uv - 0.5;
  float edge = length(centered) * 2.0;
  return pow(clamp(edge, 0.0, 1.0), power);
}

void main() {
  vec2 uv = vUv;

  // World-space UV for DOM texture sampling
  vec2 refractedUv;
  float distortionStrength = (uIOR - 1.0) * 2.0;
  vec2 localDistorted = barrelDistort(uv, distortionStrength);
  refractedUv = vec2(
    (uMeshRect.x + localDistorted.x * uMeshRect.z) / uTexSize.x,
    1.0 - (uMeshRect.y + (1.0 - localDistorted.y) * uMeshRect.w) / uTexSize.y
  );

  vec3 bg = texture2D(uDOMTexture, clamp(refractedUv, 0.0, 1.0)).rgb;

  // Frosted overlay
  float frost = uBlurStrength * 0.18;
  bg = mix(bg, vec3(1.0), frost);

  // Fresnel edge brightening
  float fresnelFactor = fresnel(uv, 2.5);
  bg += vec3(fresnelFactor * 0.12);

  // Volumetric specular — mouse-driven
  vec2 meshMouseLocal = vec2(
    (uMouse.x * uTexSize.x - uMeshRect.x) / uMeshRect.z,
    (uMouse.y * uTexSize.y - uMeshRect.y) / uMeshRect.w
  );

  vec2 mouseOffset = meshMouseLocal - uv;
  float specDist = length(mouseOffset);
  float diffuseSpec = smoothstep(0.6, 0.0, specDist) * 0.20;
  bg += vec3(diffuseSpec);

  // Rim specular on borders
  float borderDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  float rimMask = smoothstep(0.15, 0.0, borderDist);
  float rimSpec = rimMask * smoothstep(0.7, 0.0, specDist) * 0.45;
  bg += vec3(rimSpec);

  // Edge shadow
  float edgeShadow = smoothstep(0.0, 0.12, borderDist);
  bg *= mix(0.93, 1.0, edgeShadow);

  // Top highlight
  float topHighlight = smoothstep(0.03, 0.0, uv.y) * 0.25;
  bg += vec3(topHighlight);

  // Bottom shadow
  float bottomShadow = smoothstep(0.03, 0.0, 1.0 - uv.y) * 0.08;
  bg -= vec3(bottomShadow);

  gl_FragColor = vec4(bg, uOpacity);
}
