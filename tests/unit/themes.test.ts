import { describe, it, expect } from 'vitest';
import { resolveTheme } from '../../src/ui/themes';
import { buildStyles } from '../../src/ui/styles';

describe('resolveTheme', () => {
  it('returns default theme when called with no config', () => {
    const theme = resolveTheme();
    expect(theme.colors.primary).toBe('#2563eb');
    expect(theme.size).toBe('md');
    expect(theme.borderRadius).toBe('12px');
    expect(theme.colorScheme).toBe('auto');
    expect(theme.buttonSize).toBe(56);
    expect(theme.iconSize).toBe(24);
    expect(theme.panelMaxWidth).toBe(320);
  });

  it('applies dark preset colors', () => {
    const theme = resolveTheme({ theme: { preset: 'dark' } });
    expect(theme.colors.primary).toBe('#3b82f6');
    expect(theme.colors.background).toBe('#1f2937');
    expect(theme.colors.text).toBe('#f3f4f6');
  });

  it('applies minimal preset colors', () => {
    const theme = resolveTheme({ theme: { preset: 'minimal' } });
    expect(theme.colors.primary).toBe('#6b7280');
    expect(theme.colors.shadow).toBe('0 2px 8px rgba(0, 0, 0, 0.06)');
  });

  it('applies light preset colors (same as default)', () => {
    const theme = resolveTheme({ theme: { preset: 'light' } });
    expect(theme.colors.primary).toBe('#2563eb');
    expect(theme.colors.background).toBe('#ffffff');
  });

  it('legacy primaryColor overrides preset primary', () => {
    const theme = resolveTheme({ primaryColor: '#ff0000' });
    expect(theme.colors.primary).toBe('#ff0000');
  });

  it('theme.colors overrides preset and legacy primaryColor', () => {
    const theme = resolveTheme({
      primaryColor: '#ff0000',
      theme: { colors: { primary: '#00ff00' } },
    });
    expect(theme.colors.primary).toBe('#00ff00');
  });

  it('partial color overrides merge with preset', () => {
    const theme = resolveTheme({
      theme: {
        preset: 'dark',
        colors: { primary: '#ff6600' },
      },
    });
    expect(theme.colors.primary).toBe('#ff6600');
    // Other dark preset colors remain
    expect(theme.colors.background).toBe('#1f2937');
    expect(theme.colors.text).toBe('#f3f4f6');
  });

  it('sm size gives smaller dimensions', () => {
    const theme = resolveTheme({ theme: { size: 'sm' } });
    expect(theme.buttonSize).toBe(40);
    expect(theme.iconSize).toBe(18);
    expect(theme.panelMaxWidth).toBe(280);
  });

  it('lg size gives larger dimensions', () => {
    const theme = resolveTheme({ theme: { size: 'lg' } });
    expect(theme.buttonSize).toBe(72);
    expect(theme.iconSize).toBe(30);
    expect(theme.panelMaxWidth).toBe(400);
  });

  it('custom borderRadius is applied', () => {
    const theme = resolveTheme({ theme: { borderRadius: '24px' } });
    expect(theme.borderRadius).toBe('24px');
  });

  it('custom colorScheme is applied', () => {
    const theme = resolveTheme({ theme: { colorScheme: 'dark' } });
    expect(theme.colorScheme).toBe('dark');
  });

  it('custom properties are passed through', () => {
    const theme = resolveTheme({
      theme: { customProperties: { '--my-var': '42px' } },
    });
    expect(theme.customProperties).toEqual({ '--my-var': '42px' });
  });

  it('empty theme object uses all defaults', () => {
    const theme = resolveTheme({ theme: {} });
    expect(theme.colors.primary).toBe('#2563eb');
    expect(theme.size).toBe('md');
  });

  it('direct buttonSize overrides size preset', () => {
    const theme = resolveTheme({ theme: { size: 'sm', buttonSize: 64 } });
    expect(theme.buttonSize).toBe(64);
    // Other size-derived values still follow preset
    expect(theme.iconSize).toBe(18);
    expect(theme.panelMaxWidth).toBe(280);
  });

  it('direct iconSize overrides size preset', () => {
    const theme = resolveTheme({ theme: { size: 'lg', iconSize: 20 } });
    expect(theme.iconSize).toBe(20);
    expect(theme.buttonSize).toBe(72);
  });

  it('direct panelWidth overrides size preset', () => {
    const theme = resolveTheme({ theme: { size: 'md', panelWidth: 500 } });
    expect(theme.panelMaxWidth).toBe(500);
    expect(theme.buttonSize).toBe(56);
  });

  it('all direct size overrides work together', () => {
    const theme = resolveTheme({
      theme: { buttonSize: 48, iconSize: 22, panelWidth: 350 },
    });
    expect(theme.buttonSize).toBe(48);
    expect(theme.iconSize).toBe(22);
    expect(theme.panelMaxWidth).toBe(350);
  });
});

describe('buildStyles', () => {
  it('generates CSS string with theme colors injected', () => {
    const theme = resolveTheme({ theme: { preset: 'dark' } });
    const css = buildStyles(theme);
    expect(css).toContain('--vsdk-primary: #3b82f6');
    expect(css).toContain('--vsdk-bg: #1f2937');
  });

  it('includes button size from theme', () => {
    const theme = resolveTheme({ theme: { size: 'lg' } });
    const css = buildStyles(theme);
    expect(css).toContain('width: 72px');
    expect(css).toContain('height: 72px');
  });

  it('includes icon size from theme', () => {
    const theme = resolveTheme({ theme: { size: 'sm' } });
    const css = buildStyles(theme);
    expect(css).toContain('width: 18px');
    expect(css).toContain('height: 18px');
  });

  it('includes panel max width from theme', () => {
    const theme = resolveTheme({ theme: { size: 'lg' } });
    const css = buildStyles(theme);
    expect(css).toContain('width: 400px');
  });

  it('includes border radius from theme', () => {
    const theme = resolveTheme({ theme: { borderRadius: '24px' } });
    const css = buildStyles(theme);
    expect(css).toContain('--vsdk-radius: 24px');
  });

  it('includes custom properties', () => {
    const theme = resolveTheme({
      theme: { customProperties: { '--my-color': '#ff0000' } },
    });
    const css = buildStyles(theme);
    expect(css).toContain('--my-color: #ff0000');
  });

  it('omits dark mode media query for colorScheme light', () => {
    const theme = resolveTheme({ theme: { colorScheme: 'light' } });
    const css = buildStyles(theme);
    expect(css).not.toContain('prefers-color-scheme');
  });

  it('omits dark mode media query for colorScheme dark', () => {
    const theme = resolveTheme({ theme: { colorScheme: 'dark' } });
    const css = buildStyles(theme);
    expect(css).not.toContain('prefers-color-scheme');
  });

  it('includes dark mode media query for colorScheme auto', () => {
    const theme = resolveTheme({ theme: { colorScheme: 'auto' } });
    const css = buildStyles(theme);
    expect(css).toContain('prefers-color-scheme');
  });

  it('includes high contrast mode styles', () => {
    const theme = resolveTheme();
    const css = buildStyles(theme);
    expect(css).toContain('.high-contrast');
    expect(css).toContain('3px solid #facc15');
  });

  it('includes focus-visible outlines', () => {
    const theme = resolveTheme();
    const css = buildStyles(theme);
    expect(css).toContain('focus-visible');
  });

  it('includes CSS for all position variants', () => {
    const theme = resolveTheme();
    const css = buildStyles(theme);
    expect(css).toContain('.vsdk-container.bottom-right');
    expect(css).toContain('.vsdk-container.bottom-left');
    expect(css).toContain('.vsdk-container.top-right');
    expect(css).toContain('.vsdk-container.top-left');
    expect(css).toContain('.vsdk-container.bottom-center');
    expect(css).toContain('.vsdk-container.top-center');
    expect(css).toContain('.vsdk-container.center-right');
    expect(css).toContain('.vsdk-container.center-left');
    expect(css).toContain('.vsdk-container.center');
  });

  it('uses offset CSS variables for positioning', () => {
    const theme = resolveTheme();
    const css = buildStyles(theme);
    expect(css).toContain('--vsdk-ox');
    expect(css).toContain('--vsdk-oy');
  });

  it('includes paused CSS variable', () => {
    const theme = resolveTheme();
    const css = buildStyles(theme);
    expect(css).toContain('--vsdk-paused');
    expect(css).toContain('--vsdk-success');
  });
});
