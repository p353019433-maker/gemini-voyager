import { findChatInput } from '../chatInput';
import { MIN_INTERVAL_MS, USER_ACTIVITY_WINDOW_MS } from './constants';

export interface PolicyState {
  /** Per-conversation auto-reply counters. Keyed by conversation key (e.g. URL). */
  countByConversation: Map<string, number>;
  /** Last auto-reply timestamp (any conversation). */
  lastReplyAt: number;
  /** Last time the user manually triggered a send. */
  lastUserActivityAt: number;
}

export interface PolicyContext {
  enabled: boolean;
  maxPerConversation: number;
  conversationKey: string;
  now?: number;
  documentHidden?: boolean;
}

export type PolicyDecision =
  | { allow: true }
  | {
      allow: false;
      reason:
        | 'disabled'
        | 'page-hidden'
        | 'over-limit'
        | 'too-soon'
        | 'no-recent-user-activity'
        | 'input-busy';
    };

export function createPolicyState(): PolicyState {
  return {
    countByConversation: new Map(),
    lastReplyAt: 0,
    lastUserActivityAt: 0,
  };
}

/**
 * Decide whether an auto-reply may proceed right now.
 * Stateless beyond the snapshot — caller is responsible for state mutation
 * on actual send (so we can keep this pure and easy to test).
 */
export function checkPolicy(state: PolicyState, ctx: PolicyContext): PolicyDecision {
  if (!ctx.enabled) return { allow: false, reason: 'disabled' };

  if (ctx.documentHidden) return { allow: false, reason: 'page-hidden' };

  const now = ctx.now ?? Date.now();

  if (state.lastUserActivityAt === 0 || now - state.lastUserActivityAt > USER_ACTIVITY_WINDOW_MS) {
    return { allow: false, reason: 'no-recent-user-activity' };
  }

  if (now - state.lastReplyAt < MIN_INTERVAL_MS) {
    return { allow: false, reason: 'too-soon' };
  }

  const count = state.countByConversation.get(ctx.conversationKey) ?? 0;
  if (count >= ctx.maxPerConversation) {
    return { allow: false, reason: 'over-limit' };
  }

  if (isInputBusy()) return { allow: false, reason: 'input-busy' };

  return { allow: true };
}

export function recordAutoReply(state: PolicyState, conversationKey: string, now = Date.now()): void {
  state.lastReplyAt = now;
  const count = state.countByConversation.get(conversationKey) ?? 0;
  state.countByConversation.set(conversationKey, count + 1);
}

export function recordUserActivity(state: PolicyState, now = Date.now()): void {
  state.lastUserActivityAt = now;
}

export function resetCounter(state: PolicyState, conversationKey: string): void {
  state.countByConversation.delete(conversationKey);
}

/** The user is mid-typing or has draft content — never interrupt them. */
function isInputBusy(): boolean {
  try {
    const input = findChatInput({ requireVisible: false });
    if (!input) return false;
    const hasFocus = document.activeElement === input;
    const text =
      input instanceof HTMLTextAreaElement ? input.value : (input.textContent ?? '').trim();
    return hasFocus || text.length > 0;
  } catch {
    return false;
  }
}
