import crypto from 'crypto';
import { WebSocket } from 'ws';
import type { InternalContent } from './providers/types.js';
import type { TrackedSession } from './types.js';
import { MAX_TOOL_DEPTH, MAX_LLM_CONTEXT_ENTRIES, provider } from './config.js';
import { logSessionEvent, broadcastQueueState, waitForToolResults } from './state.js';
import { createOrUpdateProviderCache } from './caching.js';
import { sendToClient } from './utils.js';

/** Tools that return data the model needs to process (read/query tools). */
const READ_TOOLS = new Set(['scanPage', 'readContent', 'describePage', 'listLandmarks', 'readHeadings', 'getWorkflowStatus']);

/**
 * Replace large tool responses in history with compact markers.
 * Called before adding new tool results so the model's fresh results are preserved.
 */
function compactToolResponses(history: InternalContent[]): void {
  for (const entry of history) {
    if (entry.role !== 'user') continue;
    for (const part of entry.parts) {
      if (!part.functionResponse) continue;
      if (!READ_TOOLS.has(part.functionResponse.name)) continue;
      const resp = part.functionResponse.response as Record<string, unknown>;
      const result = resp?.result;
      if (typeof result === 'string' && result.length > 200) {
        resp.result = JSON.stringify({ compacted: true });
      }
    }
  }
}

export async function handleTurnStreaming(
  tracked: TrackedSession,
  turnId: string,
  signal: AbortSignal,
  depth = 0,
): Promise<void> {
  if (depth >= MAX_TOOL_DEPTH) {
    sendToClient(tracked.clientWs!, { type: 'error', message: 'Maximum tool call depth exceeded' });
    logSessionEvent(tracked, 'error', { message: 'Maximum tool call depth exceeded', depth });
    return;
  }

  if (signal.aborted) return;

  const session = tracked.session;
  if (!session) return;

  // Attempt context caching for large contexts (provider-dependent)
  await createOrUpdateProviderCache(session, tracked);

  // Always inject current page context as conversation prefix.
  // At depth 1+, session.pageContext may have been refreshed by a context.update
  // from the client after DOM changes — giving the model an up-to-date view.
  const contents: InternalContent[] = [];
  if (session.pageContext) {
    contents.push(
      { role: 'user', parts: [{ text: session.pageContext }] },
      { role: 'model', parts: [{ text: '.' }] },
    );
  }

  // Send only the last N history entries to the LLM — older turns are irrelevant
  // since pageContext already reflects the current page state.
  // Must start with a text user entry (not a functionResponse) to satisfy the
  // Gemini constraint that functionResponse must follow immediately after functionCall.
  let historySlice = session.history;
  if (historySlice.length > MAX_LLM_CONTEXT_ENTRIES) {
    let start = historySlice.length - MAX_LLM_CONTEXT_ENTRIES;
    // Find nearest user entry with text (not a tool response orphaned from its call)
    while (start < historySlice.length) {
      const entry = historySlice[start];
      if (entry.role === 'user' && entry.parts.some(p => 'text' in p)) break;
      start++;
    }
    historySlice = historySlice.slice(start);
  }
  contents.push(...historySlice);

  const usingCache = !!session.cachedContentName;

  // Log LLM turn for admin visibility
  logSessionEvent(tracked, 'llm.turn', {
    turnId,
    depth,
    cached: usingCache,
    historyEntries: session.history.length,
    pageContextChars: session.pageContext.length,
  });

  let stream: AsyncIterable<import('./providers/types.js').StreamChunk>;
  try {
    stream = await provider.generateContentStream({
      contents,
      systemInstruction: usingCache ? undefined : session.systemInstruction,
      tools: usingCache ? undefined : session.tools,
      cachedContent: session.cachedContentName || undefined,
    });
  } catch (err: any) {
    // If cache reference failed (expired/deleted), retry without cache
    if (session.cachedContentName && /cache|not found|invalid/i.test(err.message)) {
      console.warn('[voxglide] Cache reference failed, retrying without cache:', err.message);
      session.cachedContentName = null;
      session.cachedContentHash = null;
      session.cacheEligible = false;
      stream = await provider.generateContentStream({
        contents,
        systemInstruction: session.systemInstruction,
        tools: session.tools,
      });
    } else {
      throw err;
    }
  }

  let accumulatedText = '';
  const functionCalls: Array<{ id?: string; name: string; args: Record<string, unknown> }> = [];
  const allParts: any[] = [];
  let lastUsage: import('./providers/types.js').TokenUsage | null = null;

  try {
    for await (const chunk of stream) {
      // Check abort signal
      if (signal.aborted) {
        if (allParts.length > 0) {
          tracked.session?.history.push({ role: 'model', parts: allParts });
        }
        return;
      }

      // Check client still connected — always use tracked.clientWs for current reference
      if (!tracked.clientWs || tracked.clientWs.readyState !== WebSocket.OPEN) {
        if (allParts.length > 0) {
          tracked.session?.history.push({ role: 'model', parts: allParts });
        }
        return;
      }

      if (chunk.usage) lastUsage = chunk.usage;

      // rawParts go into history for faithful provider replay (preserves thought_signature, thought, etc.)
      // Parsed textDelta/functionCalls go to the client for SDK communication
      if (chunk.rawParts) {
        allParts.push(...chunk.rawParts);
      }

      if (chunk.textDelta) {
        accumulatedText += chunk.textDelta;
        sendToClient(tracked.clientWs, { type: 'response.delta', text: chunk.textDelta });
        if (!chunk.rawParts) {
          allParts.push({ text: chunk.textDelta });
        }
      }

      if (chunk.functionCalls) {
        for (const fc of chunk.functionCalls) {
          if (!chunk.rawParts) {
            allParts.push({ functionCall: { name: fc.name, args: fc.args } });
          }
          functionCalls.push(fc);
        }
      }
    }
  } catch (err: any) {
    // Save partial history on stream error
    if (allParts.length > 0) {
      tracked.session?.history.push({ role: 'model', parts: allParts });
    }
    throw err;
  }

  // Send usage — always use tracked.clientWs for current reference
  if (lastUsage && tracked.session) {
    tracked.session.lastPromptTokenCount = lastUsage.promptTokens || 0;
    tracked.session.lastOutputTokenCount = lastUsage.outputTokens || 0;
    const thinkingTokens = lastUsage.thinkingTokens || 0;
    if (tracked.clientWs) {
      sendToClient(tracked.clientWs, {
        type: 'usage',
        totalTokens: lastUsage.totalTokens || 0,
        inputTokens: lastUsage.promptTokens || 0,
        outputTokens: lastUsage.outputTokens || 0,
        cachedTokens: lastUsage.cachedTokens || 0,
        thinkingTokens,
      });
    }
    logSessionEvent(tracked, 'usage', {
      totalTokens: lastUsage.totalTokens || 0,
      inputTokens: lastUsage.promptTokens || 0,
      outputTokens: lastUsage.outputTokens || 0,
      cachedTokens: lastUsage.cachedTokens || 0,
      thinkingTokens,
      depth,
      cached: usingCache,
    });
  }

  if (functionCalls.length > 0) {
    tracked.session?.history.push({ role: 'model', parts: allParts });

    // Send tool calls to client and wait for results
    const fcs = functionCalls.map(fc => ({
      id: fc.id || crypto.randomUUID(),
      name: fc.name,
      args: fc.args || {},
    }));

    if (tracked.clientWs) {
      sendToClient(tracked.clientWs, { type: 'toolCall', functionCalls: fcs, turnId });
    }
    logSessionEvent(tracked, 'toolCall', { functionCalls: fcs, turnId, depth });

    // Update active turn status to executing-tools
    if (tracked.activeTurn?.turnId === turnId) {
      tracked.activeTurn.status = 'executing-tools';
      broadcastQueueState(tracked);
    }

    // Wait for tool results from client
    const results = await waitForToolResults(tracked, fcs.length, turnId);

    // Check abort after waiting for tool results
    if (signal.aborted) return;

    // Compact old large tool responses (e.g. scanPage) before adding new results.
    // The model already processed these — no need to re-send thousands of tokens.
    compactToolResponses(tracked.session!.history);

    // Add fresh tool results to history
    const functionResponseParts = results.map((r: any) => ({
      functionResponse: {
        name: r.name,
        response: r.response,
      },
    }));
    tracked.session?.history.push({ role: 'user', parts: functionResponseParts });

    // Decide whether to recurse. The model needs another turn when:
    // 1. depth == 0: always recurse (model may have multi-step plans)
    // 2. Any tool was a read tool (scanPage, readContent): model needs to process the data
    // 3. Any tool returned an error: model may want to retry or report
    // Otherwise, action tools succeeded — the task step is complete, no need for another LLM call.
    const toolNames = fcs.map(fc => fc.name);
    const hasReadTool = toolNames.some(n => READ_TOOLS.has(n));
    const hasError = results.some((r: any) => {
      try {
        const parsed = JSON.parse(r.response?.result || '{}');
        return !!parsed.error;
      } catch { return false; }
    });
    const needsFollowUp = depth === 0 || hasReadTool || hasError;

    if (needsFollowUp) {
      await handleTurnStreaming(tracked, turnId, signal, depth + 1);
    } else {
      logSessionEvent(tracked, 'turn.complete', { turnId, depth, tools: toolNames });
    }
  } else {
    tracked.session?.history.push({ role: 'model', parts: allParts });

    // Send final response (backward compatible — old clients see type:'response')
    if (accumulatedText && tracked.clientWs) {
      sendToClient(tracked.clientWs, { type: 'response', text: accumulatedText });
      logSessionEvent(tracked, 'response', { text: accumulatedText, turnId, depth });
    }
  }
}
