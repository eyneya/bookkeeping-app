// Eyneya Business Solutions — brand design system
// Professional financial-services palette: deep navy + teal accent.

export const colors = {
  // Brand
  navy: '#0f2942',
  navyLight: '#1a3a5c',
  navyDark: '#0a1f33',
  teal: '#0d9488',
  tealLight: '#14b8a6',
  tealDark: '#0f766e',

  // Semantic
  primary: '#0f2942',
  primaryHover: '#1a3a5c',
  accent: '#0d9488',
  accentHover: '#0f766e',
  success: '#16a34a',
  successBg: '#ecfdf5',
  successBorder: '#a7f3d0',
  warning: '#b45309',
  warningBg: '#fffbeb',
  warningBorder: '#fde68a',
  error: '#dc2626',
  errorBg: '#fef2f2',
  errorBorder: '#fecaca',
  info: '#2563eb',
  infoBg: '#eff6ff',
  infoBorder: '#bfdbfe',

  // Neutrals
  white: '#ffffff',
  gray50: '#f9fafb',
  gray100: '#f3f4f6',
  gray200: '#e5e7eb',
  gray300: '#d1d5db',
  gray400: '#9ca3af',
  gray500: '#6b7280',
  gray600: '#4b5563',
  gray700: '#374151',
  gray800: '#1f2937',
  gray900: '#111827',

  // Aliases used across components
  text: '#1f2937',
  textMuted: '#6b7280',
  textSubtle: '#9ca3af',
  border: '#e5e7eb',
  borderLight: '#f3f4f6',
  pageBg: '#f9fafb',
  surface: '#ffffff',
};

export const fonts = {
  family: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  heading: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  mono: "'SF Mono', 'Fira Code', 'Consolas', monospace",
  sizeXs: 12,
  sizeSm: 13,
  sizeBase: 14,
  sizeMd: 15,
  sizeLg: 18,
  sizeXl: 22,
  size2xl: 28,
  weightNormal: 400,
  weightMedium: 500,
  weightSemibold: 600,
  weightBold: 700,
  lineHeightBody: 1.5,
  lineHeightHeading: 1.2,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const radius = {
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  pill: 999,
};

export const shadows = {
  sm: '0 1px 2px rgba(15, 41, 66, 0.05)',
  md: '0 4px 6px -1px rgba(15, 41, 66, 0.07), 0 2px 4px -2px rgba(15, 41, 66, 0.05)',
  lg: '0 10px 15px -3px rgba(15, 41, 66, 0.08), 0 4px 6px -4px rgba(15, 41, 66, 0.05)',
  xl: '0 20px 25px -5px rgba(15, 41, 66, 0.1), 0 8px 10px -6px rgba(15, 41, 66, 0.05)',
};

// --- Style objects for reusable UI primitives ---

export const button = {
  primary: {
    padding: '10px 20px',
    fontSize: fonts.sizeBase,
    fontWeight: fonts.weightSemibold,
    fontFamily: fonts.family,
    background: colors.navy,
    color: colors.white,
    border: 'none',
    borderRadius: radius.md,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    boxShadow: shadows.sm,
  },
  accent: {
    padding: '10px 20px',
    fontSize: fonts.sizeBase,
    fontWeight: fonts.weightSemibold,
    fontFamily: fonts.family,
    background: colors.teal,
    color: colors.white,
    border: 'none',
    borderRadius: radius.md,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    boxShadow: shadows.sm,
  },
  secondary: {
    padding: '10px 20px',
    fontSize: fonts.sizeBase,
    fontWeight: fonts.weightMedium,
    fontFamily: fonts.family,
    background: colors.white,
    color: colors.navy,
    border: `1px solid ${colors.gray300}`,
    borderRadius: radius.md,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  danger: {
    padding: '10px 20px',
    fontSize: fonts.sizeBase,
    fontWeight: fonts.weightSemibold,
    fontFamily: fonts.family,
    background: colors.error,
    color: colors.white,
    border: 'none',
    borderRadius: radius.md,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    boxShadow: shadows.sm,
  },
  small: {
    padding: '5px 12px',
    fontSize: fonts.sizeSm,
    fontWeight: fonts.weightMedium,
    fontFamily: fonts.family,
    background: colors.white,
    color: colors.navy,
    border: `1px solid ${colors.gray300}`,
    borderRadius: radius.sm,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  smallAccent: {
    padding: '5px 12px',
    fontSize: fonts.sizeSm,
    fontWeight: fonts.weightMedium,
    fontFamily: fonts.family,
    background: colors.teal,
    color: colors.white,
    border: 'none',
    borderRadius: radius.sm,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  smallDanger: {
    padding: '5px 12px',
    fontSize: fonts.sizeSm,
    fontWeight: fonts.weightMedium,
    fontFamily: fonts.family,
    background: 'transparent',
    color: colors.error,
    border: 'none',
    borderRadius: radius.sm,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  link: {
    background: 'none',
    border: 'none',
    color: colors.teal,
    cursor: 'pointer',
    fontSize: fonts.sizeSm,
    fontFamily: fonts.family,
    fontWeight: fonts.weightMedium,
    transition: 'color 0.15s ease',
  },
};

export const input = {
  base: {
    padding: '10px 12px',
    fontSize: fonts.sizeBase,
    fontFamily: fonts.family,
    color: colors.text,
    background: colors.white,
    border: `1px solid ${colors.gray300}`,
    borderRadius: radius.md,
    outline: 'none',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
    boxSizing: 'border-box',
  },
  small: {
    padding: '6px 10px',
    fontSize: fonts.sizeSm,
    fontFamily: fonts.family,
    color: colors.text,
    background: colors.white,
    border: `1px solid ${colors.gray300}`,
    borderRadius: radius.sm,
    outline: 'none',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
    boxSizing: 'border-box',
  },
};

export const select = {
  ...input.base,
  cursor: 'pointer',
};

export const table = {
  container: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: fonts.sizeBase,
    fontFamily: fonts.family,
  },
  headerCell: {
    padding: `${spacing.sm + 2}px ${spacing.md}px`,
    textAlign: 'left',
    fontWeight: fonts.weightSemibold,
    color: colors.navy,
    borderBottom: `2px solid ${colors.navy}`,
    fontSize: fonts.sizeSm,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  cell: {
    padding: `${spacing.md}px ${spacing.md}px`,
    color: colors.text,
    borderBottom: `1px solid ${colors.borderLight}`,
  },
  row: {
    borderBottom: `1px solid ${colors.borderLight}`,
    transition: 'background 0.15s ease',
  },
};

export const card = {
  base: {
    background: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    boxShadow: shadows.md,
    border: `1px solid ${colors.border}`,
  },
  padded: {
    background: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    boxShadow: shadows.sm,
    border: `1px solid ${colors.border}`,
  },
};

export const badge = {
  base: {
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: radius.pill,
    fontSize: fonts.sizeXs,
    fontWeight: fonts.weightSemibold,
    fontFamily: fonts.family,
  },
  success: {
    background: colors.successBg,
    color: colors.success,
    border: `1px solid ${colors.successBorder}`,
  },
  warning: {
    background: colors.warningBg,
    color: colors.warning,
    border: `1px solid ${colors.warningBorder}`,
  },
  error: {
    background: colors.errorBg,
    color: colors.error,
    border: `1px solid ${colors.errorBorder}`,
  },
  info: {
    background: colors.infoBg,
    color: colors.info,
    border: `1px solid ${colors.infoBorder}`,
  },
};

export const alert = {
  success: {
    background: colors.successBg,
    border: `1px solid ${colors.successBorder}`,
    color: colors.success,
    borderRadius: radius.md,
    padding: `${spacing.md}px ${spacing.lg}px`,
    fontSize: fonts.sizeSm,
  },
  warning: {
    background: colors.warningBg,
    border: `1px solid ${colors.warningBorder}`,
    color: colors.warning,
    borderRadius: radius.md,
    padding: `${spacing.md}px ${spacing.lg}px`,
    fontSize: fonts.sizeSm,
  },
  error: {
    background: colors.errorBg,
    border: `1px solid ${colors.errorBorder}`,
    color: colors.error,
    borderRadius: radius.md,
    padding: `${spacing.md}px ${spacing.lg}px`,
    fontSize: fonts.sizeSm,
  },
  info: {
    background: colors.infoBg,
    border: `1px solid ${colors.infoBorder}`,
    color: colors.info,
    borderRadius: radius.md,
    padding: `${spacing.md}px ${spacing.lg}px`,
    fontSize: fonts.sizeSm,
  },
};

// Helper for hover effect via CSS-in-JS (used with onMouseEnter/Leave)
export const hoverBg = (color) => ({ background: color });
