import { ScriptSegment } from '@/types/prompter';
import { normalizeTextForMatching } from '@/lib/scriptParser';

export interface MatchEvaluationResult {
  matchedSegmentIndex: number;
  similarityScore: number;     // 0.0 to 1.0
  distanceFromCurrent: number; // signed segment delta (e.g., +1, -1, +4)
  shouldAdvance: boolean;
  reason:
    | 'local-advance'
    | 'same-segment'
    | 'backtrack-reread'
    | 'forward-skip'
    | 'low-confidence-hold'
    | 'too-short-hold';
}

/**
 * 2つの正規化済み文字列間のBigram Dice係数（0.0〜1.0）を算出する。
 * 言い間違い・一部の単語の省略・語순の微細な変化に対して高いロバスト性を持つ。
 */
export function computeBigramDiceSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (b.includes(a) || a.includes(b)) {
    const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    // 発話の途中（部分一致）でも十分な長さがあれば高スコアを与える
    if (Math.min(a.length, b.length) >= 4) {
      return Math.min(1, 0.82 + ratio * 0.18);
    }
  }

  if (a.length < 2 || b.length < 2) {
    return a === b ? 1 : 0;
  }

  const bigramsA = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2);
    bigramsA.set(bg, (bigramsA.get(bg) || 0) + 1);
  }

  let intersection = 0;
  for (let j = 0; j < b.length - 1; j++) {
    const bg = b.slice(j, j + 2);
    const count = bigramsA.get(bg) || 0;
    if (count > 0) {
      intersection++;
      bigramsA.set(bg, count - 1);
    }
  }

  return (2.0 * intersection) / (a.length - 1 + (b.length - 1));
}

/**
 * 発話文字列（spokenNorm）が対象セグメント（segmentNorm）のどの部分と最もよく一致するかを
 * スライディングウィンドウ＋レーベンシュタイン編集距離＆Bigram類似度で評価する。
 * 原稿にないフィラー・説明の挿入や、一部単語の読み飛ばし・言い間違いに対応する。
 */
export function evaluateSpokenAgainstSegment(
  spokenNorm: string,
  segmentNorm: string
): number {
  if (!spokenNorm || !segmentNorm) return 0;

  // 発話が長すぎる場合（複数の文が連結された認識結果など）は末尾の直近発話も評価する
  const candidatesToTest = [spokenNorm];
  if (spokenNorm.length > 18) {
    candidatesToTest.push(spokenNorm.slice(-16));
  }
  if (spokenNorm.length > 10) {
    candidatesToTest.push(spokenNorm.slice(-10));
  }

  let bestScore = 0;

  for (const query of candidatesToTest) {
    if (query.length < 2) continue;

    // 1. 完全部分文字列一致チェック
    if (segmentNorm.includes(query)) {
      const coverage = Math.min(1, query.length / Math.min(12, segmentNorm.length));
      const score = 0.78 + coverage * 0.22;
      if (score > bestScore) bestScore = score;
      continue;
    }

    // 2. セグメント内のスライディングウィンドウで最大類似度を探索
    const winLen = Math.min(segmentNorm.length, Math.max(query.length, 4));
    const step = Math.max(1, Math.floor(winLen / 4));

    for (let pos = 0; pos <= segmentNorm.length - Math.min(3, winLen); pos += step) {
      const slice = segmentNorm.slice(pos, pos + winLen + 3);
      const dice = computeBigramDiceSimilarity(query, slice);
      if (dice > bestScore) {
        bestScore = dice;
      }
    }

    // 3. セグメント全体とのBigram類似度
    const fullDice = computeBigramDiceSimilarity(query, segmentNorm);
    if (fullDice > bestScore) {
      bestScore = fullDice;
    }
  }

  return bestScore;
}

export interface FindBestSegmentOptions {
  currentIndex: number;
  sensitivity: number; // 0.35〜0.9 (高いほど敏感に追従、標準0.65)
  isFinal: boolean;
}

/**
 * 4.2 & 4.3 原稿位置の推定アルゴリズム
 * - 現在位置の周辺を優先して類似度を計算する
 * - 類似度が十分に高い場合に読み上げ位置を更新する
 * - 信頼度が低い場合は現在位置を維持する
 * - 大きな位置移動（前の文章の読み直し・次の段落へのジャンプ）には、より高い一致度を要求する
 * - 認識結果の揺らぎによって原稿表示が頻繁に前後しないようにする（ヒステリシス制御）
 */
export function findBestMatchingSegment(
  spokenRawText: string,
  segments: ScriptSegment[],
  options: FindBestSegmentOptions
): MatchEvaluationResult {
  const { currentIndex, sensitivity, isFinal } = options;

  if (segments.length === 0) {
    return {
      matchedSegmentIndex: 0,
      similarityScore: 0,
      distanceFromCurrent: 0,
      shouldAdvance: false,
      reason: 'low-confidence-hold',
    };
  }

  const safeCurrentIdx = Math.max(
    0,
    Math.min(segments.length - 1, currentIndex)
  );
  const spokenNorm = normalizeTextForMatching(spokenRawText);

  // 極端に短い発話（1〜2文字の相槌やノイズ「あ」「えー」など）は位置を動かさない
  if (spokenNorm.length < 3) {
    return {
      matchedSegmentIndex: safeCurrentIdx,
      similarityScore: 0,
      distanceFromCurrent: 0,
      shouldAdvance: false,
      reason: 'too-short-hold',
    };
  }

  // 感度設定 (0.35〜0.9) からベース閾値を計算（感度が高いほど閾値を下げる）
  // 標準 sensitivity=0.65 のとき baseThreshold ≈ 0.46
  const baseThreshold = Math.max(0.32, Math.min(0.68, 0.85 - sensitivity * 0.6));

  const currentSeg = segments[safeCurrentIdx];
  const currentScore = evaluateSpokenAgainstSegment(
    spokenNorm,
    currentSeg.normalizedText
  );

  // 現在セグメントの末尾付近を読んでいる場合、次のセグメントへの自然な遷移を促す
  const tailOfCurrent = currentSeg.normalizedText.slice(-8);
  const isNearEndOfCurrent =
    tailOfCurrent.length >= 3 &&
    computeBigramDiceSimilarity(spokenNorm.slice(-8), tailOfCurrent) >= 0.65;

  let bestIdx = safeCurrentIdx;
  let bestWeightedScore = currentScore;
  let bestRawScore = currentScore;

  // 探索範囲：前方15セグメント、後方5セグメント（長文でも高速かつ段落ジャンプ・読み直しをカバー）
  const searchStart = Math.max(0, safeCurrentIdx - 5);
  const searchEnd = Math.min(segments.length - 1, safeCurrentIdx + 15);

  for (let idx = searchStart; idx <= searchEnd; idx++) {
    if (idx === safeCurrentIdx) continue;

    const candidate = segments[idx];
    const rawScore = evaluateSpokenAgainstSegment(
      spokenNorm,
      candidate.normalizedText
    );
    const delta = idx - safeCurrentIdx;

    // 距離に応じた近傍優先重み付け（4.3.3 現在位置の周辺を優先）
    let proximityMultiplier = 1.0;
    if (delta === 1) {
      // 直後のフレーズは最も自然な遷移先なので優遇
      proximityMultiplier = isNearEndOfCurrent ? 1.12 : 1.05;
    } else if (delta === 2) {
      proximityMultiplier = 0.96;
    } else if (delta > 2 && delta <= 5) {
      // 小幅な飛ばし読み
      proximityMultiplier = 0.86;
    } else if (delta > 5) {
      // 次の段落へのジャンプなど大きな前方移動
      proximityMultiplier = 0.78;
    } else if (delta < 0) {
      // 前の文章の読み直し（揺らぎによる逆戻りを防ぐためペナルティを課す）
      proximityMultiplier = 0.76;
    }

    const weightedScore = rawScore * proximityMultiplier;

    if (weightedScore > bestWeightedScore + 0.04) {
      bestWeightedScore = weightedScore;
      bestRawScore = rawScore;
      bestIdx = idx;
    }
  }

  const delta = bestIdx - safeCurrentIdx;

  // 1. 同じセグメントに留まる場合
  if (delta === 0) {
    // もし現在のセグメントの末尾を読み終えた確定結果であれば、次のセグメントへ一歩進める
    if (isFinal && isNearEndOfCurrent && safeCurrentIdx + 1 < segments.length) {
      return {
        matchedSegmentIndex: safeCurrentIdx + 1,
        similarityScore: currentScore,
        distanceFromCurrent: 1,
        shouldAdvance: true,
        reason: 'local-advance',
      };
    }

    return {
      matchedSegmentIndex: safeCurrentIdx,
      similarityScore: currentScore,
      distanceFromCurrent: 0,
      shouldAdvance: false,
      reason: 'same-segment',
    };
  }

  // 2. 直後の1〜2フレーズへの通常進行
  if (delta === 1 || delta === 2) {
    const requiredScore = delta === 1 ? baseThreshold : baseThreshold + 0.08;
    if (bestRawScore >= requiredScore) {
      return {
        matchedSegmentIndex: bestIdx,
        similarityScore: bestRawScore,
        distanceFromCurrent: delta,
        shouldAdvance: true,
        reason: 'local-advance',
      };
    }
  }

  // 3. 大きな前方移動（飛ばし読み・次の段落へのジャンプ: delta >= 3）
  // 4.3.6 大きな位置移動には、より高い一致度を要求する
  if (delta >= 3) {
    const jumpThreshold = Math.min(0.85, baseThreshold + 0.22);
    // 十分な文字数（6文字以上）かつ高類似度のときのみジャンプを許可
    if (spokenNorm.length >= 6 && bestRawScore >= jumpThreshold) {
      return {
        matchedSegmentIndex: bestIdx,
        similarityScore: bestRawScore,
        distanceFromCurrent: delta,
        shouldAdvance: true,
        reason: 'forward-skip',
      };
    }
  }

  // 4. 前の文章の読み直し（delta < 0）
  // 認識結果の揺らぎで頻繁に前後しないよう、6文字以上かつ高い一致度が必要
  if (delta < 0) {
    const backtrackThreshold = Math.min(0.86, baseThreshold + 0.24);
    if (spokenNorm.length >= 6 && bestRawScore >= backtrackThreshold) {
      return {
        matchedSegmentIndex: bestIdx,
        similarityScore: bestRawScore,
        distanceFromCurrent: delta,
        shouldAdvance: true,
        reason: 'backtrack-reread',
      };
    }
  }

  // 5. 信頼度が閾値未満の場合は現在位置を維持（原稿にないアドリブ挿入や言い間違い時）
  return {
    matchedSegmentIndex: safeCurrentIdx,
    similarityScore: bestRawScore,
    distanceFromCurrent: 0,
    shouldAdvance: false,
    reason: 'low-confidence-hold',
  };
}
