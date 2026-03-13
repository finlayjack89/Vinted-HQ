/**
 * GlassCanvas — Fixed fullscreen WebGL canvas for liquid glass refraction
 *
 * Renders behind all DOM content. For each tracked card, draws a refraction
 * mesh using the custom GLSL shader. Uses demand-based rendering to avoid
 * unnecessary GPU work.
 */

import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useTrackedCards } from '../hooks/useCardTracker';

/* ─── Vertex Shader ──────────────────────────────────────── */

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/* ─── Fragment Shader (inlined to avoid asset-loader issues) ── */

const fragmentShader = `
  precision mediump float;

  uniform float uTime;
  uniform vec2  uResolution;
  uniform vec2  uMouse;
  uniform float uIOR;
  uniform float uBlurStrength;
  uniform float uOpacity;

  varying vec2 vUv;

  vec3 warmGradient(vec2 uv) {
    vec3 top    = vec3(0.980, 0.976, 0.965);
    vec3 bottom = vec3(0.941, 0.937, 0.922);
    return mix(bottom, top, uv.y);
  }

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
    float distortionStrength = (uIOR - 1.0) * 2.0;
    vec2 refractedUv = barrelDistort(uv, distortionStrength);
    vec3 bg = warmGradient(refractedUv);

    float frost = uBlurStrength * 0.15;
    bg = mix(bg, vec3(1.0), frost);

    float fresnelFactor = fresnel(uv, 3.0);
    bg += vec3(fresnelFactor * 0.08);

    vec2 mouseOffset = uMouse - uv;
    float specDist = length(mouseOffset);
    float specular = smoothstep(0.5, 0.0, specDist) * 0.25;
    bg += vec3(specular);

    float edgeShadow = smoothstep(0.0, 0.15, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
    bg *= mix(0.95, 1.0, edgeShadow);

    float topHighlight = smoothstep(0.02, 0.0, uv.y) * 0.3;
    bg += vec3(topHighlight);

    gl_FragColor = vec4(bg, uOpacity);
  }
`;

/* ─── Glass Mesh for a single tracked card ───────────────── */

interface GlassMeshProps {
  id: string;
  rect: { x: number; y: number; width: number; height: number };
  viewportHeight: number;
  mouseNorm: [number, number];
}

function GlassMesh({ rect, viewportHeight, mouseNorm }: GlassMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(rect.width, rect.height) },
      uMouse: { value: new THREE.Vector2(mouseNorm[0], mouseNorm[1]) },
      uIOR: { value: 1.05 },
      uBlurStrength: { value: 0.6 },
      uOpacity: { value: 0.55 },
    }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useFrame(({ clock }) => {
    uniforms.uTime.value = clock.getElapsedTime();
    uniforms.uMouse.value.set(mouseNorm[0], mouseNorm[1]);
    uniforms.uResolution.value.set(rect.width, rect.height);
  });

  // Convert DOM coordinates to Three.js orthographic coordinates
  // DOM: (0,0) = top-left;  Three ortho: (0,0) = bottom-left
  const x = rect.x + rect.width / 2;
  const y = viewportHeight - rect.y - rect.height / 2;

  return (
    <mesh ref={meshRef} position={[x, y, 0]}>
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

/* ─── Scene: renders all tracked card meshes ─────────────── */

function GlassScene() {
  const { cards, version } = useTrackedCards();
  const { size, invalidate } = useThree();
  const mouseNorm = useRef<[number, number]>([0.5, 0.5]);

  // Listen for mouse moves on the document to update mouse position
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      mouseNorm.current = [
        e.clientX / window.innerWidth,
        1.0 - e.clientY / window.innerHeight,
      ];
      invalidate();
    };

    const scrollHandler = () => invalidate();

    document.addEventListener('mousemove', handler, { passive: true });
    const main = document.querySelector('main');
    if (main) {
      main.addEventListener('scroll', scrollHandler, { passive: true });
    }
    window.addEventListener('resize', scrollHandler, { passive: true });

    return () => {
      document.removeEventListener('mousemove', handler);
      if (main) main.removeEventListener('scroll', scrollHandler);
      window.removeEventListener('resize', scrollHandler);
    };
  }, [invalidate]);

  // Re-render when tracked cards change
  React.useEffect(() => {
    invalidate();
  }, [version, invalidate]);

  const meshes: JSX.Element[] = [];
  cards.forEach((rect, id) => {
    // Only render if the card is reasonably visible
    if (rect.width > 0 && rect.height > 0) {
      meshes.push(
        <GlassMesh
          key={id}
          id={id}
          rect={rect}
          viewportHeight={size.height}
          mouseNorm={mouseNorm.current}
        />,
      );
    }
  });

  return <>{meshes}</>;
}

/* ─── Main Canvas wrapper ────────────────────────────────── */

export default function GlassCanvas() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
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
        frameloop="demand"
        dpr={[1, 2]}
        onCreated={({ gl, size, camera }) => {
          // Set up orthographic camera to match pixel coordinates
          const cam = camera as THREE.OrthographicCamera;
          cam.left = 0;
          cam.right = size.width;
          cam.top = size.height;
          cam.bottom = 0;
          cam.updateProjectionMatrix();

          gl.setClearColor(0x000000, 0);
        }}
        resize={{
          debounce: 100,
        }}
        style={{ width: '100%', height: '100%' }}
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

  React.useEffect(() => {
    const cam = camera as THREE.OrthographicCamera;
    cam.left = 0;
    cam.right = size.width;
    cam.top = size.height;
    cam.bottom = 0;
    cam.updateProjectionMatrix();
  }, [camera, size]);

  return null;
}
