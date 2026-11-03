'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LanguageCode } from '@/types/prompter';
import {
  AudioQualityReport,
  FrameAudioSampleMetric,
  amplitudeToEstimatedDbfs,
  analyzeWaveformFrame,
  evaluateAudioQualityFrames,
} from '@/lib/audioQualityAnalyzer';
import { isSpeechRecognitionSupported } from '@/lib/speechEngine';
import {
  Mic,
  X,
  Play,
  Square,
  CheckCircle2,
  AlertTriangle,
  Volume2,
  Activity,
  RotateCcw,
} from 'lucide-react';

interface AudioTestModalProps {
  isOpen: boolean;
  onClose: () => void;
  preferredAudioDeviceId: string;
  language: LanguageCode;
  isVideoRecordingActive: boolean;
}

const MAX_TEST_DURATION_SEC = 10;
const AMBIENT_NOISE_PHASE_SEC = 2;

export function AudioTestModal({
  isOpen,
  onClose,
  preferredAudioDeviceId,
  language,
  isVideoRecordingActive,
}: AudioTestModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [liveRms, setLiveRms] = useState<number>(0);
  const [livePeak, setLivePeak] = useState<number>(0);
  const [micLabel, setMicLabel] = useState<string>('未取得');
  const [testError, setTestError] = useState<string | null>(null);
  const [report, setReport] = useState<AudioQualityReport | null>(null);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);

  // Speech recognition check state (Section 4.5)
  const [speechEngineAvailable, setSpeechEngineAvailable] =
    useState<boolean>(true);
  const [speechCheckStatus, setSpeechCheckStatus] = useState<
    'idle' | 'running' | 'recognized' | 'no-speech' | 'unavailable' | 'error'
  >('idle');
  const [recognizedText, setRecognizedText] = useState<string>('');

  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const rafRef = useRef<number | null>(null);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startMsRef = useRef<number>(0);
  const framesRef = useRef<FrameAudioSampleMetric[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  // Release all audio streams, Web Audio nodes, and SpeechRecognition cleanly (Section 4.6)
  const cleanupTestResources = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (stopTimeoutRef.current) {
      clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }
    if (tickIntervalRef.current) {
      clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== 'inactive'
    ) {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
    }
    mediaRecorderRef.current = null;

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;

    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((t) => t.stop());
      audioStreamRef.current = null;
    }
    setIsTesting(false);
    setLiveRms(0);
    setLivePeak(0);
  }, []);

  // Revoke temporary test audio URL when modal closes (Section 4.6: do not persist test audio)
  useEffect(() => {
    if (!isOpen) {
      cleanupTestResources();
      if (recordedAudioUrl) {
        URL.revokeObjectURL(recordedAudioUrl);
        setRecordedAudioUrl(null);
      }
    } else {
      setSpeechEngineAvailable(isSpeechRecognitionSupported());
    }
  }, [cleanupTestResources, isOpen, recordedAudioUrl]);

  useEffect(() => {
    return () => {
      cleanupTestResources();
    };
  }, [cleanupTestResources]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => {
      cleanupTestResources();
      onClose();
    };
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [cleanupTestResources, onClose]);

  const finishAndEvaluateTest = useCallback(() => {
    const collectedFrames = [...framesRef.current];
    cleanupTestResources();
    const evaluation = evaluateAudioQualityFrames(collectedFrames, {
      ambientWindowMs: AMBIENT_NOISE_PHASE_SEC * 1000,
    });
    setReport(evaluation);
    setSpeechCheckStatus((prev) =>
      prev === 'running' ? 'no-speech' : prev
    );
  }, [cleanupTestResources]);

  const handleStartAudioTest = async () => {
    // Section 4.6: Prevent test recording during active video recording or duplicate invocation
    if (isVideoRecordingActive) {
      setTestError('カメラ録画中は録音テストを開始できません。');
      return;
    }
    if (isTesting) return;

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setTestError('お使いのブラウザではマイク録音機能が利用できません。');
      return;
    }

    setTestError(null);
    setReport(null);
    setRecognizedText('');
    if (recordedAudioUrl) {
      URL.revokeObjectURL(recordedAudioUrl);
      setRecordedAudioUrl(null);
    }

    try {
      const constraints: MediaStreamConstraints = {
        audio: preferredAudioDeviceId
          ? {
              deviceId: { ideal: preferredAudioDeviceId },
              echoCancellation: true,
              noiseSuppression: false, // Measure raw room noise & mic level faithfully
              autoGainControl: false,
            }
          : {
              echoCancellation: true,
              noiseSuppression: false,
              autoGainControl: false,
            },
        video: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      audioStreamRef.current = stream;

      const audioTrack = stream.getAudioTracks()[0];
      setMicLabel(audioTrack?.label || 'システム標準マイク');

      // Monitor unexpected mic unplug during test (Section 4.7)
      if (audioTrack) {
        audioTrack.onended = () => {
          setTestError(
            'テスト中にマイクの接続が切断されました。外部マイクの接続を確認してください。'
          );
          finishAndEvaluateTest();
        };
      }

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Record audio clip for instant playback verification (Section 4.2)
      const chunks: BlobPart[] = [];
      try {
        const recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) {
            chunks.push(ev.data);
          }
        };
        recorder.onstop = () => {
          if (chunks.length > 0) {
            const blob = new Blob(chunks, {
              type: recorder.mimeType || 'audio/webm',
            });
            setRecordedAudioUrl(URL.createObjectURL(blob));
          }
        };
        recorder.start(250);
        mediaRecorderRef.current = recorder;
      } catch {
        // Ignore if MediaRecorder for audio-only fails on restricted browsers; Web Audio analysis still runs
      }

      // Section 4.5: Simultaneous Web Speech API recognition check
      if (isSpeechRecognitionSupported()) {
        try {
          const SpeechRecognitionCtor =
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).SpeechRecognition ||
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).webkitSpeechRecognition;
          const recognition = new SpeechRecognitionCtor();
          recognition.lang = language;
          recognition.continuous = true;
          recognition.interimResults = true;
          setSpeechCheckStatus('running');

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          recognition.onresult = (event: any) => {
            let text = '';
            for (let i = 0; i < event.results.length; i++) {
              text += event.results[i][0].transcript;
            }
            if (text.trim()) {
              setRecognizedText(text.trim());
              setSpeechCheckStatus('recognized');
            }
          };
          recognition.onerror = () => {
            setSpeechCheckStatus((prev) =>
              prev === 'recognized' ? 'recognized' : 'error'
            );
          };
          recognition.start();
          recognitionRef.current = recognition;
        } catch {
          setSpeechCheckStatus('unavailable');
        }
      } else {
        setSpeechCheckStatus('unavailable');
      }

      framesRef.current = [];
      startMsRef.current = Date.now();
      setElapsedSec(0);
      setIsTesting(true);

      const sampleBuffer = new Float32Array(analyser.fftSize);
      const sampleLoop = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getFloatTimeDomainData(sampleBuffer);
        const elapsedMs = Date.now() - startMsRef.current;
        const metric = analyzeWaveformFrame(sampleBuffer, elapsedMs);
        framesRef.current.push(metric);
        setLiveRms(metric.rms);
        setLivePeak(metric.peak);
        rafRef.current = requestAnimationFrame(sampleLoop);
      };
      rafRef.current = requestAnimationFrame(sampleLoop);

      tickIntervalRef.current = setInterval(() => {
        const sec = Math.min(
          MAX_TEST_DURATION_SEC,
          (Date.now() - startMsRef.current) / 1000
        );
        setElapsedSec(Number(sec.toFixed(1)));
      }, 100);

      stopTimeoutRef.current = setTimeout(() => {
        finishAndEvaluateTest();
      }, MAX_TEST_DURATION_SEC * 1000);
    } catch (err) {
      cleanupTestResources();
      const domErr = err as DOMException;
      if (
        domErr?.name === 'NotAllowedError' ||
        domErr?.name === 'PermissionDeniedError'
      ) {
        setTestError(
          'マイクの権限が拒否されました。ブラウザのアドレスバー左側の設定またはシステム設定からマイクを許可してください。'
        );
      } else {
        setTestError(
          'マイクの起動に失敗しました。マイクが正しく接続されているか確認してください。'
        );
      }
    }
  };

  const verdictBadgeColor = (code: AudioQualityReport['verdictCode']) => {
    switch (code) {
      case 'good':
        return 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300';
      case 'clipping':
      case 'no-signal':
        return 'border-rose-500/50 bg-rose-500/15 text-rose-300';
      case 'too-quiet':
      case 'noisy-environment':
        return 'border-amber-500/50 bg-amber-500/15 text-amber-300';
    }
  };

  const liveDbfs = amplitudeToEstimatedDbfs(liveRms);
  const meterPercent = Math.max(
    4,
    Math.min(100, Math.round(((liveDbfs + 60) / 60) * 100))
  );

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: 'any' } as React.DialogHTMLAttributes<HTMLDialogElement>)}
      aria-labelledby="audio-test-modal-title"
      className="m-auto w-full max-w-xl rounded-2xl border border-zinc-800 bg-zinc-950/95 p-0 text-zinc-100 shadow-2xl backdrop:bg-black/75 backdrop:backdrop-blur-sm"
    >
      <div className="flex max-h-[88vh] flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <Activity className="h-5 w-5 text-emerald-400" />
            <h2
              id="audio-test-modal-title"
              className="text-base font-bold tracking-tight"
            >
              録音品質・環境ノイズ・音声認識チェック
            </h2>
          </div>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
            aria-label="閉じる"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 overflow-y-auto px-6 py-5 text-xs">
          <p className="leading-relaxed text-zinc-300">
            撮影前に最大10秒間のテスト録音を行い、マイク音量・音割れ・周囲の環境音（推定SNR）・音声認識の動作を一括診断します。
          </p>

          {/* Step Guide Box */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3.5">
            <div className="flex items-center justify-between text-[11px] font-semibold">
              <span
                className={
                  isTesting && elapsedSec < AMBIENT_NOISE_PHASE_SEC
                    ? 'text-amber-300'
                    : 'text-zinc-400'
                }
              >
                ① 最初の2秒間：無音で環境音を測定
              </span>
              <span
                className={
                  isTesting && elapsedSec >= AMBIENT_NOISE_PHASE_SEC
                    ? 'text-emerald-300'
                    : 'text-zinc-400'
                }
              >
                ② 2秒〜10秒：下の文章を普段の声で読み上げ
              </span>
            </div>

            <div className="mt-2.5 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              {isTesting && elapsedSec < AMBIENT_NOISE_PHASE_SEC ? (
                <p className="text-center text-sm font-bold text-amber-300 animate-pulse">
                  🤫 そのまま静かにお待ちください（環境ノイズ測定中... 残り{' '}
                  {Math.max(0, AMBIENT_NOISE_PHASE_SEC - elapsedSec).toFixed(1)}
                  秒）
                </p>
              ) : (
                <div>
                  <span className="block text-[10px] text-sky-400">
                    {isTesting
                      ? '🎤 今すぐ普段の撮影時の声量で読み上げてください：'
                      : '読み上げ用サンプル文：'}
                  </span>
                  <p className="mt-1 text-sm font-bold leading-relaxed text-white">
                    「皆さんこんにちは。今日も動画をご覧いただきありがとうございます。ただいまマイク音量と音声追従のテストを行っています。」
                  </p>
                </div>
              )}
            </div>

            {/* Real-time Audio Meter */}
            <div className="mt-3 space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="flex items-center gap-1.5 text-zinc-400">
                  <Mic className="h-3.5 w-3.5 text-emerald-400" />
                  <span>使用マイク: {micLabel}</span>
                </span>
                <span className="font-mono text-zinc-300">
                  {isTesting
                    ? `${elapsedSec.toFixed(1)}s / ${MAX_TEST_DURATION_SEC}s (${liveDbfs} dBFS 推定)`
                    : '待機中'}
                </span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-zinc-950 p-0.5 ring-1 ring-zinc-800">
                <div
                  style={{ width: `${isTesting ? meterPercent : 0}%` }}
                  className={`h-full rounded-full transition-all duration-75 ${
                    livePeak >= 0.985
                      ? 'bg-rose-500'
                      : liveDbfs > -18
                        ? 'bg-emerald-400'
                        : 'bg-sky-400'
                  }`}
                />
              </div>
            </div>

            {/* Start / Stop Test Buttons */}
            <div className="mt-3.5 flex items-center justify-end gap-2">
              {isTesting ? (
                <button
                  type="button"
                  onClick={finishAndEvaluateTest}
                  className="flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow transition hover:bg-rose-500"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                  <span>テストを終了して結果を見る ({elapsedSec.toFixed(0)}s)</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isVideoRecordingActive}
                  onClick={handleStartAudioTest}
                  className="flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-black shadow transition hover:bg-emerald-400 disabled:opacity-40"
                >
                  {report ? (
                    <>
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>もう一度録音テストを実行 (10秒)</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5 fill-current" />
                      <span>10秒間の録音テストを開始</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {testError && (
            <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3.5 text-rose-200">
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
              <span>{testError}</span>
            </div>
          )}

          {/* Diagnostic Report Results (Section 4.2, 4.3, 4.4, 4.5) */}
          {report && (
            <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              {/* Verdict Banner */}
              <div
                className={`flex items-start justify-between gap-3 rounded-xl border p-3 ${verdictBadgeColor(
                  report.verdictCode
                )}`}
              >
                <div>
                  <div className="flex items-center gap-1.5 text-sm font-bold">
                    {report.verdictCode === 'good' ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <AlertTriangle className="h-4 w-4" />
                    )}
                    <span>診断結果：{report.verdictLabel}</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed opacity-90">
                    {report.verdictDescription}
                  </p>
                </div>
              </div>

              {/* Recorded Audio Playback (Section 4.2) */}
              {recordedAudioUrl && (
                <div className="flex flex-col gap-1.5 rounded-xl border border-zinc-800 bg-zinc-950 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="flex items-center gap-1.5 font-semibold text-zinc-200">
                    <Volume2 className="h-4 w-4 text-sky-400" />
                    <span>テスト録音の再生確認：</span>
                  </span>
                  <audio
                    src={recordedAudioUrl}
                    controls
                    className="h-8 w-full sm:w-64"
                  />
                </div>
              )}

              {/* Metrics Grid */}
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-2.5">
                  <span className="block text-[10px] text-zinc-400">
                    発話時の入力音量 (推定値)
                  </span>
                  <span className="mt-0.5 block font-mono text-sm font-bold text-sky-400">
                    {report.speechLevelDbfs} dBFS
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    全体RMS: {report.overallRms.toFixed(3)}
                  </span>
                </div>

                <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-2.5">
                  <span className="block text-[10px] text-zinc-400">
                    ピーク音量 (推定値)
                  </span>
                  <span className="mt-0.5 block font-mono text-sm font-bold text-zinc-100">
                    {report.estimatedPeakDbfs} dBFS
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    Peak振幅: {(report.overallPeak * 100).toFixed(0)}%
                  </span>
                </div>

                <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-2.5">
                  <span className="block text-[10px] text-zinc-400">
                    音割れの疑い
                  </span>
                  <span
                    className={`mt-0.5 block font-mono text-sm font-bold ${
                      report.clippingSuspected
                        ? 'text-rose-400'
                        : 'text-emerald-400'
                    }`}
                  >
                    {report.clippingSuspected
                      ? `あり (${report.clippingSuspectedCount}回)`
                      : 'なし (0回)'}
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    無音割合: {report.silenceRatioPercent}%
                  </span>
                </div>

                <div className="col-span-2 rounded-lg border border-zinc-800 bg-zinc-950/80 p-2.5 sm:col-span-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="block text-[10px] text-zinc-400">
                        環境ノイズの目安・簡易信号対雑音比（※すべて推定値）
                      </span>
                      <span className="mt-0.5 block text-xs font-bold text-zinc-200">
                        {report.ambientNoiseLabel}（環境音フロア推定:{' '}
                        {report.ambientNoiseFloorDbfs} dBFS / 推定SNR:{' '}
                        {report.estimatedSnrDb} dB）
                      </span>
                    </div>
                    <span className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
                      ※ブラウザWeb Audioによる簡易推定値
                    </span>
                  </div>
                </div>
              </div>

              {/* Speech Recognition Status Check (Section 4.5) */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/90 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-zinc-300">
                    音声認識エンジンの動作状況：
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      speechCheckStatus === 'recognized'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : !speechEngineAvailable ||
                            speechCheckStatus === 'unavailable'
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {speechCheckStatus === 'recognized'
                      ? '正常認識を確認'
                      : !speechEngineAvailable ||
                          speechCheckStatus === 'unavailable'
                        ? '音声認識非対応（録音テストのみ実行済）'
                        : '発話未検出'}
                  </span>
                </div>
                <p className="mt-1.5 rounded bg-zinc-900 px-2.5 py-1.5 text-[11px] text-zinc-200">
                  {recognizedText
                    ? `認識テキスト: 「${recognizedText}」`
                    : !speechEngineAvailable ||
                        speechCheckStatus === 'unavailable'
                      ? 'このブラウザ環境ではWeb Speech APIが利用できませんが、カメラ録画と手動・一定速度スクロールは正常に利用可能です。'
                      : '（テスト中に認識された文章がここに表示されます）'}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-800 px-6 py-3.5">
          <span className="text-[10px] text-zinc-500">
            ※ テスト録音データは外部へ送信されず、画面を閉じると自動破棄されます。
          </span>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="rounded-xl bg-zinc-800 px-4 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-700"
          >
            閉じる
          </button>
        </div>
      </div>
    </dialog>
  );
}
