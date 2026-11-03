import { ScriptSegment } from '@/types/prompter';

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
 * 原稿を段落および短いフレーズ（セグメント）単位に分割する。
 * 日本語の句点「。」「！」「？」や改行、または長すぎる読点区切りを適切な長さ（20〜55文字程度）で分割し、
 * カメラ目線で読みやすく、かつ音声追従の粒度として最適なセグメント配列を生成する。
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

    // まず文末記号（。！？!?）または英語のピリオド＋スペースで分割
    const rawSentences = trimmedParagraph
      .split(/(?<=[。！？!?])|(?<=\.\s)/)
      .map((s) => s.trim())
      .filter(Boolean);

    rawSentences.forEach((sentence) => {
      // 1文が65文字を超える場合は、読点「、」やカンマ「, 」でさらに自然なフレーズに分割
      if (sentence.length > 65) {
        const clauses = sentence.split(/(?<=[、,])/);
        let buffer = '';
        clauses.forEach((clause) => {
          if ((buffer + clause).length > 50 && buffer.length >= 12) {
            const text = buffer.trim();
            segments.push({
              id: `seg-${pIdx}-${globalIndex}`,
              index: globalIndex++,
              paragraphIndex: pIdx,
              text,
              normalizedText: normalizeTextForMatching(text),
              startCharOffset: charCursor,
              endCharOffset: charCursor + text.length,
            });
            charCursor += text.length;
            buffer = clause;
          } else {
            buffer += clause;
          }
        });
        if (buffer.trim()) {
          const text = buffer.trim();
          segments.push({
            id: `seg-${pIdx}-${globalIndex}`,
            index: globalIndex++,
            paragraphIndex: pIdx,
            text,
            normalizedText: normalizeTextForMatching(text),
            startCharOffset: charCursor,
            endCharOffset: charCursor + text.length,
          });
          charCursor += text.length;
        }
      } else {
        segments.push({
          id: `seg-${pIdx}-${globalIndex}`,
          index: globalIndex++,
          paragraphIndex: pIdx,
          text: sentence,
          normalizedText: normalizeTextForMatching(sentence),
          startCharOffset: charCursor,
          endCharOffset: charCursor + sentence.length,
        });
        charCursor += sentence.length;
      }
    });
  });

  return segments;
}
