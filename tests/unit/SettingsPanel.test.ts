import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SettingsPanel } from '../../src/ui/SettingsPanel';
import { DEFAULT_UI } from '../../src/constants';
import type { UIConfig } from '../../src/types';

describe('SettingsPanel', () => {
  let onChange: ReturnType<typeof vi.fn>;
  let onClose: ReturnType<typeof vi.fn>;
  let config: Required<UIConfig>;

  beforeEach(() => {
    onChange = vi.fn();
    onClose = vi.fn();
    config = { ...DEFAULT_UI };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function create(overrides: Partial<UIConfig> = {}): SettingsPanel {
    return new SettingsPanel({ ...config, ...overrides } as Required<UIConfig>, onChange, onClose);
  }

  describe('rendering', () => {
    it('creates a settings element with header and body', () => {
      const panel = create();
      const el = panel.getElement();
      expect(el.classList.contains('vsdk-settings')).toBe(true);
      expect(el.querySelector('.vsdk-settings-header')).not.toBeNull();
      expect(el.querySelector('.vsdk-settings-body')).not.toBeNull();
    });

    it('renders a 3x3 position grid', () => {
      const panel = create();
      const el = panel.getElement();
      const cells = el.querySelectorAll('.vsdk-pos-cell');
      expect(cells.length).toBe(9);
    });

    it('marks current position as active', () => {
      const panel = create({ position: 'center' });
      const el = panel.getElement();
      const active = el.querySelector('.vsdk-pos-cell.active');
      expect(active).not.toBeNull();
      expect(active!.textContent).toBe('C');
    });

    it('renders size toggle with S/M/L buttons', () => {
      const panel = create();
      const el = panel.getElement();
      const toggleBtns = el.querySelectorAll('.vsdk-toggle-group')[0]?.querySelectorAll('.vsdk-toggle-btn');
      expect(toggleBtns?.length).toBe(3);
      expect(toggleBtns?.[0].textContent).toBe('S');
      expect(toggleBtns?.[1].textContent).toBe('M');
      expect(toggleBtns?.[2].textContent).toBe('L');
    });

    it('renders appearance toggle with Auto/Light/Dark', () => {
      const panel = create();
      const el = panel.getElement();
      const toggleGroups = el.querySelectorAll('.vsdk-toggle-group');
      const appearanceBtns = toggleGroups[1]?.querySelectorAll('.vsdk-toggle-btn');
      expect(appearanceBtns?.length).toBe(3);
      expect(appearanceBtns?.[0].textContent).toBe('Auto');
      expect(appearanceBtns?.[1].textContent).toBe('Light');
      expect(appearanceBtns?.[2].textContent).toBe('Dark');
    });

    it('renders color picker input', () => {
      const panel = create();
      const el = panel.getElement();
      const colorInput = el.querySelector('.vsdk-color-input') as HTMLInputElement;
      expect(colorInput).not.toBeNull();
      expect(colorInput.type).toBe('color');
    });

    it('renders offset X/Y inputs', () => {
      const panel = create({ offset: { x: 30, y: 50 } });
      const el = panel.getElement();
      const inputs = el.querySelectorAll('.vsdk-offset-input') as NodeListOf<HTMLInputElement>;
      expect(inputs.length).toBe(2);
      expect(inputs[0].value).toBe('30');
      expect(inputs[1].value).toBe('50');
    });

    it('renders close button in header', () => {
      const panel = create();
      const el = panel.getElement();
      const closeBtn = el.querySelector('.vsdk-settings-header .vsdk-panel-close');
      expect(closeBtn).not.toBeNull();
    });
  });

  describe('interactions', () => {
    it('emits position change when grid cell is clicked', () => {
      const panel = create();
      const el = panel.getElement();
      const cells = el.querySelectorAll('.vsdk-pos-cell');
      // Click center cell (index 4)
      (cells[4] as HTMLElement).click();
      expect(onChange).toHaveBeenCalledWith({ position: 'center' });
    });

    it('updates active state on position click', () => {
      const panel = create({ position: 'bottom-right' });
      const el = panel.getElement();
      const cells = el.querySelectorAll('.vsdk-pos-cell');
      // Click top-left (index 0)
      (cells[0] as HTMLElement).click();
      expect(cells[0].classList.contains('active')).toBe(true);
      // Previous active (bottom-right, index 8) should be deactivated
      expect(cells[8].classList.contains('active')).toBe(false);
    });

    it('emits size change on toggle click', () => {
      const panel = create();
      const el = panel.getElement();
      const sizeGroup = el.querySelectorAll('.vsdk-toggle-group')[0];
      const smBtn = sizeGroup.querySelectorAll('.vsdk-toggle-btn')[0] as HTMLElement;
      smBtn.click();
      expect(onChange).toHaveBeenCalledWith({ theme: { size: 'sm' } });
    });

    it('emits dark appearance with correct preset and colorScheme', () => {
      const panel = create();
      const el = panel.getElement();
      const appearanceGroup = el.querySelectorAll('.vsdk-toggle-group')[1];
      const darkBtn = appearanceGroup.querySelectorAll('.vsdk-toggle-btn')[2] as HTMLElement;
      darkBtn.click();
      expect(onChange).toHaveBeenCalledWith({ theme: { preset: 'dark', colorScheme: 'dark' } });
    });

    it('emits light appearance with correct preset and colorScheme', () => {
      const panel = create();
      const el = panel.getElement();
      const appearanceGroup = el.querySelectorAll('.vsdk-toggle-group')[1];
      const lightBtn = appearanceGroup.querySelectorAll('.vsdk-toggle-btn')[1] as HTMLElement;
      lightBtn.click();
      expect(onChange).toHaveBeenCalledWith({ theme: { preset: 'light', colorScheme: 'light' } });
    });

    it('emits auto appearance with default preset', () => {
      const panel = create({ theme: { preset: 'dark', colorScheme: 'dark' } });
      const el = panel.getElement();
      const appearanceGroup = el.querySelectorAll('.vsdk-toggle-group')[1];
      const autoBtn = appearanceGroup.querySelectorAll('.vsdk-toggle-btn')[0] as HTMLElement;
      autoBtn.click();
      expect(onChange).toHaveBeenCalledWith({ theme: { preset: 'default', colorScheme: 'auto' } });
    });

    it('emits color change on input', () => {
      const panel = create();
      const el = panel.getElement();
      const colorInput = el.querySelector('.vsdk-color-input') as HTMLInputElement;
      colorInput.value = '#ff0000';
      colorInput.dispatchEvent(new Event('input'));
      expect(onChange).toHaveBeenCalledWith({ theme: { colors: { primary: '#ff0000' } } });
    });

    it('emits offset X change', () => {
      const panel = create();
      const el = panel.getElement();
      const inputs = el.querySelectorAll('.vsdk-offset-input') as NodeListOf<HTMLInputElement>;
      inputs[0].value = '40';
      inputs[0].dispatchEvent(new Event('input'));
      expect(onChange).toHaveBeenCalledWith({ offset: { x: 40 } });
    });

    it('emits offset Y change', () => {
      const panel = create();
      const el = panel.getElement();
      const inputs = el.querySelectorAll('.vsdk-offset-input') as NodeListOf<HTMLInputElement>;
      inputs[1].value = '60';
      inputs[1].dispatchEvent(new Event('input'));
      expect(onChange).toHaveBeenCalledWith({ offset: { y: 60 } });
    });

    it('calls onClose when close button is clicked', () => {
      const panel = create();
      const el = panel.getElement();
      const closeBtn = el.querySelector('.vsdk-settings-header .vsdk-panel-close') as HTMLElement;
      closeBtn.click();
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('removes element from DOM', () => {
      const panel = create();
      const el = panel.getElement();
      document.body.appendChild(el);
      expect(el.parentElement).toBe(document.body);
      panel.destroy();
      expect(el.parentElement).toBeNull();
    });
  });

  describe('initial state from config', () => {
    it('detects dark appearance from preset', () => {
      const panel = create({ theme: { preset: 'dark' } });
      const el = panel.getElement();
      const appearanceGroup = el.querySelectorAll('.vsdk-toggle-group')[1];
      const darkBtn = appearanceGroup.querySelectorAll('.vsdk-toggle-btn')[2];
      expect(darkBtn.classList.contains('active')).toBe(true);
    });

    it('detects light appearance from colorScheme', () => {
      const panel = create({ theme: { colorScheme: 'light' } });
      const el = panel.getElement();
      const appearanceGroup = el.querySelectorAll('.vsdk-toggle-group')[1];
      const lightBtn = appearanceGroup.querySelectorAll('.vsdk-toggle-btn')[1];
      expect(lightBtn.classList.contains('active')).toBe(true);
    });

    it('defaults to auto appearance', () => {
      const panel = create();
      const el = panel.getElement();
      const appearanceGroup = el.querySelectorAll('.vsdk-toggle-group')[1];
      const autoBtn = appearanceGroup.querySelectorAll('.vsdk-toggle-btn')[0];
      expect(autoBtn.classList.contains('active')).toBe(true);
    });

    it('shows primary color from theme.colors', () => {
      const panel = create({ theme: { colors: { primary: '#ff6600' } } });
      const el = panel.getElement();
      const colorInput = el.querySelector('.vsdk-color-input') as HTMLInputElement;
      expect(colorInput.value).toBe('#ff6600');
    });

    it('falls back to primaryColor when theme.colors.primary is not set', () => {
      const panel = create({ primaryColor: '#00ff00' });
      const el = panel.getElement();
      const colorInput = el.querySelector('.vsdk-color-input') as HTMLInputElement;
      expect(colorInput.value).toBe('#00ff00');
    });
  });
});
