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
    badgeClass: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    dotClass: 'bg-amber-400 animate-pulse',
  },
  listening: {
    label: '音声認識中',
    badgeClass: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
    dotClass: 'bg-sky-400 animate-pulse',
  },
  speaking: {
    label: '発話検出中',
    badgeClass: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    dotClass: 'bg-emerald-400 animate-ping',
  },
  matching: {
    label: '原稿照合中',
    badgeClass: 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300',
    dotClass: 'bg-indigo-400 animate-pulse',
  },
  paused: {
    label: '一時停止中',
    badgeClass: 'border-zinc-700 bg-zinc-900/90 text-zinc-400',
    dotClass: 'bg-zinc-500',
  },
  error: {
    label: 'エラー',
    badgeClass: 'border-red-500/40 bg-red-500/10 text-red-300',
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

  const [scrollMode, setScrollMode] = useState<ScrollMode>('constant');
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number>(0);
  const [speechStatus, setSpeechStatus] = useState<SpeechStatus>('idle');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [controlsVisible, setControlsVisible] = useState<boolean>(true);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const segmentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);
  const hideControlsTimerRef = useRef<NodeJS.Timeout | null>(null);
  const programmaticScrollRef = useRef<boolean>(false);

  // Sync speechStatus badge with current play state in Phase 1
  useEffect(() => {
    if (!isPlaying) {
      setSpeechStatus((prev) => (prev === 'idle' ? 'idle' : 'paused'));
    } else if (scrollMode === 'voice') {
      setSpeechStatus('listening');
    } else {
      setSpeechStatus('idle');
    }
  }, [isPlaying, scrollMode]);

  // Auto-hide controls during active playback for distraction-free recording
  const resetControlsIdleTimer = useCallback(() => {
    setControlsVisible(true);
    if (hideControlsTimerRef.current) {
      clearTimeout(hideControlsTimerRef.current);
    }
    if (isPlaying) {
      hideControlsTimerRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 3200);
    }
  }, [isPlaying]);

  useEffect(() => {
    resetControlsIdleTimer();
    return () => {
      if (hideControlsTimerRef.current) {
        clearTimeout(hideControlsTimerRef.current);
      }
    };
  }, [isPlaying, resetControlsIdleTimer]);

  // Scroll a specific segment smoothly to the reading guide line
  const scrollToSegment = useCallback(
    (index: number, behavior: ScrollBehavior = 'smooth') => {
      const container = scrollContainerRef.current;
      const targetEl = segmentRefs.current[index];
      if (!container || !targetEl) return;

      const containerHeight = container.clientHeight;
      const readingAnchorPx =
        (settings.readingLinePositionVh / 100) * containerHeight;

      const targetOffsetTop = targetEl.offsetTop;
      const targetHeight = targetEl.offsetHeight;
      const desiredScrollTop = Math.max(
        0,
        targetOffsetTop - readingAnchorPx + targetHeight * 0.35
      );

      programmaticScrollRef.current = true;
      container.scrollTo({
        top: desiredScrollTop,
        behavior,
      });

      setTimeout(() => {
        programmaticScrollRef.current = false;
      }, settings.scrollAnimationMs + 60);
    },
    [settings.readingLinePositionVh, settings.scrollAnimationMs]
  );

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
    setActiveSegmentIndex(0);
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

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
        setActiveSegmentIndex(targetIdx);
        scrollToSegment(targetIdx, 'smooth');
      } else {
        // Find start of previous paragraph
        let targetParagraph = Math.max(0, currentParagraph - 1);
        const firstInCurrent = segments.find(
          (s) => s.paragraphIndex === currentParagraph
        );
        if (
          firstInCurrent &&
          activeSegmentIndex > firstInCurrent.index
        ) {
          targetParagraph = currentParagraph;
        }
        const prevSeg = segments.find(
          (s) => s.paragraphIndex === targetParagraph
        );
        const targetIdx = prevSeg
          ? prevSeg.index
          : Math.max(0, activeSegmentIndex - 1);
        setActiveSegmentIndex(targetIdx);
        scrollToSegment(targetIdx, 'smooth');
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
      // Ignore if modal dialog is open
      if (document.querySelector('dialog[open]')) return;

      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying((prev) => !prev);
      } else if (e.code === 'ArrowDown' || e.code === 'ArrowRight') {
        e.preventDefault();
        const nextIdx = Math.min(segments.length - 1, activeSegmentIndex + 1);
        setActiveSegmentIndex(nextIdx);
        scrollToSegment(nextIdx, 'smooth');
      } else if (e.code === 'ArrowUp' || e.code === 'ArrowLeft') {
        e.preventDefault();
        const prevIdx = Math.max(0, activeSegmentIndex - 1);
        setActiveSegmentIndex(prevIdx);
        scrollToSegment(prevIdx, 'smooth');
      } else if (e.code === 'Home') {
        e.preventDefault();
        handleResetToTop();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSegmentIndex, handleResetToTop, scrollToSegment, segments.length]);

  const statusMeta = STATUS_LABELS[speechStatus];

  // Mirror transform style
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
        className={`fixed top-0 right-0 left-0 z-30 flex items-center justify-between border-b border-white/10 bg-black/65 px-5 py-3 backdrop-blur-md transition-opacity duration-300 ${
          controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onExitStage}
            className="flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/90 px-3.5 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-800 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            編集へ戻る
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

        {/* Center Status Indicator Badge (Section 8) */}
        <div className="flex items-center gap-2">
          <div
            className={`flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium shadow-sm ${statusMeta.badgeClass}`}
          >
            <span className={`h-2 w-2 rounded-full ${statusMeta.dotClass}`} />
            <span>状態: {statusMeta.label}</span>
          </div>
        </div>

        {/* Right Quick Toggles */}
        <div className="flex items-center gap-2">
          {/* Font Size Quick Stepper */}
          <div className="hidden items-center rounded-xl border border-zinc-800 bg-zinc-900/90 p-1 md:flex">
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
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition ${
              settings.cameraEyelineMode
                ? 'border-sky-500/60 bg-sky-500/20 text-sky-300'
                : 'border-zinc-800 bg-zinc-900/90 text-zinc-400 hover:text-zinc-200'
            }`}
            title="カメラ目線モード切替"
          >
            <Camera className="h-4 w-4" />
            <span className="hidden lg:inline">カメラ目線</span>
          </button>

          <button
            type="button"
            onClick={() =>
              onUpdateSettings({ focusMode: !settings.focusMode })
            }
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition ${
              settings.focusMode
                ? 'border-sky-500/60 bg-sky-500/20 text-sky-300'
                : 'border-zinc-800 bg-zinc-900/90 text-zinc-400 hover:text-zinc-200'
            }`}
            title="フォーカスモード切替"
          >
            <Eye className="h-4 w-4" />
            <span className="hidden lg:inline">フォーカス</span>
          </button>

          <button
            type="button"
            onClick={handleToggleFullscreen}
            className="rounded-xl border border-zinc-800 bg-zinc-900/90 p-2 text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
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
            className="rounded-xl border border-zinc-800 bg-zinc-900/90 p-2 text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
            title="設定画面を開く"
          >
            <Sliders className="h-4 w-4" />
          </button>
        </div>
      </header>

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
            ? ' rounded-b-3xl border-b border-white/10 shadow-2xl'
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
            paddingBottom: `${Math.max(45, settings.marginVerticalVh)}vh`,
            paddingLeft: `${settings.marginHorizontalPx}px`,
            paddingRight: `${settings.marginHorizontalPx}px`,
          }}
          className="h-full w-full overflow-y-auto scroll-smooth"
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
                    setActiveSegmentIndex(idx);
                    scrollToSegment(idx, 'smooth');
                  }}
                  style={{ opacity }}
                  className={`cursor-pointer rounded-2xl px-4 py-2 transition-all duration-200 ${
                    isNewParagraph ? 'mt-10' : ''
                  } ${
                    isCurrent
                      ? 'scale-[1.01] bg-white/[0.04] ring-1 ring-white/10'
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

      {/* Bottom Floating Recording Control Dock (Section 7) */}
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
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
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
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
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
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
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
            className="flex items-center gap-1 rounded-xl bg-zinc-900 px-3 py-2.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800"
            title="原稿先頭へ戻る (Home)"
          >
            <RotateCcw className="h-4 w-4" />
            <span className="hidden sm:inline">先頭へ</span>
          </button>

          <button
            type="button"
            onClick={() => handleJumpParagraph('prev')}
            className="flex items-center gap-1 rounded-xl bg-zinc-900 px-3 py-2.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800"
            title="前の段落へ移動"
          >
            <SkipBack className="h-4 w-4" />
            <span className="hidden sm:inline">前段落</span>
          </button>

          {/* Primary Play / Pause Button */}
          <button
            type="button"
            onClick={() => setIsPlaying((prev) => !prev)}
            className={`flex min-w-[130px] items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white shadow-lg transition active:scale-95 ${
              isPlaying
                ? 'bg-amber-500 text-black hover:bg-amber-400'
                : 'bg-sky-500 hover:bg-sky-400'
            }`}
          >
            {isPlaying ? (
              <>
                <Pause className="h-4 w-4 fill-current" />
                一時停止
              </>
            ) : (
              <>
                <Play className="h-4 w-4 fill-current" />
                {scrollMode === 'voice' ? '音声認識開始' : 'スクロール開始'}
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleJumpParagraph('next')}
            className="flex items-center gap-1 rounded-xl bg-zinc-900 px-3 py-2.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800"
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
