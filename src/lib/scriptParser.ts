import {
  LanguageCode,
  LookaheadLinesPreset,
  ScriptChapterItem,
  ScriptSegment,
  SegmentInlineToken,
} from '@/types/prompter';
import { toJapanesePhoneticReading } from '@/lib/japaneseNormalizer';

/**
 * 文字列がト書き・演出指示（ポーズ、間、表情指示等）であるかを判定する
 */
export function isStageDirectionContent(inner: string): boolean {
  const trimmed = inner.trim();
  if (!trimmed) return false;
  // 1. プレフィックス指定 (演出:、SE:、BGM:、ト書き: 等)
  if (
    /^(?:演出|ト書き|指示|動作|表情|注|SE|BGM|効果音|テロップ|スライド|ワイプ)[:：]/i.test(
      trimmed
    )
  ) {
    return true;
  }
  // 2. 秒数・ポーズ時間指定 (1秒ポーズ、2.5秒間、3秒休止 等)
  if (/\d+(?:\.\d+)?\s*(?:秒|sec|s)(?:間)?(?:ポーズ|休止|間)?/i.test(trimmed)) {
    return true;
  }
  // 3. 単体ポーズ・身体動作指示
  if (
    /^(?:ポーズ|pause|間をおく|間|一息|息継ぎ|深呼吸|咳払い|笑顔|笑顔で目線|目線|カメラ目線|手振り|身振り|ジェスチャー|お辞儀|一礼|拍手)$/i.test(
      trimmed
    )
  ) {
    return true;
  }
  if (/(?:ポーズ|pause|一呼吸|深呼吸)/i.test(trimmed)) {
    return true;
  }
  // 4. 話し方・トーン指定
  if (
    /(?:笑顔で|明るく|元気に|真剣に|落ち着いて|ゆっくり|早口で|小声で|強調して|感情を込めて)/.test(
      trimmed
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Vol.3: 原稿テキストから「ト書き（[笑顔で]・【1秒ポーズ】等）」を除外し、
 * 強調記法（**太字**・==水色==・!!赤強調!!）や見出し記号（# ）の記号部分のみを取り除いて、
 * 実際に声に出して読むテキスト（spokenText）を抽出する。
 * ※ 【第2章】や【まとめ】等の見出し・角括弧は発話テキストとして保持
 */
export function stripStageDirectionsAndFormatting(text: string): string {
  if (!text) return '';

  let cleaned = text;

  // 1. 行頭の見出し記号 (#, ##, ###) を除去（見出しテキスト自体は残す）
  cleaned = cleaned.replace(/^\s*#{1,4}\s+/, '');

  // 2. ト書き・演出ディレクションを除外
  // [...] は常にト書き
  cleaned = cleaned.replace(/\[[^\]\n]+\]/g, '');
  // 【...】 は演出・ポーズ指示のみ除外（【第2章】等の見出しや強調は保持）
  cleaned = cleaned.replace(/【([^】\n]+)】/g, (_, inner) => {
    return isStageDirectionContent(inner) ? '' : inner;
  });

  // 3. 強調マーカー (**...**, ==...==, !!...!!) は内部の言葉を残して記号のみ除去
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
  cleaned = cleaned.replace(/==([^=]+)==/g, '$1');
  cleaned = cleaned.replace(/!!([^!]+)!!/g, '$1');

  return cleaned.trim();
}

/**
 * Vol.3: 1つのセグメント文字列をインライン表示用トークン配列に分解する。
 * - `# 見出し` / `【第N章】` / `■ 見出し` -> type: 'heading'
 * - `[笑顔で]` / `【1秒ポーズ】` -> type: 'cue' (非発話・演出バッジ)
 * - `**重要**` -> type: 'highlight-yellow'
 * - `==注目==` -> type: 'highlight-sky'
 * - `!!警告!!` -> type: 'highlight-rose'
 * - 通常テキスト -> type: 'text'
 * さらに発話対象文字の累積インデックス (spokenStartChar .. spokenEndChar) を付与し、
 * フレーズ内のリアルタイム文字進捗ハイライト（カラオケ風ワイプ）に利用する。
 */
export function parseSegmentInlineTokens(text: string): {
  tokens: SegmentInlineToken[];
  totalSpokenChars: number;
  isHeading: boolean;
  headingTitle?: string;
  isCueOnly: boolean;
} {
  if (!text) {
    return {
      tokens: [],
      totalSpokenChars: 0,
      isHeading: false,
      isCueOnly: false,
    };
  }

  // 1. Markdown 見出し (# 見出し)
  const hashHeadingMatch = text.match(/^\s*(#{1,4})\s+(.*)$/);
  if (hashHeadingMatch) {
    const titleContent = hashHeadingMatch[2].trim();
    const cleanSpoken = stripStageDirectionsAndFormatting(titleContent);
    return {
      tokens: [
        {
          type: 'heading',
          raw: text,
          content: titleContent,
          spokenStartChar: 0,
          spokenEndChar: cleanSpoken.length,
        },
      ],
      totalSpokenChars: cleanSpoken.length,
      isHeading: true,
      headingTitle: cleanSpoken || titleContent,
      isCueOnly: false,
    };
  }

  // 2. 墨付き括弧見出し 【第N章 ...】 や記号見出し ■ / ◆ / 第N章
  const trimmed = text.trim();
  const bracketHeadingMatch = trimmed.match(/^\s*【([^】\n]+)】\s*$/);
  if (bracketHeadingMatch) {
    const inner = bracketHeadingMatch[1].trim();
    if (!isStageDirectionContent(inner)) {
      const cleanSpoken = stripStageDirectionsAndFormatting(inner);
      return {
        tokens: [
          {
            type: 'heading',
            raw: text,
            content: inner,
            spokenStartChar: 0,
            spokenEndChar: cleanSpoken.length,
          },
        ],
        totalSpokenChars: cleanSpoken.length,
        isHeading: true,
        headingTitle: cleanSpoken || inner,
        isCueOnly: false,
      };
    }
  }

  const explicitSectionMatch = trimmed.match(
    /^(?:■|▼|●|◆|第[0-9０-９一二三四五六七八九十]+[章節部]|Chapter\s*\d+|STEP\s*\d+|ステップ\s*[0-9０-９]+)[\s:：・]*(.*)$/i
  );
  if (explicitSectionMatch && trimmed.length <= 40) {
    const cleanSpoken = stripStageDirectionsAndFormatting(trimmed);
    return {
      tokens: [
        {
          type: 'heading',
          raw: text,
          content: cleanSpoken || trimmed,
          spokenStartChar: 0,
          spokenEndChar: cleanSpoken.length,
        },
      ],
      totalSpokenChars: cleanSpoken.length,
      isHeading: true,
      headingTitle: cleanSpoken || trimmed,
      isCueOnly: false,
    };
  }

  // Cues ([...], 【...】) and Highlights (**...**, ==...==, !!...!!)
  const tokenRegex =
    /(\[[^\]\n]+\]|【[^】\n]+】|\*\*[^*\n]+\*\*|==[^=\n]+==|!![^!\n]+!!)/g;
  const tokens: SegmentInlineToken[] = [];
  let lastIndex = 0;
  let spokenCursor = 0;
  let hasSpokenToken = false;
  let hasCueToken = false;

  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const plainSlice = text.slice(lastIndex, match.index);
      const len = plainSlice.length;
      if (len > 0) {
        if (plainSlice.trim().length > 0) {
          hasSpokenToken = true;
        }
        tokens.push({
          type: 'text',
          raw: plainSlice,
          content: plainSlice,
          spokenStartChar: spokenCursor,
          spokenEndChar: spokenCursor + len,
        });
        spokenCursor += len;
      }
    }

    const rawToken = match[0];
    if (rawToken.startsWith('[') && rawToken.endsWith(']')) {
      // [...] は常に演出指示
      hasCueToken = true;
      const cueInner = rawToken.slice(1, -1).trim();
      tokens.push({
        type: 'cue',
        raw: rawToken,
        content: cueInner,
        spokenStartChar: -1,
        spokenEndChar: -1,
      });
    } else if (rawToken.startsWith('【') && rawToken.endsWith('】')) {
      const cueInner = rawToken.slice(1, -1).trim();
      if (isStageDirectionContent(cueInner)) {
        hasCueToken = true;
        tokens.push({
          type: 'cue',
          raw: rawToken,
          content: cueInner,
          spokenStartChar: -1,
          spokenEndChar: -1,
        });
      } else {
        // 見出し以外の文中 【...】（例: 【重要ポイント】等）は発話テキストとして保持
        hasSpokenToken = true;
        tokens.push({
          type: 'text',
          raw: rawToken,
          content: cueInner,
          spokenStartChar: spokenCursor,
          spokenEndChar: spokenCursor + cueInner.length,
        });
        spokenCursor += cueInner.length;
      }
    } else if (rawToken.startsWith('**') && rawToken.endsWith('**')) {
      const inner = rawToken.slice(2, -2);
      hasSpokenToken = true;
      tokens.push({
        type: 'highlight-yellow',
        raw: rawToken,
        content: inner,
        spokenStartChar: spokenCursor,
        spokenEndChar: spokenCursor + inner.length,
      });
      spokenCursor += inner.length;
    } else if (rawToken.startsWith('==') && rawToken.endsWith('==')) {
      const inner = rawToken.slice(2, -2);
      hasSpokenToken = true;
      tokens.push({
        type: 'highlight-sky',
        raw: rawToken,
        content: inner,
        spokenStartChar: spokenCursor,
        spokenEndChar: spokenCursor + inner.length,
      });
      spokenCursor += inner.length;
    } else if (rawToken.startsWith('!!') && rawToken.endsWith('!!')) {
      const inner = rawToken.slice(2, -2);
      hasSpokenToken = true;
      tokens.push({
        type: 'highlight-rose',
        raw: rawToken,
        content: inner,
        spokenStartChar: spokenCursor,
        spokenEndChar: spokenCursor + inner.length,
      });
      spokenCursor += inner.length;
    }

    lastIndex = match.index + rawToken.length;
  }

  if (lastIndex < text.length) {
    const tailSlice = text.slice(lastIndex);
    const len = tailSlice.length;
    if (tailSlice.trim().length > 0) {
      hasSpokenToken = true;
    }
    tokens.push({
      type: 'text',
      raw: tailSlice,
      content: tailSlice,
      spokenStartChar: spokenCursor,
      spokenEndChar: spokenCursor + len,
    });
    spokenCursor += len;
  }

  return {
    tokens,
    totalSpokenChars: spokenCursor,
    isHeading: false,
    isCueOnly: hasCueToken && !hasSpokenToken,
  };
}

const KANJI_VARIANT_DICTIONARY: Array<[RegExp, string]> = [
  [/皆さん/g, 'みなさん'],
  [/皆様/g, 'みなさま'],
  [/今日/g, 'きょう'],
  [/今回/g, 'こんかい'],
  [/動画/g, 'どうが'],
  [/撮影/g, 'さつえい'],
  [/原稿/g, 'げんこう'],
  [/音声/g, 'おんせい'],
  [/認識/g, 'にんしき'],
  [/画面/g, 'がめん'],
  [/設定/g, 'せってい'],
  [/私/g, 'わたし'],
  [/僕/g, 'ぼく'],
  [/事/g, 'こと'],
  [/物/g, 'もの'],
  [/時/g, 'とき'],
  [/所/g, 'ところ'],
  [/方/g, 'かた'],
  [/見/g, 'み'],
  [/話/g, 'はな'],
  [/言/g, 'い'],
  [/思/g, 'おも'],
  [/考/g, 'かんが'],
  [/行/g, 'い'],
  [/来/g, 'き'],
  [/作/g, 'つく'],
  [/使/g, 'つか'],
  [/良/g, 'よ'],
  [/無/g, 'な'],
  [/有/g, 'あ'],
  [/出来/g, 'でき'],
  [/頂/g, 'いただ'],
  [/ご覧/g, 'ごらん'],
  [/是非/g, 'ぜひ'],
  [/一緒/g, 'いっしょ'],
  [/本当/g, 'ほんとう'],
  [/実際/g, 'じっさい'],
  [/自動/g, 'じどう'],
  [/位置/g, 'いち'],
  [/目線/g, 'めせん'],
];

/**
 * テキストを正規化する（句読点・空白除去、全角半角統一、カタカナ→ひらがな、頻出漢字の表記揺れ吸収、小文字化など）
 */
export function normalizeTextForMatching(text: string): string {
  if (!text) return '';

  // NFKC正規化（全角英数字→半角、半角カナ→全角カナ）
  let normalized = text.normalize('NFKC').toLowerCase();

  // 頻出の漢字・ひらがな表記揺れを正規化
  for (const [pattern, replacement] of KANJI_VARIANT_DICTIONARY) {
    normalized = normalized.replace(pattern, replacement);
  }

  // カタカナをひらがなに変換 (U+30A1..U+30F6 -> U+3041..U+3096)
  normalized = normalized.replace(/[\u30a1-\u30f6]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60)
  );

  // 句読点・記号・空白を除去（長音符「ー」はカタカナ語の識別に有用なため保持）
  normalized = normalized.replace(
    /[\s、。，．・！？!?,.:;'"「」『』（）()［］\[\]｛｝{}…〜~\-—_\/\\|@#\$%\^&\*\+=<>`]/g,
    ''
  );

  return normalized;
}

/**
 * Phase 5 (Section 7.2 & 7.3):
 * 漢字の読み（ひらがな）・漢数字/アラビア数字・英単語/カタカナ・フィラー除去まで含めた高度な読み正規化
 */
export function normalizeTextWithPhonetics(text: string): string {
  return toJapanesePhoneticReading(text);
}

function buildSegmentObject(params: {
  pIdx: number;
  globalIndex: number;
  text: string;
  charCursor: number;
}): ScriptSegment {
  const { pIdx, globalIndex, text, charCursor } = params;
  const parsed = parseSegmentInlineTokens(text);
  const spokenText = stripStageDirectionsAndFormatting(text);

  return {
    id: `seg-${pIdx}-${globalIndex}`,
    index: globalIndex,
    paragraphIndex: pIdx,
    text,
    spokenText,
    normalizedText: normalizeTextForMatching(spokenText),
    readingText: toJapanesePhoneticReading(spokenText),
    isHeading: parsed.isHeading,
    headingTitle: parsed.headingTitle,
    isCueOnly: parsed.isCueOnly,
    startCharOffset: charCursor,
    endCharOffset: charCursor + text.length,
  };
}

/**
 * 原稿を段落および短いフレーズ（セグメント）単位に分割する。
 * 日本語の句点「。」「！」「？」や改行、または長すぎる読点区切りを適切な長さ（20〜55文字程度）で分割し、
 * カメラ目線で読みやすく、かつ音声追従の粒度として最適なセグメント配列を生成する。
 * Vol.3: 見出し行（# 見出し）やト書き（[笑顔で]・【ポーズ】）、強調記法（**重要**）にも対応。
 */
export function parseScriptToSegments(content: string): ScriptSegment[] {
  if (!content.trim()) return [];

  const paragraphs = content.split(/\n+/);
  const segments: ScriptSegment[] = [];
  let globalIndex = 0;
  let charCursor = 0;

  paragraphs.forEach((rawParagraph, pIdx) => {
    const trimmedParagraph = rawParagraph.trim();
    if (!trimmedParagraph) {
      charCursor += rawParagraph.length + 1;
      return;
    }

    // 見出し行 (# 見出し) は分割せず1つのチャプター見出しセグメントとして扱う
    if (/^\s*#{1,4}\s+/.test(trimmedParagraph)) {
      segments.push(
        buildSegmentObject({
          pIdx,
          globalIndex: globalIndex++,
          text: trimmedParagraph,
          charCursor,
        })
      );
      charCursor += trimmedParagraph.length;
      return;
    }

    // ト書き ([...], 【...】) や装飾記法 (**...**, ==...==, !!...!!) を一時的にプレースホルダーに退避し、
    // 装飾記法内の「！」や「？」で文が意図せず寸断されるのを防ぐ
    const inlineTokens: string[] = [];
    const tokenRegex =
      /(\[[^\]\n]+\]|【[^】\n]+】|\*\*[^*\n]+\*\*|==[^=\n]+==|!![^!\n]+!!)/g;
    const maskedParagraph = trimmedParagraph.replace(tokenRegex, (match) => {
      const idx = inlineTokens.length;
      inlineTokens.push(match);
      return `\x00TOK_${idx}\x00`;
    });

    // まず文末記号（。！？!?）または英語のピリオド＋スペースで分割
    const rawSentences = maskedParagraph
      .split(/(?<=[。！？!?])|(?<=\.\s+)/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((part) =>
        part.replace(/\x00TOK_(\d+)\x00/g, (_, id) => inlineTokens[Number(id)])
      );

    rawSentences.forEach((sentence) => {
      // 1文が65文字を超える場合は、読点「、」やカンマ「, 」でさらに自然なフレーズに分割
      if (sentence.length > 65) {
        const clauseTokens: string[] = [];
        const maskedSentence = sentence.replace(tokenRegex, (match) => {
          const idx = clauseTokens.length;
          clauseTokens.push(match);
          return `\x00TOK_${idx}\x00`;
        });
        const clauses = maskedSentence
          .split(/(?<=[、,])/)
          .map((s) => s.trim())
          .filter(Boolean)
          .map((part) =>
            part.replace(
              /\x00TOK_(\d+)\x00/g,
              (_, id) => clauseTokens[Number(id)]
            )
          );
        let buffer = '';
        clauses.forEach((clause) => {
          if ((buffer + clause).length > 50 && buffer.length >= 12) {
            const text = buffer.trim();
            segments.push(
              buildSegmentObject({
                pIdx,
                globalIndex: globalIndex++,
                text,
                charCursor,
              })
            );
            charCursor += text.length;
            buffer = clause;
          } else {
            buffer += clause;
          }
        });
        if (buffer.trim()) {
          const text = buffer.trim();
          segments.push(
            buildSegmentObject({
              pIdx,
              globalIndex: globalIndex++,
              text,
              charCursor,
            })
          );
          charCursor += text.length;
        }
      } else {
        segments.push(
          buildSegmentObject({
            pIdx,
            globalIndex: globalIndex++,
            text: sentence,
            charCursor,
          })
        );
        charCursor += sentence.length;
      }
    });
  });

  return segments;
}

/**
 * Vol.3 (Step 2): 原稿セグメントからチャプター（# 見出し、■ 見出し、第N章 等）を抽出する。
 * 明示的な見出しが存在しない場合でも、段落数が3以上あれば段落先頭をセクション候補として抽出可能。
 */
export function extractScriptChapters(
  segments: ScriptSegment[]
): ScriptChapterItem[] {
  const chapters: ScriptChapterItem[] = [];

  segments.forEach((seg) => {
    const trimmed = seg.text.trim();
    if (seg.isHeading && seg.headingTitle) {
      chapters.push({
        id: `chap-${seg.index}`,
        title: seg.headingTitle,
        segmentIndex: seg.index,
        paragraphIndex: seg.paragraphIndex,
        startCharOffset: seg.startCharOffset,
      });
      return;
    }

    const explicitSectionMatch = trimmed.match(
      /^(?:■|▼|●|◆|第[0-9０-９一二三四五六七八九十]+章|Chapter\s*\d+|STEP\s*\d+|ステップ\s*[0-9０-９]+)[\s:：・]*(.*)$/i
    );
    if (explicitSectionMatch) {
      const cleanLabel = stripStageDirectionsAndFormatting(trimmed);
      chapters.push({
        id: `chap-${seg.index}`,
        title: cleanLabel.slice(0, 36),
        segmentIndex: seg.index,
        paragraphIndex: seg.paragraphIndex,
        startCharOffset: seg.startCharOffset,
      });
    }
  });

  return chapters;
}

/**
 * Vol.3 (Step 2): 現在のフレーズ位置から、全体の進捗率（%）・残り文字数・残り想定読み上げ時間を算出する。
 */
export function estimateRemainingReadingTime(
  segments: ScriptSegment[],
  activeSegmentIndex: number,
  language: LanguageCode = 'ja-JP'
): {
  progressPercent: number;
  remainingChars: number;
  remainingSeconds: number;
  formattedRemaining: string;
} {
  if (segments.length === 0) {
    return {
      progressPercent: 0,
      remainingChars: 0,
      remainingSeconds: 0,
      formattedRemaining: '残り 0秒',
    };
  }

  const clampedIdx = Math.max(
    0,
    Math.min(segments.length - 1, activeSegmentIndex)
  );
  const progressPercent =
    segments.length <= 1
      ? 100
      : Math.round((clampedIdx / (segments.length - 1)) * 100);

  let remainingChars = 0;
  let remainingWords = 0;
  for (let i = clampedIdx; i < segments.length; i++) {
    const spoken =
      segments[i].spokenText ??
      stripStageDirectionsAndFormatting(segments[i].text);
    remainingChars += spoken.replace(/\s+/g, '').length;
    remainingWords += spoken.trim().split(/\s+/).filter(Boolean).length;
  }

  // 日本語平均 320文字/分 (約5.33文字/秒)、英語平均 140ワード/分 (約2.33ワード/秒)
  const remainingSeconds =
    language === 'ja-JP'
      ? Math.max(0, Math.round((remainingChars / 320) * 60))
      : Math.max(0, Math.round((remainingWords / 140) * 60));

  const mins = Math.floor(remainingSeconds / 60);
  const secs = remainingSeconds % 60;
  const formattedRemaining =
    mins > 0 ? `残り約 ${mins}分${secs}秒` : `残り約 ${secs}秒`;

  return {
    progressPercent,
    remainingChars,
    remainingSeconds,
    formattedRemaining,
  };
}

export type SegmentVisualTier = 'current' | 'lookahead' | 'dimmed';

export interface SegmentDisplayHierarchy {
  tier: SegmentVisualTier;
  opacity: number;
  lookaheadOffset: number; // 0 for current, 1..3 for lookahead, -1 otherwise
}

/**
 * Phase 4 (Section 6.2 & 6.4):
 * 現在フレーズ・先読みフレーズ（1〜3）・それ以外のフレーズの視覚的3段階階層を計算する。
 * フォントサイズや余白を変えずに不透明度 (opacity) のみで階層を作るため、レイアウトのガタつきが発生しない。
 */
export function computeSegmentDisplayHierarchy(params: {
  segmentIndex: number;
  activeSegmentIndex: number;
  focusMode: boolean;
  lookaheadCount: LookaheadLinesPreset;
  lookaheadOpacity: number;
  dimOpacity: number;
}): SegmentDisplayHierarchy {
  const {
    segmentIndex,
    activeSegmentIndex,
    focusMode,
    lookaheadCount,
    lookaheadOpacity,
    dimOpacity,
  } = params;

  if (segmentIndex === activeSegmentIndex) {
    return {
      tier: 'current',
      opacity: 1,
      lookaheadOffset: 0,
    };
  }

  if (!focusMode) {
    return {
      tier: 'dimmed',
      opacity: 1,
      lookaheadOffset: -1,
    };
  }

  const aheadOffset = segmentIndex - activeSegmentIndex;
  if (lookaheadCount > 0 && aheadOffset >= 1 && aheadOffset <= lookaheadCount) {
    // Graduated intermediate brightness: e.g. +1 = lookaheadOpacity (68%), +2 = 60%, +3 = 52% (never below dimOpacity + 0.08)
    const stepDecay = (aheadOffset - 1) * 0.08;
    const clampedOpacity = Math.max(
      Math.min(0.95, dimOpacity + 0.08),
      Math.min(0.95, lookaheadOpacity - stepDecay)
    );
    return {
      tier: 'lookahead',
      opacity: Number(clampedOpacity.toFixed(2)),
      lookaheadOffset: aheadOffset,
    };
  }

  return {
    tier: 'dimmed',
    opacity: dimOpacity,
    lookaheadOffset: -1,
  };
}
