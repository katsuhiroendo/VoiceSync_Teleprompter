import { LanguageCode, SpeechStatus } from '@/types/prompter';

export interface SpeechTranscriptEvent {
  transcript: string;
  isFinal: boolean;
  resultIndex: number;
  confidence: number;
  timestamp: number;
}

export interface SpeechErrorInfo {
  code:
    | 'not-allowed'
    | 'service-not-allowed'
    | 'no-speech'
    | 'network'
    | 'audio-capture'
    | 'unsupported'
    | 'unknown';
  title: string;
  message: string;
  recoverySteps: string[];
  canFallbackToManual: boolean;
}

// Web Speech API standard + webkit prefixed interfaces for TypeScript safety
interface WebSpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface WebSpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): WebSpeechRecognitionAlternative;
  [index: number]: WebSpeechRecognitionAlternative;
}

interface WebSpeechRecognitionResultList {
  readonly length: number;
  item(index: number): WebSpeechRecognitionResult;
  [index: number]: WebSpeechRecognitionResult;
}

interface WebSpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: WebSpeechRecognitionResultList;
}

interface WebSpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message?: string;
}

interface WebSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: ((this: WebSpeechRecognition, ev: Event) => void) | null;
  onend: ((this: WebSpeechRecognition, ev: Event) => void) | null;
  onerror:
    | ((this: WebSpeechRecognition, ev: WebSpeechRecognitionErrorEvent) => void)
    | null;
  onresult:
    | ((this: WebSpeechRecognition, ev: WebSpeechRecognitionEvent) => void)
    | null;
  onspeechstart: ((this: WebSpeechRecognition, ev: Event) => void) | null;
  onspeechend: ((this: WebSpeechRecognition, ev: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type WebSpeechRecognitionConstructor = new () => WebSpeechRecognition;

function getSpeechRecognitionConstructor(): WebSpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    SpeechRecognition?: WebSpeechRecognitionConstructor;
    webkitSpeechRecognition?: WebSpeechRecognitionConstructor;
  };
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionConstructor() !== null;
}

export function buildErrorInfo(rawError: string): SpeechErrorInfo {
  switch (rawError) {
    case 'not-allowed':
    case 'service-not-allowed':
      return {
        code: 'not-allowed',
        title: 'マイクへのアクセスが拒否されました',
        message:
          'ブラウザまたはOSの設定でマイク権限がブロックされているため、音声認識を開始できません。',
        recoverySteps: [
          'ブラウザのアドレスバー左側のアイコン（鍵マークまたはマイクアイコン）をクリックし、「マイク」を「許可」に変更してください。',
          'macOSの場合：「システム設定」＞「プライバシーとセキュリティ」＞「マイク」で、使用中のブラウザ（Google Chrome / Safari）がオンになっているか確認してください。',
          'iPadOS / Androidの場合：「設定」アプリからブラウザのマイク権限と音声認識機能（Siriと音声入力）が有効か確認してください。',
          '設定変更後、画面を再読み込みするか「再試行」ボタンを押してください。',
        ],
        canFallbackToManual: true,
      };
    case 'audio-capture':
      return {
        code: 'audio-capture',
        title: 'マイクデバイスが見つかりません',
        message:
          '有効なマイク入力を取得できませんでした。別のアプリがマイクを排他使用していないか確認してください。',
        recoverySteps: [
          'MacBook内蔵マイクまたは外部マイクが正しく接続されているか確認してください。',
          '他の通話・録音アプリがマイクを占有している場合は閉じてから再試行してください。',
        ],
        canFallbackToManual: true,
      };
    case 'network':
      return {
        code: 'network',
        title: '音声認識サーバーへ接続できません（オフライン）',
        message:
          'お使いのブラウザの音声認識エンジンはインターネット接続を必要としています。',
        recoverySteps: [
          'Wi-Fiまたはモバイル通信の接続状況を確認してください。',
          'オフライン環境で撮影を続ける場合は、「一定速度モード」または「手動モード」へ切り替えてそのまま撮影を続行できます。',
        ],
        canFallbackToManual: true,
      };
    case 'unsupported':
      return {
        code: 'unsupported',
        title: 'このブラウザは音声認識に対応していません',
        message:
          'Web Speech API が利用できない環境です。Google Chrome または Safari の最新版をご利用ください。',
        recoverySteps: [
          'macOS / Android では Google Chrome、iPadOS では Safari の利用を推奨します。',
          'このまま撮影を続ける場合は「一定速度スクロール」または「手動スクロール」をご利用ください。',
        ],
        canFallbackToManual: true,
      };
    default:
      return {
        code: 'unknown',
        title: '音声認識が一時的に中断されました',
        message: `エラーコード: ${rawError}`,
        recoverySteps: [
          '「音声認識を再開」ボタンを押して再度開始してください。',
          '繰り返し発生する場合は一定速度スクロールモードへ切り替えられます。',
        ],
        canFallbackToManual: true,
      };
  }
}

export interface SpeechEngineCallbacks {
  onStatusChange: (status: SpeechStatus) => void;
  onTranscript: (event: SpeechTranscriptEvent) => void;
  onVolumeChange: (rmsLevel: number) => void;
  onError: (error: SpeechErrorInfo | null) => void;
}

export const MAX_AUTO_RESTART_RETRIES = 8;

export function computeRestartBackoffMs(retryAttempt: number): number {
  if (retryAttempt <= 0) return 180;
  return Math.min(3000, Math.round(220 * Math.pow(1.6, Math.min(retryAttempt, 6))));
}

/**
 * 画面の再描画（React state更新）に影響されず、またマイクの重複起動やメモリリークを起こさない
 * リアルタイム音声認識＆音量モニター管理クラス
 */
export class SpeechRecognitionController {
  private recognition: WebSpeechRecognition | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private volumeRafId: number | null = null;
  private restartTimerId: ReturnType<typeof setTimeout> | null = null;

  private isDesiredActive = false;
  private isRecognitionRunning = false;
  private language: LanguageCode = 'ja-JP';
  private preferredAudioDeviceId = '';
  private callbacks: SpeechEngineCallbacks;
  private processedFinalSignatures = new Set<string>();
  private lastSpeechTimestamp = 0;
  private lastStartTimestamp = 0;
  private consecutiveErrorRestarts = 0;
  private lastEndWasNormalSilence = false;

  constructor(callbacks: SpeechEngineCallbacks) {
    this.callbacks = callbacks;
  }

  public updateCallbacks(callbacks: SpeechEngineCallbacks): void {
    this.callbacks = callbacks;
  }

  public setAudioDeviceId(deviceId: string): void {
    if (this.preferredAudioDeviceId === deviceId) return;
    this.preferredAudioDeviceId = deviceId;
    if (this.isDesiredActive) {
      this.startAudioMeter();
    }
  }

  public setLanguage(lang: LanguageCode): void {
    if (this.language === lang) return;
    this.language = lang;
    if (this.recognition) {
      this.recognition.lang = lang;
      if (this.isDesiredActive && this.isRecognitionRunning) {
        try {
          this.recognition.stop();
        } catch {
          // onend will trigger automatic restart with new language
        }
      }
    }
  }

  public async start(
    lang: LanguageCode,
    audioDeviceId?: string
  ): Promise<boolean> {
    this.language = lang;
    if (typeof audioDeviceId === 'string') {
      this.preferredAudioDeviceId = audioDeviceId;
    }

    // 既に稼働中の場合は重複起動しない（4.1 / 12. マイク重複起動防止）
    if (this.isDesiredActive && this.isRecognitionRunning) {
      return true;
    }

    const RecognitionCtor = getSpeechRecognitionConstructor();
    if (!RecognitionCtor) {
      this.callbacks.onStatusChange('error');
      this.callbacks.onError(buildErrorInfo('unsupported'));
      return false;
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.callbacks.onStatusChange('error');
      this.callbacks.onError(buildErrorInfo('network'));
      return false;
    }

    this.isDesiredActive = true;
    this.consecutiveErrorRestarts = 0;
    this.callbacks.onError(null);
    this.callbacks.onStatusChange('connecting');

    // Start Web Audio API volume meter (non-blocking if Safari shares mic)
    await this.startAudioMeter();

    if (!this.isDesiredActive) {
      // Stopped while awaiting permission
      this.stopAudioMeter();
      return false;
    }

    this.initAndStartRecognition(RecognitionCtor);
    return true;
  }

  public stop(): void {
    this.isDesiredActive = false;
    if (this.restartTimerId) {
      clearTimeout(this.restartTimerId);
      this.restartTimerId = null;
    }

    if (this.recognition) {
      this.recognition.onend = null;
      this.recognition.onresult = null;
      this.recognition.onerror = null;
      try {
        this.recognition.stop();
      } catch {
        // ignore
      }
      this.recognition = null;
    }

    this.isRecognitionRunning = false;
    this.stopAudioMeter();
    this.callbacks.onStatusChange('paused');
  }

  public destroy(): void {
    this.stop();
    this.processedFinalSignatures.clear();
  }

  private initAndStartRecognition(
    RecognitionCtor: WebSpeechRecognitionConstructor
  ): void {
    if (this.recognition) {
      try {
        this.recognition.onend = null;
        this.recognition.abort();
      } catch {
        // ignore
      }
    }

    const rec = new RecognitionCtor();
    rec.lang = this.language;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      this.isRecognitionRunning = true;
      this.lastStartTimestamp = Date.now();
      this.lastEndWasNormalSilence = false;
      this.callbacks.onStatusChange('listening');
    };

    rec.onspeechstart = () => {
      this.lastSpeechTimestamp = Date.now();
      this.consecutiveErrorRestarts = 0;
      this.callbacks.onStatusChange('speaking');
    };

    rec.onspeechend = () => {
      if (this.isDesiredActive) {
        this.callbacks.onStatusChange('listening');
      }
    };

    rec.onresult = (event: WebSpeechRecognitionEvent) => {
      this.lastSpeechTimestamp = Date.now();
      this.consecutiveErrorRestarts = 0;
      const totalResults = event.results.length;
      if (totalResults === 0) return;

      // Chrome's continuous WebSpeechRecognition in Japanese frequently emits event.resultIndex = 0
      // and accumulates all previous sentences into event.results[0..N-1], or updates old indices while
      // the user is speaking at the latest index (totalResults - 1).
      // To prevent already-spoken sentences from re-triggering or causing multi-paragraph jumps,
      // ONLY process the newest active result slot (or any newly finalized slot from resultIndex).
      const startIdx = Math.max(event.resultIndex, totalResults - 1);

      for (let i = startIdx; i < totalResults; i++) {
        const res = event.results[i];
        const alt = res[0];
        if (!alt) continue;
        const transcript = alt.transcript.trim();
        if (!transcript) continue;

        if (res.isFinal) {
          // 同一発話の確定イベントを二重処理しないガード (4.3)
          const signature = `${i}:${transcript}`;
          if (this.processedFinalSignatures.has(signature)) {
            continue;
          }
          this.processedFinalSignatures.add(signature);
          if (this.processedFinalSignatures.size > 120) {
            const firstKey = this.processedFinalSignatures.values().next().value;
            if (firstKey) this.processedFinalSignatures.delete(firstKey);
          }
        }

        this.callbacks.onTranscript({
          transcript,
          isFinal: res.isFinal,
          resultIndex: i,
          confidence: alt.confidence || 0.85,
          timestamp: Date.now(),
        });
      }
    };

    rec.onerror = (event: WebSpeechRecognitionErrorEvent) => {
      const errCode = event.error;

      // 無音状態（no-speech）はエラー扱いせず、自動再起動して待機を継続する（4.2 & 7.5 途中で2秒/5秒/10秒間沈黙した場合）
      if (errCode === 'no-speech' || errCode === 'aborted') {
        this.lastEndWasNormalSilence = true;
        if (this.isDesiredActive) {
          this.callbacks.onStatusChange('listening');
        }
        return;
      }

      if (errCode === 'not-allowed' || errCode === 'service-not-allowed') {
        this.isDesiredActive = false;
        this.isRecognitionRunning = false;
        this.stopAudioMeter();
        this.callbacks.onStatusChange('error');
        this.callbacks.onError(buildErrorInfo('not-allowed'));
        return;
      }

      if (errCode === 'network' || errCode === 'audio-capture') {
        this.isDesiredActive = false;
        this.isRecognitionRunning = false;
        this.stopAudioMeter();
        this.callbacks.onStatusChange('error');
        this.callbacks.onError(buildErrorInfo(errCode));
        return;
      }
    };

    rec.onend = () => {
      this.isRecognitionRunning = false;
      this.processedFinalSignatures.clear();

      // Section 7.5: ユーザーが停止しておらず、無音タイムアウト等で切断された場合は再試行上限とバックオフ付きで自動再開
      if (this.isDesiredActive) {
        const uptimeMs = Date.now() - this.lastStartTimestamp;
        if (!this.lastEndWasNormalSilence && uptimeMs < 600) {
          this.consecutiveErrorRestarts += 1;
        } else {
          this.consecutiveErrorRestarts = 0;
        }

        if (this.consecutiveErrorRestarts > MAX_AUTO_RESTART_RETRIES) {
          this.isDesiredActive = false;
          this.stopAudioMeter();
          this.callbacks.onStatusChange('error');
          this.callbacks.onError(
            buildErrorInfo('音声認識の自動再開上限に達しました')
          );
          return;
        }

        const delayMs = computeRestartBackoffMs(this.consecutiveErrorRestarts);
        this.restartTimerId = setTimeout(() => {
          if (!this.isDesiredActive) return;
          const Ctor = getSpeechRecognitionConstructor();
          if (Ctor) {
            this.initAndStartRecognition(Ctor);
          }
        }, delayMs);
      }
    };

    this.recognition = rec;
    try {
      rec.start();
    } catch {
      // Handle unexpected InvalidStateError if already started
    }
  }

  private async startAudioMeter(): Promise<void> {
    if (
      typeof window === 'undefined' ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      return;
    }

    try {
      this.stopAudioMeter();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...(this.preferredAudioDeviceId
            ? { deviceId: { ideal: this.preferredAudioDeviceId } }
            : {}),
        },
        video: false,
      });

      this.mediaStream = stream;
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.65;
      source.connect(analyser);

      this.audioContext = ctx;
      this.analyser = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateVolume = () => {
        if (!this.analyser || !this.isDesiredActive) return;
        this.analyser.getByteTimeDomainData(dataArray);
        let sumSquares = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const normalized = (dataArray[i] - 128) / 128;
          sumSquares += normalized * normalized;
        }
        const rms = Math.sqrt(sumSquares / dataArray.length);
        const scaledLevel = Math.min(1, rms * 3.8);
        this.callbacks.onVolumeChange(scaledLevel);
        this.volumeRafId = requestAnimationFrame(updateVolume);
      };

      this.volumeRafId = requestAnimationFrame(updateVolume);
    } catch (err) {
      const domErr = err as DOMException;
      if (
        domErr?.name === 'NotAllowedError' ||
        domErr?.name === 'PermissionDeniedError'
      ) {
        this.isDesiredActive = false;
        this.callbacks.onStatusChange('error');
        this.callbacks.onError(buildErrorInfo('not-allowed'));
      }
    }
  }

  private stopAudioMeter(): void {
    if (this.volumeRafId) {
      cancelAnimationFrame(this.volumeRafId);
      this.volumeRafId = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.analyser = null;
    this.callbacks.onVolumeChange(0);
  }
}
