import { describe, it, expect } from 'vitest';
import { parseScriptToSegments } from '@/lib/scriptParser';
import { findBestMatchingSegment } from '@/lib/fuzzyMatcher';
import {
  convertKanjiNumberBlock,
  toJapanesePhoneticReading,
  stripJapaneseFillers,
  extractSelfCorrectionCandidate,
} from '@/lib/japaneseNormalizer';
import { computeRestartBackoffMs, MAX_AUTO_RESTART_RETRIES } from '@/lib/speechEngine';

interface BenchmarkScenario {
  id: number;
  name: string;
  scriptText: string;
  startIndex: number;
  utterances: Array<{
    transcript: string;
    isFinal: boolean;
    allowBacktrack?: boolean;
  }>;
  expectedFinalIndex: number;
  maxAllowedIndex: number; // Above this is counted as a false forward jump
}

const BENCHMARK_SCENARIOS: BenchmarkScenario[] = [
  {
    id: 1,
    name: '1. 漢字とひらがなの揺れ・同音異義語変換揺れ',
    scriptText:
      'まずは挨拶です。\n原稿の構成と概要欄の仕様および視聴者対象の解説。\n最後のまとめです。',
    startIndex: 0,
    utterances: [
      {
        transcript: 'げんこうの校正とがいようらんのしようおよび市長しゃ対称のかいせつ',
        isFinal: true,
      },
    ],
    expectedFinalIndex: 1,
    maxAllowedIndex: 1,
  },
  {
    id: 2,
    name: '2. カタカナと英語表記の揺れ (YouTube / MacBook / iPhone / AI)',
    scriptText:
      '導入の文章です。\nYouTube撮影のMacBookとiPhoneとUSBとAI。\n次のステップへ進みます。',
    startIndex: 0,
    utterances: [
      {
        transcript: 'ユーチューブさつえいのマックブックとアイフォーンとユーエスビーとエーアイ',
        isFinal: true,
      },
    ],
    expectedFinalIndex: 1,
    maxAllowedIndex: 1,
  },
  {
    id: 3,
    name: '3. アラビア数字と漢数字の揺れ (2028年8月 / 15万円)',
    scriptText:
      '予算の概要です。\n2028年8月に15万円の4K撮影環境。\n以上が計画です。',
    startIndex: 0,
    utterances: [
      {
        transcript: '二千二十八年八月に十五万円のヨンケーさつえいかんきょう',
        isFinal: true,
      },
    ],
    expectedFinalIndex: 1,
    maxAllowedIndex: 1,
  },
  {
    id: 4,
    name: '4. フィラー（えー、あのー、えっと）の混入',
    scriptText:
      '最初の項目です。\n具体的なカメラ目線モードの調整手順を詳しく説明します。\n次の項目です。',
    startIndex: 0,
    utterances: [
      {
        transcript: 'えーっと、あのー、具体的な、えー、カメラ目線モードの調整手順を詳しく説明します',
        isFinal: true,
      },
    ],
    expectedFinalIndex: 1,
    maxAllowedIndex: 1,
  },
  {
    id: 5,
    name: '5. 言い直し表現（「いや」「じゃなくて」による自己訂正）',
    scriptText:
      'プランの比較です。\n月額18万円のビジネスプランを選択して契約を進めます。\n完了画面へ進みます。',
    startIndex: 0,
    utterances: [
      {
        transcript: '月額十五万円、いや、月額十八万円のビジネスプランを選択して契約を進めます',
        isFinal: true,
      },
    ],
    expectedFinalIndex: 1,
    maxAllowedIndex: 1,
  },
  {
    id: 6,
    name: '6. 少し飛ばして読む（1フレーズ読み飛ばし）',
    scriptText:
      '第1の文です。第2の補足文です。第3の重要な結論として作業時間を半分に短縮できます。第4の文です。',
    startIndex: 0,
    utterances: [
      {
        transcript: '第3の重要な結論として作業時間を半分に短縮できます',
        isFinal: true,
      },
    ],
    expectedFinalIndex: 2,
    maxAllowedIndex: 2,
  },
  {
    id: 7,
    name: '7. 同じ単語が複数段落にある原稿での誤ジャンプ抑制',
    scriptText: [
      '今回の動画ではカメラ目線で撮影できるテレプロンプターの活用方法を紹介します。',
      '撮影中に目線が下にずれてしまう悩みはありませんか。',
      'このテレプロンプターを使えば撮影しながらリアルタイムで原稿を追従します。',
    ].join('\n\n'),
    startIndex: 0,
    utterances: [
      {
        transcript: '今回の動画ではカメラ目線で撮影できるテレプロンプターの活用方法を',
        isFinal: false,
      },
    ],
    expectedFinalIndex: 0, // Still at 75% of segment 0 (advanceTriggerRatio=0.90), must NOT jump to segment 2!
    maxAllowedIndex: 1,
  },
  {
    id: 8,
    name: '8. 短い文が連続する原稿での順次進行',
    scriptText:
      'まずは準備です。カメラを起動します。マイクを選びます。録画ボタンを押します。',
    startIndex: 0,
    utterances: [
      { transcript: 'まずは準備です', isFinal: true },
      { transcript: 'カメラを起動します', isFinal: true },
      { transcript: 'マイクを選びます', isFinal: true },
    ],
    expectedFinalIndex: 3,
    maxAllowedIndex: 3,
  },
  {
    id: 9,
    name: '9. 長い一文（65文字超）の自動句読点分割と追従',
    scriptText:
      '長文テストを開始します。\n自宅やカフェなど様々な環境でYouTube動画を撮影する際には、事前の録音品質チェック機能を使って周囲の環境ノイズや音割れがないかをわずか10秒間で確認しておくことが非常に重要です。\n次の章へ移ります。',
    startIndex: 0,
    utterances: [
      {
        transcript: '自宅やカフェなど様々な環境でユーチューブ動画を撮影する際には',
        isFinal: true,
      },
    ],
    expectedFinalIndex: 1,
    maxAllowedIndex: 2,
  },
  {
    id: 10,
    name: '10. 専門用語（人工知能・機械学習・自然言語処理・アルゴリズム）を含む原稿',
    scriptText:
      '技術解説のパートです。\n人工知能と機械学習および自然言語処理の最適化。\nまとめに入ります。',
    startIndex: 0,
    utterances: [
      {
        transcript: 'じんこうちのうときかいがくしゅうおよびしぜんげんごしょりのさいてきか',
        isFinal: true,
      },
    ],
    expectedFinalIndex: 1,
    maxAllowedIndex: 1,
  },
  {
    id: 11,
    name: '11. 早口想定の短い認識結果（一部省略）',
    scriptText:
      '導入文です。\nチャンネル登録と高評価をぜひよろしくお願いします。\nエンディングです。',
    startIndex: 0,
    utterances: [
      {
        transcript: 'ちゃんねるとうろくとこうひょうかをよろしくおねがいします',
        isFinal: true,
      },
    ],
    expectedFinalIndex: 1,
    maxAllowedIndex: 1,
  },
  {
    id: 12,
    name: '12. ゆっくり話す想定の断続的な認識結果（前半→中盤→終盤）',
    scriptText:
      'ゆっくり考えながら話しても、途中で数秒間沈黙してしまっても大丈夫です。\n声のペースに合わせてピタッと止まります。',
    startIndex: 0,
    utterances: [
      { transcript: 'ゆっくり考えながら', isFinal: false },
      { transcript: 'ゆっくり考えながら話しても途中で', isFinal: false },
      { transcript: 'ゆっくり考えながら話しても途中で数秒間沈黙してしまっても大丈夫です', isFinal: true },
    ],
    expectedFinalIndex: 1,
    maxAllowedIndex: 1,
  },
  {
    id: 13,
    name: '13. 2秒無音後の再開',
    scriptText:
      '最初の文を読み上げます。2秒間ほど息継ぎをしてから次の文を読み上げます。3番目の文です。',
    startIndex: 0,
    utterances: [
      { transcript: '最初の文を読み上げます', isFinal: true },
      // 2s silence -> new resultIndex utterance
      { transcript: '2秒間ほど息継ぎをしてから次の文を読み上げます', isFinal: true },
    ],
    expectedFinalIndex: 2,
    maxAllowedIndex: 2,
  },
  {
    id: 14,
    name: '14. 5秒無音後の再開',
    scriptText:
      '1つ目のポイントです。5秒間カメラを見つめて間を作ってから2つ目のポイントを話します。3つ目のポイントです。',
    startIndex: 0,
    utterances: [
      { transcript: '一つ目のポイントです', isFinal: true },
      { transcript: '五秒間カメラを見つめて間を作ってから二つ目のポイントを話します', isFinal: true },
    ],
    expectedFinalIndex: 2,
    maxAllowedIndex: 2,
  },
  {
    id: 15,
    name: '15. 10秒無音後の再開（Web Speech API onend 自動再起動後の継続）',
    scriptText:
      'オープニングの挨拶です。10秒間の無音の後でも現在位置を失わずに本編の解説へ進みます。エンディングです。',
    startIndex: 0,
    utterances: [
      { transcript: 'オープニングの挨拶です', isFinal: true },
      { transcript: '十秒間の無音の後でも現在位置を失わずに本編の解説へ進みます', isFinal: true },
    ],
    expectedFinalIndex: 2,
    maxAllowedIndex: 2,
  },
  {
    id: 16,
    name: '16. 原稿にない雑談・咳払い（位置保持の検証）',
    scriptText:
      'ここが現在の原稿位置です。次の正規の原稿フレーズはこちらです。さらにその次の文です。',
    startIndex: 0,
    utterances: [
      { transcript: 'あーちょっとお水飲みますねゴホンゴホン失礼', isFinal: true },
    ],
    expectedFinalIndex: 0,
    maxAllowedIndex: 0,
  },
  {
    id: 17,
    name: '17. 前の文をもう一度読む撮り直し（allowBacktrack=true 時）',
    scriptText:
      '第1の重要な導入フレーズをもう一度最初から読み直します。ここは第2の現在フレーズです。第3のフレーズです。',
    startIndex: 1,
    utterances: [
      {
        transcript: '第1の重要な導入フレーズをもう一度最初から読み直します',
        isFinal: true,
        allowBacktrack: true,
      },
    ],
    expectedFinalIndex: 0,
    maxAllowedIndex: 1,
  },
  {
    id: 18,
    name: '18. 前方進行ロック ON（allowBacktrack=false）による逆戻り完全防止',
    scriptText:
      '第1の重要な導入フレーズをもう一度最初から読み直します。ここは第2の現在フレーズです。第3のフレーズです。',
    startIndex: 1,
    utterances: [
      {
        transcript: '第1の重要な導入フレーズをもう一度最初から読み直します',
        isFinal: true,
        allowBacktrack: false,
      },
    ],
    expectedFinalIndex: 1, // Must stay at 1 and NEVER backtrack to 0 when forwardOnlyMode is ON
    maxAllowedIndex: 1,
  },
];

function runBenchmarkSuite(useLegacyNormalizationOnly: boolean) {
  let correctCount = 0;
  let falseJumpCount = 0;
  let unintendedBacktrackCount = 0;
  let totalEvaluations = 0;
  const startTime = performance.now();

  const details: Array<{
    id: number;
    name: string;
    expected: number;
    actual: number;
    passed: boolean;
  }> = [];

  for (const scenario of BENCHMARK_SCENARIOS) {
    const segments = parseScriptToSegments(scenario.scriptText);
    let currentIdx = scenario.startIndex;

    for (const u of scenario.utterances) {
      totalEvaluations++;
      const res = findBestMatchingSegment(u.transcript, segments, {
        currentIndex: currentIdx,
        sensitivity: 0.65,
        advanceTriggerRatio: 0.90,
        isFinal: u.isFinal,
        allowBacktrack: u.allowBacktrack ?? false,
        useLegacyNormalizationOnly,
      });

      if (res.shouldAdvance) {
        if (
          res.matchedSegmentIndex < currentIdx &&
          u.allowBacktrack !== true
        ) {
          unintendedBacktrackCount++;
        }
        if (res.matchedSegmentIndex > scenario.maxAllowedIndex) {
          falseJumpCount++;
        }
        currentIdx = res.matchedSegmentIndex;
      }
    }

    const passed = currentIdx === scenario.expectedFinalIndex;
    if (passed) correctCount++;
    details.push({
      id: scenario.id,
      name: scenario.name,
      expected: scenario.expectedFinalIndex,
      actual: currentIdx,
      passed,
    });
  }

  const totalTimeMs = performance.now() - startTime;
  return {
    totalCases: BENCHMARK_SCENARIOS.length,
    correctCount,
    accuracyPercent: Number(
      ((correctCount / BENCHMARK_SCENARIOS.length) * 100).toFixed(1)
    ),
    falseJumpCount,
    falseJumpRatePercent: Number(
      ((falseJumpCount / totalEvaluations) * 100).toFixed(1)
    ),
    unintendedBacktrackCount,
    avgLatencyMs: Number((totalTimeMs / totalEvaluations).toFixed(3)),
    details,
  };
}

describe('Phase 5: Japanese Voice Tracking Accuracy Improvement & 18-Case Benchmark', () => {
  it('converts Kanji numbers (十五万円, 二千二十八年八月, 一万二千) into unified Arabic numbers', () => {
    expect(convertKanjiNumberBlock('十五')).toBe('15');
    expect(convertKanjiNumberBlock('二千二十八')).toBe('2028');
    expect(convertKanjiNumberBlock('三百五十')).toBe('350');
    expect(convertKanjiNumberBlock('一万二千')).toBe('12000');

    expect(toJapanesePhoneticReading('15万円')).toBe(
      toJapanesePhoneticReading('十五万円')
    );
    expect(toJapanesePhoneticReading('2028年8月')).toBe(
      toJapanesePhoneticReading('二千二十八年八月')
    );
  });

  it('unifies English and Katakana loanwords (YouTube / MacBook / iPhone / AI)', () => {
    expect(toJapanesePhoneticReading('YouTubeの撮影')).toBe(
      toJapanesePhoneticReading('ユーチューブのさつえい')
    );
    expect(toJapanesePhoneticReading('MacBookとiPhone')).toBe(
      toJapanesePhoneticReading('マックブックとアイフォーン')
    );
  });

  it('strips Japanese fillers and extracts self-correction phrases', () => {
    const cleaned = stripJapaneseFillers(
      'えーっと、あのー、これから撮影を開始します'
    );
    expect(cleaned).not.toContain('えーっと');
    expect(cleaned).not.toContain('あのー');

    const corrected = extractSelfCorrectionCandidate(
      '月額15万円、いや、月額18万円のプランを選択します'
    );
    expect(corrected).toBe('月額18万円のプランを選択します');
  });

  it('computes exponential backoff for speech recognition auto-recovery up to MAX_AUTO_RESTART_RETRIES', () => {
    expect(MAX_AUTO_RESTART_RETRIES).toBe(8);
    const d0 = computeRestartBackoffMs(0);
    const d2 = computeRestartBackoffMs(2);
    const d5 = computeRestartBackoffMs(5);
    expect(d0).toBeLessThan(d2);
    expect(d2).toBeLessThan(d5);
    expect(d5).toBeLessThanOrEqual(3000);
  });

  it('evaluates all 18 benchmark scenarios and demonstrates quantitative improvement over legacy normalization', () => {
    const legacyMetrics = runBenchmarkSuite(true);
    const phase5Metrics = runBenchmarkSuite(false);

    // Log quantitative comparison table for verification report
    console.info('=== Phase 5 Benchmark Comparison (18 Scenarios) ===');
    console.info('Before (Legacy Surface Only):', {
      accuracyPercent: legacyMetrics.accuracyPercent,
      correctCount: `${legacyMetrics.correctCount}/${legacyMetrics.totalCases}`,
      falseJumpRatePercent: legacyMetrics.falseJumpRatePercent,
      unintendedBacktrackCount: legacyMetrics.unintendedBacktrackCount,
      avgLatencyMs: legacyMetrics.avgLatencyMs,
    });
    console.info('After (Phase 5 Phonetic + Composite Scoring):', {
      accuracyPercent: phase5Metrics.accuracyPercent,
      correctCount: `${phase5Metrics.correctCount}/${phase5Metrics.totalCases}`,
      falseJumpRatePercent: phase5Metrics.falseJumpRatePercent,
      unintendedBacktrackCount: phase5Metrics.unintendedBacktrackCount,
      avgLatencyMs: phase5Metrics.avgLatencyMs,
    });

    expect(phase5Metrics.accuracyPercent).toBe(100);
    expect(phase5Metrics.correctCount).toBe(18);
    expect(phase5Metrics.falseJumpCount).toBe(0);
    expect(phase5Metrics.unintendedBacktrackCount).toBe(0);
    expect(phase5Metrics.accuracyPercent).toBeGreaterThan(
      legacyMetrics.accuracyPercent
    );
    expect(phase5Metrics.avgLatencyMs).toBeLessThan(5);
  });
});
