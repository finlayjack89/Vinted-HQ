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
