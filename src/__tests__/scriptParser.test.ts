import { describe, it, expect } from 'vitest';
import {
  normalizeTextForMatching,
  parseScriptToSegments,
  computeSegmentDisplayHierarchy,
} from '@/lib/scriptParser';

describe('scriptParser (Phase 1 Core Unit Tests)', () => {
  it('normalizes Japanese and English text by removing punctuation and converting katakana to hiragana', () => {
    const raw = '皆さん、こんにちは！ VoiceSync Teleprompter（テレプロンプター）へようこそ。';
    const normalized = normalizeTextForMatching(raw);
    expect(normalized).toBe(
      'みなさんこんにちはvoicesyncteleprompterてれぷろんぷたーへようこそ'
    );
  });

  it('splits multi-paragraph scripts into phrase segments with paragraph indices', () => {
    const sample = `最初の段落の1文目です。続いて2文目です。

次の段落に移りました。ここもスムーズに分割されます。`;

    const segments = parseScriptToSegments(sample);
    expect(segments.length).toBe(4);
    expect(segments[0].paragraphIndex).toBe(0);
    expect(segments[1].paragraphIndex).toBe(0);
    expect(segments[2].paragraphIndex).toBe(1);
    expect(segments[3].paragraphIndex).toBe(1);
  });

  it('Phase 4: computes 3-tier brightness hierarchy for current, lookahead (0/1/2/3), and dimmed phrases', () => {
    // Lookahead = 2 (Default)
    const cur = computeSegmentDisplayHierarchy({
      segmentIndex: 2,
      activeSegmentIndex: 2,
      focusMode: true,
      lookaheadCount: 2,
      lookaheadOpacity: 0.68,
      dimOpacity: 0.28,
    });
    const next1 = computeSegmentDisplayHierarchy({
      segmentIndex: 3,
      activeSegmentIndex: 2,
      focusMode: true,
      lookaheadCount: 2,
      lookaheadOpacity: 0.68,
      dimOpacity: 0.28,
    });
    const next2 = computeSegmentDisplayHierarchy({
      segmentIndex: 4,
      activeSegmentIndex: 2,
      focusMode: true,
      lookaheadCount: 2,
      lookaheadOpacity: 0.68,
      dimOpacity: 0.28,
    });
    const next3 = computeSegmentDisplayHierarchy({
      segmentIndex: 5,
      activeSegmentIndex: 2,
      focusMode: true,
      lookaheadCount: 2,
      lookaheadOpacity: 0.68,
      dimOpacity: 0.28,
    });

    expect(cur.tier).toBe('current');
    expect(cur.opacity).toBe(1);

    expect(next1.tier).toBe('lookahead');
    expect(next1.opacity).toBe(0.68);

    expect(next2.tier).toBe('lookahead');
    expect(next2.opacity).toBe(0.6);

    expect(next3.tier).toBe('dimmed');
    expect(next3.opacity).toBe(0.28);

    // Lookahead = 0 (OFF)
    const offNext1 = computeSegmentDisplayHierarchy({
      segmentIndex: 3,
      activeSegmentIndex: 2,
      focusMode: true,
      lookaheadCount: 0,
      lookaheadOpacity: 0.68,
      dimOpacity: 0.28,
    });
    expect(offNext1.tier).toBe('dimmed');
    expect(offNext1.opacity).toBe(0.28);
  });
});
