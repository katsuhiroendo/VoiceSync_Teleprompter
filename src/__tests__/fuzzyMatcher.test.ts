import { describe, it, expect } from 'vitest';
import { parseScriptToSegments } from '@/lib/scriptParser';
import { findBestMatchingSegment } from '@/lib/fuzzyMatcher';
import { buildErrorInfo } from '@/lib/speechEngine';

const TEST_SCRIPT_JA = `皆さんこんにちは！今日も動画をご覧いただき、ありがとうございます。
今回の動画では、カメラ目線を自然に維持しながら撮影できるテレプロンプターの活用方法についてご紹介します。

YouTubeの撮影をしていると、原稿を確認するためにどうしても目線が下にずれてしまうことはありませんか？
このアプリを使えば、あなたが話した言葉をリアルタイムで認識し、原稿の現在位置を特定して自動的にスクロールしてくれます。

ゆっくり考えながら話しても、途中で10秒間沈黙してしまっても大丈夫です。
声のペースに合わせてピタッと止まり、話し始めると再び滑らかに追従を再開します。

また、MacBookの内蔵カメラで撮影する際は、カメラ目線モードをオンにしてみてください。
画面の最上部に現在の文章がコンパクトに表示されるため、視聴者からは完全にカメラを見つめて話しているように見えます。`;

describe('VoiceSync Fuzzy Matcher & 10 Required Test Cases (Section 14)', () => {
  const segments = parseScriptToSegments(TEST_SCRIPT_JA);
  const defaultSensitivity = 0.65;

  it('Case 1: 日本語の原稿を通常速度で順番どおり読み上げる (Normal sequential reading)', () => {
    // Segment 0 ("皆さんこんにちは！") -> Segment 1 ("今日も動画をご覧いただき、ありがとうございます。")
    const res1 = findBestMatchingSegment(
      '今日も動画をご覧いただきありがとうございます',
      segments,
      { currentIndex: 0, sensitivity: defaultSensitivity, isFinal: false }
    );
    expect(res1.shouldAdvance).toBe(true);
    expect(res1.matchedSegmentIndex).toBe(1);
    expect(res1.reason).toBe('local-advance');

    // Segment 1 -> Segment 2 ("今回の動画では、カメラ目線を自然に維持しながら撮影できる...")
    const res2 = findBestMatchingSegment(
      '今回の動画ではカメラ目線を自然に維持しながら撮影できる',
      segments,
      { currentIndex: 1, sensitivity: defaultSensitivity, isFinal: false }
    );
    expect(res2.shouldAdvance).toBe(true);
    expect(res2.matchedSegmentIndex).toBe(2);
    expect(res2.reason).toBe('local-advance');
  });

  it('Case 2: 非常にゆっくり読み上げる (Slow reading with short incremental transcripts)', () => {
    // Very short initial utterance stays on current segment without erratic jumps
    const step1 = findBestMatchingSegment('みなさん', segments, {
      currentIndex: 0,
      sensitivity: defaultSensitivity,
      isFinal: false,
    });
    expect(step1.matchedSegmentIndex).toBe(0);

    // Completing the end of segment 0 advances smoothly to segment 1 on final result
    const step2 = findBestMatchingSegment(
      'みなさんこんにちは',
      segments,
      {
        currentIndex: 0,
        sensitivity: defaultSensitivity,
        isFinal: true,
      }
    );
    expect(step2.matchedSegmentIndex).toBe(1);
  });

  it('Case 3: 途中で10秒間沈黙する (10-second silence holds current position without advancing)', () => {
    const emptyOrNoise = findBestMatchingSegment('', segments, {
      currentIndex: 2,
      sensitivity: defaultSensitivity,
      isFinal: true,
    });
    expect(emptyOrNoise.shouldAdvance).toBe(false);
    expect(emptyOrNoise.matchedSegmentIndex).toBe(2);

    const filler = findBestMatchingSegment('えーっと', segments, {
      currentIndex: 2,
      sensitivity: defaultSensitivity,
      isFinal: false,
    });
    expect(filler.shouldAdvance).toBe(false);
    expect(filler.matchedSegmentIndex).toBe(2);
  });

  it('Case 4: 一部の単語を読み飛ばす・言い間違える (Omitted words / minor mispronunciation)', () => {
    const targetIdx = segments.findIndex((s) =>
      s.text.includes('このアプリを使えば')
    );
    // Speaker is at previous segment and omits "あなたが" and "リアルタイムで" and slightly alters phrasing
    const res = findBestMatchingSegment(
      'このアプリを使えば話した言葉を認識して原稿の現在位置を特定して自動スクロールしてくれます',
      segments,
      { currentIndex: targetIdx - 1, sensitivity: defaultSensitivity, isFinal: true }
    );
    expect(res.shouldAdvance).toBe(true);
    expect(res.matchedSegmentIndex).toBe(targetIdx);
  });

  it('Case 5: 原稿にない説明（アドリブ）を追加する (Ad-lib insertion holds position until script resumes)', () => {
    // Speaker is at segment 2 and adds an off-script remark
    const adlibRes = findBestMatchingSegment(
      'ちなみに昨日は東京で雨が降っていてとても寒かったんですよね',
      segments,
      { currentIndex: 2, sensitivity: defaultSensitivity, isFinal: true }
    );
    expect(adlibRes.shouldAdvance).toBe(false);
    expect(adlibRes.matchedSegmentIndex).toBe(2);
    expect(adlibRes.reason).toBe('low-confidence-hold');
  });

  it('Case 6: 前の文章を読み直す (Re-reading a previous sentence backtracks cleanly)', () => {
    const targetIdx = segments.findIndex((s) =>
      s.text.includes('今回の動画では')
    );
    // Currently 2 segments ahead, speaker re-reads targetIdx clearly
    const rereadRes = findBestMatchingSegment(
      '今回の動画ではカメラ目線を自然に維持しながら撮影できるテレプロンプターの活用方法についてご紹介します',
      segments,
      { currentIndex: targetIdx + 2, sensitivity: defaultSensitivity, isFinal: true }
    );
    expect(rereadRes.shouldAdvance).toBe(true);
    expect(rereadRes.matchedSegmentIndex).toBe(targetIdx);
    expect(rereadRes.reason).toBe('backtrack-reread');
  });

  it('Case 7: 次の段落へ飛ぶ (Jumping ahead to a later paragraph)', () => {
    // Currently at segment 1, speaker jumps directly to the final paragraph (segment 6)
    const targetSegIndex = segments.findIndex((s) =>
      s.text.includes('MacBookの内蔵カメラで撮影する際は')
    );
    expect(targetSegIndex).toBeGreaterThanOrEqual(4);

    const jumpRes = findBestMatchingSegment(
      'またMacBookの内蔵カメラで撮影する際はカメラ目線モードをオンにしてみてください',
      segments,
      { currentIndex: 1, sensitivity: defaultSensitivity, isFinal: true }
    );
    expect(jumpRes.shouldAdvance).toBe(true);
    expect(jumpRes.matchedSegmentIndex).toBe(targetSegIndex);
    expect(jumpRes.reason).toBe('forward-skip');
  });

  it('Case 8 & 9: 音声認識の一時停止およびマイク権限拒否時のエラー診断と代替手順生成', () => {
    const deniedInfo = buildErrorInfo('not-allowed');
    expect(deniedInfo.code).toBe('not-allowed');
    expect(deniedInfo.canFallbackToManual).toBe(true);
    expect(deniedInfo.recoverySteps.length).toBeGreaterThanOrEqual(3);

    const offlineInfo = buildErrorInfo('network');
    expect(offlineInfo.code).toBe('network');
    expect(offlineInfo.canFallbackToManual).toBe(true);
  });

  it('Case 10: 長文原稿（100段落以上）でも高速にセグメント照合が完了する (Long script performance)', () => {
    const longParagraphs = Array.from(
      { length: 120 },
      (_, i) =>
        `第${i + 1}章の解説です。長文の原稿であってもウィンドウ探索により計算量が一定に保たれ、メモリリークやカクつきなく瞬時に照合できます。`
    ).join('\n\n');

    const longSegments = parseScriptToSegments(longParagraphs);
    expect(longSegments.length).toBeGreaterThanOrEqual(120);

    const startMs = performance.now();
    const match = findBestMatchingSegment(
      '第52章の解説です長文の原稿であってもウィンドウ探索により計算量が一定に保たれ',
      longSegments,
      { currentIndex: 50, sensitivity: defaultSensitivity, isFinal: false }
    );
    const elapsedMs = performance.now() - startMs;

    expect(match.shouldAdvance).toBe(true);
    expect(elapsedMs).toBeLessThan(25); // 25ms未満で完了すること
  });

  it('Early Paragraph Advance: advances to next segment/paragraph earlier when advanceTriggerRatio is lowered (e.g. 0.50 or 0.60)', () => {
    const seg2Idx = segments.findIndex((s) =>
      s.text.includes('今回の動画では')
    );
    // Real-world interim speech recognition often has kanji-hiragana differences in the middle
    // e.g.的原稿 "自然に維持しながら撮影できる" vs 認識結果 "しぜんにいじしながらさつえい" (around 62% of segment 2)
    const midUtteranceWithKanjiVariation =
      '今回の動画ではカメラ目線をしぜんにいじしながらさつえい';

    // With strict 0.95 ratio, it waits until the end of the sentence
    const strictRes = findBestMatchingSegment(
      midUtteranceWithKanjiVariation,
      segments,
      {
        currentIndex: seg2Idx,
        sensitivity: defaultSensitivity,
        advanceTriggerRatio: 0.95,
        isFinal: false,
      }
    );
    expect(strictRes.shouldAdvance).toBe(false);
    expect(strictRes.matchedSegmentIndex).toBe(seg2Idx);

    // With 0.60 ratio (60% setting), it advances to the next paragraph/segment immediately during interim speech
    const earlyRes60 = findBestMatchingSegment(
      midUtteranceWithKanjiVariation,
      segments,
      {
        currentIndex: seg2Idx,
        sensitivity: defaultSensitivity,
        advanceTriggerRatio: 0.60,
        isFinal: false,
      }
    );
    expect(earlyRes60.progressRatio).toBeGreaterThanOrEqual(0.55);
    expect(earlyRes60.shouldAdvance).toBe(true);
    expect(earlyRes60.matchedSegmentIndex).toBe(seg2Idx + 1);
    expect(earlyRes60.reason).toBe('early-trigger-advance');
  });

  it('Anti-Ping-Pong Guard: prevents jumping back to the previous paragraph when finishing the tail of the previous sentence after an early advance', () => {
    const seg2Idx = segments.findIndex((s) =>
      s.text.includes('今回の動画では')
    );
    const nextParagraphIdx = seg2Idx + 1;

    // Suppose we just advanced early from seg2Idx to nextParagraphIdx at 60%,
    // and now the speaker finishes reading the tail of seg2Idx ("テレプロンプターの活用方法についてご紹介します")
    // or the final transcript of seg2Idx arrives.
    const remainingTailOfPrevParagraph =
      'テレプロンプターの活用方法についてご紹介します';

    const afterAdvanceRes = findBestMatchingSegment(
      remainingTailOfPrevParagraph,
      segments,
      {
        currentIndex: nextParagraphIdx,
        sensitivity: defaultSensitivity,
        advanceTriggerRatio: 0.60,
        isFinal: true,
        preventBacktrackToIndex: seg2Idx,
      }
    );

    // Must NOT backtrack to seg2Idx and must NOT double-advance to nextParagraphIdx + 1
    expect(afterAdvanceRes.shouldAdvance).toBe(false);
    expect(afterAdvanceRes.matchedSegmentIndex).toBe(nextParagraphIdx);
    expect(afterAdvanceRes.reason).toBe('same-segment');
  });

  it('Multi-Line Cascade Guard: prevents jumping multiple segments when a short suffix of the previous sentence shares common endings with the next sentence', () => {
    const seg2Idx = segments.findIndex((s) =>
      s.text.includes('今回の動画では')
    );
    const nextIdx = seg2Idx + 1;

    // Suppose we just advanced early from seg2Idx to nextIdx, and the newly sliced tail is just "ご紹介します" (6 chars).
    // Even if "ます" or a short phrase partially matches the end of nextIdx or nextIdx+1,
    // it must stay on nextIdx because the speaker hasn't started reading the beginning of nextIdx yet.
    const shortResidualTail = 'ご紹介します';

    const cascadeRes = findBestMatchingSegment(shortResidualTail, segments, {
      currentIndex: nextIdx,
      sensitivity: defaultSensitivity,
      advanceTriggerRatio: 0.60,
      isFinal: false,
      preventBacktrackToIndex: seg2Idx,
    });

    expect(cascadeRes.shouldAdvance).toBe(false);
    expect(cascadeRes.matchedSegmentIndex).toBe(nextIdx);
  });
});
