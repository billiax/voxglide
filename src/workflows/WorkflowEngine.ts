import type { WorkflowDefinition, WorkflowState } from '../types';

export type WorkflowEventCallback = (
  event: 'start' | 'step' | 'complete' | 'cancel',
  data: WorkflowState | { name: string; reason: string },
) => void;

/**
 * State machine managing workflow lifecycle.
 * Tracks the active workflow, current step, and collected data.
 */
export class WorkflowEngine {
  private definitions: Map<string, WorkflowDefinition>;
  private activeWorkflow: string | null = null;
  private currentStep = 0;
  private collectedData: Record<string, string> = {};
  private onEvent: WorkflowEventCallback;

  constructor(definitions: WorkflowDefinition[], onEvent: WorkflowEventCallback) {
    this.definitions = new Map(definitions.map((d) => [d.name, d]));
    this.onEvent = onEvent;
  }

  startWorkflow(name: string): { success: boolean; error?: string } {
    const def = this.definitions.get(name);
    if (!def) return { success: false, error: `Unknown workflow: "${name}"` };
    if (this.activeWorkflow) {
      this.cancelWorkflow('Replaced by new workflow');
    }

    this.activeWorkflow = name;
    this.currentStep = 0;
    this.collectedData = {};

    this.onEvent('start', this.getState());
    return { success: true };
  }

  advanceStep(field?: string, value?: string): { success: boolean; error?: string } {
    if (!this.activeWorkflow) return { success: false, error: 'No active workflow' };
    const def = this.definitions.get(this.activeWorkflow)!;

    const step = def.steps[this.currentStep];
    const dataField = field ?? step?.field;

    // Store collected data
    if (dataField && value !== undefined) {
      // Run validation if defined
      if (step?.validate) {
        const result = step.validate(value);
        if (result !== true) {
          return { success: false, error: typeof result === 'string' ? result : 'Validation failed' };
        }
      }
      this.collectedData[dataField] = value;
    }

    this.currentStep++;

    if (this.currentStep >= def.steps.length) {
      return this.completeWorkflow();
    }

    this.onEvent('step', this.getState());
    return { success: true };
  }

  completeWorkflow(): { success: boolean } {
    if (!this.activeWorkflow) return { success: false };
    const def = this.definitions.get(this.activeWorkflow)!;

    const state = this.getState();
    this.onEvent('complete', state);

    // Call onComplete callback
    if (def.onComplete) {
      try {
        def.onComplete({ ...this.collectedData });
      } catch {
        // swallow callback errors
      }
    }

    this.activeWorkflow = null;
    this.currentStep = 0;
    this.collectedData = {};

    return { success: true };
  }

  cancelWorkflow(reason: string): void {
    if (!this.activeWorkflow) return;
    const name = this.activeWorkflow;

    this.onEvent('cancel', { name, reason });

    this.activeWorkflow = null;
    this.currentStep = 0;
    this.collectedData = {};
  }

  getState(): WorkflowState {
    const def = this.activeWorkflow ? this.definitions.get(this.activeWorkflow) : null;
    return {
      name: this.activeWorkflow ?? '',
      currentStep: this.currentStep,
      totalSteps: def?.steps.length ?? 0,
      collectedData: { ...this.collectedData },
    };
  }

  isActive(): boolean {
    return this.activeWorkflow !== null;
  }

  getActiveWorkflowName(): string | null {
    return this.activeWorkflow;
  }

  /**
   * Generate context prompt describing available workflows and current state.
   */
  getContextPrompt(): string {
    const parts: string[] = [];

    parts.push('WORKFLOWS:');
    for (const [name, def] of this.definitions) {
      const trigger = def.trigger ? ` (trigger: "${def.trigger}")` : '';
      parts.push(`- ${name}${trigger}: ${def.steps.length} steps`);
    }

    if (this.activeWorkflow) {
      const def = this.definitions.get(this.activeWorkflow)!;
      const step = def.steps[this.currentStep];
      parts.push('');
      parts.push(`ACTIVE WORKFLOW: "${this.activeWorkflow}" — step ${this.currentStep + 1}/${def.steps.length}`);
      if (step) {
        parts.push(`Current step instruction: ${step.instruction}`);
        if (step.field) parts.push(`Collect field: "${step.field}"`);
      }
      if (Object.keys(this.collectedData).length > 0) {
        parts.push(`Collected data: ${JSON.stringify(this.collectedData)}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Find a workflow by trigger phrase.
   */
  findByTrigger(text: string): WorkflowDefinition | null {
    const lower = text.toLowerCase();
    for (const def of this.definitions.values()) {
      if (def.trigger && lower.includes(def.trigger.toLowerCase())) {
        return def;
      }
    }
    return null;
  }
}
