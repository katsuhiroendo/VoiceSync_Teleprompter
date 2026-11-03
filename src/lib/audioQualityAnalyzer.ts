export interface AudioQualityThresholds {
  clippingSampleThreshold: number;    // Sample amplitude >= 0.985 considered clipping
  clippingCountWarning: number;       // Number of clipped frames/samples to warn
  silenceRmsThreshold: number;        // Frame RMS below 0.006 (~ -44 dBFS) treated as silence
  noSignalPeakThreshold: number;      // Overall peak below 0.008 (~ -42 dBFS) -> no mic input
  tooQuietSpeechDbfs: number;         // Speech average below -32 dBFS -> too quiet
  noisyAmbientDbfs: number;           // Ambient noise floor above -36 dBFS -> noisy environment
  minRecommendedSnrDb: number;        // Estimated SNR below 12 dB -> noisy environment
}

export const AUDIO_QUALITY_THRESHOLDS: AudioQualityThresholds = {
  clippingSampleThreshold: 0.985,
  clippingCountWarning: 3,
  silenceRmsThreshold: 0.006,
  noSignalPeakThreshold: 0.008,
  tooQuietSpeechDbfs: -32,
  noisyAmbientDbfs: -36,
  minRecommendedSnrDb: 12,
};

export type AudioQualityVerdictCode =
  | 'good'
  | 'too-quiet'
  | 'clipping'
  | 'noisy-environment'
  | 'no-signal';

export interface FrameAudioSampleMetric {
  timestampMs: number;      // Elapsed ms since test start (0..10000)
  rms: number;              // 0.0 .. 1.0
  peak: number;             // 0.0 .. 1.0
  clippedSamples: number;   // Count of samples >= clippingSampleThreshold in this frame
}

export interface AudioQualityReport {
  verdictCode: AudioQualityVerdictCode;
  verdictLabel: string;
  verdictDescription: string;
  overallRms: number;
  overallPeak: number;
  estimatedRmsDbfs: number;       // e.g. -18.4 dBFS (推定値)
  estimatedPeakDbfs: number;      // e.g. -3.2 dBFS (推定値)
  clippingSuspectedCount: number; // Total frames where clipping occurred
  clippingSuspected: boolean;
  silenceRatioPercent: number;    // 0 .. 100%
  ambientNoiseFloorDbfs: number;  // Measured during first 2 seconds (推定値)
  speechLevelDbfs: number;        // Measured during active speech frames after 2s (推定値)
  estimatedSnrDb: number;         // Speech dB - Ambient dB (推定値)
  ambientNoiseLabel: string;      // "静か (良好)" | "やや環境音あり" | "騒音が大きい可能性"
}

/**
 * 1フレーム分の波形データ (Float32Array, -1.0〜+1.0) から RMS, Peak, クリッピング数を算出する (Section 4.3)
 */
export function analyzeWaveformFrame(
  samples: Float32Array | number[],
  elapsedMs: number,
  thresholds: AudioQualityThresholds = AUDIO_QUALITY_THRESHOLDS
): FrameAudioSampleMetric {
  const len = samples.length;
  if (len === 0) {
    return { timestampMs: elapsedMs, rms: 0, peak: 0, clippedSamples: 0 };
  }

  let sumSq = 0;
  let peak = 0;
  let clippedSamples = 0;

  for (let i = 0; i < len; i++) {
    const val = Math.abs(samples[i]);
    sumSq += val * val;
    if (val > peak) {
      peak = val;
    }
    if (val >= thresholds.clippingSampleThreshold) {
      clippedSamples++;
    }
  }

  const rms = Math.sqrt(sumSq / len);
  return {
    timestampMs: elapsedMs,
    rms,
    peak,
    clippedSamples,
  };
}

/**
 * 振幅値 (0.0〜1.0) を推定 dBFS (-100〜0 dBFS) に変換する
 */
export function amplitudeToEstimatedDbfs(amplitude: number): number {
  if (!Number.isFinite(amplitude) || amplitude <= 0.00001) {
    return -100;
  }
  const db = 20 * Math.log10(Math.min(1.0, amplitude));
  return Number(Math.max(-100, db).toFixed(1));
}

/**
 * 録音テスト全フレーム（前半2秒＝環境音測定区間、後半2〜10秒＝発話テスト区間）から
 * 録音品質診断レポートを生成する (Section 4.3 & 4.4)
 */
export function evaluateAudioQualityFrames(
  frames: FrameAudioSampleMetric[],
  options?: {
    ambientWindowMs?: number;
    thresholds?: AudioQualityThresholds;
  }
): AudioQualityReport {
  const ambientWindowMs = options?.ambientWindowMs ?? 2000;
  const thresholds = options?.thresholds ?? AUDIO_QUALITY_THRESHOLDS;

  if (frames.length === 0) {
    return {
      verdictCode: 'no-signal',
      verdictLabel: 'マイク入力が検出されない',
      verdictDescription:
        '音声信号が検出されませんでした。マイクのミュート設定や接続を確認してください。',
      overallRms: 0,
      overallPeak: 0,
      estimatedRmsDbfs: -100,
      estimatedPeakDbfs: -100,
      clippingSuspectedCount: 0,
      clippingSuspected: false,
      silenceRatioPercent: 100,
      ambientNoiseFloorDbfs: -100,
      speechLevelDbfs: -100,
      estimatedSnrDb: 0,
      ambientNoiseLabel: '測定不能（無信号）',
    };
  }

  const ambientFrames = frames.filter((f) => f.timestampMs <= ambientWindowMs);
  const speechWindowFrames = frames.filter(
    (f) => f.timestampMs > ambientWindowMs
  );
  const evaluationFrames =
    speechWindowFrames.length > 0 ? speechWindowFrames : frames;

  let overallPeak = 0;
  let sumRmsSq = 0;
  let silentFramesCount = 0;
  let clippingFramesCount = 0;

  for (const f of frames) {
    if (f.peak > overallPeak) {
      overallPeak = f.peak;
    }
    sumRmsSq += f.rms * f.rms;
    if (f.rms < thresholds.silenceRmsThreshold) {
      silentFramesCount++;
    }
    if (f.clippedSamples > 0) {
      clippingFramesCount++;
    }
  }

  const overallRms = Math.sqrt(sumRmsSq / frames.length);
  const silenceRatioPercent = Math.round(
    (silentFramesCount / frames.length) * 100
  );

  // Ambient noise floor RMS (first 2 seconds)
  const ambientRms =
    ambientFrames.length > 0
      ? Math.sqrt(
          ambientFrames.reduce((acc, f) => acc + f.rms * f.rms, 0) /
            ambientFrames.length
        )
      : thresholds.silenceRmsThreshold * 0.5;

  // Active speech RMS (frames in speech window that exceed silence threshold, or all speech window frames if quiet)
  const activeSpeechFrames = evaluationFrames.filter(
    (f) => f.rms >= thresholds.silenceRmsThreshold
  );
  const targetSpeechFrames =
    activeSpeechFrames.length > 0 ? activeSpeechFrames : evaluationFrames;
  const speechRms = Math.sqrt(
    targetSpeechFrames.reduce((acc, f) => acc + f.rms * f.rms, 0) /
      Math.max(1, targetSpeechFrames.length)
  );

  const estimatedRmsDbfs = amplitudeToEstimatedDbfs(overallRms);
  const estimatedPeakDbfs = amplitudeToEstimatedDbfs(overallPeak);
  const ambientNoiseFloorDbfs = amplitudeToEstimatedDbfs(ambientRms);
  const speechLevelDbfs = amplitudeToEstimatedDbfs(speechRms);

  const rawSnrDb = speechLevelDbfs - ambientNoiseFloorDbfs;
  const estimatedSnrDb = Number(Math.max(0, rawSnrDb).toFixed(1));
  const clippingSuspected =
    clippingFramesCount >= thresholds.clippingCountWarning ||
    overallPeak >= thresholds.clippingSampleThreshold;

  // Ambient noise label
  let ambientNoiseLabel = '静か（良好）';
  if (ambientNoiseFloorDbfs > thresholds.noisyAmbientDbfs) {
    ambientNoiseLabel = '周囲の騒音が大きい可能性';
  } else if (ambientNoiseFloorDbfs > thresholds.noisyAmbientDbfs - 8) {
    ambientNoiseLabel = 'やや環境音あり（許容範囲）';
  }

  // Primary Verdict Priority:
  // 1. No signal at all
  // 2. Clipping / Distortion
  // 3. Too quiet speech
  // 4. High ambient noise / Low SNR
  // 5. Good
  if (
    overallPeak < thresholds.noSignalPeakThreshold ||
    silenceRatioPercent >= 98
  ) {
    return {
      verdictCode: 'no-signal',
      verdictLabel: 'マイク入力が検出されない',
      verdictDescription:
        'マイクからの音声入力がほぼ無音です。マイクのミュートスイッチや入力デバイス選択を確認してください。',
      overallRms,
      overallPeak,
      estimatedRmsDbfs,
      estimatedPeakDbfs,
      clippingSuspectedCount: clippingFramesCount,
      clippingSuspected: false,
      silenceRatioPercent,
      ambientNoiseFloorDbfs,
      speechLevelDbfs,
      estimatedSnrDb: 0,
      ambientNoiseLabel,
    };
  }

  if (clippingSuspected) {
    return {
      verdictCode: 'clipping',
      verdictLabel: '音割れの可能性',
      verdictDescription:
        'ピーク音量が上限（0 dBFS付近）に達しており、音割れ（クリッピング）の疑いがあります。マイクの入力ゲインを下げるか、マイクから少し離れて話してください。',
      overallRms,
      overallPeak,
      estimatedRmsDbfs,
      estimatedPeakDbfs,
      clippingSuspectedCount: clippingFramesCount,
      clippingSuspected: true,
      silenceRatioPercent,
      ambientNoiseFloorDbfs,
      speechLevelDbfs,
      estimatedSnrDb,
      ambientNoiseLabel,
    };
  }

  if (speechLevelDbfs < thresholds.tooQuietSpeechDbfs) {
    return {
      verdictCode: 'too-quiet',
      verdictLabel: '音量が小さい可能性',
      verdictDescription:
        '発話時の入力音量が小さめです。マイクに近づくか、OSの入力音量設定を少し上げると音声認識と動画の聞き取りやすさが向上します。',
      overallRms,
      overallPeak,
      estimatedRmsDbfs,
      estimatedPeakDbfs,
      clippingSuspectedCount: clippingFramesCount,
      clippingSuspected: false,
      silenceRatioPercent,
      ambientNoiseFloorDbfs,
      speechLevelDbfs,
      estimatedSnrDb,
      ambientNoiseLabel,
    };
  }

  if (
    ambientNoiseFloorDbfs > thresholds.noisyAmbientDbfs ||
    (ambientFrames.length > 0 && estimatedSnrDb < thresholds.minRecommendedSnrDb)
  ) {
    return {
      verdictCode: 'noisy-environment',
      verdictLabel: '周囲の騒音が大きい可能性',
      verdictDescription:
        '無音区間の環境ノイズがやや高め、または声と環境音の音量差（推定SNR）が小さめです。エアコンや周囲の雑音に注意し、指向性マイクやピンマイクの利用を推奨します。',
      overallRms,
      overallPeak,
      estimatedRmsDbfs,
      estimatedPeakDbfs,
      clippingSuspectedCount: clippingFramesCount,
      clippingSuspected: false,
      silenceRatioPercent,
      ambientNoiseFloorDbfs,
      speechLevelDbfs,
      estimatedSnrDb,
      ambientNoiseLabel: '周囲の騒音が大きい可能性',
    };
  }

  return {
    verdictCode: 'good',
    verdictLabel: '良好',
    verdictDescription:
      '十分な声量があり、音割れや過度な環境ノイズも見られません。このまま快適にYouTube撮影と音声追従を行えます。',
    overallRms,
    overallPeak,
    estimatedRmsDbfs,
    estimatedPeakDbfs,
    clippingSuspectedCount: clippingFramesCount,
    clippingSuspected: false,
    silenceRatioPercent,
    ambientNoiseFloorDbfs,
    speechLevelDbfs,
    estimatedSnrDb,
    ambientNoiseLabel,
  };
}
