/**
 * Centralized design tokens — Revolut-inspired dark fintech theme
 * with liquid glass aesthetic.
 */

import type { CSSProperties } from 'react';

/* ─── Color Palette ─────────────────────────────────────────── */

export const colors = {
  // Backgrounds
  bgBase: '#080b12',
  bgElevated: '#0f1420',
  surface: '#161b2e',

  // Glass
  glassBg: 'rgba(255, 255, 255, 0.03)',
  glassBgHover: 'rgba(255, 255, 255, 0.06)',
  glassBorder: 'rgba(255, 255, 255, 0.07)',
  glassBorderHover: 'rgba(255, 255, 255, 0.12)',
  glassHighlight: 'rgba(255, 255, 255, 0.05)',
  glassInset: 'rgba(255, 255, 255, 0.04)',

  // Primary accent (indigo)
  primary: '#818cf8',
  primaryHover: '#6366f1',
  primaryMuted: 'rgba(129, 140, 248, 0.15)',
  primaryGlow: 'rgba(129, 140, 248, 0.25)',

  // Text
  textPrimary: '#e8ecf4',
  textSecondary: '#8b95a8',
  textMuted: '#525c6f',

  // Semantic
  success: '#34d399',
  successBg: 'rgba(52, 211, 153, 0.12)',
  error: '#f87171',
  errorBg: 'rgba(248, 113, 113, 0.12)',
  warning: '#fbbf24',
  warningBg: 'rgba(251, 191, 36, 0.12)',
  info: '#60a5fa',
  infoBg: 'rgba(96, 165, 250, 0.12)',

  // Misc
  separator: 'rgba(255, 255, 255, 0.06)',
  overlay: 'rgba(4, 6, 10, 0.75)',
  white: '#ffffff',
  black: '#000000',
} as const;

/* ─── Typography ────────────────────────────────────────────── */

export const font = {
  family: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  mono: "'SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace",
  size: {
    xs: 11,
    sm: 12,
    md: 13,
    base: 14,
    lg: 16,
    xl: 18,
    '2xl': 22,
    '3xl': 28,
  },
  weight: {
    normal: 400 as const,
    medium: 500 as const,
    semibold: 600 as const,
    bold: 700 as const,
  },
} as const;

/* ─── Shadows & Effects ─────────────────────────────────────── */

export const shadows = {
  glass: '0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.04)',
  glassSubtle: '0 4px 16px rgba(0, 0, 0, 0.3)',
  glow: `0 0 20px ${colors.primaryGlow}`,
  card: '0 4px 24px rgba(0, 0, 0, 0.35)',
  cardHover: '0 8px 40px rgba(0, 0, 0, 0.5)',
  toast: '0 8px 32px rgba(0, 0, 0, 0.5)',
} as const;

export const blur = {
  glass: 'blur(24px) saturate(180%)',
  glassLight: 'blur(16px) saturate(150%)',
  glassHeavy: 'blur(40px) saturate(200%)',
} as const;

/* ─── Spacing & Radii ───────────────────────────────────────── */

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 16,
  '2xl': 20,
  full: 9999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
} as const;

/* ─── Transition ────────────────────────────────────────────── */

export const transition = {
  fast: 'all 0.15s ease',
  base: 'all 0.2s ease',
  slow: 'all 0.3s ease',
  spring: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const;

/* ─── Reusable Style Objects (CSSProperties) ────────────────── */

/** Standard glass panel — for cards, sections, modals */
export const glassPanel: CSSProperties = {
  background: colors.glassBg,
  backdropFilter: blur.glass,
  WebkitBackdropFilter: blur.glass,
  border: `1px solid ${colors.glassBorder}`,
  borderRadius: radius.xl,
  boxShadow: shadows.glass,
};

/** Lighter glass — for nested elements inside glass panels */
export const glassInner: CSSProperties = {
  background: colors.glassHighlight,
  border: `1px solid ${colors.glassBorder}`,
  borderRadius: radius.lg,
};

/** Glass input field */
export const glassInput: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.04)',
  border: `1px solid ${colors.glassBorder}`,
  borderRadius: radius.md,
  color: colors.textPrimary,
  fontFamily: font.family,
  fontSize: font.size.base,
  padding: '10px 14px',
  outline: 'none',
  transition: transition.base,
  boxSizing: 'border-box' as const,
};

/** Glass textarea */
export const glassTextarea: CSSProperties = {
  ...glassInput,
  fontFamily: font.mono,
  fontSize: font.size.sm,
  resize: 'vertical' as const,
};

/** Glass select */
export const glassSelect: CSSProperties = {
  ...glassInput,
  cursor: 'pointer',
  appearance: 'none' as const,
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238b95a8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center',
  paddingRight: 36,
};

/** Primary button (indigo) */
export const btnPrimary: CSSProperties = {
  background: `linear-gradient(135deg, ${colors.primary}, ${colors.primaryHover})`,
  color: colors.white,
  border: 'none',
  borderRadius: radius.md,
  padding: '10px 20px',
  fontSize: font.size.base,
  fontWeight: font.weight.semibold,
  fontFamily: font.family,
  cursor: 'pointer',
  transition: transition.base,
  boxShadow: `0 2px 12px ${colors.primaryGlow}`,
};

/** Secondary / ghost button */
export const btnSecondary: CSSProperties = {
  background: colors.glassHighlight,
  color: colors.textPrimary,
  border: `1px solid ${colors.glassBorder}`,
  borderRadius: radius.md,
  padding: '10px 20px',
  fontSize: font.size.base,
  fontWeight: font.weight.medium,
  fontFamily: font.family,
  cursor: 'pointer',
  transition: transition.base,
};

/** Danger button */
export const btnDanger: CSSProperties = {
  background: colors.errorBg,
  color: colors.error,
  border: `1px solid rgba(248, 113, 113, 0.2)`,
  borderRadius: radius.md,
  padding: '10px 20px',
  fontSize: font.size.base,
  fontWeight: font.weight.semibold,
  fontFamily: font.family,
  cursor: 'pointer',
  transition: transition.base,
};

/** Small action button */
export const btnSmall: CSSProperties = {
  padding: '6px 14px',
  fontSize: font.size.sm,
  borderRadius: radius.sm,
};

/** Inline danger text (remove links) */
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

/** Glass table wrapper */
export const glassTable: CSSProperties = {
  ...glassPanel,
  overflow: 'hidden',
  padding: 0,
};

/** Table header row */
export const tableHeader: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.04)',
  position: 'sticky' as const,
  top: 0,
  zIndex: 1,
};

/** Table header cell */
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

/** Table body cell */
export const tableCell: CSSProperties = {
  padding: '12px 16px',
  fontSize: font.size.base,
  color: colors.textPrimary,
  borderBottom: `1px solid ${colors.separator}`,
};

/** Table row hover effect — apply with onMouseEnter/Leave */
export const tableRowHoverBg = 'rgba(255, 255, 255, 0.02)';

/** Status badge base */
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

/** Section heading inside settings/pages */
export const sectionTitle: CSSProperties = {
  fontSize: font.size.lg,
  fontWeight: font.weight.semibold,
  color: colors.textPrimary,
  margin: 0,
  marginBottom: spacing.sm,
};

/** Section description text */
export const sectionDesc: CSSProperties = {
  fontSize: font.size.base,
  color: colors.textSecondary,
  margin: 0,
  lineHeight: 1.6,
};

/** Modal overlay */
export const modalOverlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: colors.overlay,
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

/** Modal content */
export const modalContent: CSSProperties = {
  ...glassPanel,
  padding: spacing['3xl'],
  maxWidth: 440,
  width: '90%',
  boxShadow: '0 24px 64px rgba(0, 0, 0, 0.6)',
};

/** Toast notification */
export const toast: CSSProperties = {
  position: 'fixed',
  bottom: 24,
  left: '50%',
  transform: 'translateX(-50%)',
  ...glassPanel,
  padding: '14px 28px',
  fontSize: font.size.base,
  color: colors.textPrimary,
  zIndex: 1001,
  boxShadow: shadows.toast,
};

/** Sidebar width constant */
export const SIDEBAR_WIDTH = 220;
