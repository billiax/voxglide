/**
 * Integration tests that exercise real multi-module flows end-to-end.
 *
 * Strategy: mock ONLY what cannot run in jsdom (WebSocket, SpeechRecognition,
 * NbtFunctionsProvider, NavigationObserver). Let ActionRouter, DOMActions,
 * ContextEngine, PageContextProvider, TextProvider, and UIManager run for real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConnectionState } from '../../src/constants';

// ── Minimal mocks for things that genuinely can't work in jsdom ──

// Capture ProxySession constructor args so we can drive callbacks manually
const proxySessionInstances: Array<{ config: any; callbacks: any; sessionId: string | null }> = [];
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn().mockResolvedValue(undefined);
const mockSendText = vi.fn();
const mockSendContextUpdate = vi.fn();
const mockSendScanResults = vi.fn();
const mockCaptureAndSendScreenshot = vi.fn();
const mockCancelTurn = vi.fn();

vi.mock('../../src/ai/ProxySession', () => {
  class MockProxySession {
    connect = mockConnect;
    disconnect = mockDisconnect;
    isConnected = vi.fn().mockReturnValue(false);
    pauseSpeech = vi.fn();
    resumeSpeech = vi.fn();
    retrySpeech = vi.fn();
    sendText = mockSendText;
    sendContextUpdate = mockSendContextUpdate;
    sendScanResults = mockSendScanResults;
    captureAndSendScreenshot = mockCaptureAndSendScreenshot;
    cancelTurn = mockCancelTurn;
    sessionId: string | null = 'integration-sid';

    constructor(public config: any, public callbacks: any) {
      proxySessionInstances.push({ config, callbacks, sessionId: this.sessionId });
    }
  }
  return { ProxySession: MockProxySession };
});

// NavigationObserver patches history.pushState which interferes with jsdom
const mockNavObserverDestroy = vi.fn();
vi.mock('../../src/NavigationObserver', () => {
  class MockNavigationObserver {
    destroy = mockNavObserverDestroy;
    constructor(public onNavigate: any, public onBeforeUnload: any) {}
  }
  return { NavigationObserver: MockNavigationObserver };
});

// NavigationHandler for static methods
vi.mock('../../src/actions/NavigationHandler', () => {
  class MockNavigationHandler {
    navigateTo = vi.fn().mockResolvedValue({ result: JSON.stringify({ success: true }) });
    setSessionId = vi.fn();
    static getPendingReconnect = vi.fn().mockReturnValue(null);
    static clearPendingReconnect = vi.fn();
    static consumePendingReconnect = vi.fn();
  }
  return { NavigationHandler: MockNavigationHandler };
});

// NbtFunctionsProvider polls window.nbt_functions with intervals
vi.mock('../../src/actions/NbtFunctionsProvider', () => {
  class MockNbtFunctionsProvider {
    sync = vi.fn().mockReturnValue(false);
    destroy = vi.fn();
    getActions = vi.fn().mockReturnValue({});
    getToolDeclarations = vi.fn().mockReturnValue([]);
    getRegisteredNames = vi.fn().mockReturnValue(new Set());
    startPolling = vi.fn();
    stopPolling = vi.fn();
    constructor(public onChange: any, public debug: any) {}
  }
  return { NbtFunctionsProvider: MockNbtFunctionsProvider };
});

// Now import the real modules (everything not mocked runs for real)
import { VoiceSDK } from '../../src/VoiceSDK';
import { ContextEngine } from '../../src/context/ContextEngine';
import { TextProvider } from '../../src/context/TextProvider';
import { ActionRouter } from '../../src/actions/ActionRouter';
import { invalidateElementCache } from '../../src/actions/DOMActions';

// ── Helpers ──

function getLastSession() {
  return proxySessionInstances[proxySessionInstances.length - 1];
}

/** Simulate server marking session as connected. */
function simulateConnected() {
  getLastSession().callbacks.onStatusChange('connected');
}

/** Build a basic DOM page with forms and headings for context scanning. */
function buildTestPage() {
  document.body.innerHTML = `
    <h1>Test Application</h1>
    <h2>Registration Form</h2>
    <form>
      <label for="firstName">First Name</label>
      <input id="firstName" name="firstName" type="text" placeholder="Enter first name" />

      <label for="lastName">Last Name</label>
      <input id="lastName" name="lastName" type="text" placeholder="Enter last name" />

      <label for="email">Email Address</label>
      <input id="email" name="email" type="email" placeholder="you@example.com" />

      <label for="country">Country</label>
      <select id="country" name="country">
        <option value="">Select...</option>
        <option value="us">United States</option>
        <option value="uk">United Kingdom</option>
        <option value="de">Germany</option>
      </select>

      <button type="submit">Register</button>
    </form>
    <main>
      <p>Welcome to our registration page. Please fill out the form above.</p>
    </main>
  `;
}

// ── Test suites ──

describe('Integration: Tool Call Flow', () => {
  let sdk: VoiceSDK;

  beforeEach(() => {
    document.body.innerHTML = '';
    invalidateElementCache();
    vi.clearAllMocks();
    proxySessionInstances.length = 0;
  });

  afterEach(async () => {
    if (sdk) await sdk.destroy();
  });

  it('fillField tool call fills a real DOM field and returns result through onToolCall', async () => {
    // Set up a real form in the DOM
    buildTestPage();

    // Create SDK with real ActionRouter + DOMActions (UI enabled, autoContext off to keep simple)
    sdk = new VoiceSDK({
      serverUrl: 'ws://localhost:3100',
      autoContext: false,
      ui: false,
      nbtFunctions: false,
      autoReconnect: false,
    });

    await sdk.start();
    simulateConnected();

    // Get the onToolCall callback that VoiceSDK wired into ProxySession
    const { callbacks } = getLastSession();

    // Simulate server sending a fillField tool call
    const result = await callbacks.onToolCall({
      id: 'tc-1',
      name: 'fillField',
      args: { fieldId: 'firstName', value: 'Alice' },
    });

    // Verify the real DOM was actually modified
    const input = document.getElementById('firstName') as HTMLInputElement;
    expect(input.value).toBe('Alice');

    // Verify the result sent back
    const parsed = JSON.parse(result.result);
    expect(parsed.success).toBe(true);
    expect(parsed.field).toBe('firstName');
    expect(parsed.value).toBe('Alice');
  });

  it('clickElement tool call clicks a real DOM button', async () => {
    buildTestPage();
    const clickSpy = vi.fn();
    document.querySelector('button')!.addEventListener('click', clickSpy);

    sdk = new VoiceSDK({
      serverUrl: 'ws://localhost:3100',
      autoContext: false,
      ui: false,
      nbtFunctions: false,
      autoReconnect: false,
    });

    await sdk.start();
    simulateConnected();

    const { callbacks } = getLastSession();
    const result = await callbacks.onToolCall({
      id: 'tc-2',
      name: 'clickElement',
      args: { description: 'Register' },
    });

    const parsed = JSON.parse(result.result);
    expect(parsed.success).toBe(true);
    expect(clickSpy).toHaveBeenCalled();
  });

  it('readContent tool call reads real DOM content', async () => {
    buildTestPage();

    sdk = new VoiceSDK({
      serverUrl: 'ws://localhost:3100',
      autoContext: false,
      ui: false,
      nbtFunctions: false,
      autoReconnect: false,
    });

    await sdk.start();
    simulateConnected();

    const { callbacks } = getLastSession();
    const result = await callbacks.onToolCall({
      id: 'tc-3',
      name: 'readContent',
      args: { selector: 'main' },
    });

    const parsed = JSON.parse(result.result);
    expect(parsed.content).toContain('Welcome to our registration page');
  });

  it('emits action:before and action events with correct data', async () => {
    buildTestPage();

    sdk = new VoiceSDK({
      serverUrl: 'ws://localhost:3100',
      autoContext: false,
      ui: false,
      nbtFunctions: false,
      autoReconnect: false,
    });

    const beforeEvents: any[] = [];
    const actionEvents: any[] = [];
    sdk.on('action:before', (e) => beforeEvents.push(e));
    sdk.on('action', (e) => actionEvents.push(e));

    await sdk.start();
    simulateConnected();

    const { callbacks } = getLastSession();
    await callbacks.onToolCall({
      id: 'tc-4',
      name: 'fillField',
      args: { fieldId: 'email', value: 'alice@test.com' },
    });

    // action:before should fire before execution
    expect(beforeEvents).toHaveLength(1);
    expect(beforeEvents[0].name).toBe('fillField');
    expect(beforeEvents[0].args).toEqual({ fieldId: 'email', value: 'alice@test.com' });

    // action should fire after execution with result
    expect(actionEvents).toHaveLength(1);
    expect(actionEvents[0].name).toBe('fillField');
    expect(actionEvents[0].result).toBeDefined();
    const parsed = JSON.parse(actionEvents[0].result.result);
    expect(parsed.success).toBe(true);
  });

  it('unknown tool call returns error through onToolCall', async () => {
    sdk = new VoiceSDK({
      serverUrl: 'ws://localhost:3100',
      autoContext: false,
      ui: false,
      nbtFunctions: false,
      autoReconnect: false,
    });

    await sdk.start();
    simulateConnected();

    const { callbacks } = getLastSession();
    const result = await callbacks.onToolCall({
      id: 'tc-unknown',
      name: 'nonExistentTool',
      args: {},
    });

    const parsed = JSON.parse(result.result);
    expect(parsed.error).toContain('Unknown action');
    expect(parsed.error).toContain('nonExistentTool');
  });
});


describe('Integration: Context Aggregation Flow', () => {
  let sdk: VoiceSDK;

  beforeEach(() => {
    document.body.innerHTML = '';
    invalidateElementCache();
    vi.clearAllMocks();
    proxySessionInstances.length = 0;
  });

  afterEach(async () => {
    if (sdk) await sdk.destroy();
  });

  it('autoContext builds page context containing page forms and headings', async () => {
    buildTestPage();

    sdk = new VoiceSDK({
      serverUrl: 'ws://localhost:3100',
      autoContext: { forms: true, headings: true, navigation: false, content: false, meta: false, interactiveElements: false },
      ui: false,
      nbtFunctions: false,
      autoReconnect: false,
    });

    await sdk.start();

    // Page context from providers goes to pageContext, not systemInstruction
    const { config } = getLastSession();
    const pageContext = config.pageContext;

    // Should contain form field IDs from the real DOM scan
    expect(pageContext).toContain('firstName');
    expect(pageContext).toContain('lastName');
    expect(pageContext).toContain('email');
    expect(pageContext).toContain('country');

    // Should contain headings from the real DOM scan
    expect(pageContext).toContain('Test Application');
    expect(pageContext).toContain('Registration Form');
  });

  it('developer context string is included in system prompt', async () => {
    buildTestPage();

    sdk = new VoiceSDK({
      serverUrl: 'ws://localhost:3100',
      autoContext: false,
      context: 'This is an internal HR tool for managing employees.',
      ui: false,
      nbtFunctions: false,
      autoReconnect: false,
    });

    await sdk.start();

    const { config } = getLastSession();
    expect(config.systemInstruction).toContain('This is an internal HR tool for managing employees.');
  });

  it('TextProvider added via setContext is included in context engine', async () => {
    sdk = new VoiceSDK({
      serverUrl: 'ws://localhost:3100',
      autoContext: false,
      ui: false,
      nbtFunctions: false,
      autoReconnect: false,
    });

    // Set context before starting
    sdk.setContext('Custom runtime context about this page.');

    // Access the context engine to verify the provider is aggregated
    const engine = (sdk as any).contextCoordinator.contextEngine as ContextEngine;
    const prompt = await engine.buildSystemPrompt();

    expect(prompt).toContain('Custom runtime context about this page.');
  });

  it('addContext provider is aggregated into system prompt', async () => {
    sdk = new VoiceSDK({
      serverUrl: 'ws://localhost:3100',
      autoContext: false,
      ui: false,
      nbtFunctions: false,
      autoReconnect: false,
    });

    sdk.addContext({
      type: 'custom',
      name: 'UserRole',
      async getContext() {
        return { content: 'Current user role: Administrator', tools: [] };
      },
    });

    const engine = (sdk as any).contextCoordinator.contextEngine as ContextEngine;
    const prompt = await engine.buildSystemPrompt();

    expect(prompt).toContain('Current user role: Administrator');
  });

  it('combined autoContext + developer context both appear in prompt', async () => {
    buildTestPage();

    sdk = new VoiceSDK({
      serverUrl: 'ws://localhost:3100',
      autoContext: { forms: true, headings: true, navigation: false, content: false, meta: false, interactiveElements: false },
      context: 'Application-specific instruction: always greet the user.',
      ui: false,
      nbtFunctions: false,
      autoReconnect: false,
    });

    await sdk.start();

    const { config } = getLastSession();

    // Form fields from auto context go to pageContext
    expect(config.pageContext).toContain('firstName');
    // Developer context goes to systemInstruction via template
    expect(config.systemInstruction).toContain('Application-specific instruction: always greet the user.');
  });
});


describe('Integration: Action to Transcript Flow', () => {
  let sdk: VoiceSDK;

  beforeEach(() => {
    document.body.innerHTML = '';
    invalidateElementCache();
    vi.clearAllMocks();
    proxySessionInstances.length = 0;
  });

  afterEach(async () => {
    if (sdk) await sdk.destroy();
  });

  it('tool call result triggers transcript event emission', async () => {
    buildTestPage();

    sdk = new VoiceSDK({
      serverUrl: 'ws://localhost:3100',
      autoContext: false,
      ui: false,
      nbtFunctions: false,
      autoReconnect: false,
    });

    const actionEvents: any[] = [];
    sdk.on('action', (e) => actionEvents.push(e));

    await sdk.start();
    simulateConnected();

    const { callbacks } = getLastSession();

    // Simulate a tool call that modifies the DOM
    await callbacks.onToolCall({
      id: 'tc-transcript-1',
      name: 'fillField',
      args: { fieldId: 'lastName', value: 'Wonderland' },
    });

    // Verify the action event includes the successful result
    expect(actionEvents).toHaveLength(1);
    const parsed = JSON.parse(actionEvents[0].result.result);
    expect(parsed.success).toBe(true);
    expect(parsed.value).toBe('Wonderland');

    // Verify the DOM actually changed
    expect((document.getElementById('lastName') as HTMLInputElement).value).toBe('Wonderland');
  });

  it('AI response triggers transcript event and passes to UI', async () => {
    sdk = new VoiceSDK({
      serverUrl: 'ws://localhost:3100',
      autoContext: false,
      // Keep UI enabled to test transcript flow
      nbtFunctions: false,
      autoReconnect: false,
    });

    const transcriptEvents: any[] = [];
    sdk.on('transcript', (e) => transcriptEvents.push(e));

    await sdk.start();
    simulateConnected();

    const { callbacks } = getLastSession();

    // Simulate AI sending a text response
    callbacks.onTranscript('I have filled the form for you.', 'ai', true);

    expect(transcriptEvents).toHaveLength(1);
    expect(transcriptEvents[0]).toEqual({
      speaker: 'ai',
      text: 'I have filled the form for you.',
      isFinal: true,
    });
  });
});


describe('Integration: Error Recovery', () => {
  let sdk: VoiceSDK;

  beforeEach(() => {
    document.body.innerHTML = '';
    invalidateElementCache();
    vi.clearAllMocks();
    proxySessionInstances.length = 0;
    mockConnect.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    if (sdk) await sdk.destroy();
  });

  it('connection error transitions to ERROR state with event', async () => {
    sdk = new VoiceSDK({
      serverUrl: 'ws://localhost:3100',
      autoContext: false,
      ui: false,
      nbtFunctions: false,
      autoReconnect: false,
    });

    mockConnect.mockRejectedValueOnce(new Error('Connection refused'));

    const errorEvents: any[] = [];
    const stateChanges: any[] = [];
    sdk.on('error', (e) => errorEvents.push(e));
    sdk.on('stateChange', (e) => stateChanges.push(e));

    await sdk.start();

    expect(sdk.getConnectionState()).toBe(ConnectionState.ERROR);
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0].message).toBe('Connection refused');

    // State transitions: DISCONNECTED -> CONNECTING -> ERROR
    expect(stateChanges).toHaveLength(2);
    expect(stateChanges[0]).toEqual({ from: 'DISCONNECTED', to: 'CONNECTING' });
    expect(stateChanges[1]).toEqual({ from: 'CONNECTING', to: 'ERROR' });
  });

  it('can reconnect after error via toggle', async () => {
    sdk = new VoiceSDK({
      serverUrl: 'ws://localhost:3100',
      autoContext: false,
      ui: false,
      nbtFunctions: false,
      autoReconnect: false,
    });

    // First attempt: fail
    mockConnect.mockRejectedValueOnce(new Error('Temporary error'));
    await sdk.start();
    expect(sdk.getConnectionState()).toBe(ConnectionState.ERROR);

    // Second attempt: succeed
    mockConnect.mockResolvedValueOnce(undefined);
    await sdk.toggle();

    // Should have created a new ProxySession
    expect(proxySessionInstances).toHaveLength(2);
    expect(sdk.getConnectionState()).toBe(ConnectionState.CONNECTING);

    // Simulate successful connection
    simulateConnected();
    expect(sdk.getConnectionState()).toBe(ConnectionState.CONNECTED);
  });

  it('server error mid-session transitions to ERROR state', async () => {
    sdk = new VoiceSDK({
      serverUrl: 'ws://localhost:3100',
      autoContext: false,
      ui: false,
      nbtFunctions: false,
      autoReconnect: false,
    });

    const errorEvents: any[] = [];
    sdk.on('error', (e) => errorEvents.push(e));

    await sdk.start();
    simulateConnected();
    expect(sdk.getConnectionState()).toBe(ConnectionState.CONNECTED);

    // Simulate server-side error
    getLastSession().callbacks.onError('Internal server error');

    expect(sdk.getConnectionState()).toBe(ConnectionState.ERROR);
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0].message).toBe('Internal server error');
  });

  it('sendText emits error when not connected', () => {
    sdk = new VoiceSDK({
      serverUrl: 'ws://localhost:3100',
      autoContext: false,
      ui: false,
      nbtFunctions: false,
      autoReconnect: false,
    });

    const errorEvents: any[] = [];
    sdk.on('error', (e) => errorEvents.push(e));

    sdk.sendText('hello');

    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0].message).toContain('Not connected');
  });

  it('state is consistent after disconnect and reconnect cycle', async () => {
    sdk = new VoiceSDK({
      serverUrl: 'ws://localhost:3100',
      autoContext: false,
      ui: false,
      nbtFunctions: false,
      autoReconnect: false,
    });

    // Connect
    await sdk.start();
    simulateConnected();
    expect(sdk.getConnectionState()).toBe(ConnectionState.CONNECTED);

    // Disconnect
    await sdk.stop();
    expect(sdk.getConnectionState()).toBe(ConnectionState.DISCONNECTED);

    // Reconnect
    await sdk.start();
    expect(sdk.getConnectionState()).toBe(ConnectionState.CONNECTING);
    simulateConnected();
    expect(sdk.getConnectionState()).toBe(ConnectionState.CONNECTED);

    // Should have two ProxySession instances (one per start call)
    expect(proxySessionInstances).toHaveLength(2);
  });
});


describe('Integration: Multiple Tool Calls in Sequence', () => {
  let sdk: VoiceSDK;

  beforeEach(() => {
    document.body.innerHTML = '';
    invalidateElementCache();
    vi.clearAllMocks();
    proxySessionInstances.length = 0;
  });

  afterEach(async () => {
    if (sdk) await sdk.destroy();
  });

  it('executes multiple fillField tool calls sequentially and all take effect', async () => {
    buildTestPage();

    sdk = new VoiceSDK({
      serverUrl: 'ws://localhost:3100',
      autoContext: false,
      ui: false,
      nbtFunctions: false,
      autoReconnect: false,
    });

    await sdk.start();
    simulateConnected();

    const { callbacks } = getLastSession();

    // Send three tool calls in sequence
    const result1 = await callbacks.onToolCall({
      id: 'tc-seq-1',
      name: 'fillField',
      args: { fieldId: 'firstName', value: 'John' },
    });

    const result2 = await callbacks.onToolCall({
      id: 'tc-seq-2',
      name: 'fillField',
      args: { fieldId: 'lastName', value: 'Doe' },
    });

    const result3 = await callbacks.onToolCall({
      id: 'tc-seq-3',
      name: 'fillField',
      args: { fieldId: 'email', value: 'john.doe@test.com' },
    });

    // All should succeed
    expect(JSON.parse(result1.result).success).toBe(true);
    expect(JSON.parse(result2.result).success).toBe(true);
    expect(JSON.parse(result3.result).success).toBe(true);

    // Verify all DOM fields were actually changed
    expect((document.getElementById('firstName') as HTMLInputElement).value).toBe('John');
    expect((document.getElementById('lastName') as HTMLInputElement).value).toBe('Doe');
    expect((document.getElementById('email') as HTMLInputElement).value).toBe('john.doe@test.com');
  });

  it('mixed tool call types execute in order and all return results', async () => {
    buildTestPage();

    const clickSpy = vi.fn();
    document.querySelector('button')!.addEventListener('click', clickSpy);

    sdk = new VoiceSDK({
      serverUrl: 'ws://localhost:3100',
      autoContext: false,
      ui: false,
      nbtFunctions: false,
      autoReconnect: false,
    });

    const actionEvents: any[] = [];
    sdk.on('action', (e) => actionEvents.push(e));

    await sdk.start();
    simulateConnected();

    const { callbacks } = getLastSession();

    // Fill a field
    const r1 = await callbacks.onToolCall({
      id: 'tc-mix-1',
      name: 'fillField',
      args: { fieldId: 'firstName', value: 'Jane' },
    });

    // Read content
    const r2 = await callbacks.onToolCall({
      id: 'tc-mix-2',
      name: 'readContent',
      args: { selector: 'main' },
    });

    // Click button
    const r3 = await callbacks.onToolCall({
      id: 'tc-mix-3',
      name: 'clickElement',
      args: { description: 'Register' },
    });

    // Verify results
    expect(JSON.parse(r1.result).success).toBe(true);
    expect(JSON.parse(r2.result).content).toContain('Welcome to our registration page');
    expect(JSON.parse(r3.result).success).toBe(true);

    // Verify side effects
    expect((document.getElementById('firstName') as HTMLInputElement).value).toBe('Jane');
    expect(clickSpy).toHaveBeenCalled();

    // All action events should have fired
    expect(actionEvents).toHaveLength(3);
    expect(actionEvents.map(e => e.name)).toEqual(['fillField', 'readContent', 'clickElement']);
  });

  it('select element tool call selects option by text', async () => {
    buildTestPage();

    sdk = new VoiceSDK({
      serverUrl: 'ws://localhost:3100',
      autoContext: false,
      ui: false,
      nbtFunctions: false,
      autoReconnect: false,
    });

    await sdk.start();
    simulateConnected();

    const { callbacks } = getLastSession();

    const result = await callbacks.onToolCall({
      id: 'tc-select-1',
      name: 'fillField',
      args: { fieldId: 'country', value: 'Germany' },
    });

    const parsed = JSON.parse(result.result);
    expect(parsed.success).toBe(true);

    const select = document.getElementById('country') as HTMLSelectElement;
    expect(select.value).toBe('de');
  });

  it('error in one tool call does not prevent subsequent calls', async () => {
    buildTestPage();

    sdk = new VoiceSDK({
      serverUrl: 'ws://localhost:3100',
      autoContext: false,
      ui: false,
      nbtFunctions: false,
      autoReconnect: false,
    });

    await sdk.start();
    simulateConnected();

    const { callbacks } = getLastSession();

    // First call: error (nonexistent field)
    const r1 = await callbacks.onToolCall({
      id: 'tc-err-1',
      name: 'fillField',
      args: { fieldId: 'nonexistent_field', value: 'foo' },
    });

    // Second call: success
    const r2 = await callbacks.onToolCall({
      id: 'tc-err-2',
      name: 'fillField',
      args: { fieldId: 'firstName', value: 'Recovery' },
    });

    // First should have error
    expect(JSON.parse(r1.result).error).toBeDefined();

    // Second should succeed despite first failing
    expect(JSON.parse(r2.result).success).toBe(true);
    expect((document.getElementById('firstName') as HTMLInputElement).value).toBe('Recovery');
  });
});


describe('Integration: Custom Actions', () => {
  let sdk: VoiceSDK;

  beforeEach(() => {
    document.body.innerHTML = '';
    invalidateElementCache();
    vi.clearAllMocks();
    proxySessionInstances.length = 0;
  });

  afterEach(async () => {
    if (sdk) await sdk.destroy();
  });

  it('custom action registered via config is callable through onToolCall', async () => {
    const customHandler = vi.fn().mockResolvedValue({ status: 'done', items: 3 });

    sdk = new VoiceSDK({
      serverUrl: 'ws://localhost:3100',
      autoContext: false,
      ui: false,
      nbtFunctions: false,
      autoReconnect: false,
      actions: {
        custom: {
          fetchInventory: {
            declaration: {
              name: 'fetchInventory',
              description: 'Fetch inventory count',
              parameters: {
                type: 'OBJECT',
                properties: {
                  warehouse: { type: 'STRING', description: 'Warehouse ID' },
                },
                required: ['warehouse'],
              },
            },
            handler: customHandler,
          },
        },
      },
    });

    await sdk.start();
    simulateConnected();

    const { callbacks } = getLastSession();
    const result = await callbacks.onToolCall({
      id: 'tc-custom-1',
      name: 'fetchInventory',
      args: { warehouse: 'WH-01' },
    });

    expect(customHandler).toHaveBeenCalledWith({ warehouse: 'WH-01' });
    const parsed = JSON.parse(result.result);
    expect(parsed.status).toBe('done');
    expect(parsed.items).toBe(3);
  });

  it('runtime-registered action is callable through onToolCall', async () => {
    sdk = new VoiceSDK({
      serverUrl: 'ws://localhost:3100',
      autoContext: false,
      ui: false,
      nbtFunctions: false,
      autoReconnect: false,
    });

    const handler = vi.fn().mockResolvedValue({ computed: 42 });
    sdk.registerAction('calculateTotal', {
      declaration: {
        name: 'calculateTotal',
        description: 'Calculate total',
        parameters: { type: 'OBJECT', properties: {}, required: [] },
      },
      handler,
    });

    await sdk.start();
    simulateConnected();

    const { callbacks } = getLastSession();
    const result = await callbacks.onToolCall({
      id: 'tc-runtime-1',
      name: 'calculateTotal',
      args: {},
    });

    expect(handler).toHaveBeenCalled();
    const parsed = JSON.parse(result.result);
    expect(parsed.computed).toBe(42);
  });

  it('removed action returns error', async () => {
    sdk = new VoiceSDK({
      serverUrl: 'ws://localhost:3100',
      autoContext: false,
      ui: false,
      nbtFunctions: false,
      autoReconnect: false,
    });

    const handler = vi.fn().mockResolvedValue('ok');
    sdk.registerAction('tempAction', {
      declaration: {
        name: 'tempAction',
        description: 'Temporary',
        parameters: { type: 'OBJECT', properties: {} },
      },
      handler,
    });

    sdk.removeAction('tempAction');

    await sdk.start();
    simulateConnected();

    const { callbacks } = getLastSession();
    const result = await callbacks.onToolCall({
      id: 'tc-removed-1',
      name: 'tempAction',
      args: {},
    });

    const parsed = JSON.parse(result.result);
    expect(parsed.error).toContain('Unknown action');
  });
});


describe('Integration: Full Form Fill Workflow', () => {
  let sdk: VoiceSDK;

  beforeEach(() => {
    document.body.innerHTML = '';
    invalidateElementCache();
    vi.clearAllMocks();
    proxySessionInstances.length = 0;
  });

  afterEach(async () => {
    if (sdk) await sdk.destroy();
  });

  it('scans page context, fills all form fields, then clicks submit', async () => {
    buildTestPage();

    sdk = new VoiceSDK({
      serverUrl: 'ws://localhost:3100',
      autoContext: { forms: true, headings: true, navigation: false, content: false, meta: false, interactiveElements: false },
      ui: false,
      nbtFunctions: false,
      autoReconnect: false,
    });

    await sdk.start();

    // Verify the page context has the form field info
    const { config, callbacks } = getLastSession();
    expect(config.pageContext).toContain('firstName');
    expect(config.pageContext).toContain('lastName');
    expect(config.pageContext).toContain('email');
    expect(config.pageContext).toContain('country');

    simulateConnected();

    // Simulate the AI filling all fields based on the context it received
    await callbacks.onToolCall({ id: 'w-1', name: 'fillField', args: { fieldId: 'firstName', value: 'Emma' } });
    await callbacks.onToolCall({ id: 'w-2', name: 'fillField', args: { fieldId: 'lastName', value: 'Watson' } });
    await callbacks.onToolCall({ id: 'w-3', name: 'fillField', args: { fieldId: 'email', value: 'emma@example.com' } });
    await callbacks.onToolCall({ id: 'w-4', name: 'fillField', args: { fieldId: 'country', value: 'United Kingdom' } });

    // Verify all fields are filled
    expect((document.getElementById('firstName') as HTMLInputElement).value).toBe('Emma');
    expect((document.getElementById('lastName') as HTMLInputElement).value).toBe('Watson');
    expect((document.getElementById('email') as HTMLInputElement).value).toBe('emma@example.com');
    expect((document.getElementById('country') as HTMLSelectElement).value).toBe('uk');

    // Click submit
    const submitSpy = vi.fn();
    document.querySelector('button')!.addEventListener('click', submitSpy);
    await callbacks.onToolCall({ id: 'w-5', name: 'clickElement', args: { description: 'Register' } });
    expect(submitSpy).toHaveBeenCalled();
  });
});


describe('Integration: State Machine Transitions', () => {
  let sdk: VoiceSDK;

  beforeEach(() => {
    document.body.innerHTML = '';
    invalidateElementCache();
    vi.clearAllMocks();
    proxySessionInstances.length = 0;
    mockConnect.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    if (sdk) await sdk.destroy();
  });

  it('full lifecycle: DISCONNECTED -> CONNECTING -> CONNECTED -> DISCONNECTED', async () => {
    sdk = new VoiceSDK({
      serverUrl: 'ws://localhost:3100',
      autoContext: false,
      ui: false,
      nbtFunctions: false,
      autoReconnect: false,
    });

    const states: string[] = [];
    sdk.on('stateChange', (e) => states.push(`${e.from}->${e.to}`));

    expect(sdk.getConnectionState()).toBe('DISCONNECTED');

    await sdk.start();
    expect(sdk.getConnectionState()).toBe('CONNECTING');

    simulateConnected();
    expect(sdk.getConnectionState()).toBe('CONNECTED');

    await sdk.stop();
    expect(sdk.getConnectionState()).toBe('DISCONNECTED');

    expect(states).toEqual([
      'DISCONNECTED->CONNECTING',
      'CONNECTING->CONNECTED',
      'CONNECTED->DISCONNECTED',
    ]);
  });

  it('destroy from connected state cleans up and reaches DISCONNECTED', async () => {
    sdk = new VoiceSDK({
      serverUrl: 'ws://localhost:3100',
      autoContext: false,
      ui: false,
      nbtFunctions: false,
      autoReconnect: false,
    });

    await sdk.start();
    simulateConnected();
    expect(sdk.getConnectionState()).toBe('CONNECTED');

    await sdk.destroy();
    expect(sdk.getConnectionState()).toBe('DISCONNECTED');
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('duplicate start calls are idempotent', async () => {
    sdk = new VoiceSDK({
      serverUrl: 'ws://localhost:3100',
      autoContext: false,
      ui: false,
      nbtFunctions: false,
      autoReconnect: false,
    });

    await sdk.start();
    await sdk.start(); // second call while CONNECTING
    await sdk.start(); // third call

    expect(proxySessionInstances).toHaveLength(1);
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it('toggle from ERROR state initiates reconnection', async () => {
    sdk = new VoiceSDK({
      serverUrl: 'ws://localhost:3100',
      autoContext: false,
      ui: false,
      nbtFunctions: false,
      autoReconnect: false,
    });

    // Force error
    mockConnect.mockRejectedValueOnce(new Error('fail'));
    await sdk.start();
    expect(sdk.getConnectionState()).toBe('ERROR');

    // Toggle should retry
    mockConnect.mockResolvedValueOnce(undefined);
    await sdk.toggle();
    expect(proxySessionInstances).toHaveLength(2);
    expect(sdk.getConnectionState()).toBe('CONNECTING');

    simulateConnected();
    expect(sdk.getConnectionState()).toBe('CONNECTED');
  });
});


describe('Integration: Context Engine with Real Providers', () => {
  it('TextProvider provides content that ContextEngine formats correctly', async () => {
    const engine = new ContextEngine();
    const provider = new TextProvider('This page helps users manage inventory.', 'App Instructions');
    engine.addProvider(provider);

    const prompt = await engine.buildSystemPrompt();

    expect(prompt).toContain('=== PAGE CONTEXT ===');
    expect(prompt).toContain('[App Instructions]');
    expect(prompt).toContain('This page helps users manage inventory.');
    expect(prompt).toContain('=== END CONTEXT ===');
  });

  it('multiple providers are aggregated in order', async () => {
    const engine = new ContextEngine();
    engine.addProvider(new TextProvider('First provider content', 'First'));
    engine.addProvider(new TextProvider('Second provider content', 'Second'));

    const prompt = await engine.buildSystemPrompt();

    const firstIdx = prompt.indexOf('[First]');
    const secondIdx = prompt.indexOf('[Second]');
    expect(firstIdx).toBeLessThan(secondIdx);
    expect(prompt).toContain('First provider content');
    expect(prompt).toContain('Second provider content');
  });

  it('buildSystemPromptAndToolsIfChanged detects content changes', async () => {
    const engine = new ContextEngine();
    const provider = new TextProvider('version 1', 'Dynamic');
    engine.addProvider(provider);

    const r1 = await engine.buildSystemPromptAndToolsIfChanged();
    expect(r1.changed).toBe(true);

    const r2 = await engine.buildSystemPromptAndToolsIfChanged();
    expect(r2.changed).toBe(false);

    provider.setText('version 2');
    const r3 = await engine.buildSystemPromptAndToolsIfChanged();
    expect(r3.changed).toBe(true);
    expect(r3.systemPrompt).toContain('version 2');
  });
});


describe('Integration: ActionRouter with Real DOMActions', () => {
  let router: ActionRouter;

  beforeEach(() => {
    document.body.innerHTML = '';
    invalidateElementCache();
    router = new ActionRouter();
  });

  it('routes fillField to real DOMActions which modifies the DOM', async () => {
    document.body.innerHTML = '<input id="test-field" type="text" />';

    const result = await router.route({
      id: 'ar-1',
      name: 'fillField',
      args: { fieldId: 'test-field', value: 'hello from router' },
    });

    expect(JSON.parse(result.result).success).toBe(true);
    expect((document.getElementById('test-field') as HTMLInputElement).value).toBe('hello from router');
  });

  it('routes clickElement to real DOMActions which clicks the element', async () => {
    document.body.innerHTML = '<button>Save Changes</button>';
    const spy = vi.fn();
    document.querySelector('button')!.addEventListener('click', spy);

    const result = await router.route({
      id: 'ar-2',
      name: 'clickElement',
      args: { description: 'Save Changes' },
    });

    expect(JSON.parse(result.result).success).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  it('routes readContent to real DOMActions which reads DOM text', async () => {
    document.body.innerHTML = '<div id="content">Important information here.</div>';

    const result = await router.route({
      id: 'ar-3',
      name: 'readContent',
      args: { selector: '#content' },
    });

    const parsed = JSON.parse(result.result);
    expect(parsed.content).toBe('Important information here.');
  });

  it('custom handler registered at runtime is routable', async () => {
    const handler = vi.fn().mockResolvedValue({ result: JSON.stringify({ custom: true }) });
    router.registerHandler('myCustomAction', handler);

    const result = await router.route({
      id: 'ar-4',
      name: 'myCustomAction',
      args: { key: 'value' },
    });

    expect(handler).toHaveBeenCalledWith({ key: 'value' });
    expect(JSON.parse(result.result).custom).toBe(true);
  });

  it('handler error is caught and returned as error result', async () => {
    router.registerHandler('buggy', async () => {
      throw new Error('Handler crashed');
    });

    const result = await router.route({
      id: 'ar-5',
      name: 'buggy',
      args: {},
    });

    const parsed = JSON.parse(result.result);
    expect(parsed.error).toBe('Handler crashed');
  });
});
