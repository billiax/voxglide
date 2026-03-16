# Conversation Workflows

Workflows guide the AI through multi-step conversations — collecting data, validating input, and calling back when complete. Useful for onboarding flows, form wizards, surveys, or any structured interaction.

## Basic Example

```typescript
const sdk = new VoiceSDK({
  serverUrl: 'wss://your-server.com',
  workflows: [{
    name: 'onboarding',
    trigger: 'get started',
    steps: [
      { instruction: 'Ask for the user\'s name', field: 'name' },
      {
        instruction: 'Ask for their email',
        field: 'email',
        validate: (v) => v.includes('@') || 'Invalid email',
      },
      { instruction: 'Ask which plan they want (free/pro)', field: 'plan' },
    ],
    onComplete: (data) => {
      console.log('Onboarding complete:', data);
      // { name: 'Alice', email: 'alice@example.com', plan: 'pro' }
    },
  }],
});
```

## How It Works

1. The AI sees available workflows in its system prompt
2. A workflow starts when the user says something matching the `trigger` phrase, or the AI calls the `startWorkflow` tool
3. Each step gives the AI an `instruction` — what to ask or do
4. If `field` is set, the AI collects the user's answer into that field
5. If `validate` is set, the value is checked before advancing
6. On completion, `onComplete` fires with all collected data

## Workflow Events

```typescript
sdk.on('workflow:start', (state) => {
  console.log('Started:', state.name);
});

sdk.on('workflow:step', (state) => {
  console.log(`Step ${state.currentStep}/${state.totalSteps}`);
});

sdk.on('workflow:complete', (state) => {
  console.log('Done:', state.collectedData);
});

sdk.on('workflow:cancel', ({ name, reason }) => {
  console.log('Cancelled:', name, reason);
});
```

## WorkflowState

The state object passed to events and `getWorkflowState()`:

```typescript
interface WorkflowState {
  name: string;
  currentStep: number;
  totalSteps: number;
  collectedData: Record<string, string>;
}
```

## AI Tools

When workflows are enabled, the AI gets 4 additional tools:

| Tool | Description |
|------|-------------|
| `startWorkflow` | Start a named workflow |
| `workflowStepComplete` | Advance to next step, optionally storing a field value |
| `cancelWorkflow` | Cancel the active workflow |
| `getWorkflowStatus` | Get current workflow state |

## Step Definition

```typescript
interface WorkflowStep {
  instruction: string;   // What the AI should do at this step
  field?: string;        // Key to store the collected value under
  validate?: (value: string) => boolean | string;
  // Return true to accept, or an error string to reject
}
```
