import type { ToolDeclaration } from '../types';

export const startWorkflowTool: ToolDeclaration = {
  name: 'startWorkflow',
  description: 'Start a named conversation workflow. Use this to begin a guided multi-step interaction.',
  parameters: {
    type: 'OBJECT',
    properties: {
      name: {
        type: 'STRING',
        description: 'The name of the workflow to start.',
      },
    },
    required: ['name'],
  },
};

export const workflowStepCompleteTool: ToolDeclaration = {
  name: 'workflowStepComplete',
  description: 'Mark the current workflow step as complete. Optionally store a collected field value.',
  parameters: {
    type: 'OBJECT',
    properties: {
      field: {
        type: 'STRING',
        description: 'The field name to store the collected value under.',
      },
      value: {
        type: 'STRING',
        description: 'The value collected from the user for this step.',
      },
    },
    required: [],
  },
};

export const cancelWorkflowTool: ToolDeclaration = {
  name: 'cancelWorkflow',
  description: 'Cancel the currently active workflow.',
  parameters: {
    type: 'OBJECT',
    properties: {
      reason: {
        type: 'STRING',
        description: 'Why the workflow is being cancelled.',
      },
    },
    required: [],
  },
};

export const getWorkflowStatusTool: ToolDeclaration = {
  name: 'getWorkflowStatus',
  description: 'Get the current workflow status including active workflow name, step number, and collected data.',
  parameters: {
    type: 'OBJECT',
    properties: {},
    required: [],
  },
};

export const workflowTools: ToolDeclaration[] = [
  startWorkflowTool,
  workflowStepCompleteTool,
  cancelWorkflowTool,
  getWorkflowStatusTool,
];
