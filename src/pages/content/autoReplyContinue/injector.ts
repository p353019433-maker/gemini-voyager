import { findChatInput, insertTextIntoChatInput } from '../chatInput';

/** Selectors used by sendBehavior to locate the send button. Kept in sync. */
const SEND_BUTTON_SELECTORS = [
  'button[aria-label*="Send"]',
  'button[aria-label*="send"]',
  'button[data-tooltip*="Send"]',
  'button[data-tooltip*="send"]',
  'button mat-icon[fonticon="send"]',
  '[data-send-button]',
  '.send-button',
] as const;

const CONTAINER_SELECTORS = [
  '.text-input-field',
  'ms-prompt-input-wrapper',
  'ms-prompt-input',
  'form',
] as const;

function findSendButton(input: HTMLElement): HTMLElement | null {
  let container: HTMLElement | null = null;
  for (const sel of CONTAINER_SELECTORS) {
    const found = input.closest(sel);
    if (found instanceof HTMLElement) {
      container = found;
      break;
    }
  }

  const scope: ParentNode = container ?? document;
  for (const sel of SEND_BUTTON_SELECTORS) {
    try {
      const el = scope.querySelector(sel);
      if (el instanceof HTMLElement) {
        const button = el.closest('button');
        const resolved = button instanceof HTMLElement ? button : el;
        if (resolved.offsetParent !== null) return resolved;
      }
    } catch {
      // ignore bad selector
    }
  }

  if (container) {
    for (const button of Array.from(container.querySelectorAll('button'))) {
      const icon = button.querySelector('.material-symbols-outlined, mat-icon');
      const name = icon?.textContent?.trim().toLowerCase();
      if ((name === 'send' || name === 'play_arrow') && button.offsetParent !== null) {
        return button;
      }
    }
  }

  return null;
}

/**
 * Insert reply text into the chat input and click send.
 * Returns true on success.
 */
export function sendAutoReply(text: string): boolean {
  const input = findChatInput();
  if (!input) return false;
  if (!insertTextIntoChatInput(text, input)) return false;

  const button = findSendButton(input);
  if (!button) return false;

  // Some implementations disable the send button until the next animation
  // frame after input. Defer the click to give the framework time to react.
  try {
    button.click();
    return true;
  } catch {
    return false;
  }
}
