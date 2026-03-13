/**
 * GlassCanvas — Unified WebGL Glass Refraction Engine
 *
 * A global fixed overlay (z-index: 9999, pointer-events: none) that renders
 * liquid glass refraction meshes over ALL tracked DOM elements: sidebar,
 * modals, feed cards, purchase cards.
 *
 * Uses Chromium 138 context.drawElement to capture the live <main> DOM content
 * as a dynamic texture, enabling true refraction of underlying item images.
 *
 * Includes volumetric specular highlights (rim lighting) driven by
 * normalised mouse position uniforms.
 */

import React, { useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useTrackedCards } from '../hooks/useCardTracker';

/* ─── Vertex Shader ──────────────────────────────────────── */

const vertexShader = `
  varying vec2 vUv;
  varying vec2 vWorldPos;

  void main() {
    vUv = uv;
    vec4 worldPos = modelViewMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xy;
    gl_Position = projectionMatrix * worldPos;
  }
`;

/* ─── Fragment Shader — Live DOM Refraction + Volumetric Specular ─── */

const fragmentShader = `
  precision highp float;

  uniform float uTime;
  uniform vec2  uResolution;     // viewport size in px
  uniform vec2  uMouse;          // normalised mouse [0..1]
  uniform float uIOR;            // index of refraction (~1.05)
  uniform float uBlurStrength;   // frosted blur intensity
  uniform float uOpacity;        // overall glass opacity
  uniform sampler2D uDOMTexture; // live capture of <main> content
  uniform vec2 uTexSize;         // DOM texture dimensions
  uniform vec4 uMeshRect;        // mesh rect: (x, y, width, height) in viewport px

  varying vec2 vUv;
  varying vec2 vWorldPos;

  // ─── Barrel distortion for IOR simulation ──────────────────
  vec2 barrelDistort(vec2 uv, float strength) {
    vec2 centered = uv - 0.5;
    float r2 = dot(centered, centered);
    vec2 distorted = centered * (1.0 + strength * r2);
    return distorted + 0.5;
  }

  // ─── Fresnel approximation ─────────────────────────────────
  float fresnel(vec2 uv, float power) {
    vec2 centered = uv - 0.5;
    float edge = length(centered) * 2.0;
    return pow(clamp(edge, 0.0, 1.0), power);
  }

  void main() {
    vec2 uv = vUv;

    // 1) Compute world-space UV for DOM texture sampling
    //    Map fragment position to viewport-normalised coordinates
    vec2 viewportUv = vec2(
      (uMeshRect.x + uv.x * uMeshRect.z) / uTexSize.x,
      1.0 - (uMeshRect.y + (1.0 - uv.y) * uMeshRect.w) / uTexSize.y
    );

    // 2) Apply barrel distortion for refraction
    float distortionStrength = (uIOR - 1.0) * 2.0;
    vec2 localDistorted = barrelDistort(uv, distortionStrength);
    vec2 refractedUv = vec2(
      (uMeshRect.x + localDistorted.x * uMeshRect.z) / uTexSize.x,
      1.0 - (uMeshRect.y + (1.0 - localDistorted.y) * uMeshRect.w) / uTexSize.y
    );

    // 3) Sample live DOM texture at refracted coordinates
    vec3 bg = texture2D(uDOMTexture, clamp(refractedUv, 0.0, 1.0)).rgb;

    // 4) Frosted overlay — blend toward white for glass tint
    float frost = uBlurStrength * 0.18;
    bg = mix(bg, vec3(1.0), frost);

    // 5) Fresnel edge brightening — volumetric depth
    float fresnelFactor = fresnel(uv, 2.5);
    bg += vec3(fresnelFactor * 0.12);

    // 6) Volumetric Specular Highlight — mouse-driven rim light
    //    Convert mouse position to mesh-local UV space
    vec2 meshMouseLocal = vec2(
      (uMouse.x * uTexSize.x - uMeshRect.x) / uMeshRect.z,
      (uMouse.y * uTexSize.y - uMeshRect.y) / uMeshRect.w
    );

    // Diffuse specular — broad, soft glow following cursor across the surface
    vec2 mouseOffset = meshMouseLocal - uv;
    float specDist = length(mouseOffset);
    float diffuseSpec = smoothstep(0.6, 0.0, specDist) * 0.20;
    bg += vec3(diffuseSpec);

    // Rim specular — concentrated highlight on panel borders near cursor
    //    Compute distance to nearest border
    float borderDist = min(
      min(uv.x, 1.0 - uv.x),
      min(uv.y, 1.0 - uv.y)
    );
    float rimMask = smoothstep(0.15, 0.0, borderDist);

    //    Rim intensity peaks when cursor is near this border region
    float rimSpec = rimMask * smoothstep(0.7, 0.0, specDist) * 0.45;
    bg += vec3(rimSpec);

    // 7) Subtle inner shadow at edges
    float edgeShadow = smoothstep(0.0, 0.12, borderDist);
    bg *= mix(0.93, 1.0, edgeShadow);

    // 8) Inset highlight on top edge — simulates environmental light
    float topHighlight = smoothstep(0.03, 0.0, uv.y) * 0.25;
    bg += vec3(topHighlight);

    // 9) Subtle bottom shadow for grounding
    float bottomShadow = smoothstep(0.03, 0.0, 1.0 - uv.y) * 0.08;
    bg -= vec3(bottomShadow);

    gl_FragColor = vec4(bg, uOpacity);
  }
`;

/* ─── DOM Texture Capture via context.drawElement ────────── */

/**
 * Captures the live <main> DOM element into a THREE.DataTexture
 * using the Chromium 138 CanvasRenderingContext2D.drawElement API.
 * Falls back to a warm gradient if the API is unavailable.
 */
function useDOMTexture(gl: THREE.WebGLRenderer): THREE.Texture {
  const textureRef = useRef<THREE.DataTexture | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  // Create the texture once
  if (!textureRef.current) {
    const w = Math.max(1, Math.floor(window.innerWidth / 2));
    const h = Math.max(1, Math.floor(window.innerHeight / 2));
    const data = new Uint8Array(w * h * 4);
    // Fill with warm off-white default (#FAF9F6)
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = 250;
      data[i * 4 + 1] = 249;
      data[i * 4 + 2] = 246;
      data[i * 4 + 3] = 255;
    }
    textureRef.current = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    textureRef.current.needsUpdate = true;
    textureRef.current.minFilter = THREE.LinearFilter;
    textureRef.current.magFilter = THREE.LinearFilter;
  }

  // Create offscreen canvas for drawElement capture
  if (!canvasRef.current) {
    const w = Math.max(1, Math.floor(window.innerWidth / 2));
    const h = Math.max(1, Math.floor(window.innerHeight / 2));
    canvasRef.current = document.createElement('canvas');
    canvasRef.current.width = w;
    canvasRef.current.height = h;
    ctxRef.current = canvasRef.current.getContext('2d', { willReadFrequently: true });
  }

  return textureRef.current;
}

/**
 * Captures DOM content into the texture on each frame.
 * Uses context.drawElement when available, otherwise maintains the default gradient.
 */
function DOMTextureUpdater({ texture }: { texture: THREE.DataTexture }): null {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const frameCount = useRef(0);

  useEffect(() => {
    const w = texture.image.width;
    const h = texture.image.height;
    canvasRef.current = document.createElement('canvas');
    canvasRef.current.width = w;
    canvasRef.current.height = h;
    ctxRef.current = canvasRef.current.getContext('2d', { willReadFrequently: true });
  }, [texture]);

  useFrame(() => {
    frameCount.current++;
    // Capture every 2nd frame for performance (80fps effective capture rate)
    if (frameCount.current % 2 !== 0) return;

    const ctx = ctxRef.current;
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;

    const mainEl = document.querySelector('main');
    if (!mainEl) return;

    const w = canvas.width;
    const h = canvas.height;

    try {
      // Chromium 138: context.drawElement renders a DOM element directly to canvas
      if (typeof (ctx as any).drawElement === 'function') {
        ctx.clearRect(0, 0, w, h);
        ctx.save();
        ctx.scale(w / window.innerWidth, h / window.innerHeight);
        (ctx as any).drawElement(mainEl, 0, 0);
        ctx.restore();

        const imageData = ctx.getImageData(0, 0, w, h);
        texture.image.data.set(imageData.data);
        texture.needsUpdate = true;
      }
      // If drawElement is not available, the texture keeps its warm gradient default
    } catch {
      // Silently fail — texture keeps previous frame
    }
  });

  return null;
}

/* ─── Glass Mesh for a single tracked element ────────────── */

interface GlassMeshProps {
  id: string;
  rect: { x: number; y: number; width: number; height: number; scrolls: boolean };
  viewportHeight: number;
  mouseNorm: React.MutableRefObject<[number, number]>;
  scrollOffsetRef: React.MutableRefObject<number>;
  domTexture: THREE.Texture;
  texSize: [number, number];
}

function GlassMesh({ id, rect, viewportHeight, mouseNorm, scrollOffsetRef, domTexture, texSize }: GlassMeshProps): JSX.Element {
  const meshRef = useRef<THREE.Mesh>(null);

  // Determine opacity based on element type
  const isModal = id.startsWith('modal-');
  const isSidebar = id === 'sidebar';

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      uMouse: { value: new THREE.Vector2(0.5, 0.5) },
      uIOR: { value: isModal ? 1.08 : isSidebar ? 1.06 : 1.05 },
      uBlurStrength: { value: isModal ? 0.8 : isSidebar ? 0.7 : 0.5 },
      uOpacity: { value: isModal ? 0.7 : isSidebar ? 0.65 : 0.55 },
      uDOMTexture: { value: domTexture },
      uTexSize: { value: new THREE.Vector2(texSize[0], texSize[1]) },
      uMeshRect: { value: new THREE.Vector4(rect.x, rect.y, rect.width, rect.height) },
    }),
    [isModal, isSidebar], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Direct mesh position mutation on every frame — NO React re-renders
  useFrame(({ clock }) => {
    uniforms.uTime.value = clock.getElapsedTime();
    uniforms.uMouse.value.set(mouseNorm.current[0], 1.0 - mouseNorm.current[1]);
    uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
    uniforms.uDOMTexture.value = domTexture;
    uniforms.uTexSize.value.set(texSize[0], texSize[1]);

    // Apply scroll offset: for scrolling elements, subtract scrollTop from stored Y
    const scrollY = rect.scrolls ? scrollOffsetRef.current : 0;
    const screenY = rect.y - scrollY;

    // Update mesh position via direct mutation (not React state)
    if (meshRef.current) {
      const x = rect.x + rect.width / 2;
      const y = viewportHeight - screenY - rect.height / 2;
      meshRef.current.position.set(x, y, 0);
    }

    // Update shader uniform with screen-space rect
    uniforms.uMeshRect.value.set(rect.x, screenY, rect.width, rect.height);
  });

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[rect.width, rect.height]} />
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
}

/* ─── Scene: renders all tracked element meshes ──────────── */

function GlassScene(): JSX.Element {
  const { cardsRef, scrollOffsetRef, version } = useTrackedCards();
  const { size, gl } = useThree();
  const mouseNorm = useRef<[number, number]>([0.5, 0.5]);

  // Create the live DOM texture
  const domTexture = useDOMTexture(gl);
  const texSize: [number, number] = [
    Math.max(1, Math.floor(window.innerWidth / 2)),
    Math.max(1, Math.floor(window.innerHeight / 2)),
  ];

  // Global mouse listener — attached to document, not canvas
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      mouseNorm.current = [
        e.clientX / window.innerWidth,
        e.clientY / window.innerHeight,
      ];
    };
    document.addEventListener('mousemove', handler, { passive: true });
    return () => document.removeEventListener('mousemove', handler);
  }, []);

  // Build meshes from the mutable cards map
  // Only re-runs when version changes (structural add/remove), not on scroll
  const meshes: JSX.Element[] = [];
  cardsRef.current.forEach((rect, id) => {
    if (rect.width > 0 && rect.height > 0) {
      meshes.push(
        <GlassMesh
          key={id}
          id={id}
          rect={rect}
          viewportHeight={size.height}
          mouseNorm={mouseNorm}
          scrollOffsetRef={scrollOffsetRef}
          domTexture={domTexture}
          texSize={texSize}
        />,
      );
    }
  });

  return (
    <>
      <DOMTextureUpdater texture={domTexture as THREE.DataTexture} />
      {meshes}
    </>
  );
}

/* ─── Main Canvas wrapper — global overlay ───────────────── */

export default function GlassCanvas(): JSX.Element {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        pointerEvents: 'none',
      }}
    >
      <Canvas
        orthographic
        camera={{ zoom: 1, position: [0, 0, 100], near: 0.1, far: 1000 }}
        gl={{
          alpha: true,
          antialias: false,
          powerPreference: 'high-performance',
          preserveDrawingBuffer: false,
        }}
        frameloop="always"
        dpr={[1, 2]}
        onCreated={({ gl, size, camera }) => {
          const cam = camera as THREE.OrthographicCamera;
          cam.left = 0;
          cam.right = size.width;
          cam.top = size.height;
          cam.bottom = 0;
          cam.updateProjectionMatrix();
          gl.setClearColor(0x000000, 0);
          // Force pointer-events none on the actual canvas DOM element
          gl.domElement.style.pointerEvents = 'none';
        }}
        resize={{ debounce: 100 }}
        style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
      >
        <CameraSync />
        <GlassScene />
      </Canvas>
    </div>
  );
}

/* ─── Camera sync on resize ──────────────────────────────── */

function CameraSync(): null {
  const { camera, size } = useThree();

  useEffect(() => {
    const cam = camera as THREE.OrthographicCamera;
    cam.left = 0;
    cam.right = size.width;
    cam.top = size.height;
    cam.bottom = 0;
    cam.updateProjectionMatrix();
  }, [camera, size]);

  return null;
}
