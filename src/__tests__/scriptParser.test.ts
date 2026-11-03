import { describe, it, expect } from 'vitest';
import {
  normalizeTextForMatching,
  parseScriptToSegments,
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
});
