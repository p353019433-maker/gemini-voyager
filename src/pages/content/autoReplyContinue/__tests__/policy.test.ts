import { beforeEach, describe, expect, it } from 'vitest';

import { MIN_INTERVAL_MS, USER_ACTIVITY_WINDOW_MS } from '../constants';
import {
  checkPolicy,
  createPolicyState,
  recordAutoReply,
  recordUserActivity,
  resetCounter,
} from '../policy';

const CONV = 'conv-1';
const NOW = 1_700_000_000_000;

function setupActiveState() {
  const state = createPolicyState();
  recordUserActivity(state, NOW);
  return state;
}

describe('checkPolicy', () => {
  beforeEach(() => {
    // Ensure jsdom document exists with empty body (no chat input → not busy)
    document.body.innerHTML = '';
  });

  it('denies when disabled', () => {
    const state = setupActiveState();
    const d = checkPolicy(state, {
      enabled: false,
      maxPerConversation: 10,
      conversationKey: CONV,
      now: NOW,
    });
    expect(d.allow).toBe(false);
    expect(d.allow === false && d.reason).toBe('disabled');
  });

  it('denies when page hidden', () => {
    const state = setupActiveState();
    const d = checkPolicy(state, {
      enabled: true,
      maxPerConversation: 10,
      conversationKey: CONV,
      now: NOW,
      documentHidden: true,
    });
    expect(d.allow === false && d.reason).toBe('page-hidden');
  });

  it('denies when no recent user activity', () => {
    const state = createPolicyState(); // no activity recorded
    const d = checkPolicy(state, {
      enabled: true,
      maxPerConversation: 10,
      conversationKey: CONV,
      now: NOW,
    });
    expect(d.allow === false && d.reason).toBe('no-recent-user-activity');
  });

  it('denies when user activity is stale (beyond window)', () => {
    const state = setupActiveState();
    const d = checkPolicy(state, {
      enabled: true,
      maxPerConversation: 10,
      conversationKey: CONV,
      now: NOW + USER_ACTIVITY_WINDOW_MS + 1,
    });
    expect(d.allow === false && d.reason).toBe('no-recent-user-activity');
  });

  it('denies when a reply was sent too recently', () => {
    const state = setupActiveState();
    recordAutoReply(state, CONV, NOW);
    // Refresh user activity so that test isolates the cooldown branch.
    recordUserActivity(state, NOW + 1000);
    const d = checkPolicy(state, {
      enabled: true,
      maxPerConversation: 10,
      conversationKey: CONV,
      now: NOW + MIN_INTERVAL_MS - 1,
    });
    expect(d.allow === false && d.reason).toBe('too-soon');
  });

  it('denies when the per-conversation cap is reached', () => {
    const state = setupActiveState();
    for (let i = 0; i < 5; i++) {
      recordAutoReply(state, CONV, NOW - MIN_INTERVAL_MS * (i + 5));
    }
    recordUserActivity(state, NOW);
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
    const state = setupActiveState();
    const d = checkPolicy(state, {
      enabled: true,
      maxPerConversation: 10,
      conversationKey: CONV,
      now: NOW,
    });
    expect(d.allow === false && d.reason).toBe('input-busy');
  });

  it('allows when all gates clear', () => {
    const state = setupActiveState();
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

  it('resetCounter clears only the named conversation', () => {
    const state = createPolicyState();
    recordAutoReply(state, 'a', NOW);
    recordAutoReply(state, 'b', NOW);
    resetCounter(state, 'a');
    expect(state.countByConversation.has('a')).toBe(false);
    expect(state.countByConversation.get('b')).toBe(1);
  });
});
