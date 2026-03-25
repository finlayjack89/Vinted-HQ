# Post-Mortem & ADR: 160fps Liquid Glass Architecture

**Feature:** Global Liquid Glass UI Architecture (WebGL)  
**Status:** ✅ Resolved  

---

## 1. Executive Summary

Our target for the Vinted HQ app was an Apple-tier "Liquid Glass" aesthetic, characterized by heavy edge refraction and volumetric specular rim lighting that tracks the mouse pointer. The strict visual architecture mandated a 4-layer stack: Base Content, Displacement Map (Lens), Backdrop Blur Plane, and a Specular Highlight Frame.

After early failures with CSS-native `backdrop-filter` and hybrid CSS/WebGL approaches, we successfully pivoted to a **Unified WebGL Architecture** leveraging Electron 40 / Chromium 138's new `context.drawElement` API. This facilitated rendering the live DOM directly into a global, hardware-accelerated `<GlassCanvas>` running at `z-index: 9999` at 160fps, completely bypassing the extreme overhead of traditional DOM serialization grids.

---

## 2. The Problem (Technical Deep Dive)

### 2.1 Architecture Iteration 1: CSS & Hybrid
We initially attempted a standard CSS `backdrop-filter` implementation. This immediately caused Chromium scroll tearing and "frozen" background artifacts during rapid scrolling. We then explored a Hybrid architecture—using WebGL for the underlying items grid and CSS for modals—but this failed to provide the cohesive, true volumetric refraction required across both the sidebar and modals.

### 2.2 Architecture Iteration 2: Unified WebGL
We pivoted to rendering the effect entirely in WebGL. Utilizing the new `context.drawElement` API available in our Electron/Chromium environment, we captured the live DOM and passed it as a texture into a global `<GlassCanvas>`. This circumvented the performance pitfalls of `html2canvas`, but introduced strict WebGL context constraints and event-loop thrashing that repeatedly crashed the shader or tanked framerates.

---

## 3. Critical Failures & Architectural Fixes

### 3.1 Invisible Glass (CORS & Tainting)
**The Problem:** The `context.drawElement` API failed silently, rendering the glass completely invisible. 
**The Cause:** Vinted's externally hosted item images were tainting the canvas with strict CORS policies, triggering immediate WebGL security blocks upon texture read.
**The Fix:** We retrofitted the image pipeline to append `crossOrigin="anonymous"` to all `<img>` tags across the application, allowing the canvas to safely ingest the visual data.

### 3.2 Invisible Glass (Texture Limits) & Edge Beveling
**The Problem:** Pushing the captured DOM into the WebGL context crashed the shader entirely. Additionally, the glass lacked physical depth.
**The Cause:** Our initial implementation attempted to capture the entire height of the scrollable `<main>` container, massively exceeding WebGL's `MAX_TEXTURE_SIZE` limits. The simple distortion shader also failed to calculate the complex optical thickness required for the "Liquid" aesthetic.
**The Fix:** 
1. We scoped the `drawElement` capture strictly to the fixed `window` viewport bounds rather than the massive scroll-height.
2. We injected rigorous **Signed Distance Field (SDF) mathematics** directly into `glassRefraction.glsl` to compute the physically accurate, thick optical edge bevel in real-time.

### 3.3 160fps Performance Crash (State Thrashing)
**The Problem:** Framerates violently crashed during scrolling, creating severe input lag.
**The Cause:** The `CardTrackerProvider` was synchronizing with React State on every single scroll pixel. This forced React to re-render constantly and repeatedly uploaded a massive `THREE.DataTexture` to the GPU on the main thread.
**The Fix:** We completely decoupled the scroll events from the React render cycle. The scroll listener now directly mutates the WebGL camera's `Y-offset` parameter via a `useRef` attachment. We then restricted expensive texture uploads strictly to `ResizeObserver` and `MutationObserver` triggers.

### 3.4 Event Trapping
**The Problem:** The overarching global WebGL canvas intercepted all browser pointer events, rendering the underlying UI unclickable.
**The Cause:** The `<GlassCanvas>` sat at `z-index: 9999` across the entire viewport. 
**The Fix:** We enforced `pointer-events: none` directly on the WebGL canvas wrapper and decoupled the specular mouse-tracking by moving the pointer event listeners upstream to the global `window` object. 

---

## 4. Future Considerations & Maintenance

- **Texture Size Safeguards:** Any future expansions to the unified canvas must ensure captured nodes never attempt to bypass viewport bounding boxes, preventing arbitrary `MAX_TEXTURE_SIZE` GPU faults.
- **Scroll Syncing:** Direct WebGL uniform mutation (bypassing React) must remain the standard architectural pattern for any high-frequency event listeners (Scroll, MouseMove) interacting with the glass context.
- **CORS Upgrades:** If Vinted alters its asset delivery infrastructure, `crossOrigin="anonymous"` policies must be verified to ensure the underlying domain supports it, otherwise fallback proxying may be required to prevent canvas tainting.
