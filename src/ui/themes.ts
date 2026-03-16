import type { UIConfig, ThemeColors, ThemePreset, ThemeSize, ResolvedTheme } from '../types';

// ── Preset Color Maps ──

const PRESET_COLORS: Record<ThemePreset, Required<ThemeColors>> = {
  default: {
    primary: '#2563eb',
    primaryHover: '#1d4ed8',
    danger: '#dc2626',
    dangerHover: '#b91c1c',
    background: '#ffffff',
    backgroundOverlay: 'rgba(255, 255, 255, 0.95)',
    text: '#1f2937',
    textMuted: '#6b7280',
    border: '#e5e7eb',
    shadow: '0 4px 24px rgba(0, 0, 0, 0.12)',
  },
  light: {
    primary: '#2563eb',
    primaryHover: '#1d4ed8',
    danger: '#dc2626',
    dangerHover: '#b91c1c',
    background: '#ffffff',
    backgroundOverlay: 'rgba(255, 255, 255, 0.95)',
    text: '#1f2937',
    textMuted: '#6b7280',
    border: '#e5e7eb',
    shadow: '0 4px 24px rgba(0, 0, 0, 0.12)',
  },
  dark: {
    primary: '#3b82f6',
    primaryHover: '#2563eb',
    danger: '#ef4444',
    dangerHover: '#dc2626',
    background: '#1f2937',
    backgroundOverlay: 'rgba(31, 41, 55, 0.95)',
    text: '#f3f4f6',
    textMuted: '#9ca3af',
    border: '#374151',
    shadow: '0 4px 24px rgba(0, 0, 0, 0.3)',
  },
  minimal: {
    primary: '#6b7280',
    primaryHover: '#4b5563',
    danger: '#dc2626',
    dangerHover: '#b91c1c',
    background: '#ffffff',
    backgroundOverlay: 'rgba(255, 255, 255, 0.98)',
    text: '#374151',
    textMuted: '#9ca3af',
    border: '#f3f4f6',
    shadow: '0 2px 8px rgba(0, 0, 0, 0.06)',
  },
};

// ── Size Maps ──

const SIZE_MAP: Record<ThemeSize, { buttonSize: number; iconSize: number; panelMaxWidth: number }> = {
  sm: { buttonSize: 40, iconSize: 18, panelMaxWidth: 280 },
  md: { buttonSize: 56, iconSize: 24, panelMaxWidth: 320 },
  lg: { buttonSize: 72, iconSize: 30, panelMaxWidth: 400 },
};

// ── Resolver ──

export function resolveTheme(uiConfig: UIConfig = {}): ResolvedTheme {
  const theme = uiConfig.theme ?? {};
  const preset = theme.preset ?? 'default';
  const presetColors = PRESET_COLORS[preset];

  // Merge: preset < legacy primaryColor < theme.colors overrides
  const colors: Required<ThemeColors> = { ...presetColors };

  // Legacy backward compat: primaryColor overrides preset primary
  if (uiConfig.primaryColor) {
    colors.primary = uiConfig.primaryColor;
  }

  // Theme color overrides
  if (theme.colors) {
    for (const [key, value] of Object.entries(theme.colors)) {
      if (value !== undefined) {
        (colors as Record<string, string>)[key] = value;
      }
    }
  }

  const size = theme.size ?? 'md';
  const sizeValues = SIZE_MAP[size];

  return {
    colors,
    size,
    borderRadius: theme.borderRadius ?? '12px',
    colorScheme: theme.colorScheme ?? 'auto',
    buttonSize: sizeValues.buttonSize,
    iconSize: sizeValues.iconSize,
    panelMaxWidth: sizeValues.panelMaxWidth,
    customProperties: theme.customProperties ?? {},
  };
}
