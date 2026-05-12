import { describe, expect, it } from 'vitest';

import { matchContinuePrompt, resolveReplyText } from '../matcher';

describe('matchContinuePrompt', () => {
  describe('positive cases — Chinese', () => {
    const positives = [
      '上面是第一部分，要继续吗？',
      '需要我继续吗？',
      '内容太长，是否继续？',
      '剩下的部分要不要继续？',
      '是否需要继续输出？',
      '是否要我继续？',
    ];
    for (const text of positives) {
      it(`triggers on: ${text}`, () => {
        const r = matchContinuePrompt(text);
        expect(r.trigger).toBe(true);
        expect(r.language).toBe('zh');
      });
    }
  });

  describe('positive cases — English', () => {
    const positives = [
      'I have more details to share. Shall I continue?',
      "Do you want me to continue?",
      'Would you like me to continue?',
      'There is more output remaining. Continue?',
    ];
    for (const text of positives) {
      it(`triggers on: ${text}`, () => {
        const r = matchContinuePrompt(text);
        expect(r.trigger).toBe(true);
        expect(r.language).toBe('en');
      });
    }
  });

  describe('negative cases', () => {
    it('returns false for empty text', () => {
      const r = matchContinuePrompt('');
      expect(r.trigger).toBe(false);
      expect(r.reason).toBe('empty');
    });

    it('returns false when no question mark', () => {
      const r = matchContinuePrompt('好的，我会继续写下去。');
      expect(r.trigger).toBe(false);
      expect(r.reason).toBe('no-question-mark');
    });

    it('returns false when "continue" appears mid-text but tail is unrelated', () => {
      const text =
        '让我继续讲讲算法。这里我们使用快速排序，下面给出实现细节。性能怎么样？';
      const r = matchContinuePrompt(text);
      expect(r.trigger).toBe(false);
      expect(r.reason).toBe('no-pattern-match');
    });

    it('returns false when the trailing question sits inside an unclosed code block', () => {
      // Unclosed fence — the question is part of the code, not a natural ask.
      const text = 'Example:\n```python\nprint("继续吗？")';
      const r = matchContinuePrompt(text);
      expect(r.trigger).toBe(false);
      expect(r.reason).toBe('inside-code-block');
    });

    it('returns false when destructive blocklist word present (delete)', () => {
      const r = matchContinuePrompt('Confirm delete and continue?');
      expect(r.trigger).toBe(false);
      expect(r.reason).toBe('safety-blocked');
    });

    it('returns false when destructive blocklist word present (密码)', () => {
      const r = matchContinuePrompt('确认密码后继续吗？');
      expect(r.trigger).toBe(false);
      expect(r.reason).toBe('safety-blocked');
    });
  });

  describe('custom patterns', () => {
    it('accepts user-supplied trigger pattern', () => {
      const r = matchContinuePrompt('Stuck mid-thought. Keep streaming?', {
        customPatterns: ['keep streaming'],
      });
      expect(r.trigger).toBe(true);
    });

    it('ignores invalid regex sources without crashing', () => {
      // Trailing '(' is an invalid regex — should be skipped, not throw.
      const r = matchContinuePrompt('上面是部分内容，要继续吗？', {
        customPatterns: ['('],
      });
      expect(r.trigger).toBe(true);
    });
  });

  describe('language detection', () => {
    it('flags mixed CJK + ASCII as zh', () => {
      const r = matchContinuePrompt('Section 1 done. 要继续吗？');
      expect(r.trigger).toBe(true);
      expect(r.language).toBe('zh');
    });

    it('flags pure ASCII as en', () => {
      const r = matchContinuePrompt('Continue?');
      expect(r.trigger).toBe(true);
      expect(r.language).toBe('en');
    });
  });
});

describe('resolveReplyText', () => {
  it('returns custom text when non-empty', () => {
    expect(resolveReplyText('zh', '请接着说')).toBe('请接着说');
    expect(resolveReplyText('en', 'go on')).toBe('go on');
  });

  it('trims whitespace from custom text', () => {
    expect(resolveReplyText('en', '  continue please  ')).toBe('continue please');
  });

  it('falls back to Chinese default for zh', () => {
    expect(resolveReplyText('zh', '')).toBe('继续');
    expect(resolveReplyText('zh', null)).toBe('继续');
    expect(resolveReplyText('zh', undefined)).toBe('继续');
  });

  it('falls back to English default for en', () => {
    expect(resolveReplyText('en', '')).toBe('continue');
  });
});
