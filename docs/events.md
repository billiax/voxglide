# Events

VoxGlide emits events for connection state, transcripts, tool execution, and workflows. Use `sdk.on()` to subscribe and `sdk.off()` to unsubscribe.

## Connection

```typescript
sdk.on('connected', () => {
  // WebSocket connected to server
});

sdk.on('disconnected', () => {
  // WebSocket disconnected
});

sdk.on('stateChange', ({ from, to }) => {
  // Connection state changed (e.g., 'idle' → 'connecting' → 'active')
});
```

## Transcript

```typescript
sdk.on('transcript', ({ speaker, text, isFinal }) => {
  // speaker: 'user' | 'ai'
  // isFinal: true when speech recognition result is final
});
```

## Tool Execution

```typescript
sdk.on('action:before', ({ name, args }) => {
  // Before a tool is executed (built-in or custom)
});

sdk.on('action', ({ name, args, result }) => {
  // After a tool is executed
});
```

## Usage

```typescript
sdk.on('usage', ({ totalTokens, inputTokens, outputTokens }) => {
  // Token usage reported by the server
});
```

## Errors

```typescript
sdk.on('error', ({ message }) => {
  // Error from WebSocket, speech recognition, or tool execution
});
```

## Workflows

```typescript
sdk.on('workflow:start', (state) => { /* WorkflowState */ });
sdk.on('workflow:step', (state) => { /* WorkflowState */ });
sdk.on('workflow:complete', (state) => { /* WorkflowState */ });
sdk.on('workflow:cancel', ({ name, reason }) => {});
```

See [Workflows](./workflows.md) for details.
