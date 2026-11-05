'use client';

import React, { useMemo } from 'react';
import { parseSegmentInlineTokens } from '@/lib/scriptParser';
import { SegmentInlineToken } from '@/types/prompter';

interface SegmentRichRendererProps {
  text: string;
  isCurrent: boolean;
  enableFormatting: boolean;
  enableCharProgress: boolean;
  progressRatio: number; // 0.0 to 1.0 for the currently active segment
}

/**
 * Vol.3 (Steps 1 & 3):
 * - `[笑顔で]` / `【1秒ポーズ】` 等のト書きを視覚的な演出バッジとして表示
 * - `**黄色強調**` / `==水色強調==` / `!!赤強調!!` のインラインハイライト表示
 * - `# 見出し` のチャプターラベル表示
 * - 現在読んでいるフレーズ内の「読んだ文字までのリアルタイム色変化（カラオケ風進捗ガイド）」表示
 */
export function SegmentRichRenderer({
  text,
  isCurrent,
  enableFormatting,
  enableCharProgress,
  progressRatio,
}: SegmentRichRendererProps) {
  const parsed = useMemo(() => parseSegmentInlineTokens(text), [text]);

  const clampedRatio = isCurrent
    ? Math.max(0, Math.min(1, progressRatio))
    : 0;
  const completedSpokenChars =
    isCurrent && enableCharProgress && parsed.totalSpokenChars > 0
      ? Math.round(parsed.totalSpokenChars * clampedRatio)
      : 0;

  if (!enableFormatting) {
    if (isCurrent && enableCharProgress && completedSpokenChars > 0) {
      const doneSlice = text.slice(0, completedSpokenChars);
      const restSlice = text.slice(completedSpokenChars);
      return (
        <span className="relative inline">
          <span className="text-sky-300 underline decoration-sky-400/70 decoration-2 underline-offset-8 transition-colors duration-75">
            {doneSlice}
          </span>
          <span>{restSlice}</span>
        </span>
      );
    }
    return <>{text}</>;
  }

  const renderSpokenTextWithProgress = (
    token: SegmentInlineToken,
    isHighlight = false
  ) => {
    if (
      !isCurrent ||
      !enableCharProgress ||
      completedSpokenChars <= token.spokenStartChar
    ) {
      return token.content;
    }

    const completedStyle = isHighlight
      ? 'underline decoration-current decoration-2 underline-offset-4 font-black'
      : 'text-sky-300 underline decoration-sky-400/80 decoration-2 underline-offset-8 transition-colors duration-75';

    if (completedSpokenChars >= token.spokenEndChar) {
      return <span className={completedStyle}>{token.content}</span>;
    }

    const splitOffset = completedSpokenChars - token.spokenStartChar;
    const readPart = token.content.slice(0, splitOffset);
    const unreadPart = token.content.slice(splitOffset);

    return (
      <>
        <span className={completedStyle}>{readPart}</span>
        <span>{unreadPart}</span>
      </>
    );
  };

  return (
    <span className="inline">
      {parsed.tokens.map((token, idx) => {
        if (token.type === 'heading') {
          return (
            <span
              key={idx}
              className="inline-flex items-center gap-2 rounded-xl border border-sky-400/40 bg-sky-500/15 px-3.5 py-1 text-[0.78em] font-bold tracking-tight text-sky-300"
            >
              <span className="rounded bg-sky-400/25 px-1.5 py-0.5 font-mono text-[0.7em] text-sky-200">
                CHAPTER
              </span>
              <span>{token.content}</span>
            </span>
          );
        }

        if (token.type === 'cue') {
          const isPauseCue =
            /ポーズ|間|秒|呼吸|休|待|pause|breath|wait/i.test(token.content);
          return (
            <span
              key={idx}
              className={`mx-1.5 inline-flex items-center gap-1 rounded-lg border px-2.5 py-0.5 align-middle text-[0.62em] font-bold tracking-normal shadow-sm ${
                isPauseCue
                  ? 'border-amber-400/50 bg-amber-500/20 text-amber-200'
                  : 'border-violet-400/50 bg-violet-500/20 text-violet-200'
              }`}
              title="演出ディレクション（ト書き）：声に出して読まなくても自動でスキップされます"
            >
              <span>{isPauseCue ? '⏸' : '🎬'}</span>
              <span>{token.content}</span>
            </span>
          );
        }

        if (token.type === 'highlight-yellow') {
          return (
            <mark
              key={idx}
              className="mx-0.5 inline-block rounded-md bg-amber-300 px-2 py-0.5 font-bold text-zinc-950 shadow-sm ring-1 ring-amber-400/60"
            >
              {renderSpokenTextWithProgress(token, true)}
            </mark>
          );
        }

        if (token.type === 'highlight-sky') {
          return (
            <mark
              key={idx}
              className="mx-0.5 inline-block rounded-md bg-cyan-300 px-2 py-0.5 font-bold text-zinc-950 shadow-sm ring-1 ring-cyan-400/60"
            >
              {renderSpokenTextWithProgress(token, true)}
            </mark>
          );
        }

        if (token.type === 'highlight-rose') {
          return (
            <mark
              key={idx}
              className="mx-0.5 inline-block rounded-md bg-rose-500 px-2 py-0.5 font-bold text-white shadow-sm ring-1 ring-rose-400/60"
            >
              {renderSpokenTextWithProgress(token, true)}
            </mark>
          );
        }

        return <span key={idx}>{renderSpokenTextWithProgress(token)}</span>;
      })}
    </span>
  );
}
