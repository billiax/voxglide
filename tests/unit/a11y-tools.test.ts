import { describe, it, expect } from 'vitest';
import { a11yTools } from '../../src/accessibility/a11y-tools';

describe('a11y-tools', () => {
  it('exports 6 tool declarations', () => {
    expect(a11yTools).toHaveLength(6);
  });

  it('includes describePage tool', () => {
    const tool = a11yTools.find(t => t.name === 'describePage');
    expect(tool).toBeDefined();
    expect(tool!.description).toContain('ARIA');
  });

  it('includes focusElement tool', () => {
    const tool = a11yTools.find(t => t.name === 'focusElement');
    expect(tool).toBeDefined();
    expect(tool!.parameters.properties).toHaveProperty('index');
    expect(tool!.parameters.properties).toHaveProperty('selector');
    expect(tool!.parameters.properties).toHaveProperty('description');
  });

  it('includes listLandmarks tool', () => {
    const tool = a11yTools.find(t => t.name === 'listLandmarks');
    expect(tool).toBeDefined();
  });

  it('includes readHeadings tool', () => {
    const tool = a11yTools.find(t => t.name === 'readHeadings');
    expect(tool).toBeDefined();
  });

  it('includes nextFormField tool', () => {
    const tool = a11yTools.find(t => t.name === 'nextFormField');
    expect(tool).toBeDefined();
  });

  it('includes prevFormField tool', () => {
    const tool = a11yTools.find(t => t.name === 'prevFormField');
    expect(tool).toBeDefined();
  });

  it('all tools have OBJECT type parameters', () => {
    for (const tool of a11yTools) {
      expect(tool.parameters.type).toBe('OBJECT');
    }
  });
});
