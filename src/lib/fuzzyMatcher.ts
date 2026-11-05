import { ScriptSegment } from '@/types/prompter';
import { normalizeTextForMatching } from '@/lib/scriptParser';
import {
  extractSelfCorrectionCandidate,
  toJapanesePhoneticReading,
} from '@/lib/japaneseNormalizer';

export interface MatchEvaluationResult {
  matchedSegmentIndex: number;
  similarityScore: number;     // 0.0 to 1.0
  progressRatio: number;       // 0.0 to 1.0 (現在フレーズ内の到達位置比率)
  distanceFromCurrent: number; // signed segment delta (e.g., +1, -1, +4)
  shouldAdvance: boolean;
  reason:
    | 'local-advance'
    | 'early-trigger-advance'
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

  // 発話が長すぎる場合（複数の文が連結された認識結果など）は末尾の直近発話（最大14文字）を優先評価する
  const candidatesToTest: string[] = [];
  if (spokenNorm.length <= 22) {
    candidatesToTest.push(spokenNorm);
  }
  if (spokenNorm.length > 14) {
    candidatesToTest.push(spokenNorm.slice(-14));
  }
  if (spokenNorm.length > 9) {
    candidatesToTest.push(spokenNorm.slice(-9));
  }

  let bestScore = 0;

  for (const query of candidatesToTest) {
    if (query.length < 2) continue;

    // 1. 完全部分文字列一致チェック
    // ※ 2文字（「ます」「です」「して」など）の短い一致だけで高スコア（0.80以上）を与えてしまうと、
    //    まだ読んでいない次の文の語尾に反応して早期スクロールしてしまうため、4文字以上の一致に限定する。
    if (query.length >= 4 && segmentNorm.includes(query)) {
      const coverage = Math.min(
        1,
        query.length / Math.min(12, segmentNorm.length)
      );
      const score = 0.78 + coverage * 0.22;
      if (score > bestScore) bestScore = score;
      continue;
    }

    // 2. セグメント内のスライディングウィンドウで最大類似度を探索
    // 重要：query が segmentNorm より長い場合に winLen を segmentNorm.length に丸めてしまうと、
    // 長い累積発話の中に偶然含まれるビッググラムだけで短い別段落が 0.65 以上の高スコアになる誤爆が起きる。
    // そのため window サイズは query.length（上限20文字）を基準にして比較する。
    const effectiveQuery = query.length > 20 ? query.slice(-20) : query;
    if (effectiveQuery.length >= segmentNorm.length) {
      const fullDice = computeBigramDiceSimilarity(effectiveQuery, segmentNorm);
      if (fullDice > bestScore) {
        bestScore = fullDice;
      }
      continue;
    }

    const winLen = Math.max(effectiveQuery.length, 4);
    const step = Math.max(1, Math.floor(winLen / 4));

    for (
      let pos = 0;
      pos <= Math.max(0, segmentNorm.length - winLen);
      pos += step
    ) {
      const slice = segmentNorm.slice(pos, pos + winLen + 2);
      const dice = computeBigramDiceSimilarity(effectiveQuery, slice);
      if (dice > bestScore) {
        bestScore = dice;
      }
    }

    // 3. セグメント全体とのBigram類似度
    const fullDice = computeBigramDiceSimilarity(effectiveQuery, segmentNorm);
    if (fullDice > bestScore) {
      bestScore = fullDice;
    }
  }

  return bestScore;
}

export interface FindBestSegmentOptions {
  currentIndex: number;
  sensitivity: number;           // 0.35〜0.9 (高いほど敏感に追従、標準0.65)
  advanceTriggerRatio?: number;  // 0.40〜0.95 (現在の文・段落の何割まで読んだら次へ先行遷移するか、標準0.85)
  isFinal: boolean;
  /**
   * 前のセグメント（currentIndex - 1）から先行遷移してきた直後の場合、
   * 話者がまだ前のセグメントの後半を読み終えている途中であるため、
   * 前のセグメントへの逆戻り（ピンポン現象）や、前のセグメント残余音声による二重送りを防止する。
   */
  preventBacktrackToIndex?: number | null;
  /**
   * 一度スクロールして進んだ段落・フレーズからは音声認識で後ろへ戻らないようにする（デフォルト: false、ステージ側では設定に応じて渡す）
   */
  allowBacktrack?: boolean;
  /**
   * Phase 5 ベンチマーク比較用：true の場合は改善前（表層正規化のみ）で評価し、false（標準）の場合は
   * 読み正規化・漢数字/英単語統一・フィラー除去・言い直し補正を含む複合スコアリングを使用する。
   */
  useLegacyNormalizationOnly?: boolean;
}

/**
 * 発話(spokenNorm)が現在セグメント(segmentNorm)のどの位置（0.0〜1.0）まで到達しているかを推定する。
 * 音声認識特有の漢字変換揺れ（例：原稿「維持」→ 認識「いじ」）があっても、
 * 3〜8文字のマルチスケール窓と2文字Bigramの末尾位置から頑健に現在位置比率を算出する。
 */
export function estimateSegmentProgressRatio(
  spokenNorm: string,
  segmentNorm: string
): number {
  if (!spokenNorm || !segmentNorm) return 0;

  const segLen = segmentNorm.length;
  if (segLen === 0) return 0;

  let maxProgress = 0;

  // 1. 発話末尾の複数ウィンドウ長（4〜10文字）で完全一致または高類似度スライスを探索
  const tailSource = spokenNorm.slice(-Math.min(14, spokenNorm.length));
  const candidateLengths = [10, 8, 6, 5, 4].filter(
    (len) => len <= tailSource.length && len <= segLen
  );

  for (const len of candidateLengths) {
    const tailQuery = tailSource.slice(-len);
    const exactIdx = segmentNorm.lastIndexOf(tailQuery);
    if (exactIdx !== -1) {
      const ratio = (exactIdx + len) / segLen;
      if (ratio > maxProgress) maxProgress = ratio;
      break;
    }

    // 漢字揺れなどで完全一致しない場合はスライディングウィンドウでBigram類似度を評価
    // ※ 発話文字数に対して極端に先（spokenNorm.length * 1.45 より後ろ）の位置と偶然マッチして
    //    文の途中なのに進捗90%と誤判定されないよう探索上限位置を制限する
    const maxPlausiblePos = Math.min(
      segLen - len,
      Math.max(8, Math.ceil(spokenNorm.length * 1.45))
    );
    for (let pos = 0; pos <= maxPlausiblePos; pos++) {
      const slice = segmentNorm.slice(pos, pos + len);
      const dice = computeBigramDiceSimilarity(tailQuery, slice);
      if (dice >= 0.56) {
        const ratio = (pos + len) / segLen;
        if (ratio > maxProgress) {
          maxProgress = ratio;
        }
      }
    }
  }

  // 2. 直近発話（末尾6文字）に含まれる2文字Bigramがセグメント内の妥当な到達範囲のどこに出現するかで補完
  const recentTail = spokenNorm.slice(-Math.min(6, spokenNorm.length));
  if (recentTail.length >= 2) {
    let matchedBigrams = 0;
    let latestBigramEnd = 0;
    const maxPlausibleEnd = Math.min(
      segLen,
      Math.max(10, Math.ceil(spokenNorm.length * 1.45))
    );
    const plausibleSegmentSlice = segmentNorm.slice(0, maxPlausibleEnd);

    for (let i = 0; i < recentTail.length - 1; i++) {
      const bg = recentTail.slice(i, i + 2);
      const idx = plausibleSegmentSlice.lastIndexOf(bg);
      if (idx !== -1) {
        matchedBigrams++;
        if (idx + 2 > latestBigramEnd) {
          latestBigramEnd = idx + 2;
        }
      }
    }
    // 2個以上のBigram（または短文なら1個以上）が一致していればその到達位置を採用
    if (matchedBigrams >= 2 || (segLen <= 10 && matchedBigrams >= 1)) {
      const bgRatio = latestBigramEnd / segLen;
      if (bgRatio > maxProgress) {
        maxProgress = bgRatio;
      }
    }
  }

  // 3. 発話全体の文字長比率による下限補完：
  // 途中認識(interim)では未確定の語尾がすべてひらがな（例：「自然に維持」→「しぜんにいじ」）になることが多く、
  // 原稿が漢字だと末尾の文字一致だけでは進捗率が過小評価されるため、
  // セグメント冒頭と高い類似度（>= 0.58）で一致している場合のみ、ひらがな膨張分を補正した係数(0.84)で補完する
  const headSlice = segmentNorm.slice(0, Math.min(segLen, spokenNorm.length + 4));
  const headSim = computeBigramDiceSimilarity(
    spokenNorm.slice(0, Math.min(10, spokenNorm.length)),
    headSlice.slice(0, Math.min(10, headSlice.length))
  );
  if (headSim >= 0.58) {
    const lengthBasedRatio = Math.min(0.90, (spokenNorm.length * 0.84) / segLen);
    if (lengthBasedRatio > maxProgress) {
      maxProgress = lengthBasedRatio;
    }
  }

  return Math.min(1, maxProgress);
}

/**
 * 4.2 & 4.3 原稿位置の推定アルゴリズム
 * - 現在位置の周辺を優先して類似度を計算する
 * - 類似度が十分に高い場合に読み上げ位置を更新する
 * - 信頼度が低い場合は現在位置を維持する
 * - 大きな位置移動（前の文章の読み直し・次の段落へのジャンプ）には、より高い一致度を要求する
 * - 認識結果の揺らぎによって原稿表示が頻繁に前後しないようにする（ヒステリシス制御）
 * - advanceTriggerRatio に基づき、現在フレーズや段落末の指定割合を通過した時点で次フレーズ・次段落へ先行遷移する
 */
export function findBestMatchingSegment(
  spokenRawText: string,
  segments: ScriptSegment[],
  options: FindBestSegmentOptions
): MatchEvaluationResult {
  const {
    currentIndex,
    sensitivity,
    advanceTriggerRatio = 0.90,
    isFinal,
    preventBacktrackToIndex = null,
    allowBacktrack = true,
    useLegacyNormalizationOnly = false,
  } = options;

  if (segments.length === 0) {
    return {
      matchedSegmentIndex: 0,
      similarityScore: 0,
      progressRatio: 0,
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
  const spokenReading = useLegacyNormalizationOnly
    ? spokenNorm
    : toJapanesePhoneticReading(spokenRawText);
  const selfCorrectionRaw = useLegacyNormalizationOnly
    ? null
    : extractSelfCorrectionCandidate(spokenRawText);
  const selfCorrectionReading = selfCorrectionRaw
    ? toJapanesePhoneticReading(selfCorrectionRaw)
    : null;

  const effectiveLength = useLegacyNormalizationOnly
    ? spokenNorm.length
    : Math.max(spokenReading.length, selfCorrectionReading?.length ?? 0);

  // 極端に短い発話（1〜2文字の相槌やノイズ「あ」「えー」など）は位置を動かさない
  if (effectiveLength < 3) {
    return {
      matchedSegmentIndex: safeCurrentIdx,
      similarityScore: 0,
      progressRatio: 0,
      distanceFromCurrent: 0,
      shouldAdvance: false,
      reason: 'too-short-hold',
    };
  }

  // Helper to evaluate composite similarity (surface + phonetic reading + self-correction) against a segment (Section 7.3 & 7.4)
  const scoreSegmentComposite = (seg: ScriptSegment): number => {
    const surfaceScore = evaluateSpokenAgainstSegment(
      spokenNorm,
      seg.normalizedText
    );
    if (useLegacyNormalizationOnly) {
      return surfaceScore;
    }
    const segReading = seg.readingText || toJapanesePhoneticReading(seg.text);
    const readingScore = evaluateSpokenAgainstSegment(
      spokenReading,
      segReading
    );
    const correctionScore = selfCorrectionReading
      ? evaluateSpokenAgainstSegment(selfCorrectionReading, segReading)
      : 0;
    return Math.max(surfaceScore, readingScore * 0.99, correctionScore * 0.98);
  };

  // Helper to evaluate head similarity for a segment
  const scoreSegmentHeadComposite = (
    seg: ScriptSegment,
    ratio = 0.65
  ): number => {
    const surfaceHeadLen = Math.max(
      4,
      Math.ceil(seg.normalizedText.length * ratio)
    );
    const surfaceHeadScore = evaluateSpokenAgainstSegment(
      spokenNorm,
      seg.normalizedText.slice(0, surfaceHeadLen)
    );
    if (useLegacyNormalizationOnly) {
      return surfaceHeadScore;
    }
    const segReading = seg.readingText || toJapanesePhoneticReading(seg.text);
    const readingHeadLen = Math.max(4, Math.ceil(segReading.length * ratio));
    const readingHeadScore = evaluateSpokenAgainstSegment(
      spokenReading,
      segReading.slice(0, readingHeadLen)
    );
    const correctionHeadScore = selfCorrectionReading
      ? evaluateSpokenAgainstSegment(
          selfCorrectionReading,
          segReading.slice(0, readingHeadLen)
        )
      : 0;
    return Math.max(
      surfaceHeadScore,
      readingHeadScore * 0.99,
      correctionHeadScore * 0.98
    );
  };

  // 感度設定 (0.35〜0.9) からベース閾値を計算（感度が高いほど閾値を下げる）
  // 標準 sensitivity=0.65 のとき baseThreshold ≈ 0.46
  const baseThreshold = Math.max(0.32, Math.min(0.68, 0.85 - sensitivity * 0.6));

  const currentSeg = segments[safeCurrentIdx];
  const currentScore = scoreSegmentComposite(currentSeg);

  // 直前に先行送り（early-trigger-advance等）されたばかりで、話者がまだ1つ前のセグメントの後半（文末）を
  // 読み終えている途中の場合は、現在のセグメント（N+1）に留まり、さらなる次セグメント（N+2等）への連鎖飛び越しを防ぐ。
  if (
    preventBacktrackToIndex !== null &&
    preventBacktrackToIndex >= 0 &&
    preventBacktrackToIndex < segments.length &&
    preventBacktrackToIndex !== safeCurrentIdx
  ) {
    const prevSeg = segments[preventBacktrackToIndex];
    const prevScore = scoreSegmentComposite(prevSeg);
    const currentHeadScore = scoreSegmentHeadComposite(currentSeg, 0.65);

    // まだ新しいセグメントの前半を読み始めておらず、前のセグメントの残り言葉（または文末の共通語尾）を話している段階
    if (
      (prevScore >= currentScore && currentHeadScore < baseThreshold + 0.08) ||
      (prevScore >= 0.45 && currentHeadScore < 0.48)
    ) {
      return {
        matchedSegmentIndex: safeCurrentIdx,
        similarityScore: currentScore,
        progressRatio: 0,
        distanceFromCurrent: 0,
        shouldAdvance: false,
        reason: 'same-segment',
      };
    }
  }

  const effectiveTriggerRatio = advanceTriggerRatio;

  const surfaceProgress = estimateSegmentProgressRatio(
    spokenNorm,
    currentSeg.normalizedText
  );
  const currentSegReading =
    currentSeg.readingText || toJapanesePhoneticReading(currentSeg.text);
  const readingProgress = useLegacyNormalizationOnly
    ? 0
    : estimateSegmentProgressRatio(
        selfCorrectionReading || spokenReading,
        currentSegReading
      );
  const progressRatio = Math.max(surfaceProgress, readingProgress);

  const currentHeadScore = scoreSegmentHeadComposite(currentSeg, 0.65);
  const hasStartedReadingCurrent =
    currentSeg.normalizedText.length <= 10 ||
    currentHeadScore >= 0.42 ||
    effectiveLength >=
      Math.min(10, Math.floor(currentSeg.normalizedText.length * 0.45));

  const tailOfCurrentSurface = currentSeg.normalizedText.slice(-8);
  const tailOfCurrentReading = currentSegReading.slice(-8);
  const activeReadingQuery = selfCorrectionReading || spokenReading;

  const isNearEndOfCurrent =
    hasStartedReadingCurrent &&
    (((tailOfCurrentSurface.length >= 3 &&
      spokenNorm.length >= 5 &&
      computeBigramDiceSimilarity(
        spokenNorm.slice(-8),
        tailOfCurrentSurface
      ) >= 0.65) ||
      (!useLegacyNormalizationOnly &&
        tailOfCurrentReading.length >= 3 &&
        activeReadingQuery.length >= 5 &&
        computeBigramDiceSimilarity(
          activeReadingQuery.slice(-8),
          tailOfCurrentReading
        ) >= 0.65)) ||
      (currentScore >= baseThreshold * 0.85 &&
        progressRatio >= effectiveTriggerRatio));

  let bestIdx = safeCurrentIdx;
  let bestWeightedScore = currentScore;
  let bestRawScore = currentScore;

  // 探索範囲：前方15セグメント、後方5セグメント（allowBacktrack=false の場合は現在位置以降のみ探索し、過去の段落には絶対に戻らない）
  const searchStart = allowBacktrack ? Math.max(0, safeCurrentIdx - 5) : safeCurrentIdx;
  const searchEnd = Math.min(segments.length - 1, safeCurrentIdx + 15);

  // Vol.3: 見出し行(isHeading)やト書きのみ行(isCueOnly)は声に出して読まない場合が多いため、
  // 2つのインデックス間の「発話対象セグメント距離 (spokenDelta)」を計算し、見出し・ト書き行を挟んでも直後のセリフ(spokenDelta === 1)として扱う
  const countNonSpokenBetween = (fromIdx: number, toIdx: number): number => {
    if (toIdx <= fromIdx) return 0;
    let nonSpoken = 0;
    // If current segment itself is a heading or cue-only, count it so the immediately following spoken line has spokenDelta = 1
    if (segments[fromIdx]?.isHeading || segments[fromIdx]?.isCueOnly) {
      nonSpoken++;
    }
    for (let k = fromIdx + 1; k < toIdx; k++) {
      if (segments[k]?.isHeading || segments[k]?.isCueOnly) {
        nonSpoken++;
      }
    }
    return nonSpoken;
  };

  for (let idx = searchStart; idx <= searchEnd; idx++) {
    if (idx === safeCurrentIdx) continue;

    const candidate = segments[idx];
    if (candidate.isCueOnly || !candidate.normalizedText) continue;

    const rawScore = scoreSegmentComposite(candidate);
    const rawDelta = idx - safeCurrentIdx;
    const effectiveDelta =
      rawDelta > 0
        ? Math.max(1, rawDelta - countNonSpokenBetween(safeCurrentIdx, idx))
        : rawDelta;

    // 距離に応じた近傍優先重み付け（4.3.3 & 7.4 現在位置の周辺・前後連続性を優先）
    let proximityMultiplier = 1.0;
    if (effectiveDelta === 1) {
      // 直後のフレーズ（または見出し・ト書き直後のフレーズ）は最も自然な遷移先なので優遇
      proximityMultiplier = isNearEndOfCurrent ? 1.12 : 1.05;
    } else if (effectiveDelta === 2) {
      proximityMultiplier = 0.96;
    } else if (effectiveDelta > 2 && effectiveDelta <= 5) {
      // 小幅な飛ばし読み
      proximityMultiplier = 0.86;
    } else if (effectiveDelta > 5) {
      // 次の段落へのジャンプなど大きな前方移動
      proximityMultiplier = 0.78;
    } else if (effectiveDelta < 0) {
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

  const rawDelta = bestIdx - safeCurrentIdx;
  const delta =
    rawDelta > 0
      ? Math.max(1, rawDelta - countNonSpokenBetween(safeCurrentIdx, bestIdx))
      : rawDelta;

  // 1. 同じセグメントに留まる場合
  if (delta === 0) {
    // 確定結果(isFinal)で文末付近に到達した場合、またはユーザーが早め遷移(advanceTriggerRatio <= 0.90)を設定していて
    // 途中認識(interim)でも指定割合を通過した場合は次のセグメントへ進める。
    const allowEarlyInterimAdvance =
      effectiveTriggerRatio <= 0.92 &&
      progressRatio >= effectiveTriggerRatio &&
      currentScore >= baseThreshold * 0.85;

    if (
      (isFinal || allowEarlyInterimAdvance) &&
      isNearEndOfCurrent &&
      safeCurrentIdx + 1 < segments.length
    ) {
      return {
        matchedSegmentIndex: safeCurrentIdx + 1,
        similarityScore: currentScore,
        progressRatio,
        distanceFromCurrent: 1,
        shouldAdvance: true,
        reason: allowEarlyInterimAdvance
          ? 'early-trigger-advance'
          : 'local-advance',
      };
    }

    return {
      matchedSegmentIndex: safeCurrentIdx,
      similarityScore: currentScore,
      progressRatio,
      distanceFromCurrent: 0,
      shouldAdvance: false,
      reason: 'same-segment',
    };
  }

  // 2. 直後の1〜2フレーズへの通常進行
  if (delta === 1 || delta === 2) {
    // 途中認識(interim)での2行一気飛ばし（delta === 2）は誤爆しやすいため、
    // isFinal確定時、または12文字以上で非常に高い類似度（>= 0.80）かつ現在セグメントより明確に高い場合のみ許可する
    if (delta === 2) {
      const canSkipOneOnInterim =
        effectiveLength >= 12 &&
        bestRawScore >= Math.max(0.80, baseThreshold + 0.20) &&
        bestRawScore > currentScore + 0.18;
      if (
        (isFinal &&
          effectiveLength >= 7 &&
          bestRawScore >= baseThreshold + 0.14 &&
          bestRawScore > currentScore + 0.12) ||
        canSkipOneOnInterim
      ) {
        return {
          matchedSegmentIndex: bestIdx,
          similarityScore: bestRawScore,
          progressRatio,
          distanceFromCurrent: delta,
          shouldAdvance: true,
          reason: 'local-advance',
        };
      }
    } else if (delta === 1 && bestRawScore >= baseThreshold) {
      return {
        matchedSegmentIndex: bestIdx,
        similarityScore: bestRawScore,
        progressRatio,
        distanceFromCurrent: 1,
        shouldAdvance: true,
        reason: 'local-advance',
      };
    }
  }

  // 3. 大きな前方移動（飛ばし読み・次の段落へのジャンプ: delta >= 3）
  // 4.3.6 大きな位置移動には、より高い一致度を要求する（途中認識での複数行暴走ジャンプを防止）
  // ただし「現在セグメントとよく一致しているのに共通単語で先の段落にも一致した」ケースを弾くため、
  // bestRawScore > currentScore + 0.25 かつ、飛び先セグメントの広範囲（または冒頭）と75%以上一致していることを要求する。
  if (delta >= 3) {
    const jumpThreshold = Math.min(0.86, baseThreshold + 0.25);
    const candidateSeg = segments[bestIdx];
    const candidateNorm = candidateSeg.normalizedText;
    const headLen = Math.min(16, candidateNorm.length);
    const surfaceHeadMatch = Math.max(
      computeBigramDiceSimilarity(
        spokenNorm.slice(0, headLen),
        candidateNorm.slice(0, headLen)
      ),
      computeBigramDiceSimilarity(
        spokenNorm.slice(-headLen),
        candidateNorm.slice(0, headLen)
      )
    );
    const compositeHeadMatch = useLegacyNormalizationOnly
      ? surfaceHeadMatch
      : Math.max(
          surfaceHeadMatch,
          scoreSegmentHeadComposite(candidateSeg, 0.7)
        );

    if (
      isFinal &&
      effectiveLength >= 10 &&
      bestRawScore >= jumpThreshold &&
      compositeHeadMatch >= 0.65 &&
      bestRawScore > currentScore + 0.24
    ) {
      return {
        matchedSegmentIndex: bestIdx,
        similarityScore: bestRawScore,
        progressRatio,
        distanceFromCurrent: delta,
        shouldAdvance: true,
        reason: 'forward-skip',
      };
    }
  }

  // 4. 前の文章の読み直し（delta < 0）
  // 認識結果の揺らぎや、前の段落の末尾残余音声で元の段落に逆戻り（ピンポン現象）しないよう厳格にガードする：
  // - 途中認識(interim)では逆戻りしない（isFinal確定時、または14文字以上の明確な再発話のみ許可）
  // - 直前に遷移してきた元のセグメント(preventBacktrackToIndex)への逆戻りはブロック
  // - 現在のセグメントでも一定の類似度がある場合は逆戻りしない
  if (delta < 0) {
    if (bestIdx === preventBacktrackToIndex) {
      return {
        matchedSegmentIndex: safeCurrentIdx,
        similarityScore: currentScore,
        progressRatio,
        distanceFromCurrent: 0,
        shouldAdvance: false,
        reason: 'same-segment',
      };
    }

    const isCrossParagraphBacktrack =
      segments[bestIdx].paragraphIndex < currentSeg.paragraphIndex;
    const backtrackThreshold = Math.min(
      0.90,
      baseThreshold + (isCrossParagraphBacktrack ? 0.30 : 0.25)
    );
    const minBacktrackLength = isCrossParagraphBacktrack ? 10 : 8;
    const canBacktrackOnInterim =
      effectiveLength >= 16 && bestRawScore >= 0.88;

    if (
      (isFinal || canBacktrackOnInterim) &&
      effectiveLength >= minBacktrackLength &&
      bestRawScore >= backtrackThreshold &&
      bestRawScore > currentScore + 0.25
    ) {
      return {
        matchedSegmentIndex: bestIdx,
        similarityScore: bestRawScore,
        progressRatio,
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
    progressRatio,
    distanceFromCurrent: 0,
    shouldAdvance: false,
    reason: 'low-confidence-hold',
  };
}
