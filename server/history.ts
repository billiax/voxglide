import type { InternalContent } from './providers/types.js';
import type { Session, TrackedSession } from './types.js';
import { SUMMARIZATION_THRESHOLD, KEEP_RECENT_TURNS, provider } from './config.js';
import { logSessionEvent } from './state.js';

export function estimateTokens(history: InternalContent[]): number {
  let chars = 0;
  for (const entry of history) {
    for (const part of entry.parts || []) {
      if (part.text) chars += part.text.length;
      else chars += JSON.stringify(part).length;
    }
  }
  return Math.ceil(chars / 4);
}

export async function maybeSummarizeHistory(session: Session, tracked: TrackedSession): Promise<void> {
  // Estimate next prompt tokens
  let estimatedTokens = session.lastPromptTokenCount + session.lastOutputTokenCount;
  if (estimatedTokens === 0) {
    estimatedTokens = estimateTokens(session.history);
  }

  if (estimatedTokens < SUMMARIZATION_THRESHOLD || session.history.length <= KEEP_RECENT_TURNS) {
    return;
  }

  // Split history into old (to summarize) and recent (to keep)
  const splitPoint = session.history.length - KEEP_RECENT_TURNS;
  const oldHistory = session.history.slice(0, splitPoint);
  const recentHistory = session.history.slice(splitPoint);

  try {
    // Generate summary using a non-streaming call
    const summaryPrompt = `Summarize the following conversation concisely, preserving key facts, user preferences, and any pending context:\n\n${oldHistory.map(h => `${h.role}: ${(h.parts || []).map(p => p.text || JSON.stringify(p)).join(' ')}`).join('\n')}`;

    const response = await provider.generateContent({
      contents: [{ role: 'user', parts: [{ text: summaryPrompt }] }],
      systemInstruction: 'You are a conversation summarizer. Produce a concise summary that preserves all important context.',
    });

    const summaryText = response.text || '';

    if (summaryText) {
      session.conversationSummary = summaryText;

      const summaryEntry: InternalContent = { role: 'user', parts: [{ text: `[Previous conversation summary]: ${summaryText}` }] };
      const ackEntry: InternalContent = { role: 'model', parts: [{ text: 'Understood, I have the context from our previous conversation.' }] };

      session.history.length = 0;
      session.history.push(summaryEntry, ackEntry, ...recentHistory);

      logSessionEvent(tracked, 'history.summarized', {
        oldTurns: oldHistory.length,
        keptTurns: recentHistory.length,
        summaryLength: summaryText.length,
      });
    }
  } catch (err: any) {
    console.error('[voxglide] History summarization failed:', err.message);
    logSessionEvent(tracked, 'error', { message: `History summarization failed: ${err.message}` });

    // Fallback: truncate to last KEEP_RECENT_TURNS entries to prevent oversized history
    if (session.history.length > KEEP_RECENT_TURNS * 2) {
      const kept = session.history.slice(-KEEP_RECENT_TURNS);
      session.history.length = 0;
      session.history.push(...kept);
    }
  }
}
