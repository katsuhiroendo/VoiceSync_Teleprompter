import { describe, it, expect } from 'vitest';
import {
  stripStageDirectionsAndFormatting,
  parseSegmentInlineTokens,
  parseScriptToSegments,
  extractScriptChapters,
  estimateRemainingReadingTime,
} from '@/lib/scriptParser';
import { findBestMatchingSegment } from '@/lib/fuzzyMatcher';
import { resolveRetakeSegmentIndex } from '@/lib/ngMarkerService';
import {
  DEFAULT_CUSTOM_KEY_BINDINGS,
  DEFAULT_PROMPTER_SETTINGS,
} from '@/types/prompter';

describe('Vol.3 Step 1: Stage directions & highlights', () => {
  it('strips [cues] and 【cues】 and keeps highlighted words', () => {
    expect(
      stripStageDirectionsAndFormatting(
        '[笑顔で]皆さん、**こんにちは**！【1秒ポーズ】==今日==は!!大事!!な話です。'
      )
    ).toBe('皆さん、こんにちは！今日は大事な話です。');
  });

  it('strips heading markers but keeps heading text', () => {
    expect(stripStageDirectionsAndFormatting('# 第1章：はじめに')).toBe(
      '第1章：はじめに'
    );
  });

  it('tokenizes inline cues/highlights with spoken char offsets', () => {
    const { tokens, totalSpokenChars, isCueOnly } = parseSegmentInlineTokens(
      'こんにちは[笑顔で]**世界**です'
    );
    expect(tokens.map((t) => t.type)).toEqual([
      'text',
      'cue',
      'highlight-yellow',
      'text',
    ]);
    expect(tokens[1].spokenStartChar).toBe(-1);
    expect(tokens[2].spokenStartChar).toBe(5);
    expect(tokens[2].spokenEndChar).toBe(7);
    expect(totalSpokenChars).toBe(9);
    expect(isCueOnly).toBe(false);
  });

  it('marks cue-only lines and heading lines in segments', () => {
    const segs = parseScriptToSegments(
      '# オープニング\n[1秒ポーズ]\n皆さんこんにちは。'
    );
    expect(segs[0].isHeading).toBe(true);
    expect(segs[0].headingTitle).toBe('オープニング');
    expect(segs[1].isCueOnly).toBe(true);
    expect(segs[1].normalizedText).toBe('');
    expect(segs[2].spokenText).toBe('皆さんこんにちは。');
  });

  it('does not split sentences on punctuation inside cues', () => {
    const segs = parseScriptToSegments('今日は晴れです[ここで。間を取る]。次の文です。');
    expect(segs.map((s) => s.text)).toEqual([
      '今日は晴れです[ここで。間を取る]。',
      '次の文です。',
    ]);
  });

  it('voice tracking skips over cue-only and heading lines', () => {
    const segs = parseScriptToSegments(
      '最初の挨拶をします。\n[笑顔で]\n# 本題\n今回のテーマはテレプロンプターです。'
    );
    const result = findBestMatchingSegment(
      '今回のテーマはテレプロンプターです',
      segs,
      { currentIndex: 0, sensitivity: 0.65, isFinal: true }
    );
    expect(result.matchedSegmentIndex).toBe(3);
  });
});

describe('Vol.3 Step 2: Chapters & remaining time', () => {
  const content =
    '# オープニング\n皆さんこんにちは。\n# 本題\n今日は機能を紹介します。\n■ まとめ\nご視聴ありがとうございました。';
  const segs = parseScriptToSegments(content);

  it('extracts # headings and ■ sections as chapters', () => {
    const chapters = extractScriptChapters(segs);
    expect(chapters.map((c) => c.title)).toEqual([
      'オープニング',
      '本題',
      '■ まとめ',
    ]);
    expect(chapters[1].segmentIndex).toBe(2);
  });

  it('estimates progress and remaining reading time', () => {
    const start = estimateRemainingReadingTime(segs, 0, 'ja-JP');
    const end = estimateRemainingReadingTime(segs, segs.length - 1, 'ja-JP');
    expect(start.progressPercent).toBe(0);
    expect(end.progressPercent).toBe(100);
    expect(start.remainingChars).toBeGreaterThan(end.remainingChars);
    expect(start.formattedRemaining).toMatch(/^残り約/);
  });

  it('prev-heading retake ignores 【cue】-only lines', () => {
    const s = parseScriptToSegments('# 本題\n文1です。\n【1秒ポーズ】\n文2です。');
    expect(resolveRetakeSegmentIndex(s, 3, 'prev-heading-or-section')).toBe(0);
  });
});

describe('Vol.3 Step 5: Custom key bindings defaults', () => {
  it('provides default bindings for all actions', () => {
    expect(DEFAULT_PROMPTER_SETTINGS.customKeyBindings).toEqual(
      DEFAULT_CUSTOM_KEY_BINDINGS
    );
    expect(DEFAULT_CUSTOM_KEY_BINDINGS.recordNgMarker).toBe('KeyM');
    expect(DEFAULT_CUSTOM_KEY_BINDINGS.nextChapter).toBe('PageDown');
    expect(DEFAULT_PROMPTER_SETTINGS.enableStageDirectionsAndHighlights).toBe(
      true
    );
    expect(DEFAULT_PROMPTER_SETTINGS.charLevelProgressHighlight).toBe(true);
  });
});
