/**
 * Default trigger patterns for "is there continue?" detection.
 *
 * Each entry is a regex source string (case-insensitive). They are tested
 * against the trailing slice of the most recent AI response. The tail must
 * also contain a question mark (Chinese '?' or ASCII '?') to qualify.
 */
export const DEFAULT_TRIGGER_PATTERNS: readonly string[] = [
  // Chinese
  '要继续吗',
  '是否继续',
  '是否需要继续',
  '需要我继续吗',
  '要不要继续',
  '是否要我继续',
  '要我继续(输出|写|生成)?吗',
  '继续(输出|生成|写|讲)?吗',
  '是否要继续',
  '后续(内容|部分)?(是否需要|要不要)',
  '接着(往下|说|写)吗',
  // English
  'shall I continue',
  'should I continue',
  'should I keep going',
  'do you want me to continue',
  'would you like me to continue',
  'want me to continue',
  'continue\\?',
  'keep going\\?',
];

/**
 * Words that — if present in the trailing tail — block auto-reply even if a
 * trigger pattern matched. These usually signal destructive or sensitive
 * confirmations that should never receive an automated "continue".
 */
export const SAFETY_BLOCKLIST: readonly string[] = [
  '删除',
  '清空',
  '清除',
  '重置',
  '密码',
  '账户',
  '账号',
  '付款',
  '支付',
  '购买',
  '订阅',
  '授权',
  '确认操作',
  'delete',
  'remove',
  'reset',
  'password',
  'credential',
  'account',
  'payment',
  'purchase',
  'subscribe',
  'authorize',
  'confirm action',
];

/** Number of trailing characters from the AI response we examine. */
export const TAIL_WINDOW = 200;

/** Stability window for "DOM no longer mutating" fallback signal. */
export const DOM_QUIESCENCE_MS = 1500;

/** Minimum gap between two consecutive auto-replies within one conversation. */
export const MIN_INTERVAL_MS = 5000;

/**
 * How long a manual user send keeps the current conversation armed for
 * auto-continuation. The user can override this from settings.
 */
export const DEFAULT_ARMED_TTL_MINUTES = 120;
export const MIN_ARMED_TTL_MINUTES = 1;
export const MAX_ARMED_TTL_MINUTES = 24 * 60;

/** Default reply text per language. */
export const DEFAULT_REPLY_TEXT_ZH = '继续';
export const DEFAULT_REPLY_TEXT_EN = 'continue';
