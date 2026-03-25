import type { ConsoleCapture, CapturedLogEntry } from './ConsoleCapture';

export interface EvalResult {
  returnValue: string | null;
  consoleOutput: CapturedLogEntry[];
  error: string | null;
  durationMs: number;
}

const MAX_RETURN_SIZE = 8192;
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Execute arbitrary JS in the page context.
 * Uses AsyncFunction constructor so `await` works in the code.
 * Captures return value, console output during execution, and errors.
 */
export async function evaluateJS(
  code: string,
  consoleCapture: ConsoleCapture,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<EvalResult> {
  const cursor = consoleCapture.snapshot();
  const start = performance.now();

  let returnValue: string | null = null;
  let error: string | null = null;

  try {
    // AsyncFunction = Object.getPrototypeOf(async function(){}).constructor
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction(code) as () => Promise<unknown>;

    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Execution timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);

    if (result !== undefined && result !== null) {
      try {
        const serialized = JSON.stringify(result, null, 2);
        returnValue = serialized.length > MAX_RETURN_SIZE
          ? serialized.slice(0, MAX_RETURN_SIZE) + '\n... (truncated)'
          : serialized;
      } catch {
        returnValue = String(result);
      }
    }
  } catch (err: any) {
    error = err.stack || err.message || String(err);
  }

  return {
    returnValue,
    consoleOutput: consoleCapture.getEntriesSince(cursor),
    error,
    durationMs: Math.round(performance.now() - start),
  };
}
