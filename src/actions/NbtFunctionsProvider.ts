import type { CustomAction, ToolDeclaration, NbtFunctionDef } from '../types';

/**
 * Auto-discovers window.nbt_functions and converts them to VoiceSDK-compatible
 * tool declarations and action handlers. Polls for changes and notifies via callback.
 */
export class NbtFunctionsProvider {
  private actions: Record<string, CustomAction> = {};
  private toolDeclarations: ToolDeclaration[] = [];
  private registeredNames = new Set<string>();
  private snapshot = ''; // fingerprint for diffing
  private onChange: (added: string[], removed: string[]) => void;
  private debug: boolean;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private eventHandler: (() => void) | null = null;

  constructor(onChange: (added: string[], removed: string[]) => void, debug?: boolean) {
    this.onChange = onChange;
    this.debug = debug ?? false;

    // Initial discovery
    this.sync();

    // Poll every 2 seconds (lightweight fingerprint check)
    this.pollInterval = setInterval(() => this.sync(), 2000);

    // Listen for instant notification
    this.eventHandler = () => this.sync();
    window.addEventListener('voxglide:functions-changed', this.eventHandler);
  }

  /**
   * Re-scan window.nbt_functions. Returns true if the set changed.
   */
  sync(): boolean {
    const funcs = window.nbt_functions;
    const newFingerprint = this.buildFingerprint(funcs);

    if (newFingerprint === this.snapshot) {
      return false;
    }

    const previousNames = this.registeredNames;
    const currentNames = new Set<string>();
    const newActions: Record<string, CustomAction> = {};
    const newToolDeclarations: ToolDeclaration[] = [];

    if (funcs && typeof funcs === 'object') {
      for (const [name, def] of Object.entries(funcs)) {
        if (!this.validateDef(name, def)) continue;

        currentNames.add(name);
        newToolDeclarations.push(this.convertToToolDeclaration(name, def));
        newActions[name] = {
          declaration: newToolDeclarations[newToolDeclarations.length - 1],
          handler: this.wrapHandler(name, def.handler),
        };
      }
    }

    // Compute diff
    const added = [...currentNames].filter((n) => !previousNames.has(n));
    const removed = [...previousNames].filter((n) => !currentNames.has(n));

    this.actions = newActions;
    this.toolDeclarations = newToolDeclarations;
    this.registeredNames = currentNames;
    this.snapshot = newFingerprint;

    if (this.debug) {
      console.log('[VoiceSDK:nbt] Synced nbt_functions:', {
        total: currentNames.size,
        added,
        removed,
      });
    }

    if (added.length > 0 || removed.length > 0) {
      this.onChange(added, removed);
    }

    return true;
  }

  /** Current actions for ActionRouter */
  getActions(): Record<string, CustomAction> {
    return { ...this.actions };
  }

  /** Current tool schemas for Gemini */
  getToolDeclarations(): ToolDeclaration[] {
    return [...this.toolDeclarations];
  }

  /** Currently known function names */
  getRegisteredNames(): Set<string> {
    return new Set(this.registeredNames);
  }

  /** Cleanup interval + event listener */
  destroy(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.eventHandler) {
      window.removeEventListener('voxglide:functions-changed', this.eventHandler);
      this.eventHandler = null;
    }
  }

  /**
   * Build a lightweight fingerprint from function names + descriptions.
   * Used to detect changes without deep-comparing handlers.
   */
  private buildFingerprint(funcs: Record<string, NbtFunctionDef> | undefined): string {
    if (!funcs || typeof funcs !== 'object') return '';

    const parts: string[] = [];
    for (const [name, def] of Object.entries(funcs)) {
      if (def && typeof def === 'object' && typeof def.handler === 'function') {
        parts.push(`${name}:${def.description || ''}`);
      }
    }
    return parts.sort().join('|');
  }

  /**
   * Validate a function definition. Must have description (string) and handler (function).
   */
  private validateDef(name: string, def: unknown): def is NbtFunctionDef {
    if (!def || typeof def !== 'object') {
      if (this.debug) console.warn(`[VoiceSDK:nbt] Skipping "${name}": not an object`);
      return false;
    }
    const d = def as Record<string, unknown>;
    if (typeof d.description !== 'string' || !d.description.trim()) {
      if (this.debug) console.warn(`[VoiceSDK:nbt] Skipping "${name}": missing or empty description`);
      return false;
    }
    if (typeof d.handler !== 'function') {
      if (this.debug) console.warn(`[VoiceSDK:nbt] Skipping "${name}": handler is not a function`);
      return false;
    }
    return true;
  }

  /**
   * Convert flat NbtFunctionDef → Gemini ToolDeclaration.
   */
  private convertToToolDeclaration(name: string, def: NbtFunctionDef): ToolDeclaration {
    const properties: Record<string, { type: string; description: string; enum?: string[] }> = {};
    const required: string[] = [];

    if (def.parameters) {
      for (const [paramName, param] of Object.entries(def.parameters)) {
        const prop: { type: string; description: string; enum?: string[] } = {
          type: param.type.toUpperCase(),
          description: param.description,
        };
        if (param.enum) {
          prop.enum = param.enum;
        }
        properties[paramName] = prop;
        if (param.required) {
          required.push(paramName);
        }
      }
    }

    return {
      name,
      description: def.description,
      parameters: {
        type: 'OBJECT',
        properties,
        ...(required.length > 0 ? { required } : {}),
      },
    };
  }

  /**
   * Wrap a developer handler to normalize return values to { result: string }.
   */
  private wrapHandler(name: string, handler: NbtFunctionDef['handler']): CustomAction['handler'] {
    return async (args: Record<string, unknown>) => {
      try {
        const result = await handler(args);
        if (typeof result === 'string') return result;
        return JSON.stringify(result ?? { success: true });
      } catch (err: any) {
        if (this.debug) {
          console.error(`[VoiceSDK:nbt] Error in handler "${name}":`, err);
        }
        return JSON.stringify({ error: err.message || 'Handler failed' });
      }
    };
  }
}
