# SPEC.md — Vinted HQ "Calm Technology" Redesign Specification

**Version:** 1.0
**Status:** DRAFT — Awaiting Architect Approval
**Scope:** Complete frontend token + CSS architecture for the Elevated Neutral / Liquid Glass redesign.

---

## 1. Color Token Schema — `src/theme.ts`

The existing `colors` export must be **completely replaced** with the schema below.
The legacy dark-mode palette (`bgBase: '#080b12'`, etc.) is retired in its entirety.

```typescript
export const colors = {
  // ── Backgrounds ───────────────────────────────────────────
  bgBase:        '#FAF9F6',   // Warm off-white. The absolute bottom layer of <body>.
  bgElevated:    '#FFFFFF',   // Pure white. Reserved for cards, panels, modals.
  surface:       '#F0EFEB',   // Subtle warm grey. For nested containers, resting inputs.

  // ── Glass ─────────────────────────────────────────────────
  glassBg:       'rgba(255, 255, 255, 0.65)',    // Translucent base for glass panels.
  glassBgHover:  'rgba(255, 255, 255, 0.80)',    // Increased opacity on hover.
  glassBorder:   'rgba(255, 255, 255, 0.85)',    // High-opacity white edge.
  glassBorderHover: 'rgba(255, 255, 255, 0.95)', // Near-opaque on hover.
  glassHighlight: 'rgba(255, 255, 255, 0.40)',   // For card default state.
  glassInset:    'rgba(255, 255, 255, 0.70)',    // Inset volumetric illumination.

  // ── Primary Accent (Indigo) ───────────────────────────────
  primary:       '#6366F1',   // Primary interactive accent.
  primaryHover:  '#4F46E5',   // Darkened on hover for depth.
  primaryMuted:  'rgba(99, 102, 241, 0.10)',  // Tinted backgrounds (active nav).
  primaryGlow:   'rgba(99, 102, 241, 0.15)',  // Subtle elevation shadow.

  // ── Text ──────────────────────────────────────────────────
  textPrimary:   '#111111',   // Near-black. Max contrast without optical vibration.
  textSecondary: '#666666',   // Dark grey. Metadata, timestamps, descriptions.
  textMuted:     '#A3A3A3',   // Light grey. Placeholders, disabled states.

  // ── Semantic Status ───────────────────────────────────────
  success:     '#059669',     // Deep emerald text.
  successBg:   '#ECFDF5',     // Pale mint background.
  error:       '#DC2626',     // Red text.
  errorBg:     '#FEF2F2',     // Pale rose background.
  warning:     '#D97706',     // Amber text.
  warningBg:   '#FFFBEB',     // Pale gold background.
  info:        '#2563EB',     // Blue text.
  infoBg:      '#EFF6FF',     // Pale blue background.

  // ── Miscellaneous ─────────────────────────────────────────
  separator:   'rgba(0, 0, 0, 0.06)',  // Extremely subtle dividers.
  overlay:     'rgba(0, 0, 0, 0.40)',  // Modal backdrop.
  white:       '#FFFFFF',
  black:       '#000000',
} as const;
```

---

## 2. Typography Token Schema

The `font` export retains Inter as the primary typeface. Weights restricted to prevent density disjoint. Light (`300`) weight is **prohibited** below `18px`.

```typescript
export const font = {
  family:
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  mono:
    "'SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace",
  size: {
    xs:   11,
    sm:   12,
    md:   13,
    base: 14,
    lg:   16,
    xl:   18,
    '2xl': 22,
    '3xl': 28,
  },
  weight: {
    normal:   400 as const,  // Body copy, table cells.
    medium:   500 as const,  // Metadata, labels.
    semibold: 600 as const,  // Primary data points, headers.
    bold:     700 as const,  // App title, hero numbers.
  },
} as const;
```

**Typography Hierarchy Rules:**
- **Primary data** → `semibold (600)` + `textPrimary (#111111)`
- **Body copy** → `normal (400)` + `textSecondary (#666666)`
- **Metadata/Labels** → `medium (500)` + `textMuted (#A3A3A3)` + `letter-spacing: 0.02em`

---

## 3. Spacing & Radii Token Schema

All values strictly adhere to the **8-point grid**.

```typescript
export const radius = {
  sm:   8,       // Badges, small pills.
  md:   12,      // Inputs, buttons.
  lg:   16,      // Inner nested panels.
  xl:   20,      // Standard glass panels, cards.
  '2xl': 24,     // Sidebar, modal, primary containers.
  full: 9999,    // Fully pill-shaped toggles.
} as const;

export const spacing = {
  xs:   4,
  sm:   8,
  md:   12,
  lg:   16,
  xl:   24,      // Standard component padding. (Changed from legacy 20.)
  '2xl': 32,     // Macro-spacing between settings sections.
  '3xl': 40,     // Major layout gaps.
  '4xl': 48,     // Extreme separation (page-level).
} as const;
```

---

## 4. Shadow & Effects Token Schema

```typescript
export const shadows = {
  glass:
    '0 12px 32px rgba(0, 0, 0, 0.04), ' +
    'inset 0 4px 20px rgba(255, 255, 255, 0.7), ' +
    'inset 0 -1px 2px rgba(0, 0, 0, 0.02)',
  glassSubtle:
    '0 4px 24px rgba(0, 0, 0, 0.03)',
  glow:
    `0 2px 12px ${colors.primaryGlow}`,
  card:
    '0 4px 24px rgba(0, 0, 0, 0.03)',
  cardHover:
    '0 12px 40px rgba(0, 0, 0, 0.06)',
  toast:
    '0 8px 32px rgba(0, 0, 0, 0.08)',
} as const;

export const blur = {
  glass:      'blur(20px) saturate(150%)',
  glassLight: 'blur(16px) saturate(130%)',
  glassHeavy: 'blur(40px) saturate(150%)',
} as const;
```

---

## 5. SVG Filter Definition — Liquid Glass Displacement Map

This SVG block **must** be injected into the DOM root. Referenced by CSS via `url(#liquid-glass-refraction)`.

```html
<svg
  xmlns="http://www.w3.org/2000/svg"
  style="position: absolute; width: 0; height: 0; overflow: hidden;"
  aria-hidden="true"
>
  <defs>
    <filter id="liquid-glass-refraction" x="-20%" y="-20%" width="140%" height="140%">
      <!-- Step 1: Generate organic noise map -->
      <feTurbulence
        type="fractalNoise"
        baseFrequency="0.015"
        numOctaves="3"
        seed="42"
        stitchTiles="stitch"
        result="noise"
      />
      <!-- Step 2: Displace source graphic using noise -->
      <feDisplacementMap
        in="SourceGraphic"
        in2="noise"
        scale="6"
        xChannelSelector="R"
        yChannelSelector="G"
        result="displaced"
      />
      <!-- Step 3: Diffusion blur on displaced output -->
      <feGaussianBlur
        in="displaced"
        stdDeviation="0.5"
        result="blurred"
      />
      <!-- Step 4: Composite back onto source -->
      <feBlend in="blurred" in2="SourceGraphic" mode="normal" />
    </filter>
  </defs>
</svg>
```

**Performance Warning:** The refraction filter is GPU-intensive. Only apply to static macro-layout elements (Sidebar, Modals, Sticky Headers). **Never** apply to `FeedItemCard` or scrolling data grids.

---

## 6. CSS Property Recipes — Reusable Style Objects

### 6.1 `liquidGlassPanel` — Macro-layout Panels (Sidebar, Modals)

Full Liquid Glass with SVG refraction.

```typescript
export const liquidGlassPanel: CSSProperties = {
  position: 'relative',
  background: colors.glassBg,
  backdropFilter: `url(#liquid-glass-refraction) ${blur.glass}`,
  WebkitBackdropFilter: `url(#liquid-glass-refraction) ${blur.glass}`,
  border: `1px solid ${colors.glassBorder}`,
  borderRadius: radius['2xl'],   // 24px
  boxShadow: shadows.glass,
  overflow: 'hidden',
};
```

**Specular Highlight (CSS class for `index.css`):**

```css
.liquid-glass-panel::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow:
    inset 2px 2px 4px rgba(255, 255, 255, 0.95),
    inset -1px -1px 2px rgba(255, 255, 255, 0.4);
  pointer-events: none;
  z-index: 1;
}
```

### 6.2 `liquidGlassCard` — Feed Item Cards (Optimized, No SVG)

Pure CSS glassmorphism without SVG displacement. For high-volume scrollable components.

```typescript
export const liquidGlassCard: CSSProperties = {
  position: 'relative',
  background: colors.glassHighlight,
  backdropFilter: blur.glassLight,
  WebkitBackdropFilter: blur.glassLight,
  border: `1px solid rgba(0, 0, 0, 0.05)`,
  borderRadius: radius.xl,        // 20px
  boxShadow: shadows.card,
  overflow: 'hidden',
  transition: transition.base,
};
```

**Hover state:**
```typescript
{
  background: colors.glassBgHover,
  transform: 'translateY(-4px)',
  boxShadow: shadows.cardHover,
}
```

### 6.3 `recessedInput` — Form Inputs (Settings.tsx)

```typescript
export const recessedInput: CSSProperties = {
  background: 'rgba(0, 0, 0, 0.03)',
  border: '1px solid transparent',
  borderRadius: radius.md,          // 12px
  color: colors.textPrimary,
  fontFamily: font.family,
  fontSize: font.size.base,
  padding: '12px 16px',
  outline: 'none',
  transition: transition.base,
  boxSizing: 'border-box' as const,
  boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.04)',
};
```

**Focus state:**
```typescript
{
  background: colors.bgElevated,      // #FFFFFF
  border: `2px solid ${colors.primary}`, // #6366F1
  boxShadow: 'none',
}
```

---

## 7. Updated Composite Tokens

### Backward-compatible aliases
```typescript
export const glassPanel: CSSProperties = liquidGlassPanel;
export const glassInput: CSSProperties = recessedInput;
```

### Updated `SIDEBAR_WIDTH`
```typescript
export const SIDEBAR_WIDTH = 240;  // Wider for airier feel (was 220).
```

### Updated Button Tokens
```typescript
export const btnPrimary: CSSProperties = {
  background: colors.primary,
  color: colors.white,
  border: 'none',
  borderRadius: radius.md,
  padding: '12px 24px',
  fontSize: font.size.base,
  fontWeight: font.weight.semibold,
  fontFamily: font.family,
  cursor: 'pointer',
  transition: transition.base,
  boxShadow: `0 2px 8px ${colors.primaryGlow}`,
};

export const btnSecondary: CSSProperties = {
  background: colors.bgElevated,
  color: colors.textPrimary,
  border: `1px solid rgba(0, 0, 0, 0.10)`,
  borderRadius: radius.md,
  padding: '12px 24px',
  fontSize: font.size.base,
  fontWeight: font.weight.medium,
  fontFamily: font.family,
  cursor: 'pointer',
  transition: transition.base,
};
```

### Updated Table Tokens
```typescript
export const tableHeader: CSSProperties = {
  background: '#F5F5F5',
  position: 'sticky' as const,
  top: 0,
  zIndex: 1,
};

export const tableCell: CSSProperties = {
  padding: '14px 16px',
  fontSize: font.size.base,
  color: colors.textPrimary,
  borderBottom: `1px solid ${colors.separator}`,
  minHeight: 48,
};

export const tableRowHoverBg = 'rgba(0, 0, 0, 0.02)';
```

### Updated Modal Tokens
```typescript
export const modalOverlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: colors.overlay,
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

export const modalContent: CSSProperties = {
  ...liquidGlassPanel,
  background: colors.bgElevated,
  padding: spacing['2xl'],
  maxWidth: 480,
  width: '90%',
  boxShadow: '0 24px 64px rgba(0, 0, 0, 0.12)',
};
```

---

## 8. Accessibility Constraints

1. **Opaque Text Layers** — Text must never inherit transparency. Render as solid `#111111`.
2. **Controlled Luminosity** — Add `brightness(1.1)` to backdrop-filter chains where dynamic content scrolls beneath.
3. **Shadow Lift** — For prices / countdown timers: `text-shadow: 0 1px 0 rgba(255,255,255,0.9)`.
4. **No zebra striping** — Use 48px min row height + subtle `rgba(0,0,0,0.04)` bottom borders.

---

## 9. `index.css` Global Resets

```css
*, *::before, *::after {
  box-sizing: border-box;
}

html, body, #root {
  margin: 0;
  padding: 0;
  height: 100%;
  background-color: #FAF9F6;
  color: #111111;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.12); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: rgba(0, 0, 0, 0.20); }
```

---

*End of SPEC.md*
