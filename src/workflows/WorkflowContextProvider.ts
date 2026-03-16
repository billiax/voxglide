import type { ContextProvider, ContextResult, ToolDeclaration } from '../types';
import type { WorkflowEngine } from './WorkflowEngine';
import { workflowTools } from './workflow-tools';

/**
 * Injects workflow context and tools into the ContextEngine pipeline.
 */
export class WorkflowContextProvider implements ContextProvider {
  type = 'workflow';
  name = 'Workflows';

  private engine: WorkflowEngine;

  constructor(engine: WorkflowEngine) {
    this.engine = engine;
  }

  async getContext(): Promise<ContextResult> {
    const content = this.engine.getContextPrompt();
    const tools: ToolDeclaration[] = [...workflowTools];
    return { content, tools };
  }
}
