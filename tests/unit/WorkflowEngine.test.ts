import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowEngine } from '../../src/workflows/WorkflowEngine';
import type { WorkflowDefinition } from '../../src/types';

function createDefinitions(): WorkflowDefinition[] {
  return [
    {
      name: 'onboarding',
      trigger: 'get started',
      steps: [
        { instruction: 'Ask for name', field: 'name' },
        { instruction: 'Ask for email', field: 'email' },
        { instruction: 'Confirm details' },
      ],
    },
    {
      name: 'feedback',
      steps: [
        { instruction: 'Ask for rating', field: 'rating', validate: (v) => /^[1-5]$/.test(v) || 'Rating must be 1-5' },
        { instruction: 'Ask for comment', field: 'comment' },
      ],
    },
  ];
}

describe('WorkflowEngine', () => {
  let engine: WorkflowEngine;
  let eventSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    eventSpy = vi.fn();
    engine = new WorkflowEngine(createDefinitions(), eventSpy);
  });

  describe('startWorkflow', () => {
    it('starts a defined workflow', () => {
      const result = engine.startWorkflow('onboarding');
      expect(result.success).toBe(true);
      expect(engine.isActive()).toBe(true);
      expect(engine.getActiveWorkflowName()).toBe('onboarding');
    });

    it('returns error for unknown workflow', () => {
      const result = engine.startWorkflow('unknown');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown workflow');
    });

    it('emits start event', () => {
      engine.startWorkflow('onboarding');
      expect(eventSpy).toHaveBeenCalledWith('start', expect.objectContaining({
        name: 'onboarding',
        currentStep: 0,
        totalSteps: 3,
      }));
    });

    it('cancels previous workflow when starting new one', () => {
      engine.startWorkflow('onboarding');
      engine.startWorkflow('feedback');
      expect(engine.getActiveWorkflowName()).toBe('feedback');
      expect(eventSpy).toHaveBeenCalledWith('cancel', {
        name: 'onboarding',
        reason: 'Replaced by new workflow',
      });
    });
  });

  describe('advanceStep', () => {
    it('advances step and stores data', () => {
      engine.startWorkflow('onboarding');
      const result = engine.advanceStep('name', 'Alice');
      expect(result.success).toBe(true);

      const state = engine.getState();
      expect(state.currentStep).toBe(1);
      expect(state.collectedData).toEqual({ name: 'Alice' });
    });

    it('uses step field if no field provided', () => {
      engine.startWorkflow('onboarding');
      engine.advanceStep(undefined, 'Alice');
      expect(engine.getState().collectedData).toEqual({ name: 'Alice' });
    });

    it('emits step event', () => {
      engine.startWorkflow('onboarding');
      eventSpy.mockClear();
      engine.advanceStep('name', 'Alice');
      expect(eventSpy).toHaveBeenCalledWith('step', expect.objectContaining({
        currentStep: 1,
      }));
    });

    it('returns error when no active workflow', () => {
      const result = engine.advanceStep('name', 'Alice');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No active workflow');
    });

    it('validates values when validate function exists', () => {
      engine.startWorkflow('feedback');
      const result = engine.advanceStep('rating', '7');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Rating must be 1-5');
    });

    it('allows valid values to pass validation', () => {
      engine.startWorkflow('feedback');
      const result = engine.advanceStep('rating', '3');
      expect(result.success).toBe(true);
    });

    it('completes workflow when last step advanced', () => {
      engine.startWorkflow('onboarding');
      engine.advanceStep('name', 'Alice');
      engine.advanceStep('email', 'alice@example.com');
      engine.advanceStep();

      expect(engine.isActive()).toBe(false);
      expect(eventSpy).toHaveBeenCalledWith('complete', expect.objectContaining({
        name: 'onboarding',
      }));
    });
  });

  describe('completeWorkflow', () => {
    it('calls onComplete callback with collected data', () => {
      const onComplete = vi.fn();
      const defs: WorkflowDefinition[] = [{
        name: 'test',
        steps: [{ instruction: 'step', field: 'val' }],
        onComplete,
      }];
      const eng = new WorkflowEngine(defs, vi.fn());
      eng.startWorkflow('test');
      eng.advanceStep('val', 'hello');
      expect(onComplete).toHaveBeenCalledWith({ val: 'hello' });
    });

    it('does not throw if onComplete throws', () => {
      const defs: WorkflowDefinition[] = [{
        name: 'test',
        steps: [{ instruction: 'step' }],
        onComplete: () => { throw new Error('boom'); },
      }];
      const eng = new WorkflowEngine(defs, vi.fn());
      eng.startWorkflow('test');
      expect(() => eng.advanceStep()).not.toThrow();
    });

    it('returns false when no active workflow', () => {
      expect(engine.completeWorkflow().success).toBe(false);
    });
  });

  describe('cancelWorkflow', () => {
    it('cancels active workflow and emits event', () => {
      engine.startWorkflow('onboarding');
      eventSpy.mockClear();
      engine.cancelWorkflow('User changed mind');
      expect(engine.isActive()).toBe(false);
      expect(eventSpy).toHaveBeenCalledWith('cancel', {
        name: 'onboarding',
        reason: 'User changed mind',
      });
    });

    it('no-ops when no active workflow', () => {
      engine.cancelWorkflow('Nothing to cancel');
      expect(eventSpy).not.toHaveBeenCalled();
    });

    it('resets collected data', () => {
      engine.startWorkflow('onboarding');
      engine.advanceStep('name', 'Alice');
      engine.cancelWorkflow('Reset');
      expect(engine.getState().collectedData).toEqual({});
    });
  });

  describe('getState', () => {
    it('returns empty state when no workflow active', () => {
      const state = engine.getState();
      expect(state.name).toBe('');
      expect(state.currentStep).toBe(0);
      expect(state.totalSteps).toBe(0);
      expect(state.collectedData).toEqual({});
    });

    it('returns active workflow state', () => {
      engine.startWorkflow('onboarding');
      engine.advanceStep('name', 'Bob');
      const state = engine.getState();
      expect(state.name).toBe('onboarding');
      expect(state.currentStep).toBe(1);
      expect(state.totalSteps).toBe(3);
      expect(state.collectedData).toEqual({ name: 'Bob' });
    });

    it('returns a copy of collected data', () => {
      engine.startWorkflow('onboarding');
      engine.advanceStep('name', 'Alice');
      const state1 = engine.getState();
      state1.collectedData.name = 'mutated';
      expect(engine.getState().collectedData.name).toBe('Alice');
    });
  });

  describe('getContextPrompt', () => {
    it('lists available workflows', () => {
      const prompt = engine.getContextPrompt();
      expect(prompt).toContain('onboarding');
      expect(prompt).toContain('feedback');
      expect(prompt).toContain('trigger: "get started"');
    });

    it('includes active workflow details', () => {
      engine.startWorkflow('onboarding');
      engine.advanceStep('name', 'Alice');
      const prompt = engine.getContextPrompt();
      expect(prompt).toContain('ACTIVE WORKFLOW: "onboarding"');
      expect(prompt).toContain('step 2/3');
      expect(prompt).toContain('Ask for email');
      expect(prompt).toContain('"name"');
    });
  });

  describe('findByTrigger', () => {
    it('finds workflow by trigger phrase', () => {
      const def = engine.findByTrigger("I'd like to get started");
      expect(def?.name).toBe('onboarding');
    });

    it('is case insensitive', () => {
      const def = engine.findByTrigger('GET STARTED please');
      expect(def?.name).toBe('onboarding');
    });

    it('returns null when no match', () => {
      expect(engine.findByTrigger('random text')).toBeNull();
    });
  });
});
