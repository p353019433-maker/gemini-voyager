import { findChatInput } from '../chatInput';
import {
  DEFAULT_ARMED_TTL_MINUTES,
  MAX_ARMED_TTL_MINUTES,
  MIN_ARMED_TTL_MINUTES,
  MIN_INTERVAL_MS,
} from './constants';

export interface PolicyState {
  /** Per-armed-session auto-reply counters. Keyed by conversation key (e.g. URL). */
  countByConversation: Map<string, number>;
  /** Last auto-reply timestamp (any conversation). */
  lastReplyAt: number;
  /** Conversation that has been explicitly armed by a manual user send. */
  armedConversationKey: string | null;
  /** Timestamp when the current conversation was armed. */
  armedAt: number;
  /** Conversations paused by user cancellation until the next manual send. */
  pausedConversationKeys: Set<string>;
}

export interface PolicyContext {
  enabled: boolean;
  maxPerConversation: number;
  conversationKey: string;
  now?: number;
  /** User-configurable authorization lifetime in minutes. */
  armedTtlMinutes?: number;
}

export type PolicyDecision =
  | { allow: true }
  | {
      allow: false;
      reason:
        | 'disabled'
        | 'conversation-not-armed'
        | 'armed-expired'
        | 'conversation-paused'
        | 'over-limit'
        | 'too-soon'
        | 'input-busy';
    };

export function createPolicyState(): PolicyState {
  return {
    countByConversation: new Map(),
    lastReplyAt: 0,
    armedConversationKey: null,
    armedAt: 0,
    pausedConversationKeys: new Set(),
  };
}

/**
 * Decide whether an auto-reply may proceed right now.
 *
 * A conversation is eligible only after the user manually sends a message in
 * that same conversation. This turns auto-continue into an explicit,
 * conversation-scoped authorization instead of a short "recent activity"
 * window. The authorization expires after a user-configurable TTL.
 */
export function checkPolicy(state: PolicyState, ctx: PolicyContext): PolicyDecision {
  if (!ctx.enabled) return { allow: false, reason: 'disabled' };

  const now = ctx.now ?? Date.now();
  const armedTtlMs = normalizeArmedTtlMinutes(ctx.armedTtlMinutes) * 60 * 1000;

  if (state.armedConversationKey !== ctx.conversationKey || state.armedAt <= 0) {
    return { allow: false, reason: 'conversation-not-armed' };
  }

  if (now - state.armedAt > armedTtlMs) {
    return { allow: false, reason: 'armed-expired' };
  }

  if (state.pausedConversationKeys.has(ctx.conversationKey)) {
    return { allow: false, reason: 'conversation-paused' };
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

export function recordUserActivity(
  state: PolicyState,
  conversationKey: string,
  now = Date.now(),
): void {
  state.armedConversationKey = conversationKey;
  state.armedAt = now;
  state.pausedConversationKeys.delete(conversationKey);
  // Treat a new manual send as a new auto-continue session for this conversation.
  state.countByConversation.delete(conversationKey);
}

export function pauseConversation(state: PolicyState, conversationKey: string): void {
  state.pausedConversationKeys.add(conversationKey);
}

export function resetCounter(state: PolicyState, conversationKey: string): void {
  state.countByConversation.delete(conversationKey);
}

export function normalizeArmedTtlMinutes(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_ARMED_TTL_MINUTES;
  return Math.min(
    MAX_ARMED_TTL_MINUTES,
    Math.max(MIN_ARMED_TTL_MINUTES, Math.round(numeric)),
  );
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
