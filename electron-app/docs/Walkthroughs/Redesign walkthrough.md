# Motion & Liquid Glass System — Walkthrough

## Overview
Implemented the full motion system and Liquid Glass rendering pipeline as specified in [ANIMATION_SPEC_V2.md](file:///Users/finlaysalisbury/.gemini/antigravity/brain/f8065f97-f91a-4384-a71f-6198bfffd699/ANIMATION_SPEC_V2.md). The app now uses physics-based spring animations (Framer Motion) instead of CSS keyframes, with centralized motion tokens and reusable hooks for performance-critical optics.

## Changes Made

### New Files
| File | Purpose |
|---|---|
| [useMousePosition.ts](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Vinted-HQ/electron-app/src/hooks/useMousePosition.ts) | Tracks mouse → local coords → injects `--mouse-x`/`--mouse-y` via `style.setProperty()` (bypasses VDOM) |
| [useScrollDegradation.ts](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Vinted-HQ/electron-app/src/hooks/useScrollDegradation.ts) | Detects fast scrolling → disables SVG filter → re-engages after scroll stops |
| [GlassSkeleton.tsx](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Vinted-HQ/electron-app/src/components/GlassSkeleton.tsx) | Frosted glass skeleton loader with specular shimmer animation |

### Modified Files

```diff:theme.ts
/**
 * Centralized design tokens — Elevated Neutral / Liquid Glass Theme
 */

import type { CSSProperties } from 'react';

/* ─── Color Palette ─────────────────────────────────────────── */

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

/* ─── Typography ────────────────────────────────────────────── */

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

/* ─── Shadows & Effects ─────────────────────────────────────── */

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

/* ─── Spacing & Radii ───────────────────────────────────────── */

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
  xl:   24,      // Standard component padding.
  '2xl': 32,     // Macro-spacing between settings sections.
  '3xl': 40,     // Major layout gaps.
  '4xl': 48,     // Extreme separation (page-level).
} as const;

/* ─── Transition ────────────────────────────────────────────── */

export const transition = {
  fast: 'all 0.15s ease',
  base: 'all 0.2s ease',
  slow: 'all 0.3s ease',
  spring: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const;

/* ─── Reusable Style Objects (CSSProperties) ────────────────── */

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

// Aliases for backward compatibility
export const glassPanel: CSSProperties = liquidGlassPanel;
export const glassInput: CSSProperties = recessedInput;

export const glassInner: CSSProperties = {
  background: colors.glassHighlight,
  border: `1px solid ${colors.glassBorder}`,
  borderRadius: radius.lg,
};

export const glassTextarea: CSSProperties = {
  ...recessedInput,
  fontFamily: font.mono,
  fontSize: font.size.sm,
  resize: 'vertical' as const,
};

export const glassSelect: CSSProperties = {
  ...recessedInput,
  cursor: 'pointer',
  appearance: 'none' as const,
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23666666' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center',
  paddingRight: 36,
};

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

export const btnDanger: CSSProperties = {
  ...btnSecondary,
  color: colors.error,
  border: `1px solid rgba(220, 38, 38, 0.2)`,
  background: colors.errorBg,
};

export const btnSmall: CSSProperties = {
  padding: '6px 14px',
  fontSize: font.size.sm,
  borderRadius: radius.sm,
};

export const dangerText: CSSProperties = {
  color: colors.error,
  fontSize: font.size.sm,
  cursor: 'pointer',
  background: 'none',
  border: 'none',
  fontFamily: font.family,
  fontWeight: font.weight.medium,
  transition: transition.fast,
  padding: '4px 8px',
  borderRadius: radius.sm,
};

export const glassTable: CSSProperties = {
  ...liquidGlassPanel,
  overflow: 'hidden',
  padding: 0,
};

export const tableHeader: CSSProperties = {
  background: '#F5F5F5',
  position: 'sticky' as const,
  top: 0,
  zIndex: 1,
};

export const tableHeaderCell: CSSProperties = {
  padding: '12px 16px',
  textAlign: 'left' as const,
  fontSize: font.size.sm,
  fontWeight: font.weight.semibold,
  color: colors.textSecondary,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  borderBottom: `1px solid ${colors.separator}`,
};

export const tableCell: CSSProperties = {
  padding: '14px 16px',
  fontSize: font.size.base,
  color: colors.textPrimary,
  borderBottom: `1px solid ${colors.separator}`,
  minHeight: 48,
};

export const tableRowHoverBg = 'rgba(0, 0, 0, 0.02)';

export const badge = (bg: string, fg: string): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  padding: '3px 10px',
  borderRadius: radius.full,
  fontSize: font.size.xs,
  fontWeight: font.weight.semibold,
  letterSpacing: '0.02em',
  background: bg,
  color: fg,
});

export const sectionTitle: CSSProperties = {
  fontSize: font.size.lg,
  fontWeight: font.weight.semibold,
  color: colors.textPrimary,
  margin: 0,
  marginBottom: spacing.sm,
};

export const sectionDesc: CSSProperties = {
  fontSize: font.size.base,
  color: colors.textSecondary,
  margin: 0,
  lineHeight: 1.6,
};

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

export const toast: CSSProperties = {
  position: 'fixed',
  bottom: 24,
  left: '50%',
  transform: 'translateX(-50%)',
  ...liquidGlassPanel,
  padding: '14px 28px',
  fontSize: font.size.base,
  color: colors.textPrimary,
  zIndex: 1001,
  boxShadow: shadows.toast,
};

export const SIDEBAR_WIDTH = 240;
===
/**
 * Centralized design tokens — Elevated Neutral / Liquid Glass Theme
 */

import type { CSSProperties } from 'react';

/* ─── Color Palette ─────────────────────────────────────────── */

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

/* ─── Typography ────────────────────────────────────────────── */

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

/* ─── Shadows & Effects ─────────────────────────────────────── */

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

/* ─── Spacing & Radii ───────────────────────────────────────── */

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
  xl:   24,      // Standard component padding.
  '2xl': 32,     // Macro-spacing between settings sections.
  '3xl': 40,     // Major layout gaps.
  '4xl': 48,     // Extreme separation (page-level).
} as const;

/* ─── Transition ────────────────────────────────────────────── */

export const transition = {
  fast: 'all 0.15s ease',
  base: 'all 0.2s ease',
  slow: 'all 0.3s ease',
  spring: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const;

/* ─── Framer Motion Spring Tokens ───────────────────────────── */

/** Micro-interactions: toggles, buttons, card entrances */
export const springResponsive = {
  type: 'spring' as const,
  stiffness: 350,
  damping: 25,
  mass: 1,
};

/** Macro-spatial transitions: page routing, layout shifts */
export const springSmooth = {
  type: 'spring' as const,
  stiffness: 150,
  damping: 15,
  mass: 1,
};

/** Z-axis elevation: modals, overlays, heavy panels */
export const springGentle = {
  type: 'spring' as const,
  stiffness: 75,
  damping: 15,
  mass: 1,
};

/** Stagger configuration for data grid population */
export const staggerFast = {
  staggerChildren: 0.05,
};

/* ─── Reusable Style Objects (CSSProperties) ────────────────── */

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

// Aliases for backward compatibility
export const glassPanel: CSSProperties = liquidGlassPanel;
export const glassInput: CSSProperties = recessedInput;

export const glassInner: CSSProperties = {
  background: colors.glassHighlight,
  border: `1px solid ${colors.glassBorder}`,
  borderRadius: radius.lg,
};

export const glassTextarea: CSSProperties = {
  ...recessedInput,
  fontFamily: font.mono,
  fontSize: font.size.sm,
  resize: 'vertical' as const,
};

export const glassSelect: CSSProperties = {
  ...recessedInput,
  cursor: 'pointer',
  appearance: 'none' as const,
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23666666' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center',
  paddingRight: 36,
};

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

export const btnDanger: CSSProperties = {
  ...btnSecondary,
  color: colors.error,
  border: `1px solid rgba(220, 38, 38, 0.2)`,
  background: colors.errorBg,
};

export const btnSmall: CSSProperties = {
  padding: '6px 14px',
  fontSize: font.size.sm,
  borderRadius: radius.sm,
};

export const dangerText: CSSProperties = {
  color: colors.error,
  fontSize: font.size.sm,
  cursor: 'pointer',
  background: 'none',
  border: 'none',
  fontFamily: font.family,
  fontWeight: font.weight.medium,
  transition: transition.fast,
  padding: '4px 8px',
  borderRadius: radius.sm,
};

export const glassTable: CSSProperties = {
  ...liquidGlassPanel,
  overflow: 'hidden',
  padding: 0,
};

export const tableHeader: CSSProperties = {
  background: '#F5F5F5',
  position: 'sticky' as const,
  top: 0,
  zIndex: 1,
};

export const tableHeaderCell: CSSProperties = {
  padding: '12px 16px',
  textAlign: 'left' as const,
  fontSize: font.size.sm,
  fontWeight: font.weight.semibold,
  color: colors.textSecondary,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  borderBottom: `1px solid ${colors.separator}`,
};

export const tableCell: CSSProperties = {
  padding: '14px 16px',
  fontSize: font.size.base,
  color: colors.textPrimary,
  borderBottom: `1px solid ${colors.separator}`,
  minHeight: 48,
};

export const tableRowHoverBg = 'rgba(0, 0, 0, 0.02)';

export const badge = (bg: string, fg: string): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  padding: '3px 10px',
  borderRadius: radius.full,
  fontSize: font.size.xs,
  fontWeight: font.weight.semibold,
  letterSpacing: '0.02em',
  background: bg,
  color: fg,
});

export const sectionTitle: CSSProperties = {
  fontSize: font.size.lg,
  fontWeight: font.weight.semibold,
  color: colors.textPrimary,
  margin: 0,
  marginBottom: spacing.sm,
};

export const sectionDesc: CSSProperties = {
  fontSize: font.size.base,
  color: colors.textSecondary,
  margin: 0,
  lineHeight: 1.6,
};

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

export const toast: CSSProperties = {
  position: 'fixed',
  bottom: 24,
  left: '50%',
  transform: 'translateX(-50%)',
  ...liquidGlassPanel,
  padding: '14px 28px',
  fontSize: font.size.base,
  color: colors.textPrimary,
  zIndex: 1001,
  boxShadow: shadows.toast,
};

export const SIDEBAR_WIDTH = 240;
```
```diff:index.css
/* ─── Elevated Neutral / Liquid Glass Theme ─────────── */

@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

/* ─── Reset & Base ──────────────────────────────────────────── */

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

/* ─── Scrollbar (Webkit / Chromium / Electron) ──────────────── */

::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.12); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: rgba(0, 0, 0, 0.20); }

/* ─── Liquid Glass Helper Classes ───────────────────────────── */

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

/* ─── Selection ─────────────────────────────────────────────── */

::selection {
  background: rgba(99, 102, 241, 0.2);
  color: #111111;
}

::-moz-selection {
  background: rgba(99, 102, 241, 0.2);
  color: #111111;
}

/* ─── Form Element Resets ───────────────────────────────────── */

input,
textarea,
select,
button {
  font-family: inherit;
  font-size: inherit;
  color: inherit;
  outline: none;
}

select option {
  background: #FFFFFF;
  color: #111111;
}

input::placeholder,
textarea::placeholder {
  color: #A3A3A3;
}

input:focus,
textarea:focus,
select:focus {
  border-color: rgba(99, 102, 241, 0.5) !important;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15) !important;
}

button:focus-visible {
  outline: 2px solid rgba(99, 102, 241, 0.5);
  outline-offset: 2px;
}

/* ─── Links ─────────────────────────────────────────────────── */

a {
  color: #6366F1;
  text-decoration: none;
  transition: color 0.15s ease;
}

a:hover {
  color: #4F46E5;
}

/* ─── Custom Checkbox & Radio ───────────────────────────────── */

input[type="checkbox"],
input[type="radio"] {
  appearance: none;
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  border: 1.5px solid rgba(0, 0, 0, 0.2);
  background: rgba(0, 0, 0, 0.04);
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
  position: relative;
}

input[type="checkbox"] {
  border-radius: 5px;
}

input[type="radio"] {
  border-radius: 50%;
}

input[type="checkbox"]:checked,
input[type="radio"]:checked {
  background: #6366F1;
  border-color: #6366F1;
}

input[type="checkbox"]:checked::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 6px;
  width: 4px;
  height: 8px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

input[type="radio"]:checked::after {
  content: '';
  position: absolute;
  top: 4px;
  left: 4px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #fff;
}

input[type="checkbox"]:focus,
input[type="radio"]:focus {
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2) !important;
  border-color: rgba(99, 102, 241, 0.5) !important;
}

/* ─── Animations ────────────────────────────────────────────── */

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes fadeInScale {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@keyframes slideUp {
  from { opacity: 0; transform: translateX(-50%) translateY(16px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

/* Utility animation classes */
.animate-fadeIn {
  animation: fadeIn 0.3s ease forwards;
}

.animate-fadeInScale {
  animation: fadeInScale 0.25s ease forwards;
}

.animate-pulse {
  animation: pulse 2s ease-in-out infinite;
}

.animate-slideUp {
  animation: slideUp 0.3s ease forwards;
}

/* ─── Code/mono styling ─────────────────────────────────────── */

code {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace;
  font-size: 0.85em;
  background: rgba(0, 0, 0, 0.04);
  padding: 2px 6px;
  border-radius: 4px;
  color: #6366F1;
}
===
/* ─── Elevated Neutral / Liquid Glass Theme ─────────── */

@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

/* ─── Reset & Base ──────────────────────────────────────────── */

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

/* ─── Scrollbar (Webkit / Chromium / Electron) ──────────────── */

::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.12); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: rgba(0, 0, 0, 0.20); }

/* ─── Liquid Glass Helper Classes ───────────────────────────── */

.liquid-glass-panel {
  transform: translate3d(0, 0, 0);
  will-change: transform, backdrop-filter;
}

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

/* ─── Liquid Glass Skeleton Shimmer ─────────────────────────── */

.liquid-glass-skeleton {
  position: relative;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.40);
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
  border: 1px solid rgba(255, 255, 255, 0.85);
  border-radius: 20px;
}

.liquid-glass-skeleton::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.4) 50%,
    transparent 100%
  );
  background-size: 200% 100%;
  animation: shimmer 1.8s ease-in-out infinite;
  pointer-events: none;
}

/* ─── Selection ─────────────────────────────────────────────── */

::selection {
  background: rgba(99, 102, 241, 0.2);
  color: #111111;
}

::-moz-selection {
  background: rgba(99, 102, 241, 0.2);
  color: #111111;
}

/* ─── Form Element Resets ───────────────────────────────────── */

input,
textarea,
select,
button {
  font-family: inherit;
  font-size: inherit;
  color: inherit;
  outline: none;
}

select option {
  background: #FFFFFF;
  color: #111111;
}

input::placeholder,
textarea::placeholder {
  color: #A3A3A3;
}

input:focus,
textarea:focus,
select:focus {
  border-color: rgba(99, 102, 241, 0.5) !important;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15) !important;
}

button:focus-visible {
  outline: 2px solid rgba(99, 102, 241, 0.5);
  outline-offset: 2px;
}

/* ─── Links ─────────────────────────────────────────────────── */

a {
  color: #6366F1;
  text-decoration: none;
  transition: color 0.15s ease;
}

a:hover {
  color: #4F46E5;
}

/* ─── Custom Checkbox & Radio ───────────────────────────────── */

input[type="checkbox"],
input[type="radio"] {
  appearance: none;
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  border: 1.5px solid rgba(0, 0, 0, 0.2);
  background: rgba(0, 0, 0, 0.04);
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
  position: relative;
}

input[type="checkbox"] {
  border-radius: 5px;
}

input[type="radio"] {
  border-radius: 50%;
}

input[type="checkbox"]:checked,
input[type="radio"]:checked {
  background: #6366F1;
  border-color: #6366F1;
}

input[type="checkbox"]:checked::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 6px;
  width: 4px;
  height: 8px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

input[type="radio"]:checked::after {
  content: '';
  position: absolute;
  top: 4px;
  left: 4px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #fff;
}

input[type="checkbox"]:focus,
input[type="radio"]:focus {
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2) !important;
  border-color: rgba(99, 102, 241, 0.5) !important;
}

/* ─── Animations ────────────────────────────────────────────── */

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes fadeInScale {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@keyframes slideUp {
  from { opacity: 0; transform: translateX(-50%) translateY(16px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

/* Utility animation classes */
.animate-fadeIn {
  animation: fadeIn 0.3s ease forwards;
}

.animate-fadeInScale {
  animation: fadeInScale 0.25s ease forwards;
}

.animate-pulse {
  animation: pulse 2s ease-in-out infinite;
}

.animate-slideUp {
  animation: slideUp 0.3s ease forwards;
}

/* ─── Code/mono styling ─────────────────────────────────────── */

code {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace;
  font-size: 0.85em;
  background: rgba(0, 0, 0, 0.04);
  padding: 2px 6px;
  border-radius: 4px;
  color: #6366F1;
}
```
```diff:index.html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Vinted HQ</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
    <style>
      /* Prevent flash-of-white while CSS loads */
      body { background: #080b12; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/renderer.tsx"></script>
  </body>
</html>
===
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Vinted HQ</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
    <style>
      /* Prevent flash-of-white while CSS loads */
      body { background: #FAF9F6; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/renderer.tsx"></script>
  </body>
</html>
```
```diff:App.tsx
/**
 * Root React component — Vinted HQ
 * Revolut-inspired sidebar layout with liquid glass UI
 */

import React, { useState, useEffect } from 'react';
import Feed from './components/Feed';
import Wardrobe from './components/Wardrobe';
import Settings from './components/Settings';
import Logs from './components/Logs';
import PurchasesSuite from './components/PurchasesSuite';
import SalesSuite from './components/SalesSuite';
import AutoMessage from './components/AutoMessage';
import ProxyStatus from './components/ProxyStatus';
import {
  colors,
  font,
  glassTextarea,
  btnPrimary,
  btnSecondary,
  btnDanger,
  modalOverlay,
  modalContent,
  toast as toastStyle,
  SIDEBAR_WIDTH,
  radius,
  spacing,
  transition,
  liquidGlassPanel,
} from './theme';
import type { SniperCountdownParams } from './types/global';

type Tab = 'feed' | 'wardrobe' | 'sales' | 'automessage' | 'proxies' | 'settings' | 'logs' | 'purchases';

/* ─── SVG Icons (inline for zero-dep) ───────────────────────── */

const icons: Record<Tab, JSX.Element> = {
  feed: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  wardrobe: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3h7v18H3zM14 3h7v18h-7z" />
      <line x1="7" y1="8" x2="7" y2="12" />
      <line x1="17" y1="8" x2="17" y2="12" />
    </svg>
  ),
  proxies: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="2" />
      <circle cx="4" cy="6" r="2" />
      <circle cx="20" cy="6" r="2" />
      <circle cx="4" cy="18" r="2" />
      <circle cx="20" cy="18" r="2" />
      <line x1="6" y1="7" x2="10" y2="11" />
      <line x1="18" y1="7" x2="14" y2="11" />
      <line x1="6" y1="17" x2="10" y2="13" />
      <line x1="18" y1="17" x2="14" y2="13" />
    </svg>
  ),
  settings: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  logs: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  ),
  purchases: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  ),
  sales: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  automessage: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <line x1="9" y1="10" x2="15" y2="10" />
    </svg>
  ),
};

const tabLabels: Record<Tab, string> = {
  feed: 'Feed',
  wardrobe: 'Wardrobe',
  sales: 'Sales',
  automessage: 'Auto-Message',
  proxies: 'Proxies',
  settings: 'Settings',
  logs: 'Logs',
  purchases: 'Purchases',
};

export default function App() {
  const [tab, setTab] = useState<Tab>('feed');
  const [sessionExpired, setSessionExpired] = useState(false);
  const [reconnectCookie, setReconnectCookie] = useState('');
  const [countdown, setCountdown] = useState<SniperCountdownParams | null>(null);
  const [countdownSeconds, setCountdownSeconds] = useState(0);
  const [countdownDone, setCountdownDone] = useState<string | null>(null);

  useEffect(() => {
    const unsubExpired = window.vinted.onSessionExpired(() => setSessionExpired(true));
    const unsubReconnected = window.vinted.onSessionReconnected(() => {
      setSessionExpired(false);
      setReconnectCookie('');
    });
    return () => {
      unsubExpired();
      unsubReconnected();
    };
  }, []);

  useEffect(() => {
    const unsub = window.vinted.onSniperCountdown((params) => {
      setCountdown(params);
      setCountdownSeconds(params.secondsLeft);
      setCountdownDone(null);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = window.vinted.onSniperCountdownDone((params) => {
      setCountdownDone(params.message);
      setCountdown(null);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!countdownDone) return;
    const t = setTimeout(() => setCountdownDone(null), 5000);
    return () => clearTimeout(t);
  }, [countdownDone]);

  useEffect(() => {
    if (!countdown || countdownSeconds <= 0) return;
    const t = setInterval(() => {
      setCountdownSeconds((s) => {
        if (s <= 1) {
          clearInterval(t);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [countdown, countdownSeconds]);

  const [isRefreshingSession, setIsRefreshingSession] = useState(false);

  const handleReconnect = async () => {
    if (!reconnectCookie.trim()) return;
    await window.vinted.storeCookie(reconnectCookie.trim());
  };

  const handleRefreshSession = async () => {
    if (isRefreshingSession) return;
    setIsRefreshingSession(true);
    try {
      const result = await window.vinted.startCookieRefresh();
      if (result.ok) {
        setSessionExpired(false);
        setReconnectCookie('');
      }
    } finally {
      setIsRefreshingSession(false);
    }
  };

  const handleCancelCountdown = () => {
    if (countdown) {
      window.vinted.cancelSniperCountdown(countdown.countdownId);
      setCountdown(null);
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: font.family }}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
        aria-hidden="true"
      >
        <defs>
          <filter id="liquid-glass-refraction" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.015"
              numOctaves="3"
              seed="42"
              stitchTiles="stitch"
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="6"
              xChannelSelector="R"
              yChannelSelector="G"
              result="displaced"
            />
            <feGaussianBlur
              in="displaced"
              stdDeviation="0.5"
              result="blurred"
            />
            <feBlend in="blurred" in2="SourceGraphic" mode="normal" />
          </filter>
        </defs>
      </svg>
      {/* ─── Sidebar ──────────────────────────────────────── */}
      <aside
        className="liquid-glass-panel"
        style={{
          ...liquidGlassPanel,
          width: SIDEBAR_WIDTH,
          minWidth: SIDEBAR_WIDTH,
          height: '100vh',
          position: 'fixed',
          left: 0,
          top: 0,
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(255, 255, 255, 0.60)',
          backdropFilter: 'url(#liquid-glass-refraction) blur(40px) saturate(150%)',
          WebkitBackdropFilter: 'url(#liquid-glass-refraction) blur(40px) saturate(150%)',
          borderRight: `1px solid rgba(255, 255, 255, 0.9)`,
          boxShadow: '1px 0 12px rgba(0, 0, 0, 0.03)',
          borderRadius: 0, // Left sidebar is flush
          zIndex: 100,
          padding: `${spacing['2xl']}px 0`,
        }}
      >
        {/* Branding */}
        <div style={{ padding: `0 ${spacing.xl}px`, marginBottom: spacing['3xl'] }}>
          <h1
            style={{
              fontSize: font.size.xl,
              fontWeight: font.weight.bold,
              color: colors.textPrimary,
              margin: 0,
              letterSpacing: '-0.02em',
            }}
          >
            Vinted HQ
          </h1>
          <span
            style={{
              fontSize: font.size.xs,
              color: colors.textMuted,
              fontWeight: font.weight.medium,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginTop: 4,
              display: 'block',
            }}
          >
            Sniper Dashboard
          </span>
        </div>

        {/* Nav Items */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: `0 ${spacing.sm}px` }}>
          {(['feed', 'wardrobe', 'sales', 'automessage', 'proxies', 'settings', 'logs', 'purchases'] as Tab[]).map((t) => {
            const active = tab === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '11px 16px',
                  borderRadius: radius.md,
                  border: 'none',
                  background: active ? colors.primaryMuted : 'transparent',
                  color: active ? colors.primary : colors.textSecondary,
                  fontWeight: active ? font.weight.semibold : font.weight.medium,
                  fontSize: font.size.base,
                  cursor: 'pointer',
                  transition: transition.base,
                  textAlign: 'left',
                  width: '100%',
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = 'rgba(0, 0, 0, 0.04)';
                    e.currentTarget.style.color = colors.textPrimary;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = colors.textSecondary;
                  }
                }}
              >
                {icons[t]}
                {tabLabels[t]}
              </button>
            );
          })}
        </nav>

        {/* Bottom spacer for visual balance */}
        <div style={{ flex: 1 }} />

        {/* Session status indicator */}
        {sessionExpired && (
          <div
            style={{
              margin: `0 ${spacing.md}px`,
              padding: `${spacing.sm}px ${spacing.md}px`,
              borderRadius: radius.md,
              background: colors.errorBg,
              color: colors.error,
              fontSize: font.size.sm,
              fontWeight: font.weight.medium,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: colors.error, flexShrink: 0 }} />
            Session expired
          </div>
        )}
      </aside>

      {/* ─── Main Content ─────────────────────────────────── */}
      <main
        style={{
          flex: 1,
          marginLeft: SIDEBAR_WIDTH,
          height: '100vh',
          overflow: 'auto',
          background: colors.bgBase,
        }}
      >
        {tab === 'feed' && <Feed />}
        {tab === 'wardrobe' && <Wardrobe />}
        {tab === 'sales' && <SalesSuite />}
        {tab === 'automessage' && <AutoMessage />}
        {tab === 'proxies' && <ProxyStatus />}
        {tab === 'settings' && <Settings />}
        {tab === 'logs' && <Logs />}
        {tab === 'purchases' && <PurchasesSuite />}
      </main>

      {/* ─── Sniper Countdown Modal ───────────────────────── */}
      {countdown && (
        <div style={modalOverlay}>
          <div style={{ ...modalContent, textAlign: 'center' }} className="animate-fadeInScale">
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: radius.lg,
                background: colors.primaryMuted,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={colors.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <h3 style={{ margin: '0 0 6px', fontSize: font.size.lg, fontWeight: font.weight.semibold, color: colors.textPrimary }}>
              {countdown.sniper.name}
            </h3>
            <p style={{ margin: '0 0 4px', fontSize: font.size.base, color: colors.textSecondary }}>
              {countdown.item.title}
            </p>
            <p style={{ margin: '0 0 20px', fontWeight: font.weight.bold, color: colors.primary, fontSize: font.size.lg }}>
              £{countdown.item.price}
            </p>
            <p
              style={{
                margin: '0 0 24px',
                fontSize: font.size['3xl'],
                fontWeight: font.weight.bold,
                color: colors.textPrimary,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {countdownSeconds > 0 ? countdownSeconds : 'Buying...'}
            </p>
            <button
              type="button"
              onClick={handleCancelCountdown}
              disabled={countdownSeconds <= 0}
              style={{
                ...btnDanger,
                opacity: countdownSeconds > 0 ? 1 : 0.4,
                cursor: countdownSeconds > 0 ? 'pointer' : 'default',
                width: '100%',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ─── Session Expired Modal ────────────────────────── */}
      {sessionExpired && (
        <div style={{ ...modalOverlay, zIndex: 1002 }}>
          <div style={{ ...modalContent, maxWidth: 480 }} className="animate-fadeInScale">
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: radius.lg,
                background: colors.errorBg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={colors.error} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <h3 style={{ margin: '0 0 8px', fontSize: font.size.lg, fontWeight: font.weight.semibold, color: colors.textPrimary }}>
              Session expired
            </h3>
            <p style={{ margin: '0 0 20px', color: colors.textSecondary, fontSize: font.size.base, lineHeight: 1.6 }}>
              Your Vinted session has expired. Open the login page to re-authenticate, or paste a cookie string manually.
            </p>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              <button
                type="button"
                onClick={handleRefreshSession}
                disabled={isRefreshingSession}
                style={{
                  ...btnPrimary,
                  flex: 1,
                  opacity: isRefreshingSession ? 0.6 : 1,
                  cursor: isRefreshingSession ? 'default' : 'pointer',
                }}
              >
                {isRefreshingSession ? 'Opening login...' : 'Refresh session (open login)'}
              </button>
            </div>
            <details style={{ marginBottom: 16 }}>
              <summary style={{ color: colors.textSecondary, fontSize: font.size.sm, cursor: 'pointer', marginBottom: 8 }}>
                Or paste cookie manually...
              </summary>
              <textarea
                placeholder="Paste cookie string here..."
                value={reconnectCookie}
                onChange={(e) => setReconnectCookie(e.target.value)}
                rows={4}
                style={{
                  ...glassTextarea,
                  width: '100%',
                  marginBottom: 8,
                }}
              />
              <button
                type="button"
                onClick={handleReconnect}
                disabled={!reconnectCookie.trim()}
                style={{
                  ...btnPrimary,
                  width: '100%',
                  opacity: reconnectCookie.trim() ? 1 : 0.4,
                  cursor: reconnectCookie.trim() ? 'pointer' : 'default',
                }}
              >
                Reconnect
              </button>
            </details>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => {
                  setSessionExpired(false);
                  setReconnectCookie('');
                }}
                style={{ ...btnSecondary, flex: 1 }}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Countdown Done Toast ─────────────────────────── */}
      {countdownDone && !countdown && (
        <div style={toastStyle} className="animate-slideUp">
          {countdownDone}
        </div>
      )}
    </div>
  );
}
===
/**
 * Root React component — Vinted HQ
 * Revolut-inspired sidebar layout with liquid glass UI
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Feed from './components/Feed';
import Wardrobe from './components/Wardrobe';
import Settings from './components/Settings';
import Logs from './components/Logs';
import PurchasesSuite from './components/PurchasesSuite';
import SalesSuite from './components/SalesSuite';
import AutoMessage from './components/AutoMessage';
import ProxyStatus from './components/ProxyStatus';
import {
  colors,
  font,
  glassTextarea,
  btnPrimary,
  btnSecondary,
  btnDanger,
  modalOverlay,
  modalContent,
  toast as toastStyle,
  SIDEBAR_WIDTH,
  radius,
  spacing,
  transition,
  liquidGlassPanel,
  springSmooth,
  springGentle,
  springResponsive,
} from './theme';
import type { SniperCountdownParams } from './types/global';

type Tab = 'feed' | 'wardrobe' | 'sales' | 'automessage' | 'proxies' | 'settings' | 'logs' | 'purchases';

/* ─── SVG Icons (inline for zero-dep) ───────────────────────── */

const icons: Record<Tab, JSX.Element> = {
  feed: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  wardrobe: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3h7v18H3zM14 3h7v18h-7z" />
      <line x1="7" y1="8" x2="7" y2="12" />
      <line x1="17" y1="8" x2="17" y2="12" />
    </svg>
  ),
  proxies: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="2" />
      <circle cx="4" cy="6" r="2" />
      <circle cx="20" cy="6" r="2" />
      <circle cx="4" cy="18" r="2" />
      <circle cx="20" cy="18" r="2" />
      <line x1="6" y1="7" x2="10" y2="11" />
      <line x1="18" y1="7" x2="14" y2="11" />
      <line x1="6" y1="17" x2="10" y2="13" />
      <line x1="18" y1="17" x2="14" y2="13" />
    </svg>
  ),
  settings: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  logs: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  ),
  purchases: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  ),
  sales: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  automessage: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <line x1="9" y1="10" x2="15" y2="10" />
    </svg>
  ),
};

const tabLabels: Record<Tab, string> = {
  feed: 'Feed',
  wardrobe: 'Wardrobe',
  sales: 'Sales',
  automessage: 'Auto-Message',
  proxies: 'Proxies',
  settings: 'Settings',
  logs: 'Logs',
  purchases: 'Purchases',
};

export default function App() {
  const [tab, setTab] = useState<Tab>('feed');
  const [sessionExpired, setSessionExpired] = useState(false);
  const [reconnectCookie, setReconnectCookie] = useState('');
  const [countdown, setCountdown] = useState<SniperCountdownParams | null>(null);
  const [countdownSeconds, setCountdownSeconds] = useState(0);
  const [countdownDone, setCountdownDone] = useState<string | null>(null);

  useEffect(() => {
    const unsubExpired = window.vinted.onSessionExpired(() => setSessionExpired(true));
    const unsubReconnected = window.vinted.onSessionReconnected(() => {
      setSessionExpired(false);
      setReconnectCookie('');
    });
    return () => {
      unsubExpired();
      unsubReconnected();
    };
  }, []);

  useEffect(() => {
    const unsub = window.vinted.onSniperCountdown((params) => {
      setCountdown(params);
      setCountdownSeconds(params.secondsLeft);
      setCountdownDone(null);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = window.vinted.onSniperCountdownDone((params) => {
      setCountdownDone(params.message);
      setCountdown(null);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!countdownDone) return;
    const t = setTimeout(() => setCountdownDone(null), 5000);
    return () => clearTimeout(t);
  }, [countdownDone]);

  useEffect(() => {
    if (!countdown || countdownSeconds <= 0) return;
    const t = setInterval(() => {
      setCountdownSeconds((s) => {
        if (s <= 1) {
          clearInterval(t);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [countdown, countdownSeconds]);

  const [isRefreshingSession, setIsRefreshingSession] = useState(false);

  const handleReconnect = async () => {
    if (!reconnectCookie.trim()) return;
    await window.vinted.storeCookie(reconnectCookie.trim());
  };

  const handleRefreshSession = async () => {
    if (isRefreshingSession) return;
    setIsRefreshingSession(true);
    try {
      const result = await window.vinted.startCookieRefresh();
      if (result.ok) {
        setSessionExpired(false);
        setReconnectCookie('');
      }
    } finally {
      setIsRefreshingSession(false);
    }
  };

  const handleCancelCountdown = () => {
    if (countdown) {
      window.vinted.cancelSniperCountdown(countdown.countdownId);
      setCountdown(null);
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: font.family }}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
        aria-hidden="true"
      >
        <defs>
          <filter id="liquid-glass-refraction" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.015"
              numOctaves="3"
              seed="42"
              stitchTiles="stitch"
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="6"
              xChannelSelector="R"
              yChannelSelector="G"
              result="displaced"
            />
            <feGaussianBlur
              in="displaced"
              stdDeviation="0.5"
              result="blurred"
            />
            <feBlend in="blurred" in2="SourceGraphic" mode="normal" />
          </filter>
        </defs>
      </svg>
      {/* ─── Sidebar ──────────────────────────────────────── */}
      <motion.aside
        className="liquid-glass-panel"
        initial={{ x: -SIDEBAR_WIDTH, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={springSmooth}
        style={{
          ...liquidGlassPanel,
          width: SIDEBAR_WIDTH,
          minWidth: SIDEBAR_WIDTH,
          height: '100vh',
          position: 'fixed',
          left: 0,
          top: 0,
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(255, 255, 255, 0.60)',
          backdropFilter: 'url(#liquid-glass-refraction) blur(40px) saturate(150%)',
          WebkitBackdropFilter: 'url(#liquid-glass-refraction) blur(40px) saturate(150%)',
          borderRight: `1px solid rgba(255, 255, 255, 0.9)`,
          boxShadow: '1px 0 12px rgba(0, 0, 0, 0.03)',
          borderRadius: 0,
          zIndex: 100,
          padding: `${spacing['2xl']}px 0`,
        }}
      >
        {/* Branding */}
        <div style={{ padding: `0 ${spacing.xl}px`, marginBottom: spacing['3xl'] }}>
          <h1
            style={{
              fontSize: font.size.xl,
              fontWeight: font.weight.bold,
              color: colors.textPrimary,
              margin: 0,
              letterSpacing: '-0.02em',
            }}
          >
            Vinted HQ
          </h1>
          <span
            style={{
              fontSize: font.size.xs,
              color: colors.textMuted,
              fontWeight: font.weight.medium,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginTop: 4,
              display: 'block',
            }}
          >
            Sniper Dashboard
          </span>
        </div>

        {/* Nav Items */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: `0 ${spacing.sm}px` }}>
          {(['feed', 'wardrobe', 'sales', 'automessage', 'proxies', 'settings', 'logs', 'purchases'] as Tab[]).map((t) => {
            const active = tab === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '11px 16px',
                  borderRadius: radius.md,
                  border: 'none',
                  background: active ? colors.primaryMuted : 'transparent',
                  color: active ? colors.primary : colors.textSecondary,
                  fontWeight: active ? font.weight.semibold : font.weight.medium,
                  fontSize: font.size.base,
                  cursor: 'pointer',
                  transition: transition.base,
                  textAlign: 'left',
                  width: '100%',
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = 'rgba(0, 0, 0, 0.04)';
                    e.currentTarget.style.color = colors.textPrimary;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = colors.textSecondary;
                  }
                }}
              >
                {icons[t]}
                {tabLabels[t]}
              </button>
            );
          })}
        </nav>

        {/* Bottom spacer for visual balance */}
        <div style={{ flex: 1 }} />

        {/* Session status indicator */}
        {sessionExpired && (
          <div
            style={{
              margin: `0 ${spacing.md}px`,
              padding: `${spacing.sm}px ${spacing.md}px`,
              borderRadius: radius.md,
              background: colors.errorBg,
              color: colors.error,
              fontSize: font.size.sm,
              fontWeight: font.weight.medium,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: colors.error, flexShrink: 0 }} />
            Session expired
          </div>
        )}
      </motion.aside>

      {/* ─── Main Content ─────────────────────────────────── */}
      <motion.main
        animate={{
          filter: countdown ? 'brightness(0.5) blur(8px)' : 'brightness(1) blur(0px)',
        }}
        transition={springGentle}
        style={{
          flex: 1,
          marginLeft: SIDEBAR_WIDTH,
          height: '100vh',
          overflow: 'auto',
          background: colors.bgBase,
        }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96 }}
            transition={springSmooth}
            style={{ height: '100%' }}
          >
            {tab === 'feed' && <Feed />}
            {tab === 'wardrobe' && <Wardrobe />}
            {tab === 'sales' && <SalesSuite />}
            {tab === 'automessage' && <AutoMessage />}
            {tab === 'proxies' && <ProxyStatus />}
            {tab === 'settings' && <Settings />}
            {tab === 'logs' && <Logs />}
            {tab === 'purchases' && <PurchasesSuite />}
          </motion.div>
        </AnimatePresence>
      </motion.main>

      {/* ─── Sniper Countdown Modal ───────────────────────── */}
      <AnimatePresence>
        {countdown && (
          <motion.div
            key="sniper-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={springGentle}
            style={modalOverlay}
          >
            <motion.div
              key="sniper-modal"
              initial={{ scale: 0.8, y: -40, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.8, y: -40, opacity: 0 }}
              transition={springGentle}
              style={{ ...modalContent, textAlign: 'center' }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: radius.lg,
                  background: colors.primaryMuted,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 16px',
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={colors.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
              <h3 style={{ margin: '0 0 6px', fontSize: font.size.lg, fontWeight: font.weight.semibold, color: colors.textPrimary }}>
                {countdown.sniper.name}
              </h3>
              <p style={{ margin: '0 0 4px', fontSize: font.size.base, color: colors.textSecondary }}>
                {countdown.item.title}
              </p>
              <p style={{ margin: '0 0 20px', fontWeight: font.weight.bold, color: colors.primary, fontSize: font.size.lg }}>
                £{countdown.item.price}
              </p>
              <div style={{ margin: '0 0 24px' }}>
                <AnimatePresence mode="wait">
                  <motion.span
                    key={countdownSeconds}
                    initial={{ scale: 1.15, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.85, opacity: 0 }}
                    transition={springResponsive}
                    style={{
                      display: 'block',
                      fontSize: font.size['3xl'],
                      fontWeight: font.weight.bold,
                      color: colors.textPrimary,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {countdownSeconds > 0 ? countdownSeconds : 'Buying...'}
                  </motion.span>
                </AnimatePresence>
              </div>
              <button
                type="button"
                onClick={handleCancelCountdown}
                disabled={countdownSeconds <= 0}
                style={{
                  ...btnDanger,
                  opacity: countdownSeconds > 0 ? 1 : 0.4,
                  cursor: countdownSeconds > 0 ? 'pointer' : 'default',
                  width: '100%',
                }}
              >
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Session Expired Modal ────────────────────────── */}
      {sessionExpired && (
        <div style={{ ...modalOverlay, zIndex: 1002 }}>
          <div style={{ ...modalContent, maxWidth: 480 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: radius.lg,
                background: colors.errorBg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={colors.error} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <h3 style={{ margin: '0 0 8px', fontSize: font.size.lg, fontWeight: font.weight.semibold, color: colors.textPrimary }}>
              Session expired
            </h3>
            <p style={{ margin: '0 0 20px', color: colors.textSecondary, fontSize: font.size.base, lineHeight: 1.6 }}>
              Your Vinted session has expired. Open the login page to re-authenticate, or paste a cookie string manually.
            </p>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              <button
                type="button"
                onClick={handleRefreshSession}
                disabled={isRefreshingSession}
                style={{
                  ...btnPrimary,
                  flex: 1,
                  opacity: isRefreshingSession ? 0.6 : 1,
                  cursor: isRefreshingSession ? 'default' : 'pointer',
                }}
              >
                {isRefreshingSession ? 'Opening login...' : 'Refresh session (open login)'}
              </button>
            </div>
            <details style={{ marginBottom: 16 }}>
              <summary style={{ color: colors.textSecondary, fontSize: font.size.sm, cursor: 'pointer', marginBottom: 8 }}>
                Or paste cookie manually...
              </summary>
              <textarea
                placeholder="Paste cookie string here..."
                value={reconnectCookie}
                onChange={(e) => setReconnectCookie(e.target.value)}
                rows={4}
                style={{
                  ...glassTextarea,
                  width: '100%',
                  marginBottom: 8,
                }}
              />
              <button
                type="button"
                onClick={handleReconnect}
                disabled={!reconnectCookie.trim()}
                style={{
                  ...btnPrimary,
                  width: '100%',
                  opacity: reconnectCookie.trim() ? 1 : 0.4,
                  cursor: reconnectCookie.trim() ? 'pointer' : 'default',
                }}
              >
                Reconnect
              </button>
            </details>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => {
                  setSessionExpired(false);
                  setReconnectCookie('');
                }}
                style={{ ...btnSecondary, flex: 1 }}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Countdown Done Toast ─────────────────────────── */}
      <AnimatePresence>
        {countdownDone && !countdown && (
          <motion.div
            key="countdown-toast"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={springSmooth}
            style={toastStyle}
          >
            {countdownDone}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```
```diff:Feed.tsx
/**
 * Feed — grid of items from search URLs
 * Revolut-inspired glass card design
 */

import React, { useEffect, useState } from 'react';
import {
  colors,
  font,
  liquidGlassCard,
  btnPrimary,
  btnSmall,
  radius,
  spacing,
  transition,
  shadows,
  badge,
} from '../theme';
import type { FeedItem } from '../types/global';

export default function Feed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [isPolling, setIsPolling] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [hasCookie, setHasCookie] = useState(false);
  const [searchUrlCount, setSearchUrlCount] = useState(0);
  const [buyingId, setBuyingId] = useState<number | null>(null);
  const [buyProgress, setBuyProgress] = useState<string | null>(null);
  const [buyResult, setBuyResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    window.vinted.hasCookie().then(setHasCookie);
    window.vinted.getSearchUrls().then((urls) => setSearchUrlCount(urls.filter((u) => u.enabled).length));
    window.vinted.isFeedPolling().then(setIsPolling);

    const unsubscribe = window.vinted.onFeedItems((newItems) => {
      setItems((prev) => {
        const prevIds = new Set(prev.map((i) => i.id));
        const added = newItems.filter((i) => !prevIds.has(i.id)).length;
        if (added > 0 && prev.length > 0) setNewCount((n) => n + added);
        return newItems;
      });
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (searchUrlCount > 0 && hasCookie) {
      window.vinted.startFeedPolling();
    }
  }, [searchUrlCount, hasCookie]);

  useEffect(() => {
    const unsubProgress = window.vinted.onCheckoutProgress(setBuyProgress);
    return unsubProgress;
  }, []);

  const handleBuy = async (item: FeedItem) => {
    setBuyingId(item.id);
    setBuyProgress('Starting...');
    setBuyResult(null);
    try {
      const result = await window.vinted.checkoutBuy(item);
      setBuyResult({ ok: result.ok, message: result.message });
      if (!result.ok) setBuyProgress(null);
      else setBuyProgress(null);
    } catch (err) {
      setBuyResult({ ok: false, message: err instanceof Error ? err.message : 'Checkout failed' });
      setBuyProgress(null);
    } finally {
      setBuyingId(null);
    }
  };

  const handleDismissNew = () => setNewCount(0);

  /* ─── Empty states ───────────────────────────────────── */

  if (!hasCookie) {
    return (
      <div style={{ padding: spacing['3xl'], display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ ...liquidGlassCard, padding: spacing['4xl'], textAlign: 'center', maxWidth: 400 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🔗</div>
          <p style={{ color: colors.textSecondary, fontSize: font.size.base, margin: 0, lineHeight: 1.6 }}>
            Connect your Vinted session in <strong style={{ color: colors.textPrimary }}>Settings</strong> to see the feed.
          </p>
        </div>
      </div>
    );
  }

  if (searchUrlCount === 0) {
    return (
      <div style={{ padding: spacing['3xl'], display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ ...liquidGlassCard, padding: spacing['4xl'], textAlign: 'center', maxWidth: 400 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🔍</div>
          <p style={{ color: colors.textSecondary, fontSize: font.size.base, margin: 0, lineHeight: 1.6 }}>
            Add search URLs in <strong style={{ color: colors.textPrimary }}>Settings</strong> and enable them to start the feed.
          </p>
        </div>
      </div>
    );
  }

  /* ─── Main feed ──────────────────────────────────────── */

  return (
    <div style={{ padding: spacing['2xl'], display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      {/* Status bar */}
      <div
        style={{
          ...liquidGlassCard,
          padding: `${spacing.md}px ${spacing.xl}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: spacing.md,
          borderRadius: radius.lg,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md }}>
          {/* Polling indicator dot */}
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: isPolling ? colors.success : colors.textMuted,
              flexShrink: 0,
              boxShadow: isPolling ? `0 0 8px ${colors.success}` : 'none',
            }}
            className={isPolling ? 'animate-pulse' : undefined}
          />
          <span style={{ fontSize: font.size.base, color: colors.textSecondary }}>
            {items.length} items · {isPolling ? 'Polling active' : 'Polling paused'}
            {buyProgress && <span style={{ color: colors.primary }}> · {buyProgress}</span>}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
          {buyResult && (
            <span
              style={badge(
                buyResult.ok ? colors.successBg : colors.errorBg,
                buyResult.ok ? colors.success : colors.error,
              )}
            >
              {buyResult.message}
            </span>
          )}
          {newCount > 0 && (
            <button
              type="button"
              onClick={handleDismissNew}
              style={{
                ...btnPrimary,
                ...btnSmall,
                boxShadow: 'none',
              }}
            >
              {newCount} new — dismiss
            </button>
          )}
        </div>
      </div>

      {/* Item grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: spacing.xl,
          alignContent: 'start',
        }}
      >
        {items.map((item) => (
          <FeedItemCard
            key={item.id}
            item={item}
            expanded={expandedId === item.id}
            onToggle={() => setExpandedId((id) => (id === item.id ? null : item.id))}
            onBuy={handleBuy}
            isBuying={buyingId !== null}
          />
        ))}
      </div>

      {items.length === 0 && (
        <p style={{ color: colors.textMuted, textAlign: 'center', padding: spacing['4xl'], fontSize: font.size.base }}>
          No items yet. Polling runs every few seconds — check back shortly.
        </p>
      )}
    </div>
  );
}

/* ─── Feed Item Card ────────────────────────────────────────── */

function FeedItemCard({
  item,
  expanded,
  onToggle,
  onBuy,
  isBuying,
}: {
  item: FeedItem;
  expanded: boolean;
  onToggle: () => void;
  onBuy: (item: FeedItem) => void;
  isBuying: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onToggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...liquidGlassCard,
        overflow: 'hidden',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        transition: transition.base,
        background: hovered ? colors.glassBgHover : liquidGlassCard.background,
        transform: hovered ? 'translateY(-4px)' : 'translateY(0)',
        boxShadow: hovered ? shadows.cardHover : shadows.card,
      }}
    >
      {/* Image */}
      <div
        style={{
          aspectRatio: '1',
          background: colors.bgElevated,
          position: 'relative',
          overflow: 'hidden',
          borderRadius: '20px 20px 0 0',
          boxShadow: 'inset 0 -20px 30px rgba(0,0,0,0.05)',
        }}
      >
        {item.photo_url ? (
          <img
            src={item.photo_url}
            alt={item.title}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transition: transition.slow,
              transform: hovered ? 'scale(1.03)' : 'scale(1)',
            }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: colors.textMuted,
              fontSize: font.size.sm,
            }}
          >
            No image
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{ padding: spacing.md, flex: 1 }}>
        <div
          style={{
            fontWeight: font.weight.medium,
            fontSize: font.size.base,
            color: colors.textPrimary,
            marginBottom: 4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={item.title}
        >
          {item.title.length > 50 ? item.title.slice(0, 50) + '…' : item.title}
        </div>
        <div style={{ fontSize: font.size.lg, fontWeight: font.weight.semibold, color: colors.textPrimary, textShadow: '0 1px 0 rgba(255,255,255,0.9)' }}>
          £{item.price} {item.currency}
        </div>
        {item.condition && (
          <span style={{ fontSize: font.size.sm, color: colors.textSecondary, marginTop: 2, display: 'block', fontWeight: font.weight.normal }}>
            {item.condition}
          </span>
        )}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div
          style={{
            padding: spacing.md,
            borderTop: `1px solid ${colors.separator}`,
            fontSize: font.size.sm,
            color: colors.textSecondary,
            background: 'rgba(255, 255, 255, 0.02)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {item.size && <div style={{ marginBottom: 3 }}>Size: <span style={{ color: colors.textPrimary }}>{item.size}</span></div>}
          {item.brand && <div style={{ marginBottom: 3 }}>Brand: <span style={{ color: colors.textPrimary }}>{item.brand}</span></div>}
          {item.seller_login && <div style={{ marginBottom: 3 }}>Seller: <span style={{ color: colors.textPrimary }}>{item.seller_login}</span></div>}
          {item.source_urls.length > 1 && <div style={{ marginBottom: 3 }}>From {item.source_urls.length} searches</div>}
          <div style={{ display: 'flex', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onBuy(item);
              }}
              disabled={isBuying}
              style={{
                ...btnPrimary,
                ...btnSmall,
                opacity: isBuying ? 0.5 : 1,
                cursor: isBuying ? 'default' : 'pointer',
              }}
            >
              Buy Now
            </button>
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                color: colors.textSecondary,
                fontSize: font.size.sm,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                transition: transition.fast,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = colors.primary; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = colors.textSecondary; }}
            >
              Open on Vinted →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
===
/**
 * Feed — grid of items from search URLs
 * Revolut-inspired glass card design
 */

import React, { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  colors,
  font,
  liquidGlassCard,
  btnPrimary,
  btnSmall,
  radius,
  spacing,
  transition,
  shadows,
  badge,
  springResponsive,
  staggerFast,
} from '../theme';
import { useMousePosition } from '../hooks/useMousePosition';
import GlassSkeleton from './GlassSkeleton';
import type { FeedItem } from '../types/global';

export default function Feed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [isPolling, setIsPolling] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [hasCookie, setHasCookie] = useState(false);
  const [searchUrlCount, setSearchUrlCount] = useState(0);
  const [buyingId, setBuyingId] = useState<number | null>(null);
  const [buyProgress, setBuyProgress] = useState<string | null>(null);
  const [buyResult, setBuyResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    window.vinted.hasCookie().then(setHasCookie);
    window.vinted.getSearchUrls().then((urls) => setSearchUrlCount(urls.filter((u) => u.enabled).length));
    window.vinted.isFeedPolling().then(setIsPolling);

    const unsubscribe = window.vinted.onFeedItems((newItems) => {
      setItems((prev) => {
        const prevIds = new Set(prev.map((i) => i.id));
        const added = newItems.filter((i) => !prevIds.has(i.id)).length;
        if (added > 0 && prev.length > 0) setNewCount((n) => n + added);
        return newItems;
      });
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (searchUrlCount > 0 && hasCookie) {
      window.vinted.startFeedPolling();
    }
  }, [searchUrlCount, hasCookie]);

  useEffect(() => {
    const unsubProgress = window.vinted.onCheckoutProgress(setBuyProgress);
    return unsubProgress;
  }, []);

  const handleBuy = async (item: FeedItem) => {
    setBuyingId(item.id);
    setBuyProgress('Starting...');
    setBuyResult(null);
    try {
      const result = await window.vinted.checkoutBuy(item);
      setBuyResult({ ok: result.ok, message: result.message });
      if (!result.ok) setBuyProgress(null);
      else setBuyProgress(null);
    } catch (err) {
      setBuyResult({ ok: false, message: err instanceof Error ? err.message : 'Checkout failed' });
      setBuyProgress(null);
    } finally {
      setBuyingId(null);
    }
  };

  const handleDismissNew = () => setNewCount(0);

  /* ─── Empty states ───────────────────────────────────── */

  if (!hasCookie) {
    return (
      <div style={{ padding: spacing['3xl'], display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ ...liquidGlassCard, padding: spacing['4xl'], textAlign: 'center', maxWidth: 400 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🔗</div>
          <p style={{ color: colors.textSecondary, fontSize: font.size.base, margin: 0, lineHeight: 1.6 }}>
            Connect your Vinted session in <strong style={{ color: colors.textPrimary }}>Settings</strong> to see the feed.
          </p>
        </div>
      </div>
    );
  }

  if (searchUrlCount === 0) {
    return (
      <div style={{ padding: spacing['3xl'], display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ ...liquidGlassCard, padding: spacing['4xl'], textAlign: 'center', maxWidth: 400 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🔍</div>
          <p style={{ color: colors.textSecondary, fontSize: font.size.base, margin: 0, lineHeight: 1.6 }}>
            Add search URLs in <strong style={{ color: colors.textPrimary }}>Settings</strong> and enable them to start the feed.
          </p>
        </div>
      </div>
    );
  }

  /* ─── Main feed ──────────────────────────────────────── */

  return (
    <div style={{ padding: spacing['2xl'], display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      {/* Status bar */}
      <div
        style={{
          ...liquidGlassCard,
          padding: `${spacing.md}px ${spacing.xl}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: spacing.md,
          borderRadius: radius.lg,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md }}>
          {/* Polling indicator dot */}
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: isPolling ? colors.success : colors.textMuted,
              flexShrink: 0,
              boxShadow: isPolling ? `0 0 8px ${colors.success}` : 'none',
            }}
            className={isPolling ? 'animate-pulse' : undefined}
          />
          <span style={{ fontSize: font.size.base, color: colors.textSecondary }}>
            {items.length} items · {isPolling ? 'Polling active' : 'Polling paused'}
            {buyProgress && <span style={{ color: colors.primary }}> · {buyProgress}</span>}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
          {buyResult && (
            <span
              style={badge(
                buyResult.ok ? colors.successBg : colors.errorBg,
                buyResult.ok ? colors.success : colors.error,
              )}
            >
              {buyResult.message}
            </span>
          )}
          {newCount > 0 && (
            <button
              type="button"
              onClick={handleDismissNew}
              style={{
                ...btnPrimary,
                ...btnSmall,
                boxShadow: 'none',
              }}
            >
              {newCount} new — dismiss
            </button>
          )}
        </div>
      </div>

      {/* Item grid */}
      <motion.div
        initial="hidden"
        animate="visible"
        variants={{
          hidden: {},
          visible: { transition: staggerFast },
        }}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: spacing.xl,
          alignContent: 'start',
        }}
      >
        {items.map((item) => (
          <FeedItemCard
            key={item.id}
            item={item}
            expanded={expandedId === item.id}
            onToggle={() => setExpandedId((id) => (id === item.id ? null : item.id))}
            onBuy={handleBuy}
            isBuying={buyingId !== null}
          />
        ))}
      </motion.div>

      {items.length === 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: spacing.xl,
          }}
        >
          <GlassSkeleton height={280} count={6} />
        </div>
      )}
    </div>
  );
}

/* ─── Feed Item Card ────────────────────────────────────────── */

function FeedItemCard({
  item,
  expanded,
  onToggle,
  onBuy,
  isBuying,
}: {
  item: FeedItem;
  expanded: boolean;
  onToggle: () => void;
  onBuy: (item: FeedItem) => void;
  isBuying: boolean;
}) {
  const { ref, onMouseMove, onMouseLeave } = useMousePosition<HTMLDivElement>();

  return (
    <motion.div
      ref={ref}
      onClick={onToggle}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      variants={{
        hidden: { y: 20, opacity: 0 },
        visible: { y: 0, opacity: 1 },
      }}
      transition={springResponsive}
      whileHover={{ y: -4, boxShadow: shadows.cardHover }}
      style={{
        ...liquidGlassCard,
        overflow: 'hidden',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        background: liquidGlassCard.background,
      }}
    >
      {/* Image */}
      <div
        style={{
          aspectRatio: '1',
          background: colors.bgElevated,
          position: 'relative',
          overflow: 'hidden',
          borderRadius: '20px 20px 0 0',
          boxShadow: 'inset 0 -20px 30px rgba(0,0,0,0.05)',
        }}
      >
        {item.photo_url ? (
          <img
            src={item.photo_url}
            alt={item.title}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: colors.textMuted,
              fontSize: font.size.sm,
            }}
          >
            No image
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{ padding: spacing.md, flex: 1 }}>
        <div
          style={{
            fontWeight: font.weight.medium,
            fontSize: font.size.base,
            color: colors.textPrimary,
            marginBottom: 4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={item.title}
        >
          {item.title.length > 50 ? item.title.slice(0, 50) + '…' : item.title}
        </div>
        <div style={{ fontSize: font.size.lg, fontWeight: font.weight.semibold, color: colors.textPrimary, textShadow: '0 1px 0 rgba(255,255,255,0.9)' }}>
          £{item.price} {item.currency}
        </div>
        {item.condition && (
          <span style={{ fontSize: font.size.sm, color: colors.textSecondary, marginTop: 2, display: 'block', fontWeight: font.weight.normal }}>
            {item.condition}
          </span>
        )}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div
          style={{
            padding: spacing.md,
            borderTop: `1px solid ${colors.separator}`,
            fontSize: font.size.sm,
            color: colors.textSecondary,
            background: 'rgba(255, 255, 255, 0.02)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {item.size && <div style={{ marginBottom: 3 }}>Size: <span style={{ color: colors.textPrimary }}>{item.size}</span></div>}
          {item.brand && <div style={{ marginBottom: 3 }}>Brand: <span style={{ color: colors.textPrimary }}>{item.brand}</span></div>}
          {item.seller_login && <div style={{ marginBottom: 3 }}>Seller: <span style={{ color: colors.textPrimary }}>{item.seller_login}</span></div>}
          {item.source_urls.length > 1 && <div style={{ marginBottom: 3 }}>From {item.source_urls.length} searches</div>}
          <div style={{ display: 'flex', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onBuy(item);
              }}
              disabled={isBuying}
              style={{
                ...btnPrimary,
                ...btnSmall,
                opacity: isBuying ? 0.5 : 1,
                cursor: isBuying ? 'default' : 'pointer',
              }}
            >
              Buy Now
            </button>
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                color: colors.textSecondary,
                fontSize: font.size.sm,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                transition: transition.fast,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = colors.primary; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = colors.textSecondary; }}
            >
              Open on Vinted →
            </a>
          </div>
        </div>
      )}
    </motion.div>
  );
}
```
```diff:Settings.tsx
/**
 * Settings page — session, polling, couriers, delivery, proxies, search URLs
 * Revolut-inspired glass section panels
 */

import React, { useEffect, useState } from 'react';
import {
  colors,
  font,
  glassPanel,
  recessedInput,
  glassInput, // Restored for backward compatibility
  glassTextarea,
  glassSelect,
  btnPrimary,
  btnSecondary,
  btnSmall,
  dangerText,
  sectionTitle,
  sectionDesc,
  badge,
  radius,
  spacing,
} from '../theme';
import type { AppSettings, SearchUrl, Sniper } from '../types/global';

type RefreshStatus =
  | 'idle'
  | 'opening'
  | 'waiting'
  | 'captured'
  | 'refreshed'
  | 'timed_out'
  | 'window_closed'
  | 'failed';

/* ─── Sniper Budget Display ─────────────────────────────────── */

function SniperSpentDisplay({ sniperId, budgetLimit }: { sniperId: number; budgetLimit: number }) {
  const [spent, setSpent] = useState<number | null>(null);
  useEffect(() => {
    window.vinted.getSniperSpent(sniperId).then(setSpent);
  }, [sniperId]);
  return (
    <span style={badge(colors.primaryMuted, colors.primary)}>
      budget £{budgetLimit} (spent: £{spent ?? '…'})
    </span>
  );
}

/* ─── Section Wrapper ───────────────────────────────────────── */

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        ...glassPanel,
        padding: spacing['2xl'],
        marginBottom: spacing['3xl'],
      }}
    >
      <h3 style={sectionTitle}>{title}</h3>
      {description && <p style={{ ...sectionDesc, marginBottom: spacing.lg }}>{description}</p>}
      <div>{children}</div>
    </section>
  );
}

/* ─── Input Row Helper ──────────────────────────────────────── */

function InputRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: spacing.sm, marginBottom: spacing.sm, alignItems: 'center' }}>
      {children}
    </div>
  );
}

/* ─── Default Settings ──────────────────────────────────────── */

const defaultSettings: AppSettings = {
  pollingIntervalSeconds: 5,
  defaultCourier: 'yodel',
  deliveryType: 'dropoff',
  latitude: 51.5074,
  longitude: -0.1278,
  verificationEnabled: false,
  verificationThresholdPounds: 100,
  authRequiredForPurchase: true,
  proxyUrls: [],
  scrapingProxies: [],
  checkoutProxies: [],
  simulationMode: true,
  autobuyEnabled: false,
  sessionAutofillEnabled: true,
  sessionAutoSubmitEnabled: false,
  transportMode: 'PROXY',
  browser_proxy_mode: 'DIRECT',
  crm_delay_min_minutes: 2,
  crm_delay_max_minutes: 5,
};

/* ─── Relist Timing Section ─────────────────────────────────── */

function RelistTimingSection() {
  const [minDelay, setMinDelay] = useState(30);
  const [maxDelay, setMaxDelay] = useState(90);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    window.vinted.getQueueSettings().then((s) => {
      setMinDelay(s.minDelay);
      setMaxDelay(s.maxDelay);
    });
  }, []);

  const handleSave = () => {
    const min = Math.max(5, minDelay);
    const max = Math.max(min + 5, maxDelay);
    setMinDelay(min);
    setMaxDelay(max);
    window.vinted.setQueueSettings(min, max);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <Section
      title="Relist Timing"
      description="Randomized delay between bulk relists to avoid pattern detection. Each relist waits a random duration between min and max before proceeding to the next item."
    >
      <div style={{ display: 'flex', gap: spacing.lg, alignItems: 'center', marginBottom: spacing.md }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, fontSize: font.size.base, color: colors.textSecondary }}>
          <span>Min delay (s):</span>
          <input
            type="number"
            min={5}
            max={300}
            value={minDelay}
            onChange={(e) => setMinDelay(Math.max(5, parseInt(e.target.value, 10) || 30))}
            style={{ ...recessedInput, width: 90 }}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, fontSize: font.size.base, color: colors.textSecondary }}>
          <span>Max delay (s):</span>
          <input
            type="number"
            min={10}
            max={600}
            value={maxDelay}
            onChange={(e) => setMaxDelay(Math.max(10, parseInt(e.target.value, 10) || 90))}
            style={{ ...recessedInput, width: 90 }}
          />
        </label>
        <button
          type="button"
          onClick={handleSave}
          style={{ ...btnPrimary, ...btnSmall }}
        >
          {saved ? '✓ Saved' : 'Save'}
        </button>
      </div>
      <p style={{ fontSize: font.size.sm, color: colors.textMuted, margin: 0 }}>
        Current range: {minDelay}–{maxDelay}s between relists. The 10-second delete-post safety gap is applied automatically.
      </p>
    </Section>
  );
}

/* ─── Main Component ────────────────────────────────────────── */

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [hasCookie, setHasCookie] = useState(false);
  const [cookieInput, setCookieInput] = useState('');
  const [proxyInput, setProxyInput] = useState('');
  const [scrapingProxyInput, setScrapingProxyInput] = useState('');
  const [checkoutProxyInput, setCheckoutProxyInput] = useState('');
  const [saved, setSaved] = useState(false);
  const [searchUrls, setSearchUrls] = useState<SearchUrl[]>([]);
  const [searchUrlInput, setSearchUrlInput] = useState('');
  const [snipers, setSnipers] = useState<Sniper[]>([]);
  const [sniperName, setSniperName] = useState('');
  const [sniperPriceMax, setSniperPriceMax] = useState('');
  const [sniperKeywords, setSniperKeywords] = useState('');
  const [sniperBudget, setSniperBudget] = useState('');
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [hasLoginCredentials, setHasLoginCredentials] = useState(false);
  const [isRefreshingSession, setIsRefreshingSession] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<RefreshStatus>('idle');
  const [transportMode, setTransportMode] = useState<'PROXY' | 'DIRECT'>('PROXY');
  const [checkoutLocked, setCheckoutLocked] = useState(false);
  const [transportError, setTransportError] = useState<string | null>(null);
  const [isSyncingExtension, setIsSyncingExtension] = useState(false);
  const [extensionSyncStatus, setExtensionSyncStatus] = useState<'idle' | 'checking' | 'synced' | 'polling' | 'failed'>('idle');

  useEffect(() => {
    window.vinted.getSettings().then(setSettings);
    window.vinted.hasCookie().then(setHasCookie);
    window.vinted.getSearchUrls().then(setSearchUrls);
    window.vinted.getSnipers().then(setSnipers);
    window.vinted.hasLoginCredentials().then(setHasLoginCredentials);
    window.vinted.getTransportMode().then(setTransportMode);
    window.vinted.isCheckoutActive().then(setCheckoutLocked);
  }, []);

  const showSaved = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSaveCookie = async () => {
    if (!cookieInput.trim()) return;
    await window.vinted.storeCookie(cookieInput.trim());
    setHasCookie(true);
    setCookieInput('');
    showSaved();
  };

  const handleClearCookie = async () => {
    await window.vinted.clearCookie();
    setHasCookie(false);
    setCookieInput('');
    showSaved();
  };

  const handleRefreshSession = async () => {
    if (isRefreshingSession) return;
    setIsRefreshingSession(true);
    setRefreshStatus('opening');
    // Keep "waiting" visible even while the window is active.
    const waitingTimer = setTimeout(() => setRefreshStatus('waiting'), 900);
    try {
      const result = await window.vinted.startCookieRefresh();
      if (result.ok) {
        setRefreshStatus('captured');
        setHasCookie(true);
        setTimeout(() => setRefreshStatus('refreshed'), 300);
        showSaved();
      } else if (result.reason === 'TIMED_OUT') {
        setRefreshStatus('timed_out');
      } else if (result.reason === 'WINDOW_CLOSED') {
        setRefreshStatus('window_closed');
      } else {
        setRefreshStatus('failed');
      }
    } finally {
      clearTimeout(waitingTimer);
      setIsRefreshingSession(false);
    }
  };

  const handleSaveLoginCredentials = async () => {
    if (!loginUsername.trim() || !loginPassword.trim()) return;
    await window.vinted.saveLoginCredentials(loginUsername.trim(), loginPassword);
    setHasLoginCredentials(true);
    setLoginPassword('');
    showSaved();
  };

  const handleClearLoginCredentials = async () => {
    await window.vinted.clearLoginCredentials();
    setHasLoginCredentials(false);
    setLoginUsername('');
    setLoginPassword('');
    showSaved();
  };

  const refreshLabel: Record<RefreshStatus, string> = {
    idle: '',
    opening: 'Opening login window...',
    waiting: 'Waiting for login and cookie capture...',
    captured: 'Cookies captured.',
    refreshed: 'Session refreshed.',
    timed_out: 'Timed out while waiting for login.',
    window_closed: 'Login window closed before capture.',
    failed: 'Unable to refresh session.',
  };

  const extensionSyncLabel: Record<string, string> = {
    idle: '',
    checking: '🔍 Checking for extension session data...',
    synced: '✅ Session synced from Chrome Extension!',
    polling: '🌐 Opened Vinted in Chrome — waiting for extension to harvest session...',
    failed: '⚠️ Extension sync failed. Make sure the Vinted HQ extension is installed and you are logged into Vinted in Chrome.',
  };

  const handleSyncFromExtension = async () => {
    if (isSyncingExtension) return;
    setIsSyncingExtension(true);
    setExtensionSyncStatus('checking');
    try {
      // Brief delay so user sees the checking state
      setTimeout(() => {
        if (isSyncingExtension) setExtensionSyncStatus('polling');
      }, 1200);
      const result = await window.vinted.syncFromExtension();
      if (result.ok) {
        setExtensionSyncStatus('synced');
        setHasCookie(true);
        showSaved();
        // Reset status after a moment
        setTimeout(() => setExtensionSyncStatus('idle'), 4000);
      } else {
        setExtensionSyncStatus('failed');
        setTimeout(() => setExtensionSyncStatus('idle'), 8000);
      }
    } catch {
      setExtensionSyncStatus('failed');
      setTimeout(() => setExtensionSyncStatus('idle'), 8000);
    } finally {
      setIsSyncingExtension(false);
    }
  };

  const handleSettingsChange = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    window.vinted.setSetting(key, value);
  };

  const handleTransportModeChange = async (mode: 'PROXY' | 'DIRECT') => {
    setTransportError(null);
    // Re-check checkout lock before attempting
    const active = await window.vinted.isCheckoutActive();
    setCheckoutLocked(active);
    if (active) {
      setTransportError('Cannot change transport mode while a checkout is in progress.');
      return;
    }
    const result = await window.vinted.setTransportMode(mode);
    if (result.ok) {
      setTransportMode(mode);
      showSaved();
    } else {
      setTransportError(result.error ?? 'Failed to change transport mode.');
    }
  };

  const handleAddProxy = () => {
    const url = proxyInput.trim();
    if (!url) return;
    const urls = [...settings.proxyUrls, url];
    setSettings((prev) => ({ ...prev, proxyUrls: urls }));
    window.vinted.setSetting('proxyUrls', urls);
    setProxyInput('');
  };

  const handleRemoveProxy = (index: number) => {
    const urls = settings.proxyUrls.filter((_, i) => i !== index);
    setSettings((prev) => ({ ...prev, proxyUrls: urls }));
    window.vinted.setSetting('proxyUrls', urls);
  };

  const handleAddScrapingProxy = () => {
    const url = scrapingProxyInput.trim();
    if (!url) return;
    const urls = [...settings.scrapingProxies, url];
    setSettings((prev) => ({ ...prev, scrapingProxies: urls }));
    window.vinted.setSetting('scrapingProxies', urls);
    setScrapingProxyInput('');
  };

  const handleRemoveScrapingProxy = (index: number) => {
    const urls = settings.scrapingProxies.filter((_, i) => i !== index);
    setSettings((prev) => ({ ...prev, scrapingProxies: urls }));
    window.vinted.setSetting('scrapingProxies', urls);
  };

  const handleAddCheckoutProxy = () => {
    const url = checkoutProxyInput.trim();
    if (!url) return;
    const urls = [...settings.checkoutProxies, url];
    setSettings((prev) => ({ ...prev, checkoutProxies: urls }));
    window.vinted.setSetting('checkoutProxies', urls);
    setCheckoutProxyInput('');
  };

  const handleRemoveCheckoutProxy = (index: number) => {
    const urls = settings.checkoutProxies.filter((_, i) => i !== index);
    setSettings((prev) => ({ ...prev, checkoutProxies: urls }));
    window.vinted.setSetting('checkoutProxies', urls);
  };

  const handleAddSearchUrl = async () => {
    const url = searchUrlInput.trim();
    if (!url) return;
    const added = await window.vinted.addSearchUrl(url);
    if (added) {
      setSearchUrls((prev) => [...prev, added]);
      setSearchUrlInput('');
      showSaved();
      window.vinted.startFeedPolling();
    }
  };

  const handleToggleSearchUrl = async (id: number, enabled: boolean) => {
    await window.vinted.updateSearchUrl(id, { enabled });
    setSearchUrls((prev) => prev.map((u) => (u.id === id ? { ...u, enabled } : u)));
    if (enabled) window.vinted.startFeedPolling();
  };

  const handleDeleteSearchUrl = async (id: number) => {
    await window.vinted.deleteSearchUrl(id);
    setSearchUrls((prev) => prev.filter((u) => u.id !== id));
  };

  const handleAddSniper = async () => {
    const name = sniperName.trim();
    if (!name) return;
    const added = await window.vinted.addSniper({
      name,
      price_max: sniperPriceMax ? parseFloat(sniperPriceMax) : undefined,
      keywords: sniperKeywords.trim() || undefined,
      budget_limit: sniperBudget ? parseFloat(sniperBudget) : 0,
    });
    if (added) {
      setSnipers((prev) => [...prev, added]);
      setSniperName('');
      setSniperPriceMax('');
      setSniperKeywords('');
      setSniperBudget('');
      showSaved();
    }
  };

  const handleToggleSniper = async (id: number, enabled: boolean) => {
    await window.vinted.updateSniper(id, { enabled });
    setSnipers((prev) => prev.map((s) => (s.id === id ? { ...s, enabled } : s)));
  };

  const handleDeleteSniper = async (id: number) => {
    await window.vinted.deleteSniper(id);
    setSnipers((prev) => prev.filter((s) => s.id !== id));
  };

  /* ─── List item row style ─────────────────────────── */
  const listRow: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
    padding: `${spacing.md}px 0`,
    borderBottom: `1px solid ${colors.separator}`,
  };

  return (
    <div style={{ padding: spacing['2xl'], maxWidth: 620 }}>
      {/* Page header */}
      <h2
        style={{
          fontSize: font.size['2xl'],
          fontWeight: font.weight.bold,
          color: colors.textPrimary,
          margin: `0 0 ${spacing.xl}px`,
          letterSpacing: '-0.02em',
        }}
      >
        Settings
      </h2>

      {/* Saved toast */}
      {saved && (
        <div
          style={{
            position: 'fixed',
            top: 20,
            right: 20,
            zIndex: 1100,
            ...badge(colors.successBg, colors.success),
            padding: '8px 16px',
            fontSize: font.size.base,
            borderRadius: radius.md,
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          }}
          className="animate-fadeIn"
        >
          ✓ Saved
        </div>
      )}

      {/* ─── Session ──────────────────────────────────── */}
      <Section
        title="Vinted Session"
        description="One-click refresh opens a short-lived login window, captures cookies, then closes automatically. Manual paste remains available as fallback."
      >
        <div style={{ display: 'flex', gap: spacing.md, alignItems: 'center', marginBottom: spacing.md }}>
          <span style={badge(hasCookie ? colors.successBg : colors.warningBg, hasCookie ? colors.success : colors.warning)}>
            {hasCookie ? '✓ Connected' : 'No active session'}
          </span>
          <button
            type="button"
            onClick={handleRefreshSession}
            disabled={isRefreshingSession}
            style={{
              ...btnPrimary,
              ...btnSmall,
              opacity: isRefreshingSession ? 0.6 : 1,
              cursor: isRefreshingSession ? 'default' : 'pointer',
            }}
          >
            Refresh session (open login)
          </button>
          <button
            type="button"
            onClick={handleClearCookie}
            style={{
              ...btnSecondary,
              ...btnSmall,
            }}
          >
            Clear session
          </button>
        </div>
        {refreshStatus !== 'idle' && (
          <p style={{ ...sectionDesc, marginBottom: spacing.md }}>{refreshLabel[refreshStatus]}</p>
        )}

        {/* ── 1-Click Extension Sync ── */}
        <div
          style={{
            padding: spacing.lg,
            marginBottom: spacing.lg,
            borderRadius: radius.md,
            border: `1px solid ${colors.primaryMuted}`,
            background: 'rgba(99, 102, 241, 0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm }}>
            <span style={{ fontSize: font.size.lg }}>🧩</span>
            <div>
              <strong style={{ color: colors.textPrimary, fontSize: font.size.base }}>Sync from Chrome Extension</strong>
              <p style={{ margin: 0, color: colors.textMuted, fontSize: font.size.sm }}>
                Instantly import your active Vinted session from Chrome. The extension harvests cookies automatically.
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center' }}>
            <button
              type="button"
              onClick={handleSyncFromExtension}
              disabled={isSyncingExtension}
              style={{
                ...btnPrimary,
                ...btnSmall,
                background: isSyncingExtension
                  ? colors.textMuted
                  : 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                border: 'none',
                opacity: isSyncingExtension ? 0.7 : 1,
                cursor: isSyncingExtension ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {isSyncingExtension ? '⏳ Syncing...' : '⚡ 1-Click Sync'}
            </button>
            {extensionSyncStatus !== 'idle' && (
              <span style={{
                fontSize: font.size.sm,
                color: extensionSyncStatus === 'synced' ? colors.success
                     : extensionSyncStatus === 'failed' ? colors.warning
                     : colors.textSecondary,
              }}>
                {extensionSyncLabel[extensionSyncStatus]}
              </span>
            )}
          </div>
        </div>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: spacing.sm,
            cursor: 'pointer',
            marginBottom: spacing.sm,
            fontSize: font.size.base,
            color: colors.textSecondary,
          }}
        >
          <input
            type="checkbox"
            checked={settings.sessionAutofillEnabled}
            onChange={(e) => handleSettingsChange('sessionAutofillEnabled', e.target.checked)}
          />
          Use saved login credentials to autofill Vinted login form
        </label>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: spacing.sm,
            cursor: 'pointer',
            marginBottom: spacing.md,
            fontSize: font.size.base,
            color: colors.textSecondary,
          }}
        >
          <input
            type="checkbox"
            checked={settings.sessionAutoSubmitEnabled}
            onChange={(e) => handleSettingsChange('sessionAutoSubmitEnabled', e.target.checked)}
          />
          Auto-submit login form after autofill
        </label>
        <InputRow>
          <input
            type="text"
            placeholder="Vinted email/username"
            value={loginUsername}
            onChange={(e) => setLoginUsername(e.target.value)}
            style={{ ...recessedInput, flex: 1 }}
          />
          <input
            type="password"
            placeholder="Vinted password"
            value={loginPassword}
            onChange={(e) => setLoginPassword(e.target.value)}
            style={{ ...recessedInput, flex: 1 }}
          />
        </InputRow>
        <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center', marginBottom: spacing.lg }}>
          <button
            type="button"
            onClick={handleSaveLoginCredentials}
            disabled={!loginUsername.trim() || !loginPassword.trim()}
            style={{
              ...btnSecondary,
              ...btnSmall,
              opacity: loginUsername.trim() && loginPassword.trim() ? 1 : 0.4,
              cursor: loginUsername.trim() && loginPassword.trim() ? 'pointer' : 'default',
            }}
          >
            Save login credentials
          </button>
          <button
            type="button"
            onClick={handleClearLoginCredentials}
            style={{ ...btnSecondary, ...btnSmall }}
          >
            Clear saved credentials
          </button>
          {hasLoginCredentials && (
            <span style={badge(colors.successBg, colors.success)}>Credentials saved in Keychain</span>
          )}
        </div>

        <textarea
          placeholder="Fallback: paste cookie string manually..."
          value={cookieInput}
          onChange={(e) => setCookieInput(e.target.value)}
          rows={4}
          style={{
            ...glassTextarea,
            width: '100%',
          }}
        />
        <button
          type="button"
          onClick={handleSaveCookie}
          disabled={!cookieInput.trim()}
          style={{
            ...btnPrimary,
            ...btnSmall,
            marginTop: spacing.sm,
            opacity: cookieInput.trim() ? 1 : 0.4,
            cursor: cookieInput.trim() ? 'pointer' : 'default',
          }}
        >
          Save pasted session
        </button>
      </Section>

      {/* ─── Network Transport ──────────────────────────── */}
      <Section
        title="Network Transport"
        description="Choose how requests reach Vinted. Proxy mode uses your configured ISP/residential proxies. Direct mode bypasses proxies and uses your local network interface (e.g. tethered iPhone)."
      >
        <div style={{ display: 'flex', gap: spacing.lg, alignItems: 'center', marginBottom: spacing.md }}>
          <span
            style={badge(
              transportMode === 'PROXY' ? colors.primaryMuted : colors.successBg,
              transportMode === 'PROXY' ? colors.primary : colors.success
            )}
          >
            {transportMode === 'PROXY' ? 'Static Proxies' : 'Direct Mobile'}
          </span>
          {checkoutLocked && (
            <span style={badge(colors.warningBg, colors.warning)}>
              Checkout in progress — locked
            </span>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: spacing.sm,
              cursor: checkoutLocked ? 'not-allowed' : 'pointer',
              fontSize: font.size.base,
              color: colors.textSecondary,
              opacity: checkoutLocked ? 0.5 : 1,
            }}
          >
            <input
              type="radio"
              name="transportMode"
              checked={transportMode === 'PROXY'}
              onChange={() => handleTransportModeChange('PROXY')}
              disabled={checkoutLocked}
            />
            Static Proxies (ISP/Resi)
          </label>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: spacing.sm,
              cursor: checkoutLocked ? 'not-allowed' : 'pointer',
              fontSize: font.size.base,
              color: colors.textSecondary,
              opacity: checkoutLocked ? 0.5 : 1,
            }}
          >
            <input
              type="radio"
              name="transportMode"
              checked={transportMode === 'DIRECT'}
              onChange={() => handleTransportModeChange('DIRECT')}
              disabled={checkoutLocked}
            />
            Direct Mobile (Tethered)
          </label>
        </div>
        {transportError && (
          <p style={{ color: colors.warning, fontSize: font.size.sm, marginTop: spacing.sm, marginBottom: 0 }}>
            {transportError}
          </p>
        )}
        {transportMode === 'DIRECT' && (
          <p style={{ fontSize: font.size.sm, color: colors.textMuted, marginTop: spacing.md, marginBottom: 0 }}>
            Direct mode uses Chrome 110 mobile fingerprint (Android/Pixel 7). Ensure your tethered device has a clean IP.
            Your configured proxies will be ignored while this mode is active.
          </p>
        )}

        <div style={{ marginTop: spacing.lg }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, fontSize: font.size.base, color: colors.textSecondary }}>
            <span>Browser ops proxy mode:</span>
            <select
              value={settings.browser_proxy_mode}
              onChange={(e) => {
                handleSettingsChange('browser_proxy_mode', e.target.value as AppSettings['browser_proxy_mode']);
                showSaved();
              }}
              style={{ ...glassSelect, minWidth: 220 }}
            >
              <option value="DIRECT">DIRECT (default)</option>
              <option value="ISP_DEDICATED">ISP Dedicated (sticky)</option>
            </select>
          </label>
          <p style={{ fontSize: font.size.sm, color: colors.textMuted, marginTop: spacing.sm, marginBottom: 0 }}>
            Controls Electron browser actions (edit save, relist, detail fetch). ISP Dedicated reserves ~25% (min 2) of your ISP proxies and keeps them sticky per browser partition.
          </p>
        </div>
      </Section>

      {/* ─── Search URLs ──────────────────────────────── */}
      <Section
        title="Search URLs"
        description="Vinted catalog URLs to poll. One proxy per URL (from Proxies section below). Active = included in feed."
      >
        <InputRow>
          <input
            type="url"
            placeholder="https://www.vinted.co.uk/catalog?search_text=...&order=newest_first"
            value={searchUrlInput}
            onChange={(e) => setSearchUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddSearchUrl()}
            style={{ ...recessedInput, flex: 1 }}
          />
          <button
            type="button"
            onClick={handleAddSearchUrl}
            style={{ ...btnPrimary, ...btnSmall }}
          >
            Add
          </button>
        </InputRow>
        {searchUrls.length > 0 && (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {searchUrls.map((u) => (
              <li key={u.id} style={listRow}>
                <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer', flex: 1, minWidth: 0 }}>
                  <input
                    type="checkbox"
                    checked={u.enabled}
                    onChange={(e) => handleToggleSearchUrl(u.id, e.target.checked)}
                  />
                  <span
                    style={{
                      fontFamily: font.mono,
                      fontSize: font.size.sm,
                      color: u.enabled ? colors.textPrimary : colors.textMuted,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={u.url}
                  >
                    {u.url}
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => handleDeleteSearchUrl(u.id)}
                  style={dangerText}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ─── ISP Proxies (Scraping) ───────────────────── */}
      <Section
        title="ISP Proxies (Scraping & Search)"
        description="Dedicated ISP proxies for high-speed feed polling and search operations. One proxy per search URL. Recommended: UK-based ISP proxies (BT, Virgin Media, Sky). Format: http://user:pass@host:port or socks5://user:pass@host:port"
      >
        <InputRow>
          <input
            type="text"
            placeholder="http://user:pass@host:port or socks5://..."
            value={scrapingProxyInput}
            onChange={(e) => setScrapingProxyInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddScrapingProxy()}
            style={{ ...glassInput, flex: 1 }}
          />
          <button
            type="button"
            onClick={handleAddScrapingProxy}
            style={{ ...btnPrimary, ...btnSmall }}
          >
            Add
          </button>
        </InputRow>
        {settings.scrapingProxies.length > 0 && (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {settings.scrapingProxies.map((url, i) => (
              <li key={i} style={listRow}>
                <span
                  style={{
                    fontFamily: font.mono,
                    fontSize: font.size.sm,
                    color: colors.textPrimary,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {url}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveScrapingProxy(i)}
                  style={dangerText}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ─── Residential Proxies (Checkout) ────────────── */}
      <Section
        title="Residential Proxies (Checkout & Payments)"
        description="High-quality residential proxies for checkout and payment operations. Used for entire purchase flow (sticky sessions). Recommended: UK residential static IPs. Format: http://user:pass@host:port or socks5://user:pass@host:port"
      >
        <InputRow>
          <input
            type="text"
            placeholder="http://user:pass@host:port or socks5://..."
            value={checkoutProxyInput}
            onChange={(e) => setCheckoutProxyInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddCheckoutProxy()}
            style={{ ...glassInput, flex: 1 }}
          />
          <button
            type="button"
            onClick={handleAddCheckoutProxy}
            style={{ ...btnPrimary, ...btnSmall }}
          >
            Add
          </button>
        </InputRow>
        {settings.checkoutProxies.length > 0 && (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {settings.checkoutProxies.map((url, i) => (
              <li key={i} style={listRow}>
                <span
                  style={{
                    fontFamily: font.mono,
                    fontSize: font.size.sm,
                    color: colors.textPrimary,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {url}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveCheckoutProxy(i)}
                  style={dangerText}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ─── Legacy Proxies (Deprecated) ───────────────── */}
      {settings.proxyUrls.length > 0 && (
        <Section
          title="Legacy Proxies (Deprecated)"
          description="These are legacy proxy URLs. Please migrate to ISP Proxies (for scraping) or Residential Proxies (for checkout) above."
        >
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {settings.proxyUrls.map((url, i) => (
              <li key={i} style={listRow}>
                <span
                  style={{
                    fontFamily: font.mono,
                    fontSize: font.size.sm,
                    color: colors.textMuted,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {url}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveProxy(i)}
                  style={dangerText}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* ─── Relist Timing ─────────────────────────────── */}
      <RelistTimingSection />

      {/* ─── Autobuy ──────────────────────────────────── */}
      <Section title="Autobuy (Sniper)">
        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer', marginBottom: spacing.md, fontSize: font.size.base, color: colors.textSecondary }}>
          <input
            type="checkbox"
            checked={settings.autobuyEnabled}
            onChange={(e) => handleSettingsChange('autobuyEnabled', e.target.checked)}
          />
          Enable autobuy (snipers will attempt to purchase matching items)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer', fontSize: font.size.base, color: colors.textSecondary }}>
          <input
            type="checkbox"
            checked={settings.simulationMode}
            onChange={(e) => handleSettingsChange('simulationMode', e.target.checked)}
          />
          Simulation mode — log "would have bought" only, no real purchases
        </label>
      </Section>

      {/* ─── Snipers ──────────────────────────────────── */}
      <Section
        title="Snipers"
        description="Rules that auto-purchase matching items. Enable Autobuy above. Each sniper: price max, keywords, budget limit."
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md }}>
          <input
            type="text"
            placeholder="Name"
            value={sniperName}
            onChange={(e) => setSniperName(e.target.value)}
            style={{ ...glassInput, width: 130 }}
          />
          <input
            type="number"
            placeholder="Max £"
            value={sniperPriceMax}
            onChange={(e) => setSniperPriceMax(e.target.value)}
            style={{ ...glassInput, width: 90 }}
          />
          <input
            type="text"
            placeholder="Keywords"
            value={sniperKeywords}
            onChange={(e) => setSniperKeywords(e.target.value)}
            style={{ ...glassInput, width: 130 }}
          />
          <input
            type="number"
            placeholder="Budget £"
            value={sniperBudget}
            onChange={(e) => setSniperBudget(e.target.value)}
            style={{ ...glassInput, width: 100 }}
          />
          <button
            type="button"
            onClick={handleAddSniper}
            style={{ ...btnPrimary, ...btnSmall }}
          >
            Add sniper
          </button>
        </div>
        {snipers.length > 0 && (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {snipers.map((s) => (
              <li key={s.id} style={listRow}>
                <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer', flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    onChange={(e) => handleToggleSniper(s.id, e.target.checked)}
                  />
                  <span style={{ fontWeight: font.weight.medium, color: colors.textPrimary }}>{s.name}</span>
                  {s.price_max != null && (
                    <span style={badge(colors.glassBg, colors.textSecondary)}>max £{s.price_max}</span>
                  )}
                  {s.keywords && (
                    <span style={badge(colors.glassBg, colors.textSecondary)}>"{s.keywords}"</span>
                  )}
                  {s.budget_limit > 0 && (
                    <SniperSpentDisplay sniperId={s.id} budgetLimit={s.budget_limit} />
                  )}
                </label>
                <button
                  type="button"
                  onClick={() => handleDeleteSniper(s.id)}
                  style={dangerText}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ─── Polling ──────────────────────────────────── */}
      <Section title="Polling">
        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.md, fontSize: font.size.base, color: colors.textSecondary }}>
          <span>Interval (seconds):</span>
          <input
            type="number"
            min={1}
            max={60}
            value={settings.pollingIntervalSeconds}
            onChange={(e) =>
              handleSettingsChange('pollingIntervalSeconds', Math.max(1, parseInt(e.target.value, 10) || 5))
            }
            style={{ ...glassInput, width: 90 }}
          />
        </label>
      </Section>

      {/* ─── Delivery ─────────────────────────────────── */}
      <Section title="Delivery">
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer', fontSize: font.size.base, color: colors.textSecondary }}>
            <input
              type="radio"
              name="deliveryType"
              checked={settings.deliveryType === 'home'}
              onChange={() => handleSettingsChange('deliveryType', 'home')}
            />
            Home delivery
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer', fontSize: font.size.base, color: colors.textSecondary }}>
            <input
              type="radio"
              name="deliveryType"
              checked={settings.deliveryType === 'dropoff'}
              onChange={() => handleSettingsChange('deliveryType', 'dropoff')}
            />
            Drop-off point
          </label>
          <div style={{ display: 'flex', gap: spacing.lg, flexWrap: 'wrap', marginTop: spacing.sm }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, fontSize: font.size.base, color: colors.textSecondary }}>
              <span>Latitude:</span>
              <input
                type="number"
                step="any"
                value={settings.latitude}
                onChange={(e) => handleSettingsChange('latitude', parseFloat(e.target.value) || 0)}
                style={{ ...glassInput, width: 130 }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, fontSize: font.size.base, color: colors.textSecondary }}>
              <span>Longitude:</span>
              <input
                type="number"
                step="any"
                value={settings.longitude}
                onChange={(e) => handleSettingsChange('longitude', parseFloat(e.target.value) || 0)}
                style={{ ...glassInput, width: 130 }}
              />
            </label>
          </div>
        </div>
      </Section>

      {/* ─── Verification ─────────────────────────────── */}
      <Section title="Item Verification (£10)">
        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer', marginBottom: spacing.md, fontSize: font.size.base, color: colors.textSecondary }}>
          <input
            type="checkbox"
            checked={settings.verificationEnabled}
            onChange={(e) => handleSettingsChange('verificationEnabled', e.target.checked)}
          />
          Auto-include verification on expensive items
        </label>
        {settings.verificationEnabled && (
          <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md, fontSize: font.size.base, color: colors.textSecondary }}>
            <span>Threshold (£):</span>
            <input
              type="number"
              min={0}
              step={10}
              value={settings.verificationThresholdPounds}
              onChange={(e) =>
                handleSettingsChange('verificationThresholdPounds', parseFloat(e.target.value) || 0)
              }
              style={{ ...glassInput, width: 100 }}
            />
          </label>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer', fontSize: font.size.base, color: colors.textSecondary }}>
          <input
            type="checkbox"
            checked={settings.authRequiredForPurchase}
            onChange={(e) => handleSettingsChange('authRequiredForPurchase', e.target.checked)}
          />
          Require Yodel/DPD auth for purchases (prompt if unavailable)
        </label>
      </Section>

      {/* ─── Courier ──────────────────────────────────── */}
      <Section title="Courier">
        <select
          value={settings.defaultCourier}
          onChange={(e) => handleSettingsChange('defaultCourier', e.target.value)}
          style={{ ...glassSelect, minWidth: 180 }}
        >
          <option value="yodel">Yodel (auth)</option>
          <option value="dpd">DPD (auth)</option>
          <option value="evri">Evri</option>
          <option value="inpost">InPost</option>
          <option value="royal_mail">Royal Mail</option>
          <option value="cheapest">Cheapest</option>
        </select>
      </Section>
    </div>
  );
}
===
/**
 * Settings page — session, polling, couriers, delivery, proxies, search URLs
 * Revolut-inspired glass section panels
 */

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  colors,
  font,
  glassPanel,
  recessedInput,
  glassInput,
  glassTextarea,
  glassSelect,
  btnPrimary,
  btnSecondary,
  btnSmall,
  dangerText,
  sectionTitle,
  sectionDesc,
  badge,
  radius,
  spacing,
  springResponsive,
} from '../theme';
import type { AppSettings, SearchUrl, Sniper } from '../types/global';

type RefreshStatus =
  | 'idle'
  | 'opening'
  | 'waiting'
  | 'captured'
  | 'refreshed'
  | 'timed_out'
  | 'window_closed'
  | 'failed';

/* ─── Sniper Budget Display ─────────────────────────────────── */

function SniperSpentDisplay({ sniperId, budgetLimit }: { sniperId: number; budgetLimit: number }) {
  const [spent, setSpent] = useState<number | null>(null);
  useEffect(() => {
    window.vinted.getSniperSpent(sniperId).then(setSpent);
  }, [sniperId]);
  return (
    <span style={badge(colors.primaryMuted, colors.primary)}>
      budget £{budgetLimit} (spent: £{spent ?? '…'})
    </span>
  );
}

/* ─── Section Wrapper ───────────────────────────────────────── */

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springResponsive}
      style={{
        ...glassPanel,
        padding: spacing['2xl'],
        marginBottom: spacing['3xl'],
      }}
    >
      <h3 style={sectionTitle}>{title}</h3>
      {description && <p style={{ ...sectionDesc, marginBottom: spacing.lg }}>{description}</p>}
      <div>{children}</div>
    </motion.section>
  );
}

/* ─── Input Row Helper ──────────────────────────────────────── */

function InputRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: spacing.sm, marginBottom: spacing.sm, alignItems: 'center' }}>
      {children}
    </div>
  );
}

/* ─── Default Settings ──────────────────────────────────────── */

const defaultSettings: AppSettings = {
  pollingIntervalSeconds: 5,
  defaultCourier: 'yodel',
  deliveryType: 'dropoff',
  latitude: 51.5074,
  longitude: -0.1278,
  verificationEnabled: false,
  verificationThresholdPounds: 100,
  authRequiredForPurchase: true,
  proxyUrls: [],
  scrapingProxies: [],
  checkoutProxies: [],
  simulationMode: true,
  autobuyEnabled: false,
  sessionAutofillEnabled: true,
  sessionAutoSubmitEnabled: false,
  transportMode: 'PROXY',
  browser_proxy_mode: 'DIRECT',
  crm_delay_min_minutes: 2,
  crm_delay_max_minutes: 5,
};

/* ─── Relist Timing Section ─────────────────────────────────── */

function RelistTimingSection() {
  const [minDelay, setMinDelay] = useState(30);
  const [maxDelay, setMaxDelay] = useState(90);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    window.vinted.getQueueSettings().then((s) => {
      setMinDelay(s.minDelay);
      setMaxDelay(s.maxDelay);
    });
  }, []);

  const handleSave = () => {
    const min = Math.max(5, minDelay);
    const max = Math.max(min + 5, maxDelay);
    setMinDelay(min);
    setMaxDelay(max);
    window.vinted.setQueueSettings(min, max);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <Section
      title="Relist Timing"
      description="Randomized delay between bulk relists to avoid pattern detection. Each relist waits a random duration between min and max before proceeding to the next item."
    >
      <div style={{ display: 'flex', gap: spacing.lg, alignItems: 'center', marginBottom: spacing.md }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, fontSize: font.size.base, color: colors.textSecondary }}>
          <span>Min delay (s):</span>
          <input
            type="number"
            min={5}
            max={300}
            value={minDelay}
            onChange={(e) => setMinDelay(Math.max(5, parseInt(e.target.value, 10) || 30))}
            style={{ ...recessedInput, width: 90 }}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, fontSize: font.size.base, color: colors.textSecondary }}>
          <span>Max delay (s):</span>
          <input
            type="number"
            min={10}
            max={600}
            value={maxDelay}
            onChange={(e) => setMaxDelay(Math.max(10, parseInt(e.target.value, 10) || 90))}
            style={{ ...recessedInput, width: 90 }}
          />
        </label>
        <button
          type="button"
          onClick={handleSave}
          style={{ ...btnPrimary, ...btnSmall }}
        >
          {saved ? '✓ Saved' : 'Save'}
        </button>
      </div>
      <p style={{ fontSize: font.size.sm, color: colors.textMuted, margin: 0 }}>
        Current range: {minDelay}–{maxDelay}s between relists. The 10-second delete-post safety gap is applied automatically.
      </p>
    </Section>
  );
}

/* ─── Main Component ────────────────────────────────────────── */

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [hasCookie, setHasCookie] = useState(false);
  const [cookieInput, setCookieInput] = useState('');
  const [proxyInput, setProxyInput] = useState('');
  const [scrapingProxyInput, setScrapingProxyInput] = useState('');
  const [checkoutProxyInput, setCheckoutProxyInput] = useState('');
  const [saved, setSaved] = useState(false);
  const [searchUrls, setSearchUrls] = useState<SearchUrl[]>([]);
  const [searchUrlInput, setSearchUrlInput] = useState('');
  const [snipers, setSnipers] = useState<Sniper[]>([]);
  const [sniperName, setSniperName] = useState('');
  const [sniperPriceMax, setSniperPriceMax] = useState('');
  const [sniperKeywords, setSniperKeywords] = useState('');
  const [sniperBudget, setSniperBudget] = useState('');
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [hasLoginCredentials, setHasLoginCredentials] = useState(false);
  const [isRefreshingSession, setIsRefreshingSession] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<RefreshStatus>('idle');
  const [transportMode, setTransportMode] = useState<'PROXY' | 'DIRECT'>('PROXY');
  const [checkoutLocked, setCheckoutLocked] = useState(false);
  const [transportError, setTransportError] = useState<string | null>(null);
  const [isSyncingExtension, setIsSyncingExtension] = useState(false);
  const [extensionSyncStatus, setExtensionSyncStatus] = useState<'idle' | 'checking' | 'synced' | 'polling' | 'failed'>('idle');

  useEffect(() => {
    window.vinted.getSettings().then(setSettings);
    window.vinted.hasCookie().then(setHasCookie);
    window.vinted.getSearchUrls().then(setSearchUrls);
    window.vinted.getSnipers().then(setSnipers);
    window.vinted.hasLoginCredentials().then(setHasLoginCredentials);
    window.vinted.getTransportMode().then(setTransportMode);
    window.vinted.isCheckoutActive().then(setCheckoutLocked);
  }, []);

  const showSaved = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSaveCookie = async () => {
    if (!cookieInput.trim()) return;
    await window.vinted.storeCookie(cookieInput.trim());
    setHasCookie(true);
    setCookieInput('');
    showSaved();
  };

  const handleClearCookie = async () => {
    await window.vinted.clearCookie();
    setHasCookie(false);
    setCookieInput('');
    showSaved();
  };

  const handleRefreshSession = async () => {
    if (isRefreshingSession) return;
    setIsRefreshingSession(true);
    setRefreshStatus('opening');
    // Keep "waiting" visible even while the window is active.
    const waitingTimer = setTimeout(() => setRefreshStatus('waiting'), 900);
    try {
      const result = await window.vinted.startCookieRefresh();
      if (result.ok) {
        setRefreshStatus('captured');
        setHasCookie(true);
        setTimeout(() => setRefreshStatus('refreshed'), 300);
        showSaved();
      } else if (result.reason === 'TIMED_OUT') {
        setRefreshStatus('timed_out');
      } else if (result.reason === 'WINDOW_CLOSED') {
        setRefreshStatus('window_closed');
      } else {
        setRefreshStatus('failed');
      }
    } finally {
      clearTimeout(waitingTimer);
      setIsRefreshingSession(false);
    }
  };

  const handleSaveLoginCredentials = async () => {
    if (!loginUsername.trim() || !loginPassword.trim()) return;
    await window.vinted.saveLoginCredentials(loginUsername.trim(), loginPassword);
    setHasLoginCredentials(true);
    setLoginPassword('');
    showSaved();
  };

  const handleClearLoginCredentials = async () => {
    await window.vinted.clearLoginCredentials();
    setHasLoginCredentials(false);
    setLoginUsername('');
    setLoginPassword('');
    showSaved();
  };

  const refreshLabel: Record<RefreshStatus, string> = {
    idle: '',
    opening: 'Opening login window...',
    waiting: 'Waiting for login and cookie capture...',
    captured: 'Cookies captured.',
    refreshed: 'Session refreshed.',
    timed_out: 'Timed out while waiting for login.',
    window_closed: 'Login window closed before capture.',
    failed: 'Unable to refresh session.',
  };

  const extensionSyncLabel: Record<string, string> = {
    idle: '',
    checking: '🔍 Checking for extension session data...',
    synced: '✅ Session synced from Chrome Extension!',
    polling: '🌐 Opened Vinted in Chrome — waiting for extension to harvest session...',
    failed: '⚠️ Extension sync failed. Make sure the Vinted HQ extension is installed and you are logged into Vinted in Chrome.',
  };

  const handleSyncFromExtension = async () => {
    if (isSyncingExtension) return;
    setIsSyncingExtension(true);
    setExtensionSyncStatus('checking');
    try {
      // Brief delay so user sees the checking state
      setTimeout(() => {
        if (isSyncingExtension) setExtensionSyncStatus('polling');
      }, 1200);
      const result = await window.vinted.syncFromExtension();
      if (result.ok) {
        setExtensionSyncStatus('synced');
        setHasCookie(true);
        showSaved();
        // Reset status after a moment
        setTimeout(() => setExtensionSyncStatus('idle'), 4000);
      } else {
        setExtensionSyncStatus('failed');
        setTimeout(() => setExtensionSyncStatus('idle'), 8000);
      }
    } catch {
      setExtensionSyncStatus('failed');
      setTimeout(() => setExtensionSyncStatus('idle'), 8000);
    } finally {
      setIsSyncingExtension(false);
    }
  };

  const handleSettingsChange = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    window.vinted.setSetting(key, value);
  };

  const handleTransportModeChange = async (mode: 'PROXY' | 'DIRECT') => {
    setTransportError(null);
    // Re-check checkout lock before attempting
    const active = await window.vinted.isCheckoutActive();
    setCheckoutLocked(active);
    if (active) {
      setTransportError('Cannot change transport mode while a checkout is in progress.');
      return;
    }
    const result = await window.vinted.setTransportMode(mode);
    if (result.ok) {
      setTransportMode(mode);
      showSaved();
    } else {
      setTransportError(result.error ?? 'Failed to change transport mode.');
    }
  };

  const handleAddProxy = () => {
    const url = proxyInput.trim();
    if (!url) return;
    const urls = [...settings.proxyUrls, url];
    setSettings((prev) => ({ ...prev, proxyUrls: urls }));
    window.vinted.setSetting('proxyUrls', urls);
    setProxyInput('');
  };

  const handleRemoveProxy = (index: number) => {
    const urls = settings.proxyUrls.filter((_, i) => i !== index);
    setSettings((prev) => ({ ...prev, proxyUrls: urls }));
    window.vinted.setSetting('proxyUrls', urls);
  };

  const handleAddScrapingProxy = () => {
    const url = scrapingProxyInput.trim();
    if (!url) return;
    const urls = [...settings.scrapingProxies, url];
    setSettings((prev) => ({ ...prev, scrapingProxies: urls }));
    window.vinted.setSetting('scrapingProxies', urls);
    setScrapingProxyInput('');
  };

  const handleRemoveScrapingProxy = (index: number) => {
    const urls = settings.scrapingProxies.filter((_, i) => i !== index);
    setSettings((prev) => ({ ...prev, scrapingProxies: urls }));
    window.vinted.setSetting('scrapingProxies', urls);
  };

  const handleAddCheckoutProxy = () => {
    const url = checkoutProxyInput.trim();
    if (!url) return;
    const urls = [...settings.checkoutProxies, url];
    setSettings((prev) => ({ ...prev, checkoutProxies: urls }));
    window.vinted.setSetting('checkoutProxies', urls);
    setCheckoutProxyInput('');
  };

  const handleRemoveCheckoutProxy = (index: number) => {
    const urls = settings.checkoutProxies.filter((_, i) => i !== index);
    setSettings((prev) => ({ ...prev, checkoutProxies: urls }));
    window.vinted.setSetting('checkoutProxies', urls);
  };

  const handleAddSearchUrl = async () => {
    const url = searchUrlInput.trim();
    if (!url) return;
    const added = await window.vinted.addSearchUrl(url);
    if (added) {
      setSearchUrls((prev) => [...prev, added]);
      setSearchUrlInput('');
      showSaved();
      window.vinted.startFeedPolling();
    }
  };

  const handleToggleSearchUrl = async (id: number, enabled: boolean) => {
    await window.vinted.updateSearchUrl(id, { enabled });
    setSearchUrls((prev) => prev.map((u) => (u.id === id ? { ...u, enabled } : u)));
    if (enabled) window.vinted.startFeedPolling();
  };

  const handleDeleteSearchUrl = async (id: number) => {
    await window.vinted.deleteSearchUrl(id);
    setSearchUrls((prev) => prev.filter((u) => u.id !== id));
  };

  const handleAddSniper = async () => {
    const name = sniperName.trim();
    if (!name) return;
    const added = await window.vinted.addSniper({
      name,
      price_max: sniperPriceMax ? parseFloat(sniperPriceMax) : undefined,
      keywords: sniperKeywords.trim() || undefined,
      budget_limit: sniperBudget ? parseFloat(sniperBudget) : 0,
    });
    if (added) {
      setSnipers((prev) => [...prev, added]);
      setSniperName('');
      setSniperPriceMax('');
      setSniperKeywords('');
      setSniperBudget('');
      showSaved();
    }
  };

  const handleToggleSniper = async (id: number, enabled: boolean) => {
    await window.vinted.updateSniper(id, { enabled });
    setSnipers((prev) => prev.map((s) => (s.id === id ? { ...s, enabled } : s)));
  };

  const handleDeleteSniper = async (id: number) => {
    await window.vinted.deleteSniper(id);
    setSnipers((prev) => prev.filter((s) => s.id !== id));
  };

  /* ─── List item row style ─────────────────────────── */
  const listRow: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
    padding: `${spacing.md}px 0`,
    borderBottom: `1px solid ${colors.separator}`,
  };

  return (
    <div style={{ padding: spacing['2xl'], maxWidth: 620 }}>
      {/* Page header */}
      <h2
        style={{
          fontSize: font.size['2xl'],
          fontWeight: font.weight.bold,
          color: colors.textPrimary,
          margin: `0 0 ${spacing.xl}px`,
          letterSpacing: '-0.02em',
        }}
      >
        Settings
      </h2>

      {/* Saved toast */}
      {saved && (
        <div
          style={{
            position: 'fixed',
            top: 20,
            right: 20,
            zIndex: 1100,
            ...badge(colors.successBg, colors.success),
            padding: '8px 16px',
            fontSize: font.size.base,
            borderRadius: radius.md,
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          }}
        >
          ✓ Saved
        </div>
      )}

      {/* ─── Session ──────────────────────────────────── */}
      <Section
        title="Vinted Session"
        description="One-click refresh opens a short-lived login window, captures cookies, then closes automatically. Manual paste remains available as fallback."
      >
        <div style={{ display: 'flex', gap: spacing.md, alignItems: 'center', marginBottom: spacing.md }}>
          <span style={badge(hasCookie ? colors.successBg : colors.warningBg, hasCookie ? colors.success : colors.warning)}>
            {hasCookie ? '✓ Connected' : 'No active session'}
          </span>
          <button
            type="button"
            onClick={handleRefreshSession}
            disabled={isRefreshingSession}
            style={{
              ...btnPrimary,
              ...btnSmall,
              opacity: isRefreshingSession ? 0.6 : 1,
              cursor: isRefreshingSession ? 'default' : 'pointer',
            }}
          >
            Refresh session (open login)
          </button>
          <button
            type="button"
            onClick={handleClearCookie}
            style={{
              ...btnSecondary,
              ...btnSmall,
            }}
          >
            Clear session
          </button>
        </div>
        {refreshStatus !== 'idle' && (
          <p style={{ ...sectionDesc, marginBottom: spacing.md }}>{refreshLabel[refreshStatus]}</p>
        )}

        {/* ── 1-Click Extension Sync ── */}
        <div
          style={{
            padding: spacing.lg,
            marginBottom: spacing.lg,
            borderRadius: radius.md,
            border: `1px solid ${colors.primaryMuted}`,
            background: 'rgba(99, 102, 241, 0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm }}>
            <span style={{ fontSize: font.size.lg }}>🧩</span>
            <div>
              <strong style={{ color: colors.textPrimary, fontSize: font.size.base }}>Sync from Chrome Extension</strong>
              <p style={{ margin: 0, color: colors.textMuted, fontSize: font.size.sm }}>
                Instantly import your active Vinted session from Chrome. The extension harvests cookies automatically.
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center' }}>
            <button
              type="button"
              onClick={handleSyncFromExtension}
              disabled={isSyncingExtension}
              style={{
                ...btnPrimary,
                ...btnSmall,
                background: isSyncingExtension
                  ? colors.textMuted
                  : 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                border: 'none',
                opacity: isSyncingExtension ? 0.7 : 1,
                cursor: isSyncingExtension ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {isSyncingExtension ? '⏳ Syncing...' : '⚡ 1-Click Sync'}
            </button>
            {extensionSyncStatus !== 'idle' && (
              <span style={{
                fontSize: font.size.sm,
                color: extensionSyncStatus === 'synced' ? colors.success
                     : extensionSyncStatus === 'failed' ? colors.warning
                     : colors.textSecondary,
              }}>
                {extensionSyncLabel[extensionSyncStatus]}
              </span>
            )}
          </div>
        </div>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: spacing.sm,
            cursor: 'pointer',
            marginBottom: spacing.sm,
            fontSize: font.size.base,
            color: colors.textSecondary,
          }}
        >
          <input
            type="checkbox"
            checked={settings.sessionAutofillEnabled}
            onChange={(e) => handleSettingsChange('sessionAutofillEnabled', e.target.checked)}
          />
          Use saved login credentials to autofill Vinted login form
        </label>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: spacing.sm,
            cursor: 'pointer',
            marginBottom: spacing.md,
            fontSize: font.size.base,
            color: colors.textSecondary,
          }}
        >
          <input
            type="checkbox"
            checked={settings.sessionAutoSubmitEnabled}
            onChange={(e) => handleSettingsChange('sessionAutoSubmitEnabled', e.target.checked)}
          />
          Auto-submit login form after autofill
        </label>
        <InputRow>
          <input
            type="text"
            placeholder="Vinted email/username"
            value={loginUsername}
            onChange={(e) => setLoginUsername(e.target.value)}
            style={{ ...recessedInput, flex: 1 }}
          />
          <input
            type="password"
            placeholder="Vinted password"
            value={loginPassword}
            onChange={(e) => setLoginPassword(e.target.value)}
            style={{ ...recessedInput, flex: 1 }}
          />
        </InputRow>
        <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center', marginBottom: spacing.lg }}>
          <button
            type="button"
            onClick={handleSaveLoginCredentials}
            disabled={!loginUsername.trim() || !loginPassword.trim()}
            style={{
              ...btnSecondary,
              ...btnSmall,
              opacity: loginUsername.trim() && loginPassword.trim() ? 1 : 0.4,
              cursor: loginUsername.trim() && loginPassword.trim() ? 'pointer' : 'default',
            }}
          >
            Save login credentials
          </button>
          <button
            type="button"
            onClick={handleClearLoginCredentials}
            style={{ ...btnSecondary, ...btnSmall }}
          >
            Clear saved credentials
          </button>
          {hasLoginCredentials && (
            <span style={badge(colors.successBg, colors.success)}>Credentials saved in Keychain</span>
          )}
        </div>

        <textarea
          placeholder="Fallback: paste cookie string manually..."
          value={cookieInput}
          onChange={(e) => setCookieInput(e.target.value)}
          rows={4}
          style={{
            ...glassTextarea,
            width: '100%',
          }}
        />
        <button
          type="button"
          onClick={handleSaveCookie}
          disabled={!cookieInput.trim()}
          style={{
            ...btnPrimary,
            ...btnSmall,
            marginTop: spacing.sm,
            opacity: cookieInput.trim() ? 1 : 0.4,
            cursor: cookieInput.trim() ? 'pointer' : 'default',
          }}
        >
          Save pasted session
        </button>
      </Section>

      {/* ─── Network Transport ──────────────────────────── */}
      <Section
        title="Network Transport"
        description="Choose how requests reach Vinted. Proxy mode uses your configured ISP/residential proxies. Direct mode bypasses proxies and uses your local network interface (e.g. tethered iPhone)."
      >
        <div style={{ display: 'flex', gap: spacing.lg, alignItems: 'center', marginBottom: spacing.md }}>
          <span
            style={badge(
              transportMode === 'PROXY' ? colors.primaryMuted : colors.successBg,
              transportMode === 'PROXY' ? colors.primary : colors.success
            )}
          >
            {transportMode === 'PROXY' ? 'Static Proxies' : 'Direct Mobile'}
          </span>
          {checkoutLocked && (
            <span style={badge(colors.warningBg, colors.warning)}>
              Checkout in progress — locked
            </span>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: spacing.sm,
              cursor: checkoutLocked ? 'not-allowed' : 'pointer',
              fontSize: font.size.base,
              color: colors.textSecondary,
              opacity: checkoutLocked ? 0.5 : 1,
            }}
          >
            <input
              type="radio"
              name="transportMode"
              checked={transportMode === 'PROXY'}
              onChange={() => handleTransportModeChange('PROXY')}
              disabled={checkoutLocked}
            />
            Static Proxies (ISP/Resi)
          </label>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: spacing.sm,
              cursor: checkoutLocked ? 'not-allowed' : 'pointer',
              fontSize: font.size.base,
              color: colors.textSecondary,
              opacity: checkoutLocked ? 0.5 : 1,
            }}
          >
            <input
              type="radio"
              name="transportMode"
              checked={transportMode === 'DIRECT'}
              onChange={() => handleTransportModeChange('DIRECT')}
              disabled={checkoutLocked}
            />
            Direct Mobile (Tethered)
          </label>
        </div>
        {transportError && (
          <p style={{ color: colors.warning, fontSize: font.size.sm, marginTop: spacing.sm, marginBottom: 0 }}>
            {transportError}
          </p>
        )}
        {transportMode === 'DIRECT' && (
          <p style={{ fontSize: font.size.sm, color: colors.textMuted, marginTop: spacing.md, marginBottom: 0 }}>
            Direct mode uses Chrome 110 mobile fingerprint (Android/Pixel 7). Ensure your tethered device has a clean IP.
            Your configured proxies will be ignored while this mode is active.
          </p>
        )}

        <div style={{ marginTop: spacing.lg }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, fontSize: font.size.base, color: colors.textSecondary }}>
            <span>Browser ops proxy mode:</span>
            <select
              value={settings.browser_proxy_mode}
              onChange={(e) => {
                handleSettingsChange('browser_proxy_mode', e.target.value as AppSettings['browser_proxy_mode']);
                showSaved();
              }}
              style={{ ...glassSelect, minWidth: 220 }}
            >
              <option value="DIRECT">DIRECT (default)</option>
              <option value="ISP_DEDICATED">ISP Dedicated (sticky)</option>
            </select>
          </label>
          <p style={{ fontSize: font.size.sm, color: colors.textMuted, marginTop: spacing.sm, marginBottom: 0 }}>
            Controls Electron browser actions (edit save, relist, detail fetch). ISP Dedicated reserves ~25% (min 2) of your ISP proxies and keeps them sticky per browser partition.
          </p>
        </div>
      </Section>

      {/* ─── Search URLs ──────────────────────────────── */}
      <Section
        title="Search URLs"
        description="Vinted catalog URLs to poll. One proxy per URL (from Proxies section below). Active = included in feed."
      >
        <InputRow>
          <input
            type="url"
            placeholder="https://www.vinted.co.uk/catalog?search_text=...&order=newest_first"
            value={searchUrlInput}
            onChange={(e) => setSearchUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddSearchUrl()}
            style={{ ...recessedInput, flex: 1 }}
          />
          <button
            type="button"
            onClick={handleAddSearchUrl}
            style={{ ...btnPrimary, ...btnSmall }}
          >
            Add
          </button>
        </InputRow>
        {searchUrls.length > 0 && (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {searchUrls.map((u) => (
              <li key={u.id} style={listRow}>
                <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer', flex: 1, minWidth: 0 }}>
                  <input
                    type="checkbox"
                    checked={u.enabled}
                    onChange={(e) => handleToggleSearchUrl(u.id, e.target.checked)}
                  />
                  <span
                    style={{
                      fontFamily: font.mono,
                      fontSize: font.size.sm,
                      color: u.enabled ? colors.textPrimary : colors.textMuted,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={u.url}
                  >
                    {u.url}
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => handleDeleteSearchUrl(u.id)}
                  style={dangerText}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ─── ISP Proxies (Scraping) ───────────────────── */}
      <Section
        title="ISP Proxies (Scraping & Search)"
        description="Dedicated ISP proxies for high-speed feed polling and search operations. One proxy per search URL. Recommended: UK-based ISP proxies (BT, Virgin Media, Sky). Format: http://user:pass@host:port or socks5://user:pass@host:port"
      >
        <InputRow>
          <input
            type="text"
            placeholder="http://user:pass@host:port or socks5://..."
            value={scrapingProxyInput}
            onChange={(e) => setScrapingProxyInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddScrapingProxy()}
            style={{ ...glassInput, flex: 1 }}
          />
          <button
            type="button"
            onClick={handleAddScrapingProxy}
            style={{ ...btnPrimary, ...btnSmall }}
          >
            Add
          </button>
        </InputRow>
        {settings.scrapingProxies.length > 0 && (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {settings.scrapingProxies.map((url, i) => (
              <li key={i} style={listRow}>
                <span
                  style={{
                    fontFamily: font.mono,
                    fontSize: font.size.sm,
                    color: colors.textPrimary,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {url}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveScrapingProxy(i)}
                  style={dangerText}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ─── Residential Proxies (Checkout) ────────────── */}
      <Section
        title="Residential Proxies (Checkout & Payments)"
        description="High-quality residential proxies for checkout and payment operations. Used for entire purchase flow (sticky sessions). Recommended: UK residential static IPs. Format: http://user:pass@host:port or socks5://user:pass@host:port"
      >
        <InputRow>
          <input
            type="text"
            placeholder="http://user:pass@host:port or socks5://..."
            value={checkoutProxyInput}
            onChange={(e) => setCheckoutProxyInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddCheckoutProxy()}
            style={{ ...glassInput, flex: 1 }}
          />
          <button
            type="button"
            onClick={handleAddCheckoutProxy}
            style={{ ...btnPrimary, ...btnSmall }}
          >
            Add
          </button>
        </InputRow>
        {settings.checkoutProxies.length > 0 && (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {settings.checkoutProxies.map((url, i) => (
              <li key={i} style={listRow}>
                <span
                  style={{
                    fontFamily: font.mono,
                    fontSize: font.size.sm,
                    color: colors.textPrimary,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {url}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveCheckoutProxy(i)}
                  style={dangerText}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ─── Legacy Proxies (Deprecated) ───────────────── */}
      {settings.proxyUrls.length > 0 && (
        <Section
          title="Legacy Proxies (Deprecated)"
          description="These are legacy proxy URLs. Please migrate to ISP Proxies (for scraping) or Residential Proxies (for checkout) above."
        >
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {settings.proxyUrls.map((url, i) => (
              <li key={i} style={listRow}>
                <span
                  style={{
                    fontFamily: font.mono,
                    fontSize: font.size.sm,
                    color: colors.textMuted,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {url}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveProxy(i)}
                  style={dangerText}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* ─── Relist Timing ─────────────────────────────── */}
      <RelistTimingSection />

      {/* ─── Autobuy ──────────────────────────────────── */}
      <Section title="Autobuy (Sniper)">
        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer', marginBottom: spacing.md, fontSize: font.size.base, color: colors.textSecondary }}>
          <input
            type="checkbox"
            checked={settings.autobuyEnabled}
            onChange={(e) => handleSettingsChange('autobuyEnabled', e.target.checked)}
          />
          Enable autobuy (snipers will attempt to purchase matching items)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer', fontSize: font.size.base, color: colors.textSecondary }}>
          <input
            type="checkbox"
            checked={settings.simulationMode}
            onChange={(e) => handleSettingsChange('simulationMode', e.target.checked)}
          />
          Simulation mode — log "would have bought" only, no real purchases
        </label>
      </Section>

      {/* ─── Snipers ──────────────────────────────────── */}
      <Section
        title="Snipers"
        description="Rules that auto-purchase matching items. Enable Autobuy above. Each sniper: price max, keywords, budget limit."
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md }}>
          <input
            type="text"
            placeholder="Name"
            value={sniperName}
            onChange={(e) => setSniperName(e.target.value)}
            style={{ ...glassInput, width: 130 }}
          />
          <input
            type="number"
            placeholder="Max £"
            value={sniperPriceMax}
            onChange={(e) => setSniperPriceMax(e.target.value)}
            style={{ ...glassInput, width: 90 }}
          />
          <input
            type="text"
            placeholder="Keywords"
            value={sniperKeywords}
            onChange={(e) => setSniperKeywords(e.target.value)}
            style={{ ...glassInput, width: 130 }}
          />
          <input
            type="number"
            placeholder="Budget £"
            value={sniperBudget}
            onChange={(e) => setSniperBudget(e.target.value)}
            style={{ ...glassInput, width: 100 }}
          />
          <button
            type="button"
            onClick={handleAddSniper}
            style={{ ...btnPrimary, ...btnSmall }}
          >
            Add sniper
          </button>
        </div>
        {snipers.length > 0 && (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {snipers.map((s) => (
              <li key={s.id} style={listRow}>
                <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer', flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    onChange={(e) => handleToggleSniper(s.id, e.target.checked)}
                  />
                  <span style={{ fontWeight: font.weight.medium, color: colors.textPrimary }}>{s.name}</span>
                  {s.price_max != null && (
                    <span style={badge(colors.glassBg, colors.textSecondary)}>max £{s.price_max}</span>
                  )}
                  {s.keywords && (
                    <span style={badge(colors.glassBg, colors.textSecondary)}>"{s.keywords}"</span>
                  )}
                  {s.budget_limit > 0 && (
                    <SniperSpentDisplay sniperId={s.id} budgetLimit={s.budget_limit} />
                  )}
                </label>
                <button
                  type="button"
                  onClick={() => handleDeleteSniper(s.id)}
                  style={dangerText}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ─── Polling ──────────────────────────────────── */}
      <Section title="Polling">
        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.md, fontSize: font.size.base, color: colors.textSecondary }}>
          <span>Interval (seconds):</span>
          <input
            type="number"
            min={1}
            max={60}
            value={settings.pollingIntervalSeconds}
            onChange={(e) =>
              handleSettingsChange('pollingIntervalSeconds', Math.max(1, parseInt(e.target.value, 10) || 5))
            }
            style={{ ...glassInput, width: 90 }}
          />
        </label>
      </Section>

      {/* ─── Delivery ─────────────────────────────────── */}
      <Section title="Delivery">
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer', fontSize: font.size.base, color: colors.textSecondary }}>
            <input
              type="radio"
              name="deliveryType"
              checked={settings.deliveryType === 'home'}
              onChange={() => handleSettingsChange('deliveryType', 'home')}
            />
            Home delivery
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer', fontSize: font.size.base, color: colors.textSecondary }}>
            <input
              type="radio"
              name="deliveryType"
              checked={settings.deliveryType === 'dropoff'}
              onChange={() => handleSettingsChange('deliveryType', 'dropoff')}
            />
            Drop-off point
          </label>
          <div style={{ display: 'flex', gap: spacing.lg, flexWrap: 'wrap', marginTop: spacing.sm }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, fontSize: font.size.base, color: colors.textSecondary }}>
              <span>Latitude:</span>
              <input
                type="number"
                step="any"
                value={settings.latitude}
                onChange={(e) => handleSettingsChange('latitude', parseFloat(e.target.value) || 0)}
                style={{ ...glassInput, width: 130 }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, fontSize: font.size.base, color: colors.textSecondary }}>
              <span>Longitude:</span>
              <input
                type="number"
                step="any"
                value={settings.longitude}
                onChange={(e) => handleSettingsChange('longitude', parseFloat(e.target.value) || 0)}
                style={{ ...glassInput, width: 130 }}
              />
            </label>
          </div>
        </div>
      </Section>

      {/* ─── Verification ─────────────────────────────── */}
      <Section title="Item Verification (£10)">
        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer', marginBottom: spacing.md, fontSize: font.size.base, color: colors.textSecondary }}>
          <input
            type="checkbox"
            checked={settings.verificationEnabled}
            onChange={(e) => handleSettingsChange('verificationEnabled', e.target.checked)}
          />
          Auto-include verification on expensive items
        </label>
        {settings.verificationEnabled && (
          <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md, fontSize: font.size.base, color: colors.textSecondary }}>
            <span>Threshold (£):</span>
            <input
              type="number"
              min={0}
              step={10}
              value={settings.verificationThresholdPounds}
              onChange={(e) =>
                handleSettingsChange('verificationThresholdPounds', parseFloat(e.target.value) || 0)
              }
              style={{ ...glassInput, width: 100 }}
            />
          </label>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer', fontSize: font.size.base, color: colors.textSecondary }}>
          <input
            type="checkbox"
            checked={settings.authRequiredForPurchase}
            onChange={(e) => handleSettingsChange('authRequiredForPurchase', e.target.checked)}
          />
          Require Yodel/DPD auth for purchases (prompt if unavailable)
        </label>
      </Section>

      {/* ─── Courier ──────────────────────────────────── */}
      <Section title="Courier">
        <select
          value={settings.defaultCourier}
          onChange={(e) => handleSettingsChange('defaultCourier', e.target.value)}
          style={{ ...glassSelect, minWidth: 180 }}
        >
          <option value="yodel">Yodel (auth)</option>
          <option value="dpd">DPD (auth)</option>
          <option value="evri">Evri</option>
          <option value="inpost">InPost</option>
          <option value="royal_mail">Royal Mail</option>
          <option value="cheapest">Cheapest</option>
        </select>
      </Section>
    </div>
  );
}
```
```diff:Logs.tsx
/**
 * Log viewer — browse logs with filters, export
 * Dark glass table with colored level badges
 */

import React, { useEffect, useState } from 'react';
import {
  colors,
  font,
  glassPanel,
  recessedInput,
  glassSelect,
  btnSecondary,
  btnSmall,
  glassTable,
  tableHeader,
  tableHeaderCell,
  tableCell,
  tableRowHoverBg,
  badge,
  radius,
  spacing,
  transition,
} from '../theme';
import type { LogEntry } from '../types/global';

/* ─── Level badge config ────────────────────────────────────── */

const levelColors: Record<string, { bg: string; fg: string }> = {
  ERROR: { bg: colors.errorBg, fg: colors.error },
  WARN: { bg: colors.warningBg, fg: colors.warning },
  INFO: { bg: colors.infoBg, fg: colors.info },
  DEBUG: { bg: '#F5F5F5', fg: colors.textSecondary },
};

export default function Logs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [level, setLevel] = useState('');
  const [eventFilter, setEventFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const loadLogs = async () => {
    setLoading(true);
    const opts: Parameters<typeof window.vinted.getLogs>[0] = { limit: 200 };
    if (level) opts.level = level;
    if (eventFilter) opts.event = eventFilter;
    const data = await window.vinted.getLogs(opts);
    setLogs(data);
    setLoading(false);
  };

  useEffect(() => {
    loadLogs();
    const interval = setInterval(loadLogs, 5000);
    return () => clearInterval(interval);
  }, [level, eventFilter]);

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vinted-logs-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts * 1000);
    return d.toLocaleString();
  };

  return (
    <div style={{ padding: spacing['2xl'], display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      {/* Filter bar */}
      <div
        style={{
          ...glassPanel,
          padding: `${spacing.md}px ${spacing.xl}px`,
          display: 'flex',
          gap: spacing.md,
          flexWrap: 'wrap',
          alignItems: 'center',
          borderRadius: radius.lg,
        }}
      >
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          style={{ ...glassSelect, minWidth: 130 }}
        >
          <option value="">All levels</option>
          <option value="DEBUG">DEBUG</option>
          <option value="INFO">INFO</option>
          <option value="WARN">WARN</option>
          <option value="ERROR">ERROR</option>
        </select>
        <input
          type="text"
          placeholder="Filter by event"
          value={eventFilter}
          onChange={(e) => setEventFilter(e.target.value)}
          style={{ ...recessedInput, width: 200 }}
        />
        <button
          type="button"
          onClick={loadLogs}
          style={{ ...btnSecondary, ...btnSmall }}
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={handleExport}
          style={{ ...btnSecondary, ...btnSmall }}
        >
          Export JSON
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <p style={{ color: colors.textMuted, padding: spacing.xl }} className="animate-pulse">
          Loading...
        </p>
      ) : (
        <div style={{ ...glassTable, overflow: 'auto', maxHeight: 'calc(100vh - 180px)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: font.size.md }}>
            <thead>
              <tr style={tableHeader}>
                <th style={tableHeaderCell}>Time</th>
                <th style={tableHeaderCell}>Level</th>
                <th style={tableHeaderCell}>Event</th>
                <th style={tableHeaderCell}>Payload</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const lc = levelColors[log.level] || levelColors.DEBUG;
                return (
                  <tr
                    key={log.id}
                    style={{ transition: transition.fast }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = tableRowHoverBg;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <td style={{ ...tableCell, whiteSpace: 'nowrap', color: colors.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
                      {formatTime(log.created_at)}
                    </td>
                    <td style={tableCell}>
                      <span style={badge(lc.bg, lc.fg)}>
                        {log.level}
                      </span>
                    </td>
                    <td style={{ ...tableCell, color: colors.textPrimary }}>{log.event}</td>
                    <td
                      style={{
                        ...tableCell,
                        fontFamily: font.mono,
                        fontSize: font.size.sm,
                        color: colors.textMuted,
                        maxWidth: 400,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {log.payload ? (
                        <span title={log.payload}>
                          {log.payload.length > 80 ? log.payload.slice(0, 80) + '…' : log.payload}
                        </span>
                      ) : (
                        <span style={{ color: colors.textMuted }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {logs.length === 0 && !loading && (
        <p style={{ color: colors.textMuted, textAlign: 'center', padding: spacing['3xl'] }}>
          No logs yet.
        </p>
      )}
    </div>
  );
}
===
/**
 * Log viewer — browse logs with filters, export
 * Dark glass table with colored level badges
 */

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  colors,
  font,
  glassPanel,
  recessedInput,
  glassSelect,
  btnSecondary,
  btnSmall,
  glassTable,
  tableHeader,
  tableHeaderCell,
  tableCell,
  tableRowHoverBg,
  badge,
  radius,
  spacing,
  transition,
  springResponsive,
  staggerFast,
} from '../theme';
import GlassSkeleton from './GlassSkeleton';
import type { LogEntry } from '../types/global';

/* ─── Level badge config ────────────────────────────────────── */

const levelColors: Record<string, { bg: string; fg: string }> = {
  ERROR: { bg: colors.errorBg, fg: colors.error },
  WARN: { bg: colors.warningBg, fg: colors.warning },
  INFO: { bg: colors.infoBg, fg: colors.info },
  DEBUG: { bg: '#F5F5F5', fg: colors.textSecondary },
};

export default function Logs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [level, setLevel] = useState('');
  const [eventFilter, setEventFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const loadLogs = async () => {
    setLoading(true);
    const opts: Parameters<typeof window.vinted.getLogs>[0] = { limit: 200 };
    if (level) opts.level = level;
    if (eventFilter) opts.event = eventFilter;
    const data = await window.vinted.getLogs(opts);
    setLogs(data);
    setLoading(false);
  };

  useEffect(() => {
    loadLogs();
    const interval = setInterval(loadLogs, 5000);
    return () => clearInterval(interval);
  }, [level, eventFilter]);

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vinted-logs-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts * 1000);
    return d.toLocaleString();
  };

  return (
    <div style={{ padding: spacing['2xl'], display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      {/* Filter bar */}
      <div
        style={{
          ...glassPanel,
          padding: `${spacing.md}px ${spacing.xl}px`,
          display: 'flex',
          gap: spacing.md,
          flexWrap: 'wrap',
          alignItems: 'center',
          borderRadius: radius.lg,
        }}
      >
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          style={{ ...glassSelect, minWidth: 130 }}
        >
          <option value="">All levels</option>
          <option value="DEBUG">DEBUG</option>
          <option value="INFO">INFO</option>
          <option value="WARN">WARN</option>
          <option value="ERROR">ERROR</option>
        </select>
        <input
          type="text"
          placeholder="Filter by event"
          value={eventFilter}
          onChange={(e) => setEventFilter(e.target.value)}
          style={{ ...recessedInput, width: 200 }}
        />
        <button
          type="button"
          onClick={loadLogs}
          style={{ ...btnSecondary, ...btnSmall }}
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={handleExport}
          style={{ ...btnSecondary, ...btnSmall }}
        >
          Export JSON
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ padding: spacing.xl }}>
          <GlassSkeleton height={40} count={8} borderRadius={radius.md} />
        </div>
      ) : (
        <div style={{ ...glassTable, overflow: 'auto', maxHeight: 'calc(100vh - 180px)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: font.size.md }}>
            <thead>
              <tr style={tableHeader}>
                <th style={tableHeaderCell}>Time</th>
                <th style={tableHeaderCell}>Level</th>
                <th style={tableHeaderCell}>Event</th>
                <th style={tableHeaderCell}>Payload</th>
              </tr>
            </thead>
            <motion.tbody
              initial="hidden"
              animate="visible"
              variants={{
                hidden: {},
                visible: { transition: staggerFast },
              }}
            >
              {logs.map((log) => {
                const lc = levelColors[log.level] || levelColors.DEBUG;
                return (
                  <motion.tr
                    key={log.id}
                    variants={{
                      hidden: { opacity: 0, y: 10 },
                      visible: { opacity: 1, y: 0 },
                    }}
                    transition={springResponsive}
                    style={{ transition: transition.fast }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = tableRowHoverBg;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <td style={{ ...tableCell, whiteSpace: 'nowrap', color: colors.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
                      {formatTime(log.created_at)}
                    </td>
                    <td style={tableCell}>
                      <span style={badge(lc.bg, lc.fg)}>
                        {log.level}
                      </span>
                    </td>
                    <td style={{ ...tableCell, color: colors.textPrimary }}>{log.event}</td>
                    <td
                      style={{
                        ...tableCell,
                        fontFamily: font.mono,
                        fontSize: font.size.sm,
                        color: colors.textMuted,
                        maxWidth: 400,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {log.payload ? (
                        <span title={log.payload}>
                          {log.payload.length > 80 ? log.payload.slice(0, 80) + '…' : log.payload}
                        </span>
                      ) : (
                        <span style={{ color: colors.textMuted }}>—</span>
                      )}
                    </td>
                  </motion.tr>
                );
              })}
            </motion.tbody>
          </table>
        </div>
      )}
      {logs.length === 0 && !loading && (
        <p style={{ color: colors.textMuted, textAlign: 'center', padding: spacing['3xl'] }}>
          No logs yet.
        </p>
      )}
    </div>
  );
}
```

## Motion Architecture Summary

```mermaid
graph TD
    A["theme.ts"] -->|exports| B["springResponsive"]
    A -->|exports| C["springSmooth"]
    A -->|exports| D["springGentle"]
    A -->|exports| E["staggerFast"]
    C --> F["App.tsx: AnimatePresence<br/>Tab routing exit/enter"]
    D --> G["App.tsx: Sniper Modal<br/>Z-axis elevation"]
    B --> H["App.tsx: Countdown digits<br/>Mechanical tick"]
    E --> I["Feed.tsx: Grid stagger<br/>Card cascade"]
    B --> J["Feed.tsx: FeedItemCard<br/>Card entrance"]
    B --> K["Settings.tsx: Section<br/>Entrance animation"]
    E --> L["Logs.tsx: Table rows<br/>Stagger entrance"]
```

## Verification

- **TypeScript `tsc --noEmit`**: All errors are pre-existing in untouched files ([Wardrobe.tsx](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Vinted-HQ/electron-app/src/components/Wardrobe.tsx), `checkoutService.ts`, `bridge.ts`, `searchUrls.ts`). Zero new errors introduced by motion changes.
- **Legacy CSS**: `@keyframes` and `.animate-*` classes retained in [index.css](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Vinted-HQ/electron-app/src/index.css) since out-of-scope components ([Wardrobe.tsx](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Vinted-HQ/electron-app/src/components/Wardrobe.tsx), [Purchases.tsx](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Vinted-HQ/electron-app/src/components/Purchases.tsx), [ProxyStatus.tsx](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Vinted-HQ/electron-app/src/components/ProxyStatus.tsx)) still reference them.

> [!NOTE]
> Feed virtualization (`react-window`) and scroll degradation integration are structurally ready via the installed deps and hooks but require layout restructuring to wire into the CSS Grid. These are documented in the implementation plan as T4.4–T4.5.
