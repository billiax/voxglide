import type { ToolDeclaration } from '../types';

export const describePageTool: ToolDeclaration = {
  name: 'describePage',
  description: 'Provide an ARIA-aware description of the current page: landmarks, element counts, forms, and heading structure.',
  parameters: {
    type: 'OBJECT',
    properties: {},
    required: [],
  },
};

export const focusElementTool: ToolDeclaration = {
  name: 'focusElement',
  description: 'Move keyboard focus to an element by index number, CSS selector, or description.',
  parameters: {
    type: 'OBJECT',
    properties: {
      index: { type: 'INTEGER', description: 'Element index from page context.' },
      selector: { type: 'STRING', description: 'CSS selector of element to focus.' },
      description: { type: 'STRING', description: 'Text description of element to focus.' },
    },
    required: [],
  },
};

export const listLandmarksTool: ToolDeclaration = {
  name: 'listLandmarks',
  description: 'List ARIA landmarks on the page with their name, role, and content summary.',
  parameters: {
    type: 'OBJECT',
    properties: {},
    required: [],
  },
};

export const readHeadingsTool: ToolDeclaration = {
  name: 'readHeadings',
  description: 'Read the page heading structure as a tree with level indicators.',
  parameters: {
    type: 'OBJECT',
    properties: {},
    required: [],
  },
};

export const nextFormFieldTool: ToolDeclaration = {
  name: 'nextFormField',
  description: 'Move focus to the next form field in sequential order.',
  parameters: {
    type: 'OBJECT',
    properties: {},
    required: [],
  },
};

export const prevFormFieldTool: ToolDeclaration = {
  name: 'prevFormField',
  description: 'Move focus to the previous form field in sequential order.',
  parameters: {
    type: 'OBJECT',
    properties: {},
    required: [],
  },
};

export const a11yTools: ToolDeclaration[] = [
  describePageTool,
  focusElementTool,
  listLandmarksTool,
  readHeadingsTool,
  nextFormFieldTool,
  prevFormFieldTool,
];
