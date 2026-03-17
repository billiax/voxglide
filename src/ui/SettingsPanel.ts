import type { UIConfig, UIPosition, ThemeSize } from '../types';
import { closeIcon } from './icons';

const POSITION_GRID: UIPosition[][] = [
  ['top-left', 'top-center', 'top-right'],
  ['center-left', 'center', 'center-right'],
  ['bottom-left', 'bottom-center', 'bottom-right'],
];

const POSITION_LABELS: Record<UIPosition, string> = {
  'top-left': 'TL', 'top-center': 'TC', 'top-right': 'TR',
  'center-left': 'CL', 'center': 'C', 'center-right': 'CR',
  'bottom-left': 'BL', 'bottom-center': 'BC', 'bottom-right': 'BR',
};

export class SettingsPanel {
  private el: HTMLElement;

  constructor(
    config: Required<UIConfig>,
    private onChange: (patch: Partial<UIConfig>) => void,
    onClose: () => void,
  ) {
    this.el = h('div', 'vsdk-settings');

    const pos = config.position;
    const ox = config.offset?.x ?? 20;
    const oy = config.offset?.y ?? 20;
    const size: ThemeSize = config.theme?.size ?? 'md';
    const preset = config.theme?.preset ?? 'default';
    const scheme = config.theme?.colorScheme ?? 'auto';
    const color = config.theme?.colors?.primary ?? config.primaryColor;

    // Derive appearance mode from preset + colorScheme
    let appearance: string;
    if (preset === 'dark' || scheme === 'dark') appearance = 'dark';
    else if (scheme === 'light') appearance = 'light';
    else appearance = 'auto';

    // Header
    const header = h('div', 'vsdk-settings-header');
    const title = h('span', 'vsdk-settings-title');
    title.textContent = 'Settings';
    const closeBtn = h('button', 'vsdk-panel-close');
    closeBtn.innerHTML = closeIcon;
    closeBtn.setAttribute('aria-label', 'Close settings');
    closeBtn.addEventListener('click', onClose);
    header.append(title, closeBtn);

    // Scrollable body
    const body = h('div', 'vsdk-settings-body');

    // Position grid
    const posGrid = h('div', 'vsdk-pos-grid');
    for (const row of POSITION_GRID) {
      for (const p of row) {
        const cell = h('button', 'vsdk-pos-cell');
        cell.textContent = POSITION_LABELS[p];
        cell.dataset.pos = p;
        if (p === pos) cell.classList.add('active');
        cell.addEventListener('click', () => {
          posGrid.querySelectorAll('.active').forEach(c => c.classList.remove('active'));
          cell.classList.add('active');
          this.onChange({ position: p });
        });
        posGrid.appendChild(cell);
      }
    }
    body.appendChild(section('Position', posGrid));

    // Size toggle
    body.appendChild(section('Size', toggleGroup(
      [{ v: 'sm', l: 'S' }, { v: 'md', l: 'M' }, { v: 'lg', l: 'L' }],
      size,
      (v) => this.onChange({ theme: { size: v as ThemeSize } }),
    )));

    // Appearance toggle
    body.appendChild(section('Appearance', toggleGroup(
      [{ v: 'auto', l: 'Auto' }, { v: 'light', l: 'Light' }, { v: 'dark', l: 'Dark' }],
      appearance,
      (v) => {
        if (v === 'dark') {
          this.onChange({ theme: { preset: 'dark', colorScheme: 'dark' } });
        } else if (v === 'light') {
          this.onChange({ theme: { preset: 'light', colorScheme: 'light' } });
        } else {
          this.onChange({ theme: { preset: 'default', colorScheme: 'auto' } });
        }
      },
    )));

    // Accent color
    const colorRow = h('div', 'vsdk-color-row');
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'vsdk-color-input';
    colorInput.value = color;
    const colorLabel = h('span', 'vsdk-color-value');
    colorLabel.textContent = color;
    colorInput.addEventListener('input', () => {
      colorLabel.textContent = colorInput.value;
      this.onChange({ theme: { colors: { primary: colorInput.value } } });
    });
    colorRow.append(colorInput, colorLabel);
    body.appendChild(section('Accent color', colorRow));

    // Edge offset
    const offsetRow = h('div', 'vsdk-offset-row');
    offsetRow.append(
      offsetField('X', ox, (v) => this.onChange({ offset: { x: v } })),
      offsetField('Y', oy, (v) => this.onChange({ offset: { y: v } })),
    );
    body.appendChild(section('Edge offset', offsetRow));

    this.el.append(header, body);
  }

  getElement(): HTMLElement { return this.el; }
  destroy(): void { this.el.remove(); }
}

// ── Helpers ──

function h(tag: string, cls: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = cls;
  return el;
}

function section(label: string, content: HTMLElement): HTMLElement {
  const sec = h('div', 'vsdk-settings-section');
  const lbl = h('div', 'vsdk-settings-label');
  lbl.textContent = label;
  sec.append(lbl, content);
  return sec;
}

function toggleGroup(
  options: { v: string; l: string }[],
  current: string,
  onChange: (val: string) => void,
): HTMLElement {
  const group = h('div', 'vsdk-toggle-group');
  for (const opt of options) {
    const btn = h('button', 'vsdk-toggle-btn');
    btn.textContent = opt.l;
    if (opt.v === current) btn.classList.add('active');
    btn.addEventListener('click', () => {
      group.querySelectorAll('.active').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onChange(opt.v);
    });
    group.appendChild(btn);
  }
  return group;
}

function offsetField(label: string, value: number, onChange: (v: number) => void): DocumentFragment {
  const frag = document.createDocumentFragment();
  const lbl = h('span', 'vsdk-offset-label');
  lbl.textContent = label;
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'vsdk-offset-input';
  input.value = String(value);
  input.min = '0';
  input.max = '200';
  input.addEventListener('input', () => {
    onChange(parseInt(input.value, 10) || 0);
  });
  frag.append(lbl, input);
  return frag;
}
