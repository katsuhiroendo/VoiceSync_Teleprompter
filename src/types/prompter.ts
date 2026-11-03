export type LanguageCode = 'ja-JP' | 'en-US';

export interface ScriptSegment {
  id: string;
  index: number;
  paragraphIndex: number;
  text: string;
  normalizedText: string;
  startCharOffset: number;
  endCharOffset: number;
}

export interface ScriptItem {
  id: string;
  title: string;
  content: string;
  language: LanguageCode;
  createdAt: number;
  updatedAt: number;
  isFavorite?: boolean;
}

export type ScrollMode = 'voice' | 'constant' | 'manual';

export type SpeechStatus =
  | 'idle'          // 待機中
  | 'connecting'    // マイク接続中
  | 'listening'     // 音声認識中
  | 'speaking'      // 発話検出中
  | 'matching'      // 原稿照合中
  | 'paused'        // 一時停止中
  | 'error';        // エラー

export type CameraPreviewMode = 'pip' | 'backdrop' | 'hidden';
export type CameraResolutionPreset = '1080p' | '4k' | '720p';
export type CameraAspectRatioPreset = '16:9' | '9:16';

export interface PrompterSettings {
  // 5. 表示設定 (Display settings)
  fontSize: number;             // 16〜100px
  lineHeight: number;           // 1.2〜2.5
  textColor: string;            // 文字色 (default: #FFFFFF)
  backgroundColor: string;      // 背景色 (default: #09090B)
  contentWidthPercent: number;  // 文字表示領域の幅 (30〜100%)
  marginHorizontalPx: number;   // 左右余白 (0〜200px)
  marginVerticalVh: number;     // 上下余白 (10〜50vh)
  textAlign: 'left' | 'center' | 'right'; // テキストの左右中央揃え
  mirrorHorizontal: boolean;    // 左右反転表示 (ハーフミラー用)
  mirrorVertical: boolean;      // 上下反転表示

  // カメラ目線モード (Camera eye-line mode)
  cameraEyelineMode: boolean;   // 画面上部にコンパクトに表示するか
  eyelineHeightVh: number;      // 表示領域の高さ (20〜100vh)
  eyelineTopOffsetVh: number;   // 上端からの位置オフセット (0〜40vh)

  // フォーカスモード (Focus mode)
  focusMode: boolean;           // 現在読み上げている文章を明るく、それ以外を暗く
  dimOpacity: number;           // フォーカス外の不透明度 (0.15〜0.7)
  showGuideLine: boolean;       // 現在位置を示す細いガイドライン表示

  // 4.4 自動スクロール & 一定速度設定 (Scroll & Voice Tracking settings)
  readingLinePositionVh: number; // 読み上げ位置の表示高さ (15〜60% from viewport top)
  constantScrollSpeed: number;   // 一定速度スクロールの速度 (10〜300 px/sec)
  scrollSmoothness: number;      // スクロールの滑らかさ (減衰係数 0.05〜0.3)
  trackingSensitivity: number;   // 追従感度 (0.3〜0.9: 類似度しきい値調整)
  advanceTriggerRatio: number;   // 次の文・段落へ移るタイミング (0.40〜0.95: 小さいほど文の途中で早めに次へ移る)
  trackingSpeed: number;         // 追従速度倍率 (0.5〜2.0)
  scrollAnimationMs: number;     // スクロールアニメーション時間 (150〜800ms)
  showDebugOverlay: boolean;     // 音声認識デバッグ表示

  // カメラ撮影・プレビュー・USBスマホ連携設定 (Camera & USB Smartphone recording settings)
  cameraPreviewMode: CameraPreviewMode;         // 'pip' (上部小窓) | 'backdrop' (背面全体) | 'hidden'
  cameraBackdropOpacity: number;                // 背面表示時のカメラ不透明度 (0.15〜0.85)
  cameraMirrorPreview: boolean;                 // カメラプレビューを鏡像反転するか (default: true)
  autoStartPrompterOnRecord: boolean;           // 録画開始時に自動でプロンプターも開始するか
  preferredVideoDeviceId: string;               // 選択されたカメラデバイスID (空文字で自動/優先検出)
  preferredAudioDeviceId: string;               // 選択されたマイクデバイスID (空文字でシステム標準)
  cameraResolution: CameraResolutionPreset;     // '1080p' | '4k' | '720p'
  cameraAspectRatio: CameraAspectRatioPreset;   // '16:9' (通常YouTube) | '9:16' (ショート動画)
}

export const DEFAULT_PROMPTER_SETTINGS: PrompterSettings = {
  fontSize: 42,
  lineHeight: 1.65,
  textColor: '#F8FAFC',
  backgroundColor: '#050507',
  contentWidthPercent: 80,
  marginHorizontalPx: 32,
  marginVerticalVh: 35,
  textAlign: 'left',
  mirrorHorizontal: false,
  mirrorVertical: false,

  cameraEyelineMode: false,
  eyelineHeightVh: 42,
  eyelineTopOffsetVh: 2,

  focusMode: true,
  dimOpacity: 0.28,
  showGuideLine: true,

  readingLinePositionVh: 32,
  constantScrollSpeed: 65,
  scrollSmoothness: 0.14,
  trackingSensitivity: 0.65,
  advanceTriggerRatio: 0.85,
  trackingSpeed: 1.0,
  scrollAnimationMs: 320,
  showDebugOverlay: true,

  cameraPreviewMode: 'pip',
  cameraBackdropOpacity: 0.35,
  cameraMirrorPreview: true,
  autoStartPrompterOnRecord: true,
  preferredVideoDeviceId: '',
  preferredAudioDeviceId: '',
  cameraResolution: '1080p',
  cameraAspectRatio: '16:9',
};
