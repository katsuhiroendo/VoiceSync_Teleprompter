'use client';

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { PrompterSettings, ScriptSegment } from '@/types/prompter';
import { SegmentRichRenderer } from '@/components/SegmentRichRenderer';
import {
  Play,
  Pause,
  Flag,
  RotateCcw,
  SkipBack,
  SkipForward,
  Minus,
  Plus,
  X,
} from 'lucide-react';

interface FloatingPrompterPortalProps {
  containerEl: HTMLElement | null;
  segments: ScriptSegment[];
  activeSegmentIndex: number;
  activeProgressRatio: number;
  isPlaying: boolean;
  isRecording: boolean;
  recordingTimerText: string;
  remainingTimeText: string;
  progressPercent: number;
  ngCount: number;
  settings: PrompterSettings;
  onTogglePlay: () => void;
  onRecordNG: () => void;
  onRetakeCurrent: () => void;
  onRetakePrev: () => void;
  onAdvanceNext: () => void;
  onSelectSegment: (index: number) => void;
  onChangeFontSize: (delta: number) => void;
  onClosePip: () => void;
}

/**
 * Vol.3 (Step 4):
 * Document Picture-in-Picture API (またはポップアップウィンドウ) 内に描画される
 * 「他アプリの最前面に常時浮くフローティング・ミニプロンプター」。
 * Keynote / Googleスライド / Canva / ブラウザ操作解説などをしながらカメラ直下で台本を読める。
 */
export function FloatingPrompterPortal({
  containerEl,
  segments,
  activeSegmentIndex,
  activeProgressRatio,
  isPlaying,
  isRecording,
  recordingTimerText,
  remainingTimeText,
  progressPercent,
  ngCount,
  settings,
  onTogglePlay,
  onRecordNG,
  onRetakeCurrent,
  onRetakePrev,
  onAdvanceNext,
  onSelectSegment,
  onChangeFontSize,
  onClosePip,
}: FloatingPrompterPortalProps) {
  const activeItemRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (activeItemRef.current) {
      activeItemRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [activeSegmentIndex]);

  if (!containerEl) return null;

  const pipFontSize = Math.max(18, Math.min(44, Math.round(settings.fontSize * 0.68)));

  return createPortal(
    <div
      style={{
        backgroundColor: settings.backgroundColor || '#050507',
        color: settings.textColor || '#F8FAFC',
      }}
      className="flex h-screen w-screen flex-col overflow-hidden select-none font-sans"
    >
      {/* Compact Top Control & Status Bar */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/15 bg-zinc-950/95 px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
              isPlaying
                ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40'
                : 'bg-zinc-800 text-zinc-300'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                isPlaying ? 'animate-pulse bg-emerald-400' : 'bg-zinc-400'
              }`}
            />
            {isPlaying ? '音声追従中' : '一時停止'}
          </span>

          {isRecording && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/20 px-2.5 py-0.5 font-mono text-[11px] font-bold text-rose-300 ring-1 ring-rose-500/50">
              <span className="h-2 w-2 animate-ping rounded-full bg-rose-500" />
              REC {recordingTimerText}
            </span>
          )}

          <span className="font-mono text-[11px] text-zinc-400">
            #{activeSegmentIndex + 1}/{Math.max(1, segments.length)} ({progressPercent}% ・ {remainingTimeText})
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onTogglePlay}
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
              isPlaying
                ? 'bg-amber-500 text-black hover:bg-amber-400'
                : 'bg-sky-500 text-white hover:bg-sky-400'
            }`}
            title="開始 / 一時停止 (Space)"
          >
            {isPlaying ? (
              <>
                <Pause className="h-3 w-3 fill-current" />
                <span>停止</span>
              </>
            ) : (
              <>
                <Play className="h-3 w-3 fill-current" />
                <span>開始</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onRecordNG}
            className="flex items-center gap-1 rounded-lg border border-amber-500/50 bg-amber-500/15 px-2 py-1 text-[11px] font-bold text-amber-200 hover:bg-amber-500/25"
            title="NGマーカーを記録 (M)"
          >
            <Flag className="h-3 w-3 text-amber-400" />
            <span>NG{ngCount > 0 ? ` (${ngCount})` : ''}</span>
          </button>

          <button
            type="button"
            onClick={onRetakeCurrent}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800"
            title="現在フレーズの先頭から再開 (1 / R)"
          >
            <RotateCcw className="inline h-3 w-3" /> 文頭
          </button>

          <button
            type="button"
            onClick={onRetakePrev}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800"
            title="1フレーズ戻る (2 / ↑)"
          >
            <SkipBack className="inline h-3 w-3" /> 1文戻
          </button>

          <button
            type="button"
            onClick={onAdvanceNext}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800"
            title="1フレーズ進む (↓)"
          >
            <SkipForward className="inline h-3 w-3" />
          </button>

          <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900 px-1 py-0.5">
            <button
              type="button"
              onClick={() => onChangeFontSize(-4)}
              className="p-0.5 text-zinc-400 hover:text-white"
              title="文字を小さく"
            >
              <Minus className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => onChangeFontSize(4)}
              className="p-0.5 text-zinc-400 hover:text-white"
              title="文字を大きく"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>

          <button
            type="button"
            onClick={onClosePip}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
            title="フローティング小窓を閉じる"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* Scrollable Floating Script Area */}
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-6">
        {segments.map((seg, idx) => {
          const isCurrent = idx === activeSegmentIndex;
          const ahead = idx - activeSegmentIndex;
          const isLookahead = ahead >= 1 && ahead <= Math.max(1, settings.lookaheadCount);
          const opacity = isCurrent
            ? 1
            : isLookahead
              ? Math.max(0.55, settings.lookaheadOpacity - (ahead - 1) * 0.08)
              : 0.22;

          return (
            <div
              key={seg.id}
              ref={isCurrent ? activeItemRef : undefined}
              onClick={() => onSelectSegment(idx)}
              style={{
                opacity,
                fontSize: `${pipFontSize}px`,
                lineHeight: settings.lineHeight,
              }}
              className={`relative cursor-pointer rounded-xl px-3.5 py-2 font-medium transition-opacity duration-150 ${
                isCurrent
                  ? 'bg-white/[0.06] ring-1 ring-sky-400/40'
                  : isLookahead
                    ? 'bg-white/[0.02]'
                    : ''
              }`}
            >
              <SegmentRichRenderer
                text={seg.text}
                isCurrent={isCurrent}
                enableFormatting={settings.enableStageDirectionsAndHighlights}
                enableCharProgress={settings.charLevelProgressHighlight}
                progressRatio={isCurrent ? activeProgressRatio : 0}
              />

              {isCurrent &&
                settings.charLevelProgressHighlight &&
                activeProgressRatio > 0 && (
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      style={{
                        width: `${Math.min(100, Math.round(activeProgressRatio * 100))}%`,
                      }}
                      className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-400 transition-all duration-100"
                    />
                  </div>
                )}
            </div>
          );
        })}
      </div>
    </div>,
    containerEl
  );
}
