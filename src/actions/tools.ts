import type { ToolDeclaration } from '../types';

/**
 * Built-in tool declarations for DOM interaction.
 */

export const fillFieldTool: ToolDeclaration = {
  name: 'fillField',
  description: 'Fill a form field with a value. Resolves the field by ID, name, label text, placeholder, or aria-label.',
  parameters: {
    type: 'OBJECT',
    properties: {
      fieldId: {
        type: 'STRING',
        description: 'The ID, name, label, or placeholder of the field to fill.',
      },
      value: {
        type: 'STRING',
        description: 'The value to set in the field. For checkboxes use "true"/"false". For selects, use the option text.',
      },
    },
    required: ['fieldId', 'value'],
  },
};

export const clickElementTool: ToolDeclaration = {
  name: 'clickElement',
  description: 'Click an element on the page. Finds it by text content, aria-label, title, or CSS selector.',
  parameters: {
    type: 'OBJECT',
    properties: {
      description: {
        type: 'STRING',
        description: 'Description of the element to click (button text, link text, etc.).',
      },
      selector: {
        type: 'STRING',
        description: 'Optional CSS selector for precise targeting.',
      },
    },
    required: ['description'],
  },
};

export const navigateToTool: ToolDeclaration = {
  name: 'navigateTo',
  description: 'Navigate to a URL. For same-origin links only unless configured otherwise.',
  parameters: {
    type: 'OBJECT',
    properties: {
      url: {
        type: 'STRING',
        description: 'The URL to navigate to. Can be absolute or relative.',
      },
    },
    required: ['url'],
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
  navigateToTool,
  readContentTool,
  scanPageTool,
];
