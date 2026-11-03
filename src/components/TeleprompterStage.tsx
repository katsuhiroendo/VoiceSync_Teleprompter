'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  ScriptItem,
  PrompterSettings,
  ScrollMode,
  SpeechStatus,
} from '@/types/prompter';
import { parseScriptToSegments } from '@/lib/scriptParser';
import {
  SpeechRecognitionController,
  SpeechTranscriptEvent,
  SpeechErrorInfo,
} from '@/lib/speechEngine';
import {
  findBestMatchingSegment,
  MatchEvaluationResult,
} from '@/lib/fuzzyMatcher';
import {
  Play,
  Pause,
  RotateCcw,
  SkipBack,
  SkipForward,
  Sliders,
  Maximize2,
  Minimize2,
  ArrowLeft,
  Mic,
  Gauge,
  Hand,
  Camera,
  Eye,
  Minus,
  Plus,
  Bug,
  AlertTriangle,
  WifiOff,
  CheckCircle2,
  X,
} from 'lucide-react';

interface TeleprompterStageProps {
  script: ScriptItem;
  settings: PrompterSettings;
  onUpdateSettings: (partial: Partial<PrompterSettings>) => void;
  onExitStage: () => void;
  onOpenSettings: () => void;
}

const STATUS_LABELS: Record<
  SpeechStatus,
  { label: string; badgeClass: string; dotClass: string }
> = {
  idle: {
    label: '待機中',
    badgeClass: 'border-zinc-700 bg-zinc-900/90 text-zinc-300',
    dotClass: 'bg-zinc-400',
  },
  connecting: {
    label: 'マイク接続中',
    badgeClass: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
    dotClass: 'bg-amber-400 animate-pulse',
  },
  listening: {
    label: '音声認識中',
    badgeClass: 'border-sky-500/40 bg-sky-500/15 text-sky-300',
    dotClass: 'bg-sky-400 animate-pulse',
  },
  speaking: {
    label: '発話検出中',
    badgeClass: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
    dotClass: 'bg-emerald-400 animate-ping',
  },
  matching: {
    label: '原稿照合中',
    badgeClass: 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300',
    dotClass: 'bg-indigo-400 animate-pulse',
  },
  paused: {
    label: '一時停止中',
    badgeClass: 'border-zinc-700 bg-zinc-900/90 text-zinc-400',
    dotClass: 'bg-zinc-500',
  },
  error: {
    label: 'エラー',
    badgeClass: 'border-red-500/50 bg-red-500/15 text-red-300',
    dotClass: 'bg-red-400',
  },
};

export function TeleprompterStage({
  script,
  settings,
  onUpdateSettings,
  onExitStage,
  onOpenSettings,
}: TeleprompterStageProps) {
  const segments = useMemo(
    () => parseScriptToSegments(script.content),
    [script.content]
  );

  // Default to voice tracking mode (Section 4)
  const [scrollMode, setScrollMode] = useState<ScrollMode>('voice');
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number>(0);
  const [speechStatus, setSpeechStatus] = useState<SpeechStatus>('idle');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [controlsVisible, setControlsVisible] = useState<boolean>(true);

  // Real-time speech recognition & debug state (Phase 2 & 3)
  const [latestTranscript, setLatestTranscript] = useState<string>('');
  const [isInterimTranscript, setIsInterimTranscript] =
    useState<boolean>(false);
  const [micVolumeLevel, setMicVolumeLevel] = useState<number>(0);
  const [lastMatchResult, setLastMatchResult] =
    useState<MatchEvaluationResult | null>(null);
  const [speechError, setSpeechError] = useState<SpeechErrorInfo | null>(null);
  const [isOffline, setIsOffline] = useState<boolean>(false);
  const [simulationInput, setSimulationInput] = useState<string>('');

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const segmentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rafRef = useRef<number | null>(null);
  const smoothScrollRafRef = useRef<number | null>(null);
  const targetScrollTopRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);
  const hideControlsTimerRef = useRef<NodeJS.Timeout | null>(null);
  const programmaticScrollRef = useRef<boolean>(false);

  // Refs to hold fresh state for the non-restarting SpeechRecognitionController
  const activeIndexRef = useRef<number>(activeSegmentIndex);
  activeIndexRef.current = activeSegmentIndex;
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const speechControllerRef = useRef<SpeechRecognitionController | null>(null);

  // Smooth spring-damped scroll engine (Section 4.4: 滑らかなアニメーション、ちらつき防止)
  const animateScrollToTarget = useCallback((desiredTop: number) => {
    const container = scrollContainerRef.current;
    if (!container) return;

    targetScrollTopRef.current = Math.max(
      0,
      Math.min(desiredTop, container.scrollHeight - container.clientHeight)
    );

    if (smoothScrollRafRef.current !== null) {
      return; // Animation loop already running toward updated targetScrollTopRef
    }

    programmaticScrollRef.current = true;

    const step = () => {
      const el = scrollContainerRef.current;
      const target = targetScrollTopRef.current;
      if (!el || target === null) {
        smoothScrollRafRef.current = null;
        programmaticScrollRef.current = false;
        return;
      }

      const current = el.scrollTop;
      const diff = target - current;

      if (Math.abs(diff) < 1.2) {
        el.scrollTop = target;
        targetScrollTopRef.current = null;
        smoothScrollRafRef.current = null;
        programmaticScrollRef.current = false;
        return;
      }

      // Compute damping factor from settings.scrollSmoothness & trackingSpeed
      const damping = Math.min(
        0.45,
        Math.max(
          0.06,
          settingsRef.current.scrollSmoothness *
            settingsRef.current.trackingSpeed
        )
      );
      el.scrollTop = current + diff * damping;
      smoothScrollRafRef.current = requestAnimationFrame(step);
    };

    smoothScrollRafRef.current = requestAnimationFrame(step);
  }, []);

  // Scroll a specific segment smoothly to the reading guide line
  const scrollToSegment = useCallback(
    (index: number) => {
      const container = scrollContainerRef.current;
      const targetEl = segmentRefs.current[index];
      if (!container || !targetEl) return;

      const containerHeight = container.clientHeight;
      const readingAnchorPx =
        (settingsRef.current.readingLinePositionVh / 100) * containerHeight;

      const targetOffsetTop = targetEl.offsetTop;
      const targetHeight = targetEl.offsetHeight;
      const desiredScrollTop = Math.max(
        0,
        targetOffsetTop - readingAnchorPx + targetHeight * 0.35
      );

      animateScrollToTarget(desiredScrollTop);
    },
    [animateScrollToTarget]
  );

  // Keep track of the normalized transcript when we last advanced via early-trigger,
  // so the remaining words of the previous phrase don't re-trigger another advance on the new phrase.
  const lastAdvanceSpokenLengthRef = useRef<number>(0);

  // Process recognized speech (from microphone or debug simulator) and match against script
  const processRecognizedSpeech = useCallback(
    (event: SpeechTranscriptEvent) => {
      setLatestTranscript(event.transcript);
      setIsInterimTranscript(!event.isFinal);
      setSpeechStatus('matching');

      // If we recently advanced early during an ongoing interim stream, slice only the newly spoken tail
      // or full transcript if a new resultIndex started.
      let effectiveTranscript = event.transcript;
      if (
        !event.isFinal &&
        lastAdvanceSpokenLengthRef.current > 0 &&
        event.transcript.length > lastAdvanceSpokenLengthRef.current
      ) {
        effectiveTranscript = event.transcript.slice(
          Math.max(0, lastAdvanceSpokenLengthRef.current - 4)
        );
      } else if (
        event.transcript.length < lastAdvanceSpokenLengthRef.current
      ) {
        lastAdvanceSpokenLengthRef.current = 0;
      }

      const evaluation = findBestMatchingSegment(
        effectiveTranscript,
        segmentsRef.current,
        {
          currentIndex: activeIndexRef.current,
          sensitivity: settingsRef.current.trackingSensitivity,
          advanceTriggerRatio: settingsRef.current.advanceTriggerRatio,
          isFinal: event.isFinal,
        }
      );

      setLastMatchResult(evaluation);

      if (
        evaluation.shouldAdvance &&
        evaluation.matchedSegmentIndex !== activeIndexRef.current
      ) {
        activeIndexRef.current = evaluation.matchedSegmentIndex;
        setActiveSegmentIndex(evaluation.matchedSegmentIndex);
        scrollToSegment(evaluation.matchedSegmentIndex);

        if (evaluation.reason === 'early-trigger-advance' && !event.isFinal) {
          lastAdvanceSpokenLengthRef.current = event.transcript.length;
        } else {
          lastAdvanceSpokenLengthRef.current = 0;
        }
      } else if (event.isFinal) {
        lastAdvanceSpokenLengthRef.current = 0;
      }

      // Restore status badge to listening after brief matching indicator
      setTimeout(() => {
        setSpeechStatus((prev) => (prev === 'matching' ? 'listening' : prev));
      }, 260);
    },
    [scrollToSegment]
  );

  // Instantiate singleton SpeechRecognitionController once on mount (4.1 再描画で再起動しない)
  useEffect(() => {
    const controller = new SpeechRecognitionController({
      onStatusChange: (status) => setSpeechStatus(status),
      onTranscript: (ev) => processRecognizedSpeech(ev),
      onVolumeChange: (rms) => setMicVolumeLevel(rms),
      onError: (err) => {
        setSpeechError(err);
        if (err) {
          setIsPlaying(false);
        }
      },
    });
    speechControllerRef.current = controller;

    return () => {
      controller.destroy();
      speechControllerRef.current = null;
      if (smoothScrollRafRef.current) {
        cancelAnimationFrame(smoothScrollRafRef.current);
      }
    };
  }, [processRecognizedSpeech]);

  // Keep language synchronized without recreating the controller
  useEffect(() => {
    speechControllerRef.current?.setLanguage(script.language);
  }, [script.language]);

  // Monitor online/offline status & auto-switch to manual mode if offline (Section 9)
  useEffect(() => {
    const updateOnlineState = () => {
      const offline = !navigator.onLine;
      setIsOffline(offline);
      if (offline && scrollMode === 'voice') {
        speechControllerRef.current?.stop();
        setIsPlaying(false);
        setScrollMode('manual');
      }
    };
    updateOnlineState();
    window.addEventListener('online', updateOnlineState);
    window.addEventListener('offline', updateOnlineState);
    return () => {
      window.removeEventListener('online', updateOnlineState);
      window.removeEventListener('offline', updateOnlineState);
    };
  }, [scrollMode]);

  // Start / Stop SpeechRecognitionController when play state or scrollMode changes
  useEffect(() => {
    const controller = speechControllerRef.current;
    if (!controller) return;

    if (isPlaying && scrollMode === 'voice') {
      controller.start(script.language);
    } else {
      controller.stop();
      if (!isPlaying) {
        setSpeechStatus((prev) => (prev === 'error' ? 'error' : 'paused'));
      } else {
        setSpeechStatus('idle');
      }
    }
  }, [isPlaying, scrollMode, script.language]);

  // Auto-hide controls during active playback for distraction-free recording
  const resetControlsIdleTimer = useCallback(() => {
    setControlsVisible(true);
    if (hideControlsTimerRef.current) {
      clearTimeout(hideControlsTimerRef.current);
    }
    if (isPlaying && !speechError) {
      hideControlsTimerRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 3400);
    }
  }, [isPlaying, speechError]);

  useEffect(() => {
    resetControlsIdleTimer();
    return () => {
      if (hideControlsTimerRef.current) {
        clearTimeout(hideControlsTimerRef.current);
      }
    };
  }, [isPlaying, resetControlsIdleTimer]);

  // Compute which segment is closest to the reading guide line when scrolling manually or at constant speed
  const updateActiveSegmentFromScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || segments.length === 0) return;

    const readingAnchorY =
      container.scrollTop +
      (settings.readingLinePositionVh / 100) * container.clientHeight;

    let closestIdx = 0;
    let minDistance = Number.POSITIVE_INFINITY;

    for (let i = 0; i < segments.length; i++) {
      const el = segmentRefs.current[i];
      if (!el) continue;
      const center = el.offsetTop + el.offsetHeight / 2;
      const dist = Math.abs(center - readingAnchorY);
      if (dist < minDistance) {
        minDistance = dist;
        closestIdx = i;
      }
    }

    setActiveSegmentIndex((prev) => (prev !== closestIdx ? closestIdx : prev));
  }, [segments.length, settings.readingLinePositionVh]);

  // Constant speed scrolling loop via requestAnimationFrame
  useEffect(() => {
    if (!isPlaying || scrollMode !== 'constant') {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastFrameTimeRef.current = null;
      return;
    }

    const tick = (timestamp: number) => {
      if (lastFrameTimeRef.current === null) {
        lastFrameTimeRef.current = timestamp;
      }
      const deltaSec = (timestamp - lastFrameTimeRef.current) / 1000;
      lastFrameTimeRef.current = timestamp;

      const container = scrollContainerRef.current;
      if (container) {
        const maxScroll = container.scrollHeight - container.clientHeight;
        if (container.scrollTop < maxScroll - 1) {
          container.scrollTop += settings.constantScrollSpeed * deltaSec;
          updateActiveSegmentFromScroll();
        } else {
          setIsPlaying(false);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [
    isPlaying,
    scrollMode,
    settings.constantScrollSpeed,
    updateActiveSegmentFromScroll,
  ]);

  // Navigation Handlers
  const handleResetToTop = useCallback(() => {
    setIsPlaying(false);
    activeIndexRef.current = 0;
    setActiveSegmentIndex(0);
    animateScrollToTarget(0);
  }, [animateScrollToTarget]);

  const handleJumpParagraph = useCallback(
    (direction: 'prev' | 'next') => {
      if (segments.length === 0) return;
      const currentParagraph =
        segments[activeSegmentIndex]?.paragraphIndex ?? 0;

      if (direction === 'next') {
        const nextSeg = segments.find(
          (s, idx) =>
            idx > activeSegmentIndex && s.paragraphIndex > currentParagraph
        );
        const targetIdx = nextSeg
          ? nextSeg.index
          : Math.min(segments.length - 1, activeSegmentIndex + 1);
        activeIndexRef.current = targetIdx;
        setActiveSegmentIndex(targetIdx);
        scrollToSegment(targetIdx);
      } else {
        let targetParagraph = Math.max(0, currentParagraph - 1);
        const firstInCurrent = segments.find(
          (s) => s.paragraphIndex === currentParagraph
        );
        if (firstInCurrent && activeSegmentIndex > firstInCurrent.index) {
          targetParagraph = currentParagraph;
        }
        const prevSeg = segments.find(
          (s) => s.paragraphIndex === targetParagraph
        );
        const targetIdx = prevSeg
          ? prevSeg.index
          : Math.max(0, activeSegmentIndex - 1);
        activeIndexRef.current = targetIdx;
        setActiveSegmentIndex(targetIdx);
        scrollToSegment(targetIdx);
      }
    },
    [activeSegmentIndex, scrollToSegment, segments]
  );

  // Fullscreen toggle
  const handleToggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch {
      // Ignore fullscreen permissions error on restricted webviews
    }
  }, []);

  // Keyboard shortcuts during Teleprompter Stage
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.querySelector('dialog[open]') ||
        document.activeElement?.tagName === 'INPUT'
      ) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying((prev) => !prev);
      } else if (e.code === 'ArrowDown' || e.code === 'ArrowRight') {
        e.preventDefault();
        const nextIdx = Math.min(segments.length - 1, activeSegmentIndex + 1);
        activeIndexRef.current = nextIdx;
        setActiveSegmentIndex(nextIdx);
        scrollToSegment(nextIdx);
      } else if (e.code === 'ArrowUp' || e.code === 'ArrowLeft') {
        e.preventDefault();
        const prevIdx = Math.max(0, activeSegmentIndex - 1);
        activeIndexRef.current = prevIdx;
        setActiveSegmentIndex(prevIdx);
        scrollToSegment(prevIdx);
      } else if (e.code === 'Home') {
        e.preventDefault();
        handleResetToTop();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSegmentIndex, handleResetToTop, scrollToSegment, segments.length]);

  const statusMeta = STATUS_LABELS[speechStatus];

  const mirrorTransform = [
    settings.mirrorHorizontal ? 'scaleX(-1)' : '',
    settings.mirrorVertical ? 'scaleY(-1)' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      onMouseMove={resetControlsIdleTimer}
      onTouchStart={resetControlsIdleTimer}
      style={{ backgroundColor: settings.backgroundColor }}
      className="relative flex h-screen w-screen flex-col overflow-hidden select-none"
    >
      {/* Top Status & Quick Action Bar */}
      <header
        className={`fixed top-0 right-0 left-0 z-30 flex items-center justify-between border-b border-white/10 bg-black/70 px-4 py-3 backdrop-blur-md transition-opacity duration-300 sm:px-6 ${
          controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onExitStage}
            className="flex min-h-[42px] items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/90 px-3.5 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-800 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>編集へ戻る</span>
          </button>

          <div className="hidden sm:block">
            <h1 className="max-w-xs truncate text-xs font-semibold text-zinc-200">
              {script.title}
            </h1>
            <p className="text-[10px] text-zinc-400">
              フレーズ {activeSegmentIndex + 1} / {Math.max(1, segments.length)}
            </p>
          </div>
        </div>

        {/* Center Status Indicator Badge & Mic Level Meter (Section 8) */}
        <div className="flex items-center gap-2.5">
          {isOffline && (
            <div className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-[11px] font-medium text-amber-300">
              <WifiOff className="h-3.5 w-3.5" />
              <span>オフライン（手動モード動作中）</span>
            </div>
          )}

          <div
            className={`flex items-center gap-2.5 rounded-full border px-3.5 py-1.5 text-xs font-medium shadow-sm ${statusMeta.badgeClass}`}
          >
            <span className={`h-2 w-2 rounded-full ${statusMeta.dotClass}`} />
            <span>{statusMeta.label}</span>

            {/* Real-time Microphone Input Level Bar */}
            {scrollMode === 'voice' && isPlaying && (
              <div
                className="flex h-3 w-12 items-center overflow-hidden rounded-full bg-zinc-800 p-0.5"
                title="マイク入力レベル"
              >
                <div
                  style={{ width: `${Math.max(8, Math.round(micVolumeLevel * 100))}%` }}
                  className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-400 transition-all duration-75"
                />
              </div>
            )}
          </div>
        </div>

        {/* Right Quick Toggles */}
        <div className="flex items-center gap-2">
          {/* Font Size Quick Stepper */}
          <div className="hidden items-center rounded-xl border border-zinc-800 bg-zinc-900/90 p-1 lg:flex">
            <button
              type="button"
              onClick={() =>
                onUpdateSettings({
                  fontSize: Math.max(16, settings.fontSize - 4),
                })
              }
              className="rounded-lg p-1.5 text-zinc-300 hover:bg-zinc-800 hover:text-white"
              title="文字を小さく"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="px-2 font-mono text-xs text-zinc-200">
              {settings.fontSize}px
            </span>
            <button
              type="button"
              onClick={() =>
                onUpdateSettings({
                  fontSize: Math.min(100, settings.fontSize + 4),
                })
              }
              className="rounded-lg p-1.5 text-zinc-300 hover:bg-zinc-800 hover:text-white"
              title="文字を大きく"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={() =>
              onUpdateSettings({
                cameraEyelineMode: !settings.cameraEyelineMode,
              })
            }
            className={`flex min-h-[42px] items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition ${
              settings.cameraEyelineMode
                ? 'border-sky-500/60 bg-sky-500/20 text-sky-300'
                : 'border-zinc-800 bg-zinc-900/90 text-zinc-400 hover:text-zinc-200'
            }`}
            title="カメラ目線モード切替"
          >
            <Camera className="h-4 w-4" />
            <span className="hidden xl:inline">カメラ目線</span>
          </button>

          <button
            type="button"
            onClick={() =>
              onUpdateSettings({ focusMode: !settings.focusMode })
            }
            className={`flex min-h-[42px] items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition ${
              settings.focusMode
                ? 'border-sky-500/60 bg-sky-500/20 text-sky-300'
                : 'border-zinc-800 bg-zinc-900/90 text-zinc-400 hover:text-zinc-200'
            }`}
            title="フォーカスモード切替"
          >
            <Eye className="h-4 w-4" />
            <span className="hidden xl:inline">フォーカス</span>
          </button>

          <button
            type="button"
            onClick={() =>
              onUpdateSettings({
                showDebugOverlay: !settings.showDebugOverlay,
              })
            }
            className={`flex min-h-[42px] items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition ${
              settings.showDebugOverlay
                ? 'border-emerald-500/60 bg-emerald-500/20 text-emerald-300'
                : 'border-zinc-800 bg-zinc-900/90 text-zinc-400 hover:text-zinc-200'
            }`}
            title="音声認識デバッグ表示切替"
          >
            <Bug className="h-4 w-4" />
            <span className="hidden xl:inline">デバッグ</span>
          </button>

          <button
            type="button"
            onClick={handleToggleFullscreen}
            className="min-h-[42px] rounded-xl border border-zinc-800 bg-zinc-900/90 p-2.5 text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
            title="全画面表示切替"
          >
            {isFullscreen ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            className="min-h-[42px] rounded-xl border border-zinc-800 bg-zinc-900/90 p-2.5 text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
            title="設定画面を開く"
          >
            <Sliders className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Microphone Permission / Error Recovery Guide Banner (Section 8 & 12) */}
      {speechError && (
        <div className="fixed top-20 right-4 left-4 z-40 mx-auto max-w-2xl rounded-2xl border border-red-500/40 bg-zinc-950/95 p-5 text-zinc-100 shadow-2xl backdrop-blur-xl">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-red-500/20 p-2 text-red-400">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-red-300">
                  {speechError.title}
                </h3>
                <p className="mt-1 text-xs text-zinc-300">
                  {speechError.message}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSpeechError(null)}
              className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900/80 p-3.5">
            <p className="mb-2 text-xs font-semibold text-zinc-200">
              解決方法・復旧ステップ：
            </p>
            <ul className="list-inside list-decimal space-y-1.5 text-xs text-zinc-300">
              {speechError.recoverySteps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ul>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={() => {
                setSpeechError(null);
                setScrollMode('constant');
                setIsPlaying(true);
              }}
              className="rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-700"
            >
              一定速度スクロールで撮影を続行
            </button>
            <button
              type="button"
              onClick={() => {
                setSpeechError(null);
                setScrollMode('manual');
              }}
              className="rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-700"
            >
              手動モードへ切替
            </button>
            <button
              type="button"
              onClick={() => {
                setSpeechError(null);
                setIsPlaying(true);
              }}
              className="rounded-xl bg-sky-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-sky-400"
            >
              音声認識を再試行
            </button>
          </div>
        </div>
      )}

      {/* Main Prompter Stage Container (supports Camera Eyeline Mode) */}
      <div
        style={{
          marginTop: settings.cameraEyelineMode
            ? `${settings.eyelineTopOffsetVh}vh`
            : '0px',
          height: settings.cameraEyelineMode
            ? `${settings.eyelineHeightVh}vh`
            : '100vh',
          transform: mirrorTransform || undefined,
        }}
        className={`relative mx-auto w-full transition-all duration-300 ${
          settings.cameraEyelineMode
            ? 'rounded-b-3xl border-b border-white/15 shadow-2xl'
            : ''
        }`}
      >
        {/* Reading Position Guide Line */}
        {settings.showGuideLine && (
          <div
            style={{ top: `${settings.readingLinePositionVh}%` }}
            className="pointer-events-none absolute right-0 left-0 z-20 flex items-center"
          >
            <div className="h-2.5 w-2.5 rounded-r-full bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.9)]" />
            <div className="h-[1px] w-full bg-gradient-to-r from-sky-400/70 via-sky-400/25 to-sky-400/70" />
            <div className="h-2.5 w-2.5 rounded-l-full bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.9)]" />
          </div>
        )}

        {/* Scrollable Script Viewport */}
        <div
          ref={scrollContainerRef}
          onScroll={() => {
            if (!programmaticScrollRef.current && scrollMode === 'manual') {
              updateActiveSegmentFromScroll();
            }
          }}
          style={{
            paddingTop: `${settings.marginVerticalVh}vh`,
            paddingBottom: `${Math.max(48, settings.marginVerticalVh)}vh`,
            paddingLeft: `${settings.marginHorizontalPx}px`,
            paddingRight: `${settings.marginHorizontalPx}px`,
          }}
          className="h-full w-full overflow-y-auto"
        >
          <div
            style={{
              width: `${settings.contentWidthPercent}%`,
              fontSize: `${settings.fontSize}px`,
              lineHeight: settings.lineHeight,
              color: settings.textColor,
              textAlign: settings.textAlign,
            }}
            className="mx-auto space-y-6 font-medium tracking-wide"
          >
            {segments.map((seg, idx) => {
              const isCurrent = idx === activeSegmentIndex;
              const isNewParagraph =
                idx > 0 &&
                segments[idx - 1].paragraphIndex !== seg.paragraphIndex;

              const opacity = settings.focusMode
                ? isCurrent
                  ? 1
                  : settings.dimOpacity
                : 1;

              return (
                <div
                  key={seg.id}
                  ref={(el) => {
                    segmentRefs.current[idx] = el;
                  }}
                  onClick={() => {
                    activeIndexRef.current = idx;
                    setActiveSegmentIndex(idx);
                    scrollToSegment(idx);
                  }}
                  style={{ opacity }}
                  className={`cursor-pointer rounded-2xl px-4 py-2 transition-opacity duration-200 ${
                    isNewParagraph ? 'mt-10' : ''
                  } ${
                    isCurrent
                      ? 'bg-white/[0.04] ring-1 ring-sky-400/25'
                      : 'hover:opacity-75'
                  }`}
                >
                  {seg.text}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Speech Recognition Live Debug Overlay & Simulator (Section 8 & Phase 2/3) */}
      {settings.showDebugOverlay && (
        <aside className="fixed right-4 bottom-24 z-30 w-full max-w-md rounded-2xl border border-white/15 bg-zinc-950/90 p-3.5 text-xs text-zinc-200 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
            <div className="flex items-center gap-1.5 font-semibold text-emerald-400">
              <Bug className="h-3.5 w-3.5" />
              <span>リアルタイム音声認識・照合デバッグ</span>
            </div>
            <span className="font-mono text-[10px] text-zinc-400">
              {script.language} | 感度 {Math.round(settings.trackingSensitivity * 100)}% | 先行送り {Math.round(settings.advanceTriggerRatio * 100)}%
            </span>
          </div>

          <div className="mt-2.5 space-y-2">
            <div className="rounded-xl bg-zinc-900/90 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] text-zinc-400">
                <span>最新認識 ({isInterimTranscript ? '途中 interim' : '確定 final'})</span>
                {lastMatchResult && (
                  <span className="font-mono text-sky-400">
                    類似度 {Math.round(lastMatchResult.similarityScore * 100)}% | フレーズ進捗 {Math.round(lastMatchResult.progressRatio * 100)}% ({lastMatchResult.reason})
                  </span>
                )}
              </div>
              <p className="mt-1 truncate font-medium text-white">
                {latestTranscript || '（マイクに向かって原稿を読み上げてください）'}
              </p>
            </div>

            {/* Interactive Utterance Simulator for testing matching without speaking */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!simulationInput.trim()) return;
                processRecognizedSpeech({
                  transcript: simulationInput.trim(),
                  isFinal: true,
                  resultIndex: Date.now(),
                  confidence: 0.95,
                  timestamp: Date.now(),
                });
                setSimulationInput('');
              }}
              className="flex items-center gap-1.5"
            >
              <input
                type="text"
                value={simulationInput}
                onChange={(e) => setSimulationInput(e.target.value)}
                placeholder="発話シミュレート入力（テスト用）..."
                className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-sky-500 focus:outline-none"
              />
              <button
                type="submit"
                className=" flex items-center gap-1 rounded-lg bg-zinc-800 px-2.5 py-1.5 text-[11px] font-semibold text-sky-300 transition hover:bg-zinc-700"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                照合テスト
              </button>
            </form>
          </div>
        </aside>
      )}

      {/* Bottom Floating Recording Control Dock (Section 7: Large touch-friendly controls) */}
      <footer
        className={`fixed right-0 bottom-5 left-0 z-30 mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-3 px-4 transition-opacity duration-300 ${
          controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/15 bg-zinc-950/90 p-2.5 shadow-2xl backdrop-blur-xl">
          {/* Scroll Mode Selector */}
          <div className="flex items-center rounded-xl bg-zinc-900 p-1">
            <button
              type="button"
              onClick={() => setScrollMode('voice')}
              className={`flex min-h-[42px] items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
                scrollMode === 'voice'
                  ? 'bg-sky-500 text-white shadow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="音声追従モード"
            >
              <Mic className="h-4 w-4" />
              <span>音声追従</span>
            </button>
            <button
              type="button"
              onClick={() => setScrollMode('constant')}
              className={`flex min-h-[42px] items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
                scrollMode === 'constant'
                  ? 'bg-sky-500 text-white shadow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="一定速度スクロールモード"
            >
              <Gauge className="h-4 w-4" />
              <span>一定速度</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setScrollMode('manual');
                setIsPlaying(false);
              }}
              className={`flex min-h-[42px] items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
                scrollMode === 'manual'
                  ? 'bg-sky-500 text-white shadow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="手動スクロールモード"
            >
              <Hand className="h-4 w-4" />
              <span>手動</span>
            </button>
          </div>

          <div className="h-6 w-[1px] bg-zinc-800" />

          {/* Reset & Paragraph Navigation */}
          <button
            type="button"
            onClick={handleResetToTop}
            className="flex min-h-[44px] items-center gap-1 rounded-xl bg-zinc-900 px-3.5 py-2.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 active:scale-95"
            title="原稿先頭へ戻る (Home)"
          >
            <RotateCcw className="h-4 w-4" />
            <span className="hidden sm:inline">先頭へ</span>
          </button>

          <button
            type="button"
            onClick={() => handleJumpParagraph('prev')}
            className="flex min-h-[44px] items-center gap-1 rounded-xl bg-zinc-900 px-3.5 py-2.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 active:scale-95"
            title="前の段落へ移動"
          >
            <SkipBack className="h-4 w-4" />
            <span className="hidden sm:inline">前段落</span>
          </button>

          {/* Primary Play / Pause Button */}
          <button
            type="button"
            onClick={() => setIsPlaying((prev) => !prev)}
            className={`flex min-h-[44px] min-w-[144px] items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white shadow-lg transition active:scale-95 ${
              isPlaying
                ? 'bg-amber-500 text-black hover:bg-amber-400'
                : 'bg-sky-500 hover:bg-sky-400'
            }`}
          >
            {isPlaying ? (
              <>
                <Pause className="h-4 w-4 fill-current" />
                <span>一時停止</span>
              </>
            ) : (
              <>
                <Play className="h-4 w-4 fill-current" />
                <span>
                  {scrollMode === 'voice' ? '音声認識開始' : '再開 / 開始'}
                </span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleJumpParagraph('next')}
            className="flex min-h-[44px] items-center gap-1 rounded-xl bg-zinc-900 px-3.5 py-2.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 active:scale-95"
            title="次の段落へ移動"
          >
            <span className="hidden sm:inline">次段落</span>
            <SkipForward className="h-4 w-4" />
          </button>

          {/* Speed Slider when in Constant Speed Mode */}
          {scrollMode === 'constant' && (
            <>
              <div className="h-6 w-[1px] bg-zinc-800" />
              <div className="flex items-center gap-2 px-2">
                <span className="text-[11px] text-zinc-400">速度</span>
                <input
                  type="range"
                  min={15}
                  max={220}
                  step={5}
                  value={settings.constantScrollSpeed}
                  onChange={(e) =>
                    onUpdateSettings({
                      constantScrollSpeed: Number(e.target.value),
                    })
                  }
                  className="w-24 accent-sky-500"
                />
                <span className="w-12 font-mono text-xs text-sky-400">
                  {settings.constantScrollSpeed}px/s
                </span>
              </div>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}
