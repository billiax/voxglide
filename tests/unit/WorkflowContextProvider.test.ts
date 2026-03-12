import { describe, it, expect, vi } from 'vitest';
import { WorkflowContextProvider } from '../../src/workflows/WorkflowContextProvider';
import { WorkflowEngine } from '../../src/workflows/WorkflowEngine';
import type { WorkflowDefinition } from '../../src/types';

function createEngine(defs?: WorkflowDefinition[]): WorkflowEngine {
  return new WorkflowEngine(defs ?? [
    {
      name: 'signup',
      steps: [
        { instruction: 'Ask for name', field: 'name' },
        { instruction: 'Ask for email', field: 'email' },
      ],
    },
  ], vi.fn());
}

describe('WorkflowContextProvider', () => {
  it('has correct type and name', () => {
    const provider = new WorkflowContextProvider(createEngine());
    expect(provider.type).toBe('workflow');
    expect(provider.name).toBe('Workflows');
  });

  it('returns workflow context content', async () => {
    const provider = new WorkflowContextProvider(createEngine());
    const result = await provider.getContext();
    expect(result.content).toContain('WORKFLOWS:');
    expect(result.content).toContain('signup');
  });

  it('returns workflow tools', async () => {
    const provider = new WorkflowContextProvider(createEngine());
    const result = await provider.getContext();
    expect(result.tools.length).toBe(4);
    const names = result.tools.map(t => t.name);
    expect(names).toContain('startWorkflow');
    expect(names).toContain('workflowStepComplete');
    expect(names).toContain('cancelWorkflow');
    expect(names).toContain('getWorkflowStatus');
  });

  it('includes active workflow state in context', async () => {
    const engine = createEngine();
    engine.startWorkflow('signup');
    engine.advanceStep('name', 'Alice');

    const provider = new WorkflowContextProvider(engine);
    const result = await provider.getContext();
    expect(result.content).toContain('ACTIVE WORKFLOW: "signup"');
    expect(result.content).toContain('step 2/2');
  });

  it('works with no workflows defined', async () => {
    const engine = createEngine([]);
    const provider = new WorkflowContextProvider(engine);
    const result = await provider.getContext();
    expect(result.content).toContain('WORKFLOWS:');
    expect(result.tools.length).toBe(4);
  });
});
