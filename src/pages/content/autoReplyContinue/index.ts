import { StorageKeys } from '@/core/types/common';
import { buildConversationIdFromUrl } from '@/core/utils/conversationIdentity';
import { isExtensionContextInvalidatedError } from '@/core/utils/extensionContext';
import { getTranslationSyncUnsafe } from '@/utils/i18n';

import { showCountdownOverlay } from './countdownOverlay';
import { startGenerationDetector } from './generationDetector';
import { sendAutoReply } from './injector';
import { matchContinuePrompt, resolveReplyText } from './matcher';
import {
  checkPolicy,
  createPolicyState,
  recordAutoReply,
  recordUserActivity,
} from './policy';

const LOG_PREFIX = '[AutoReplyContinue]';

interface Settings {
  enabled: boolean;
  countdownSec: number;
  customText: string;
  maxPerConversation: number;
  customPatterns: readonly string[] | null;
}

const DEFAULTS: Settings = {
  enabled: false,
  countdownSec: 3,
  customText: '',
  maxPerConversation: 10,
  customPatterns: null,
};

function parsePatterns(raw: unknown): readonly string[] | null {
  if (Array.isArray(raw)) {
    return raw.filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
  }
  if (typeof raw === 'string') {
    const lines = raw
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    return lines.length > 0 ? lines : null;
  }
  return null;
}

export async function startAutoReplyContinue(): Promise<() => void> {
  let settings: Settings = { ...DEFAULTS };
  let detectorHandle: { stop(): void } | null = null;
  let activeCancel: (() => void) | null = null;

  const policyState = createPolicyState();

  const conversationKey = (): string => {
    try {
      return buildConversationIdFromUrl(location.href);
    } catch {
      return location.href;
    }
  };

  const handleCompletion = async (responseText: string) => {
    // Cancel any in-flight countdown — a newer response invalidates the prior decision.
    if (activeCancel) {
      activeCancel();
      activeCancel = null;
    }

    const match = matchContinuePrompt(responseText, { customPatterns: settings.customPatterns });
    if (!match.trigger) return;

    const decision = checkPolicy(policyState, {
      enabled: settings.enabled,
      maxPerConversation: settings.maxPerConversation,
      conversationKey: conversationKey(),
      documentHidden: document.visibilityState !== 'visible',
    });
    if (!decision.allow) {
      console.log(LOG_PREFIX, 'skipped:', decision.reason);
      return;
    }

    const replyText = resolveReplyText(match.language, settings.customText);
    const labels = {
      message:
        getTranslationSyncUnsafe('autoReplyContinueOverlayMessage') ||
        'Auto-reply in {n}s — Esc to cancel',
      cancel: getTranslationSyncUnsafe('autoReplyContinueOverlayCancel') || 'Cancel',
      countdownToken: '{n}',
    };

    const { controller, result } = showCountdownOverlay(settings.countdownSec, labels);
    activeCancel = () => controller.cancel();

    const proceed = await result;
    activeCancel = null;
    if (!proceed) return;

    const sent = sendAutoReply(replyText);
    if (sent) {
      recordAutoReply(policyState, conversationKey());
    } else {
      console.warn(LOG_PREFIX, 'failed to send auto-reply (chat input or send button missing)');
    }
  };

  const reconcile = () => {
    if (settings.enabled && !detectorHandle) {
      detectorHandle = startGenerationDetector(handleCompletion);
      console.log(LOG_PREFIX, 'detector started');
    } else if (!settings.enabled && detectorHandle) {
      detectorHandle.stop();
      detectorHandle = null;
      if (activeCancel) {
        activeCancel();
        activeCancel = null;
      }
      console.log(LOG_PREFIX, 'detector stopped');
    }
  };

  const loadSettings = async (): Promise<void> => {
    return new Promise((resolve) => {
      try {
        chrome.storage?.sync?.get(
          {
            [StorageKeys.GV_AUTO_REPLY_CONTINUE_ENABLED]: false,
            [StorageKeys.GV_AUTO_REPLY_CONTINUE_COUNTDOWN_SEC]: 3,
            [StorageKeys.GV_AUTO_REPLY_CONTINUE_TEXT]: '',
            [StorageKeys.GV_AUTO_REPLY_CONTINUE_MAX_PER_CONV]: 10,
            [StorageKeys.GV_AUTO_REPLY_CONTINUE_PATTERNS]: null,
          },
          (res) => {
            settings = {
              enabled: res?.[StorageKeys.GV_AUTO_REPLY_CONTINUE_ENABLED] === true,
              countdownSec: Math.max(
                1,
                Number(res?.[StorageKeys.GV_AUTO_REPLY_CONTINUE_COUNTDOWN_SEC]) || 3,
              ),
              customText: String(res?.[StorageKeys.GV_AUTO_REPLY_CONTINUE_TEXT] ?? ''),
              maxPerConversation: Math.max(
                1,
                Number(res?.[StorageKeys.GV_AUTO_REPLY_CONTINUE_MAX_PER_CONV]) || 10,
              ),
              customPatterns: parsePatterns(res?.[StorageKeys.GV_AUTO_REPLY_CONTINUE_PATTERNS]),
            };
            resolve();
          },
        );
      } catch (error) {
        if (!isExtensionContextInvalidatedError(error)) {
          console.warn(LOG_PREFIX, 'load settings failed:', error);
        }
        resolve();
      }
    });
  };

  // Track manual user sends so that we only auto-continue conversations the
  // user is actively engaged with. We listen for Enter/click on the send
  // button area.
  const onUserActivity = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest('button[aria-label*="Send" i], button[aria-label*="send" i]')) {
      recordUserActivity(policyState);
      return;
    }
    if (event instanceof KeyboardEvent && event.key === 'Enter' && !event.shiftKey) {
      const inEditable =
        target.isContentEditable || target.getAttribute('contenteditable') === 'true';
      if (inEditable) recordUserActivity(policyState);
    }
  };

  document.addEventListener('keydown', onUserActivity, true);
  document.addEventListener('click', onUserActivity, true);

  const storageListener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ) => {
    if (areaName !== 'sync') return;
    const watched = [
      StorageKeys.GV_AUTO_REPLY_CONTINUE_ENABLED,
      StorageKeys.GV_AUTO_REPLY_CONTINUE_COUNTDOWN_SEC,
      StorageKeys.GV_AUTO_REPLY_CONTINUE_TEXT,
      StorageKeys.GV_AUTO_REPLY_CONTINUE_MAX_PER_CONV,
      StorageKeys.GV_AUTO_REPLY_CONTINUE_PATTERNS,
    ];
    if (!watched.some((key) => key in changes)) return;
    loadSettings().then(reconcile);
  };

  try {
    chrome.storage?.onChanged?.addListener(storageListener);
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) {
      console.warn(LOG_PREFIX, 'cannot attach storage listener:', error);
    }
  }

  await loadSettings();
  reconcile();

  return () => {
    if (detectorHandle) {
      detectorHandle.stop();
      detectorHandle = null;
    }
    if (activeCancel) {
      activeCancel();
      activeCancel = null;
    }
    document.removeEventListener('keydown', onUserActivity, true);
    document.removeEventListener('click', onUserActivity, true);
    try {
      chrome.storage?.onChanged?.removeListener(storageListener);
    } catch {
      // ignore
    }
  };
}
