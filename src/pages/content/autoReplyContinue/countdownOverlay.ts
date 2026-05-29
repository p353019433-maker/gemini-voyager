/**
 * Floating countdown chip shown before an auto-reply fires.
 * Provides a clear escape hatch (button + ESC key) to cancel.
 */

const OVERLAY_CLASS = 'gv-auto-reply-overlay';
const COUNTDOWN_CLASS = 'gv-auto-reply-overlay__countdown';
const CANCEL_CLASS = 'gv-auto-reply-overlay__cancel';

export interface CountdownLabels {
  message: string; // e.g. "Auto-reply in {n}s — press Esc to cancel"
  cancel: string; // e.g. "Cancel"
  /** Token replaced with the remaining seconds. */
  countdownToken: string;
}

export interface CountdownController {
  /** Stop the countdown (idempotent). */
  cancel(): void;
}

/**
 * Show a countdown chip in the bottom-right corner. Resolves to `true` when
 * the countdown reaches zero; resolves to `false` if the user cancels or the
 * page unloads.
 */
export function showCountdownOverlay(
  seconds: number,
  labels: CountdownLabels,
): {
  controller: CountdownController;
  result: Promise<boolean>;
} {
  const safeSeconds = Math.max(1, Math.round(seconds));

  const overlay = document.createElement('div');
  overlay.className = OVERLAY_CLASS;
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');

  const text = document.createElement('span');
  text.className = COUNTDOWN_CLASS;
  text.textContent = renderMessage(labels.message, labels.countdownToken, safeSeconds);
  overlay.appendChild(text);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = CANCEL_CLASS;
  button.textContent = labels.cancel;
  overlay.appendChild(button);

  document.body.appendChild(overlay);

  let remaining = safeSeconds;
  let settled = false;
  let intervalId: number | null = null;

  const cleanup = () => {
    if (intervalId !== null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
    document.removeEventListener('keydown', onKeyDown, true);
    overlay.remove();
  };

  let resolveResult!: (value: boolean) => void;
  const result = new Promise<boolean>((resolve) => {
    resolveResult = resolve;
  });

  const settle = (value: boolean) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolveResult(value);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      settle(false);
    }
  };

  button.addEventListener('click', () => settle(false));
  document.addEventListener('keydown', onKeyDown, true);

  intervalId = window.setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      settle(true);
      return;
    }
    text.textContent = renderMessage(labels.message, labels.countdownToken, remaining);
  }, 1000);

  return {
    controller: { cancel: () => settle(false) },
    result,
  };
}

function renderMessage(template: string, token: string, value: number): string {
  if (!template) return String(value);
  return template.split(token).join(String(value));
}
