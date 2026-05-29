import { combineSelectors, getAssistantTurnSelectors } from '@/core/utils/selectors';

import { DOM_QUIESCENCE_MS } from './constants';

/**
 * Watches the page for "Gemini has finished generating a response" and invokes
 * the listener with the latest response's plain text.
 *
 * Heuristics:
 *  - Primary: aria-label of the send/stop button changes from "Stop" back to
 *    "Send" (or icon switches from `stop` to `send`).
 *  - Fallback: the latest AI turn node has not mutated for DOM_QUIESCENCE_MS
 *    AND it contains some text content.
 */

export type CompletionListener = (latestResponseText: string) => void;

interface DetectorState {
  lastResponseText: string;
  quiescenceTimer: number | null;
  buttonObserver: MutationObserver | null;
  responseObserver: MutationObserver | null;
  attachedButton: HTMLElement | null;
  attachedResponse: HTMLElement | null;
  reattachInterval: number | null;
}

export interface DetectorHandle {
  stop(): void;
}

export function startGenerationDetector(onCompleted: CompletionListener): DetectorHandle {
  const state: DetectorState = {
    lastResponseText: '',
    quiescenceTimer: null,
    buttonObserver: null,
    responseObserver: null,
    attachedButton: null,
    attachedResponse: null,
    reattachInterval: null,
  };

  const settleCompletion = () => {
    const node = findLatestAssistantNode();
    if (!node) return;
    const text = extractText(node);
    if (text.length === 0) return;
    // Avoid firing twice for the same final text.
    if (text === state.lastResponseText) return;
    state.lastResponseText = text;
    try {
      onCompleted(text);
    } catch (err) {
      console.warn('[AutoReplyContinue] listener threw:', err);
    }
  };

  const scheduleQuiescenceFire = () => {
    if (state.quiescenceTimer !== null) window.clearTimeout(state.quiescenceTimer);
    state.quiescenceTimer = window.setTimeout(() => {
      state.quiescenceTimer = null;
      settleCompletion();
    }, DOM_QUIESCENCE_MS);
  };

  const attachToLatestResponse = () => {
    const node = findLatestAssistantNode();
    if (!node || node === state.attachedResponse) return;
    state.attachedResponse = node;
    if (state.responseObserver) state.responseObserver.disconnect();
    state.responseObserver = new MutationObserver(() => {
      scheduleQuiescenceFire();
    });
    state.responseObserver.observe(node, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    scheduleQuiescenceFire();
  };

  const attachToStopButton = () => {
    const button = findStopOrSendButton();
    if (!button || button === state.attachedButton) return;
    state.attachedButton = button;
    if (state.buttonObserver) state.buttonObserver.disconnect();
    state.buttonObserver = new MutationObserver(() => {
      // Whenever the button's aria-label flips back to a non-Stop state,
      // treat that as a strong completion signal.
      if (!isStopButton(button)) {
        // Allow a tiny delay so the last token finishes rendering.
        window.setTimeout(settleCompletion, 200);
      }
    });
    state.buttonObserver.observe(button, {
      attributes: true,
      attributeFilter: ['aria-label', 'data-tooltip', 'class'],
    });
  };

  // Re-attach periodically because Gemini destroys and recreates buttons /
  // response nodes on every turn.
  state.reattachInterval = window.setInterval(() => {
    attachToStopButton();
    attachToLatestResponse();
  }, 1500);

  attachToStopButton();
  attachToLatestResponse();

  return {
    stop() {
      if (state.reattachInterval !== null) window.clearInterval(state.reattachInterval);
      if (state.quiescenceTimer !== null) window.clearTimeout(state.quiescenceTimer);
      state.buttonObserver?.disconnect();
      state.responseObserver?.disconnect();
      state.attachedButton = null;
      state.attachedResponse = null;
    },
  };
}

function findLatestAssistantNode(): HTMLElement | null {
  const combined = combineSelectors(getAssistantTurnSelectors());
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(combined));
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (nodes[i].offsetParent !== null) return nodes[i];
  }
  return null;
}

function findStopOrSendButton(): HTMLElement | null {
  const selectors = [
    'button[aria-label*="Stop"]',
    'button[aria-label*="stop"]',
    'button[aria-label*="Send"]',
    'button[aria-label*="send"]',
    'button mat-icon[fonticon="stop"]',
    'button mat-icon[fonticon="send"]',
  ];
  for (const sel of selectors) {
    try {
      const found = document.querySelector(sel);
      if (found instanceof HTMLElement) {
        const button = found.closest('button');
        if (button instanceof HTMLElement && button.offsetParent !== null) return button;
        if (found.offsetParent !== null) return found;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

function isStopButton(button: HTMLElement): boolean {
  const aria = (button.getAttribute('aria-label') ?? '').toLowerCase();
  const tooltip = (button.getAttribute('data-tooltip') ?? '').toLowerCase();
  if (aria.includes('stop') || tooltip.includes('stop')) return true;
  const icon = button.querySelector('mat-icon[fonticon]');
  if (icon?.getAttribute('fonticon') === 'stop') return true;
  return false;
}

function extractText(node: HTMLElement): string {
  return (node.innerText ?? node.textContent ?? '').trim();
}
