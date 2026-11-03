/**
 * Phase 5 (Section 7.2 & 7.3):
 * 日本語音声追従のための高速・ゼロ外部依存 正規化＆読み（ひらがな・数字・英単語）統一エンジン
 */

const KANJI_DIGITS: Record<string, number> = {
  〇: 0,
  零: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const SMALL_UNITS: Record<string, number> = {
  十: 10,
  百: 100,
  千: 1000,
};

const LARGE_UNITS: Record<string, number> = {
  万: 10000,
  億: 100000000,
};

/**
 * 漢数字の連続文字列（例: "二千二十八", "十五", "三百五十", "一万二千"）をアラビア数字文字列に変換する
 */
export function convertKanjiNumberBlock(kanjiBlock: string): string {
  if (!kanjiBlock) return kanjiBlock;

  // Positional digit string without unit characters (e.g. "二〇二六" -> "2026")
  const isPureDigits = /^[〇零一二三四五六七八九]+$/.test(kanjiBlock);
  if (isPureDigits && kanjiBlock.length >= 2) {
    return Array.from(kanjiBlock)
      .map((ch) => String(KANJI_DIGITS[ch] ?? ch))
      .join('');
  }

  let total = 0;
  let currentSection = 0;
  let currentDigit = 0;

  for (const ch of kanjiBlock) {
    if (ch in KANJI_DIGITS) {
      currentDigit = KANJI_DIGITS[ch];
    } else if (ch in SMALL_UNITS) {
      const unit = SMALL_UNITS[ch];
      currentSection += (currentDigit === 0 ? 1 : currentDigit) * unit;
      currentDigit = 0;
    } else if (ch in LARGE_UNITS) {
      const largeUnit = LARGE_UNITS[ch];
      currentSection += currentDigit;
      total += (currentSection === 0 ? 1 : currentSection) * largeUnit;
      currentSection = 0;
      currentDigit = 0;
    }
  }

  total += currentSection + currentDigit;
  return String(total);
}

/**
 * 文中の漢数字表現（例: "十五万円" -> "15万円", "二千二十八年八月" -> "2028年8月"）をアラビア数字に統一する。
 * ただし慣用表現（「一つ」「一人」「一緒」「一旦」「一番」「一部」「一気」「一括」「一般」「一方」「一応」など）の
 * 語幹を壊さないよう、先に慣用表現をひらがな読みへ保護・変換した後に適用する。
 */
export function unifyJapaneseNumerals(text: string): string {
  return text.replace(
    /[〇零一二三四五六七八九十百千万億]+/g,
    (match) => convertKanjiNumberBlock(match)
  );
}

/**
 * フィラー（言い淀み: えー、あのー、えっと、そのー 等）を除去する (Section 7.2)
 */
const FILLER_PATTERNS: RegExp[] = [
  /(?:^|[\s、。，．・])(?:えー+っと|えー+と|えっとー*|えー+|あー+|あのー+|そのー+|うー+ん|まー+|んー+)(?=[\s、。，．・]|$)/g,
  /^(?:えー+っと|えー+と|えっとー*|えー+|あのー+|そのー+|うー+ん)\s*/g,
  /(?:えーっと|えっとー+|あのー+|そのー+|うーん)/g,
];

export function stripJapaneseFillers(text: string): string {
  if (!text) return '';
  let cleaned = text;
  for (const pattern of FILLER_PATTERNS) {
    cleaned = cleaned.replace(pattern, ' ');
  }
  return cleaned;
}

/**
 * 言い直し表現（例: "15万円 いや 18万円です"）が含まれる場合、
 * 全体テキストに加えて「言い直しマーカー直後の訂正後テキスト」を抽出する (Section 7.2)
 */
export function extractSelfCorrectionCandidate(text: string): string | null {
  const markers = [
    'ではなくて',
    'じゃなくて',
    'じゃなく',
    'というか',
    'じゃなくてですね',
    'いや',
    '失礼しました',
    '間違えました',
  ];
  for (const marker of markers) {
    const idx = text.lastIndexOf(marker);
    if (idx !== -1 && idx + marker.length < text.length - 2) {
      const after = text
        .slice(idx + marker.length)
        .replace(/^[\s、。，．・!？?]+/, '')
        .trim();
      if (after.length >= 3) {
        return after;
      }
    }
  }
  return null;
}

/**
 * 英語・アルファベット略語・外来語とカタカナ読みの相互統一辞書 (Section 7.2)
 */
const ENGLISH_LOANWORD_PHONETIC_MAP: Array<[RegExp, string]> = [
  [/youtube/gi, 'ゆーちゅーぶ'],
  [/youtuber/gi, 'ゆーちゅーばー'],
  [/voicesync/gi, 'ぼいすしんく'],
  [/teleprompter/gi, 'てれぷろんぷたー'],
  [/prompter/gi, 'ぷろんぷたー'],
  [/macbook\s*pro/gi, 'まっくぶっくぷろ'],
  [/macbook\s*air/gi, 'まっくぶっくえあー'],
  [/macbook/gi, 'まっくぶっく'],
  [/iphone/gi, 'あいふぉーん'],
  [/ipad/gi, 'あいぱっど'],
  [/pixel/gi, 'ぴくせる'],
  [/android/gi, 'あんどろいど'],
  [/google/gi, 'ぐーぐる'],
  [/chrome/gi, 'くろーむ'],
  [/safari/gi, 'さふぁり'],
  [/webcam/gi, 'うぇぶかめら'],
  [/web\s*カメラ/gi, 'うぇぶかめら'],
  [/web/gi, 'うぇぶ'],
  [/usb/gi, 'ゆーえすびー'],
  [/sns/gi, 'えすえぬえす'],
  [/ai/gi, 'えーあい'],
  [/it/gi, 'あいてぃー'],
  [/pc/gi, 'ぱそこん'],
  [/ピーシー/g, 'ぱそこん'],
  [/4k/gi, '4けー'],
  [/ヨンケー/g, '4けー'],
  [/よんけー/g, '4けー'],
  [/full\s*hd/gi, 'ふるえいちでぃー'],
  [/1080p/gi, '1080ぴー'],
  [/720p/gi, '720ぴー'],
  [/pwa/gi, 'ぴーだぶりゅーえー'],
  [/api/gi, 'えーぴーあい'],
  [/csv/gi, 'しーえすぶい'],
  [/json/gi, 'じぇいそん'],
  [/ng/gi, 'えぬじー'],
  [/rec/gi, 'れっく'],
  [/ok/gi, 'おっけー'],
  [/オーケー/g, 'おっけー'],
  [/オッケー/g, 'おっけー'],
];

/**
 * 漢字慣用句・同音異義語・YouTube撮影頻出語彙のひらがな読み辞書 (Section 7.3)
 * - 漢数字変換よりも先に「一緒」「一つ」「一番」「一人」などの慣用句をひらがなへ変換することで誤変換を防ぐ
 * - Web Speech API の同音異義語誤変換（構成/校正、変換/返還、視聴/市長、対象/対称 など）も同じひらがな読みへ統一する
 */
const IDIOM_AND_KANJI_READING_MAP: Array<[RegExp, string]> = [
  // 漢数字を含む慣用表現（数字変換より先に適用）
  [/一緒/g, 'いっしょ'],
  [/一旦/g, 'いったん'],
  [/一番/g, 'いちばん'],
  [/一気/g, 'いっき'],
  [/一括/g, 'いっかつ'],
  [/一般/g, 'いっぱん'],
  [/一方/g, 'いっぽう'],
  [/一応/g, 'いちおう'],
  [/一部/g, 'いちぶ'],
  [/一覧/g, 'いちらん'],
  [/一致/g, 'いっち'],
  [/一定/g, 'いってい'],
  [/一つ/g, 'ひとつ'],
  [/二つ/g, 'ふたつ'],
  [/三つ/g, 'みっつ'],
  [/四つ/g, 'よっつ'],
  [/五つ/g, 'いつつ'],
  [/六つ/g, 'むっつ'],
  [/七つ/g, 'ななつ'],
  [/八つ/g, 'やっつ'],
  [/九つ/g, 'ここのつ'],
  [/十個/g, '10こ'],
  [/一人/g, 'ひとり'],
  [/二人/g, 'ふたり'],
  [/十分/g, 'じゅうぶん'],
  [/万が一/g, 'まんがいち'],

  // YouTube・動画撮影・IT頻出語および同音異義語
  [/皆さん/g, 'みなさん'],
  [/皆様/g, 'みなさま'],
  [/今日/g, 'きょう'],
  [/今回/g, 'こんかい'],
  [/動画/g, 'どうが'],
  [/撮影/g, 'さつえい'],
  [/録画/g, 'ろくが'],
  [/録音/g, 'ろくおん'],
  [/原稿/g, 'げんこう'],
  [/音声/g, 'おんせい'],
  [/認識/g, 'にんしき'],
  [/追従/g, 'ついじゅう'],
  [/自動/g, 'じどう'],
  [/手動/g, 'しゅどう'],
  [/画面/g, 'がめん'],
  [/設定/g, 'せってい'],
  [/機能/g, 'きのう'],
  [/昨日/g, 'きのう'],
  [/方法/g, 'ほうほう'],
  [/紹介/g, 'しょうかい'],
  [/詳細/g, 'しょうさい'],
  [/説明/g, 'せつめい'],
  [/解説/g, 'かいせつ'],
  [/確認/g, 'かくにん'],
  [/活用/g, 'かつよう'],
  [/利用/g, 'りよう'],
  [/使用/g, 'しよう'],
  [/仕様/g, 'しよう'],
  [/開始/g, 'かいし'],
  [/終了/g, 'しゅうりょう'],
  [/停止/g, 'ていし'],
  [/再開/g, 'さいかい'],
  [/保存/g, 'ほぞん'],
  [/削除/g, 'さくじょ'],
  [/復旧/g, 'ふっきゅう'],
  [/選択/g, 'せんたく'],
  [/調整/g, 'ちょうせい'],
  [/変更/g, 'へんこう'],
  [/変換|返還/g, 'へんかん'],
  [/構成|校正|公正/g, 'こうせい'],
  [/対象|対称|対照/g, 'たいしょう'],
  [/視聴者/g, 'しちょうしゃ'],
  [/視聴|市長/g, 'しちょう'],
  [/概要欄/g, 'がいようらん'],
  [/登録/g, 'とうろく'],
  [/高評価|好評価/g, 'こうひょうか'],
  [/低評価/g, 'ていひょうか'],
  [/コメント/g, 'こめんと'],
  [/チャンネル/g, 'ちゃんねる'],
  [/段落/g, 'だんらく'],
  [/先頭/g, 'せんとう'],
  [/位置/g, 'いち'],
  [/目線/g, 'めせん'],
  [/視線/g, 'しせん'],
  [/自然/g, 'しぜん'],
  [/維持/g, 'いじ'],
  [/速度/g, 'そくど'],
  [/感度/g, 'かんど'],
  [/精度/g, 'せいど'],
  [/品質/g, 'ひんしつ'],
  [/環境/g, 'かんきょう'],
  [/騒音/g, 'そうおん'],
  [/無音/g, 'むおん'],
  [/音量/g, 'おんりょう'],
  [/音割れ/g, 'おとわれ'],
  [/時間/g, 'じかん'],
  [/秒間/g, 'びょうかん'],
  [/分間/g, 'ふんかん'],
  [/途中/g, 'とちゅう'],
  [/沈黙/g, 'ちんもく'],
  [/大丈夫/g, 'だいじょうぶ'],
  [/滑らか/g, 'なめらか'],
  [/簡単/g, 'かんたん'],
  [/便利/g, 'べんり'],
  [/重要/g, 'じゅうよう'],
  [/必要/g, 'ひつよう'],
  [/可能/g, 'かのう'],
  [/問題/g, 'もんだい'],
  [/原因/g, 'げんいん'],
  [/対策/g, 'たいさく'],
  [/改善/g, 'かいぜん'],
  [/最新/g, 'さいしん'],
  [/最初/g, 'さいしょ'],
  [/最後/g, 'さいご'],
  [/具体的/g, 'ぐたいてき'],
  [/基本的/g, 'きほんてき'],
  [/効率的/g, 'こうりつてき'],
  [/専門用語/g, 'せんもんようご'],
  [/人工知能/g, 'じんこうちのう'],
  [/機械学習/g, 'きかいがくしゅう'],
  [/自然言語処理/g, 'しぜんげんごしょり'],
  [/最適化/g, 'さいてきか'],
  [/アルゴリズム/g, 'あるごりずむ'],
  [/パソコン/g, 'ぱそこん'],
  [/スマートフォン/g, 'すまほ'],
  [/スマホ/g, 'すまほ'],
  [/アプリケーション/g, 'あぷり'],
  [/アプリ/g, 'あぷり'],
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
  [/本当/g, 'ほんとう'],
  [/実際/g, 'じっさい'],
  [/詳しく/g, 'くわしく'],
  [/紹介/g, 'しょうかい'],
  [/確認/g, 'かくにん'],

  // 助数詞・単位の読み統一（数字の直後に来るケース）
  [/万円/g, 'まんえん'],
  [/千円/g, 'せんえん'],
  [/百円/g, 'ひゃくえん'],
  [/円/g, 'えん'],
  [/年間/g, 'ねんかん'],
  [/年/g, 'ねん'],
  [/ヶ月|か月|カ月|ケ月/g, 'かげつ'],
  [/月/g, 'がつ'],
  [/日間/g, 'にちかん'],
  [/日/g, 'にち'],
  [/時間/g, 'じかん'],
  [/時/g, 'じ'],
  [/分/g, 'ふん'],
  [/秒/g, 'びょう'],
  [/パーセント|％|%/g, 'ぱーせんと'],
  [/個/g, 'こ'],
  [/つ/g, 'つ'],
  [/回/g, 'かい'],
  [/倍/g, 'ばい'],
  [/人/g, 'にん'],
  [/番目/g, 'ばんめ'],
  [/番/g, 'ばん'],
];

/**
 * カタカナをひらがなに変換する (U+30A1..U+30F6 -> U+3041..U+3096)
 */
export function katakanaToHiragana(text: string): string {
  return text.replace(/[\u30a1-\u30f6]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60)
  );
}

/**
 * 表記テキストから「ひらがな読み＋アラビア数字＋外来語読み統一」を行った読み正規化文字列を生成する (Section 7.2 & 7.3)
 */
export function toJapanesePhoneticReading(rawText: string): string {
  if (!rawText) return '';

  // 1. NFKC正規化 + 小文字化
  let text = rawText.normalize('NFKC').toLowerCase();

  // 2. フィラー（えー、あのー、えっと等）の除去
  text = stripJapaneseFillers(text);

  // 3. 英単語・アルファベット略語のカタカナ/ひらがな読み統一
  for (const [pattern, reading] of ENGLISH_LOANWORD_PHONETIC_MAP) {
    text = text.replace(pattern, reading);
  }

  // 4. 慣用表現および頻出漢字の読み変換（漢数字変換の前に「一緒」「一つ」等を保護）
  for (const [pattern, reading] of IDIOM_AND_KANJI_READING_MAP) {
    text = text.replace(pattern, reading);
  }

  // 5. 残った漢数字（例: 十五 -> 15, 二千二十八 -> 2028）をアラビア数字へ統一
  text = unifyJapaneseNumerals(text);

  // 6. 数字の桁区切りカンマ（例: 150,000 -> 150000）の除去と「150000」↔「15まん」表記の正規化
  text = text.replace(/(\d),(\d{3})/g, '$1$2');
  text = text.replace(/(\d+)0000/g, '$1まん');
  text = text.replace(/(\d+)000(?!\d)/g, '$1せん');

  // 7. カタカナをひらがなに変換
  text = katakanaToHiragana(text);

  // 8. 句読点・記号・空白の除去（長音符「ー」も母音揺れ吸収のため連続を1つに正規化）
  text = text.replace(
    /[\s、。，．・！？!?,.:;'"「」『』（）()［］\[\]｛｝{}…〜~\-—_\/\\|@#\$%\^&\*\+=<>`]/g,
    ''
  );
  text = text.replace(/ー+/g, 'ー');

  return text;
}
