import type { ToolDeclaration } from '../types';

/**
 * Built-in tool declarations for DOM interaction.
 */

export const fillFieldTool: ToolDeclaration = {
  name: 'fillField',
  description: 'Fill a form field with a value. Resolves the field by index, ID, name, label text, placeholder, or aria-label.',
  parameters: {
    type: 'OBJECT',
    properties: {
      index: {
        type: 'INTEGER',
        description: 'The element index number from the page context. Preferred over fieldId when available.',
      },
      fieldId: {
        type: 'STRING',
        description: 'The ID, name, label, or placeholder of the field to fill.',
      },
      value: {
        type: 'STRING',
        description: 'The value to set in the field. For checkboxes use "true"/"false". For selects, use the option text.',
      },
    },
    required: ['value'],
  },
};

export const clickElementTool: ToolDeclaration = {
  name: 'clickElement',
  description: 'Click an element on the page. Finds it by index number, text content, aria-label, title, or CSS selector.',
  parameters: {
    type: 'OBJECT',
    properties: {
      index: {
        type: 'INTEGER',
        description: 'The element index number from the page context. Preferred over description when available.',
      },
      description: {
        type: 'STRING',
        description: 'Description of the element to click (button text, link text, etc.).',
      },
      selector: {
        type: 'STRING',
        description: 'Optional CSS selector for precise targeting.',
      },
    },
    required: [],
  },
};

export const readContentTool: ToolDeclaration = {
  name: 'readContent',
  description: 'Read the text content of an element on the page.',
  parameters: {
    type: 'OBJECT',
    properties: {
      selector: {
        type: 'STRING',
        description: 'CSS selector of the element to read. Use "main" for main content.',
      },
    },
    required: ['selector'],
  },
};

export const scanPageTool: ToolDeclaration = {
  name: 'scanPage',
  description: 'Rescan the current page to get fresh information about interactive elements, forms, and content. Use when you suspect the page has changed.',
  parameters: {
    type: 'OBJECT',
    properties: {},
    required: [],
  },
};

export const builtInTools: ToolDeclaration[] = [
  fillFieldTool,
  clickElementTool,
  readContentTool,
  scanPageTool,
];
