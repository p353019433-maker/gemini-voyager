import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_ARMED_TTL_MINUTES,
  MAX_ARMED_TTL_MINUTES,
  MIN_ARMED_TTL_MINUTES,
  MIN_INTERVAL_MS,
} from '../constants';
import {
  checkPolicy,
  createPolicyState,
  normalizeArmedTtlMinutes,
  pauseConversation,
  recordAutoReply,
  recordUserActivity,
  resetCounter,
} from '../policy';

const CONV = 'conv-1';
const OTHER_CONV = 'conv-2';
const NOW = 1_700_000_000_000;

function setupArmedState(conversationKey = CONV, armedAt = NOW) {
  const state = createPolicyState();
  recordUserActivity(state, conversationKey, armedAt);
  return state;
}

describe('checkPolicy', () => {
  beforeEach(() => {
    // Ensure jsdom document exists with empty body (no chat input → not busy)
    document.body.innerHTML = '';
  });

  it('denies when disabled', () => {
    const state = setupArmedState();
    const d = checkPolicy(state, {
      enabled: false,
      maxPerConversation: 10,
      conversationKey: CONV,
      now: NOW,
    });
    expect(d.allow).toBe(false);
    expect(d.allow === false && d.reason).toBe('disabled');
  });

  it('denies when the conversation was never armed by a manual send', () => {
    const state = createPolicyState();
    const d = checkPolicy(state, {
      enabled: true,
      maxPerConversation: 10,
      conversationKey: CONV,
      now: NOW,
    });
    expect(d.allow === false && d.reason).toBe('conversation-not-armed');
  });

  it('denies when a different conversation was armed', () => {
    const state = setupArmedState(OTHER_CONV);
    const d = checkPolicy(state, {
      enabled: true,
      maxPerConversation: 10,
      conversationKey: CONV,
      now: NOW,
    });
    expect(d.allow === false && d.reason).toBe('conversation-not-armed');
  });

  it('denies when the armed conversation authorization expired', () => {
    const state = setupArmedState(CONV, NOW);
    const d = checkPolicy(state, {
      enabled: true,
      maxPerConversation: 10,
      conversationKey: CONV,
      now: NOW + 11 * 60 * 1000,
      armedTtlMinutes: 10,
    });
    expect(d.allow === false && d.reason).toBe('armed-expired');
  });

  it('allows when the armed conversation is still inside the user-configured TTL', () => {
    const state = setupArmedState(CONV, NOW);
    const d = checkPolicy(state, {
      enabled: true,
      maxPerConversation: 10,
      conversationKey: CONV,
      now: NOW + 59 * 60 * 1000,
      armedTtlMinutes: 60,
    });
    expect(d.allow).toBe(true);
  });

  it('denies when the user paused this conversation by cancelling the countdown', () => {
    const state = setupArmedState(CONV, NOW);
    pauseConversation(state, CONV);
    const d = checkPolicy(state, {
      enabled: true,
      maxPerConversation: 10,
      conversationKey: CONV,
      now: NOW,
    });
    expect(d.allow === false && d.reason).toBe('conversation-paused');
  });

  it('manual send re-arms and unpauses the conversation', () => {
    const state = setupArmedState(CONV, NOW);
    pauseConversation(state, CONV);
    recordUserActivity(state, CONV, NOW + 1000);
    const d = checkPolicy(state, {
      enabled: true,
      maxPerConversation: 10,
      conversationKey: CONV,
      now: NOW + 1000,
    });
    expect(d.allow).toBe(true);
  });

  it('denies when a reply was sent too recently', () => {
    const state = setupArmedState(CONV, NOW);
    recordAutoReply(state, CONV, NOW);
    const d = checkPolicy(state, {
      enabled: true,
      maxPerConversation: 10,
      conversationKey: CONV,
      now: NOW + MIN_INTERVAL_MS - 1,
    });
    expect(d.allow === false && d.reason).toBe('too-soon');
  });

  it('denies when the per-conversation cap is reached', () => {
    const state = setupArmedState(CONV, NOW);
    for (let i = 0; i < 5; i++) {
      recordAutoReply(state, CONV, NOW - MIN_INTERVAL_MS * (i + 5));
    }
    const d = checkPolicy(state, {
      enabled: true,
      maxPerConversation: 5,
      conversationKey: CONV,
      now: NOW,
    });
    expect(d.allow === false && d.reason).toBe('over-limit');
  });

  it('denies when input has draft text', () => {
    document.body.innerHTML = '<div role="textbox" contenteditable="true">half-typed</div>';
    const state = setupArmedState();
    const d = checkPolicy(state, {
      enabled: true,
      maxPerConversation: 10,
      conversationKey: CONV,
      now: NOW,
    });
    expect(d.allow === false && d.reason).toBe('input-busy');
  });

  it('allows when all gates clear', () => {
    const state = setupArmedState();
    const d = checkPolicy(state, {
      enabled: true,
      maxPerConversation: 10,
      conversationKey: CONV,
      now: NOW,
    });
    expect(d.allow).toBe(true);
  });
});

describe('state helpers', () => {
  it('recordAutoReply increments per-conversation counter', () => {
    const state = createPolicyState();
    recordAutoReply(state, CONV, NOW);
    recordAutoReply(state, CONV, NOW + 1);
    expect(state.countByConversation.get(CONV)).toBe(2);
    expect(state.lastReplyAt).toBe(NOW + 1);
  });

  it('recordUserActivity arms the conversation and resets its session counter', () => {
    const state = createPolicyState();
    recordAutoReply(state, CONV, NOW);
    recordUserActivity(state, CONV, NOW + 1);
    expect(state.armedConversationKey).toBe(CONV);
    expect(state.armedAt).toBe(NOW + 1);
    expect(state.countByConversation.has(CONV)).toBe(false);
  });

  it('resetCounter clears only the named conversation', () => {
    const state = createPolicyState();
    recordAutoReply(state, 'a', NOW);
    recordAutoReply(state, 'b', NOW);
    resetCounter(state, 'a');
    expect(state.countByConversation.has('a')).toBe(false);
    expect(state.countByConversation.get('b')).toBe(1);
  });
});

describe('normalizeArmedTtlMinutes', () => {
  it('uses the default for invalid values', () => {
    expect(normalizeArmedTtlMinutes(undefined)).toBe(DEFAULT_ARMED_TTL_MINUTES);
    expect(normalizeArmedTtlMinutes('nope')).toBe(DEFAULT_ARMED_TTL_MINUTES);
  });

  it('clamps to the supported range', () => {
    expect(normalizeArmedTtlMinutes(0)).toBe(MIN_ARMED_TTL_MINUTES);
    expect(normalizeArmedTtlMinutes(MAX_ARMED_TTL_MINUTES + 1)).toBe(MAX_ARMED_TTL_MINUTES);
  });

  it('rounds numeric values', () => {
    expect(normalizeArmedTtlMinutes(42.4)).toBe(42);
    expect(normalizeArmedTtlMinutes('42.6')).toBe(43);
  });
});
