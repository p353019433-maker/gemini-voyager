import {
  DEFAULT_REPLY_TEXT_EN,
  DEFAULT_REPLY_TEXT_ZH,
  DEFAULT_TRIGGER_PATTERNS,
  SAFETY_BLOCKLIST,
  TAIL_WINDOW,
} from './constants';

export interface MatchResult {
  trigger: boolean;
  /** Detected language of the trailing tail; 'zh' for Chinese, 'en' otherwise. */
  language: 'zh' | 'en';
  /** Reason for non-trigger — useful for logging and debugging. */
  reason?:
    | 'empty'
    | 'no-question-mark'
    | 'no-pattern-match'
    | 'safety-blocked'
    | 'inside-code-block';
}

const QUESTION_MARK_RE = /[？?]\s*$/;
const HAS_QUESTION_MARK_RE = /[？?]/;
const CJK_RE = /[一-鿿]/;

/**
 * Compile user-provided + default trigger patterns into a single test function.
 * Invalid regex strings are silently skipped so a typo cannot disable the
 * whole feature.
 */
function compilePatterns(extra: readonly string[] | null | undefined): RegExp[] {
  const sources = [...DEFAULT_TRIGGER_PATTERNS, ...(extra ?? [])];
  const compiled: RegExp[] = [];
  for (const source of sources) {
    if (typeof source !== 'string' || source.trim().length === 0) continue;
    try {
      compiled.push(new RegExp(source, 'i'));
    } catch {
      // Skip invalid user-supplied patterns.
    }
  }
  return compiled;
}

/**
 * Heuristic: is the trailing tail wrapped by an unclosed fenced code block?
 * If yes, we should not interpret it as a natural-language question even if a
 * pattern matches. (Triple backtick count must be odd.)
 */
function endsInsideCodeBlock(fullText: string): boolean {
  const fences = fullText.match(/```/g);
  return !!fences && fences.length % 2 === 1;
}

export interface MatchOptions {
  customPatterns?: readonly string[] | null;
}

/**
 * Decide whether the latest AI response is asking the user to confirm "继续 / continue".
 *
 * The check is intentionally conservative — we look at the trailing window
 * only, require both a trigger pattern AND a question mark, and respect a
 * safety blocklist of destructive verbs.
 */
export function matchContinuePrompt(text: string, options: MatchOptions = {}): MatchResult {
  const trimmed = (text ?? '').trim();
  if (trimmed.length === 0) {
    return { trigger: false, language: 'en', reason: 'empty' };
  }

  if (endsInsideCodeBlock(trimmed)) {
    return { trigger: false, language: detectLanguage(trimmed), reason: 'inside-code-block' };
  }

  const tail = trimmed.slice(-TAIL_WINDOW);
  const language = detectLanguage(tail);

  if (!HAS_QUESTION_MARK_RE.test(tail) || !QUESTION_MARK_RE.test(tail.replace(/[）)\s]+$/, ''))) {
    // Require a question mark close to the end, not just anywhere.
    return { trigger: false, language, reason: 'no-question-mark' };
  }

  const patterns = compilePatterns(options.customPatterns);
  const matched = patterns.some((re) => re.test(tail));
  if (!matched) {
    return { trigger: false, language, reason: 'no-pattern-match' };
  }

  const lowerTail = tail.toLowerCase();
  const blocked = SAFETY_BLOCKLIST.some((word) => lowerTail.includes(word.toLowerCase()));
  if (blocked) {
    return { trigger: false, language, reason: 'safety-blocked' };
  }

  return { trigger: true, language };
}

/**
 * Resolve the actual reply text to send.
 *  - If the user configured a non-empty override, always use it.
 *  - Otherwise pick a sane default based on the detected language.
 */
export function resolveReplyText(language: 'zh' | 'en', override: string | null | undefined): string {
  const cleaned = (override ?? '').trim();
  if (cleaned.length > 0) return cleaned;
  return language === 'zh' ? DEFAULT_REPLY_TEXT_ZH : DEFAULT_REPLY_TEXT_EN;
}

function detectLanguage(text: string): 'zh' | 'en' {
  return CJK_RE.test(text) ? 'zh' : 'en';
}
