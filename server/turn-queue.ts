import type { TrackedSession } from './types.js';
import { broadcastQueueState, logSessionEvent } from './state.js';
import { maybeSummarizeHistory } from './history.js';
import { handleTurnStreaming } from './llm.js';
import { sendToClient } from './utils.js';

// ── Turn Queue: serial execution of LLM turns per session ──

export async function processTurnQueue(tracked: TrackedSession): Promise<void> {
  tracked.turnProcessing = true;
  while (tracked.turnQueue.length > 0) {
    const queuedTurn = tracked.turnQueue[0];
    queuedTurn.status = 'processing';
    const abortController = new AbortController();
    queuedTurn.abortController = abortController;
    tracked.activeTurn = queuedTurn;
    broadcastQueueState(tracked);

    try {
      await maybeSummarizeHistory(tracked.session!, tracked);
      await handleTurnStreaming(tracked, queuedTurn.turnId, abortController.signal);
    } catch (err: any) {
      if (!abortController.signal.aborted) {
        sendToClient(tracked.clientWs!, { type: 'error', message: err.message });
        logSessionEvent(tracked, 'error', { message: `Turn queue error: ${err.message}` });
      }
    } finally {
      tracked.activeTurn = null;
      tracked.turnQueue.shift();
      broadcastQueueState(tracked);
    }
  }
  tracked.turnProcessing = false;
}

// ── Turn Cancel ──

export function handleTurnCancel(tracked: TrackedSession, msg: any): void {
  const targetTurnId = msg.turnId;
  if (!targetTurnId) return;

  // Cancel active turn
  const activeTurn = tracked.activeTurn;
  if (activeTurn && activeTurn.turnId === targetTurnId) {
    activeTurn.abortController?.abort();
    logSessionEvent(tracked, 'turn.cancelled', { turnId: targetTurnId, wasActive: true });
    // The aborted stream throws, processTurnQueue catches and moves to next turn
    return;
  }

  // Cancel queued turn
  const queueIndex = tracked.turnQueue.findIndex(t => t.turnId === targetTurnId);
  if (queueIndex >= 0) {
    const cancelled = tracked.turnQueue[queueIndex];

    // Remove the corresponding history entry
    if (tracked.session && cancelled.historyIndex < tracked.session.history.length) {
      tracked.session.history.splice(cancelled.historyIndex, 1);
      // Adjust historyIndex for subsequent turns
      for (let i = queueIndex + 1; i < tracked.turnQueue.length; i++) {
        if (tracked.turnQueue[i].historyIndex > cancelled.historyIndex) {
          tracked.turnQueue[i].historyIndex--;
        }
      }
    }

    tracked.turnQueue.splice(queueIndex, 1);
    logSessionEvent(tracked, 'turn.cancelled', { turnId: targetTurnId, wasActive: false });
    broadcastQueueState(tracked);
  }
  // Not found — stale cancel, no-op
}
