'use client';

import React, { useMemo, useRef, useState } from 'react';
import { ScriptItem, LanguageCode } from '@/types/prompter';
import {
  parseScriptToSegments,
  stripStageDirectionsAndFormatting,
} from '@/lib/scriptParser';
import { SegmentRichRenderer } from '@/components/SegmentRichRenderer';
import {
  Plus,
  Search,
  Copy,
  Trash2,
  Upload,
  Download,
  Play,
  FileText,
  Sliders,
  Check,
  Globe,
  Cloud,
  Activity,
  Sparkles,
  Hash,
  Highlighter,
  Eye,
  Edit3,
  Columns,
} from 'lucide-react';

interface ScriptEditorWorkspaceProps {
  scripts: ScriptItem[];
  activeScript: ScriptItem;
  onSelectScript: (id: string) => void;
  onCreateScript: () => void;
  onUpdateScript: (updated: ScriptItem) => void;
  onDuplicateScript: (script: ScriptItem) => void;
  onDeleteScript: (id: string) => void;
  onImportScriptFile: (title: string, content: string) => void;
  onStartTeleprompter: () => void;
  onOpenSettings: () => void;
  onOpenSync: () => void;
  onOpenAudioTest?: () => void;
}

export function ScriptEditorWorkspace({
  scripts,
  activeScript,
  onSelectScript,
  onCreateScript,
  onUpdateScript,
  onDuplicateScript,
  onDeleteScript,
  onImportScriptFile,
  onStartTeleprompter,
  onOpenSettings,
  onOpenSync,
  onOpenAudioTest,
}: ScriptEditorWorkspaceProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [saveIndicator, setSaveIndicator] = useState<'saved' | 'saving'>('saved');
  const [editorTab, setEditorTab] = useState<'edit' | 'preview' | 'split'>(
    () => {
      if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
        return 'split';
      }
      return 'edit';
    }
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const previewSegments = useMemo(
    () => parseScriptToSegments(activeScript.content),
    [activeScript.content]
  );

  // Insert or wrap text at current cursor selection in the editor textarea
  const handleInsertMarkup = (
    prefix: string,
    suffix: string = '',
    placeholder: string = ''
  ) => {
    const el = textareaRef.current;
    const current = activeScript.content;
    if (!el) {
      handleContentChange(`${current}\n${prefix}${placeholder}${suffix}`);
      return;
    }

    const start = el.selectionStart ?? current.length;
    const end = el.selectionEnd ?? current.length;
    const selected = current.slice(start, end);
    const inner = selected || placeholder;
    const nextContent =
      current.slice(0, start) +
      prefix +
      inner +
      suffix +
      current.slice(end);

    handleContentChange(nextContent);
    setTimeout(() => {
      el.focus();
      const nextCursor = start + prefix.length + inner.length + suffix.length;
      el.setSelectionRange(nextCursor, nextCursor);
    }, 0);
  };

  const filteredScripts = scripts.filter((item) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.title.toLowerCase().includes(q) ||
      item.content.toLowerCase().includes(q)
    );
  });

  const handleTitleChange = (title: string) => {
    setSaveIndicator('saving');
    onUpdateScript({
      ...activeScript,
      title,
      updatedAt: Date.now(),
    });
    setTimeout(() => setSaveIndicator('saved'), 400);
  };

  const handleContentChange = (content: string) => {
    setSaveIndicator('saving');
    onUpdateScript({
      ...activeScript,
      content,
      updatedAt: Date.now(),
    });
    setTimeout(() => setSaveIndicator('saved'), 400);
  };

  const handleLanguageChange = (language: LanguageCode) => {
    onUpdateScript({
      ...activeScript,
      language,
      updatedAt: Date.now(),
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const baseName = file.name.replace(/\.(txt|md)$/i, '');
      onImportScriptFile(baseName || '読み込み原稿', text);
    } finally {
      e.target.value = '';
    }
  };

  const handleExportTxt = () => {
    const blob = new Blob([activeScript.content], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeTitle =
      activeScript.title.trim().replace(/[\\/:*?"<>|]/g, '_') || 'script';
    a.download = `${safeTitle}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const spokenOnlyText = stripStageDirectionsAndFormatting(
    activeScript.content
  );
  const charCount = spokenOnlyText.replace(/\s+/g, '').length;
  // 日本語平均 320文字/分、英語平均 140ワード/分 で想定読み上げ時間を算出（ト書きは除外）
  const estimatedMinutes =
    activeScript.language === 'ja-JP'
      ? Math.max(0.5, Math.round((charCount / 320) * 10) / 10)
      : Math.max(
          0.5,
          Math.round(
            (spokenOnlyText.trim().split(/\s+/).filter(Boolean).length / 140) *
              10
          ) / 10
        );

  return (
    <div className="flex h-screen w-full flex-col bg-zinc-950 text-zinc-100 md:flex-row">
      {/* Left Sidebar: Script List & Management */}
      <aside className="flex w-full shrink-0 flex-col border-b border-zinc-800/80 bg-zinc-900/50 md:h-full md:w-80 md:border-r md:border-b-0">
        {/* Brand Header */}
        <div className="flex items-center justify-between border-b border-zinc-800/80 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400 ring-1 ring-sky-500/30">
              <FileText className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="text-sm font-bold tracking-tight text-white">
                  VoiceSync
                </h1>
                <span className="rounded-md border border-sky-500/40 bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-bold text-sky-300">
                  Vol.3
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">
                Studio Teleprompter
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onOpenSync}
              className="rounded-xl border border-zinc-800 bg-zinc-900 p-2 text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
              title="MacBook / iPad 原稿同期・バックアップ"
            >
              <Cloud className="h-4 w-4 text-sky-400" />
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              className="rounded-xl border border-zinc-800 bg-zinc-900 p-2 text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
              title="表示・スクロール設定"
            >
              <Sliders className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onCreateScript}
              className="flex items-center gap-1.5 rounded-xl bg-sky-500 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-sky-400"
            >
              <Plus className="h-4 w-4" />
              新規原稿
            </button>
          </div>
        </div>

        {/* Search & File Import */}
        <div className="space-y-2.5 border-b border-zinc-800/60 p-3.5">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="原稿タイトル・本文を検索..."
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950/90 py-2 pr-3 pl-9 text-xs text-zinc-100 placeholder-zinc-500 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,text/plain"
              onChange={handleFileUpload}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/90 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
            >
              <Upload className="h-3.5 w-3.5" />
              ファイル読込 (.txt)
            </button>
            <button
              type="button"
              onClick={handleExportTxt}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/90 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
            >
              <Download className="h-3.5 w-3.5" />
              書き出し (.txt)
            </button>
          </div>
        </div>

        {/* Script List */}
        <div className="max-h-52 flex-1 space-y-1.5 overflow-y-auto p-3 md:max-h-none">
          {filteredScripts.length === 0 ? (
            <div className="py-8 text-center text-xs text-zinc-500">
              一致する原稿がありません
            </div>
          ) : (
            filteredScripts.map((item) => {
              const isSelected = item.id === activeScript.id;
              return (
                <div
                  key={item.id}
                  onClick={() => onSelectScript(item.id)}
                  className={`group flex cursor-pointer items-start justify-between rounded-xl border p-3 transition ${
                    isSelected
                      ? 'border-sky-500/50 bg-sky-500/10 text-white'
                      : 'border-transparent bg-zinc-900/40 text-zinc-300 hover:border-zinc-800 hover:bg-zinc-900'
                  }`}
                >
                  <div className="min-w-0 flex-1 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-semibold">
                        {item.title || '無題の原稿'}
                      </span>
                      <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                        {item.language === 'ja-JP' ? 'JA' : 'EN'}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] text-zinc-500">
                      {item.content || '本文なし'}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1 opacity-80 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDuplicateScript(item);
                      }}
                      className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
                      title="原稿を複製"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    {scripts.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteScript(item.id);
                        }}
                        className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-red-500/20 hover:text-red-400"
                        title="原稿を削除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Main Content: Script Editor & Launch Bar */}
      <main className="flex min-h-0 flex-1 flex-col bg-zinc-950">
        {/* Top Action Bar */}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 px-6 py-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <input
              type="text"
              value={activeScript.title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="原稿タイトルを入力..."
              className="w-full max-w-2xl rounded-xl border border-transparent bg-transparent px-2 py-1 text-lg font-bold text-white transition focus:border-zinc-700 focus:bg-zinc-900 focus:outline-none"
            />
            <span className="hidden items-center gap-1 text-xs text-zinc-400 sm:inline-flex">
              <Check className="h-3.5 w-3.5 text-emerald-400" />
              {saveIndicator === 'saving' ? '自動保存中...' : 'IndexedDB保存済'}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Language Selector */}
            <div className="flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs">
              <Globe className="h-3.5 w-3.5 text-sky-400" />
              <select
                value={activeScript.language}
                onChange={(e) =>
                  handleLanguageChange(e.target.value as LanguageCode)
                }
                aria-label="原稿の言語"
                className="bg-transparent font-medium text-zinc-200 focus:outline-none"
              >
                <option value="ja-JP" className="bg-zinc-900">
                  日本語 (ja-JP)
                </option>
                <option value="en-US" className="bg-zinc-900">
                  English (en-US)
                </option>
              </select>
            </div>

            {onOpenAudioTest && (
              <button
                type="button"
                onClick={onOpenAudioTest}
                className="flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3.5 py-2.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/25"
                title="撮影前の10秒録音品質・環境ノイズ・音声認識テスト"
              >
                <Activity className="h-4 w-4" />
                <span>録音テスト</span>
              </button>
            )}

            <button
              type="button"
              onClick={onStartTeleprompter}
              className="flex items-center gap-2 rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition hover:bg-sky-400 active:scale-[0.99]"
            >
              <Play className="h-4 w-4 fill-current" />
              撮影モードを開始
            </button>
          </div>
        </header>

        {/* Textarea Editor */}
        <div className="flex flex-1 flex-col overflow-hidden p-4 md:p-6">
          <div className="mx-auto flex h-full w-full max-w-[1720px] flex-col rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-5 shadow-inner">
            {/* Vol.3: Quick Insert Toolbar for Chapters, Highlights & Non-spoken Stage Directions */}
            <div className="mb-3 flex flex-wrap items-center gap-1.5 border-b border-zinc-800/80 pb-3 text-[11px]">
              <span className="mr-1 flex items-center gap-1 font-semibold text-zinc-400">
                <Sparkles className="h-3.5 w-3.5 text-sky-400" />
                <span>挿入ツール:</span>
              </span>

              <button
                type="button"
                onClick={() => handleInsertMarkup('\n# ', '\n', '第1章：見出し')}
                className="flex items-center gap-1 rounded-lg border border-sky-500/40 bg-sky-500/15 px-2.5 py-1 font-semibold text-sky-300 transition hover:bg-sky-500/25"
                title="チャプター見出しを挿入（撮影画面のチャプター目次からワンクリックでジャンプできます）"
              >
                <Hash className="h-3 w-3" />
                <span>章見出し (#)</span>
              </button>

              <div className="mx-0.5 h-4 w-[1px] bg-zinc-800" />

              <button
                type="button"
                onClick={() => handleInsertMarkup('**', '**', '強調キーワード')}
                className="flex items-center gap-1 rounded-lg border border-amber-400/40 bg-amber-400/15 px-2.5 py-1 font-bold text-amber-200 transition hover:bg-amber-400/25"
                title="選択した文字（または新規文字）を黄色太字でハイライト表示します"
              >
                <Highlighter className="h-3 w-3" />
                <span>**黄色強調**</span>
              </button>

              <button
                type="button"
                onClick={() => handleInsertMarkup('==', '==', '注目フレーズ')}
                className="rounded-lg border border-cyan-400/40 bg-cyan-400/15 px-2.5 py-1 font-bold text-cyan-200 transition hover:bg-cyan-400/25"
                title="選択した文字を水色ハイライトで表示します"
              >
                ==水色強調==
              </button>

              <button
                type="button"
                onClick={() => handleInsertMarkup('!!', '!!', '重要ポイント')}
                className="rounded-lg border border-rose-400/40 bg-rose-400/15 px-2.5 py-1 font-bold text-rose-200 transition hover:bg-rose-400/25"
                title="選択した文字を赤色ハイライトで強調表示します"
              >
                !!赤強調!!
              </button>

              <div className="mx-0.5 h-4 w-[1px] bg-zinc-800" />

              <span className="text-[10px] text-zinc-400">
                ト書き（音声照合スキップ）:
              </span>
              {[
                { label: '😊 笑顔で', snippet: '[笑顔で]' },
                { label: '⏸ 1秒ポーズ', snippet: '[1秒ポーズ]' },
                { label: '👀 カメラ目線', snippet: '[カメラ目線]' },
                { label: '🖥 画面切替', snippet: '[画面共有へ切替]' },
                { label: '💬 テロップ', snippet: '[テロップ表示]' },
              ].map((cue) => (
                <button
                  key={cue.label}
                  type="button"
                  onClick={() => handleInsertMarkup(cue.snippet, '', '')}
                  className="rounded-lg border border-violet-500/40 bg-violet-500/15 px-2 py-1 font-medium text-violet-200 transition hover:bg-violet-500/25"
                  title="[...] で囲まれたト書きは撮影画面で演出バッジとして表示され、声に出して読まなくても自動でスキップされます"
                >
                  {cue.label}
                </button>
              ))}
              <div className="ml-auto flex items-center rounded-xl border border-zinc-800 bg-zinc-950/80 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setEditorTab('edit')}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition ${
                    editorTab === 'edit'
                      ? 'bg-zinc-800 text-white shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                  title="原稿編集テキストエリア"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  <span>入力</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEditorTab('preview')}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition ${
                    editorTab === 'preview'
                      ? 'border border-sky-500/40 bg-sky-500/20 text-sky-300 shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                  title="装飾ハイライト・ト書きバッジのプレビュー表示"
                >
                  <Eye className="h-3.5 w-3.5" />
                  <span>装飾プレビュー</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEditorTab('split')}
                  className={`hidden md:flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition ${
                    editorTab === 'split'
                      ? 'bg-zinc-800 text-white shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                  title="入力とプレビューの2画面同時表示"
                >
                  <Columns className="h-3.5 w-3.5" />
                  <span>2画面分割</span>
                </button>
              </div>
            </div>

            {/* Editor & Preview Display Body */}
            {editorTab === 'edit' && (
              <textarea
                ref={textareaRef}
                value={activeScript.content}
                onChange={(e) => handleContentChange(e.target.value)}
                placeholder="ここにYouTube撮影用の原稿を入力またはペーストしてください。句点（。）や改行ごとに自動でフレーズ分割され、撮影モードでスムーズに追従・表示されます。"
                className="w-full flex-1 resize-none bg-transparent p-3 text-base md:text-lg leading-relaxed text-zinc-100 placeholder-zinc-600 focus:outline-none"
              />
            )}

            {editorTab === 'preview' && (
              <div className="flex-1 overflow-y-auto rounded-xl border border-zinc-800/80 bg-zinc-950/70 p-6">
                <div className="mb-4 flex items-center justify-between border-b border-zinc-800/60 pb-2 text-xs">
                  <span className="font-semibold text-zinc-300">
                    撮影画面プレビュー（装飾反映）
                  </span>
                  <span className="text-[11px] text-zinc-500">
                    ※ 本番撮影時と同じハイライト・演出バッジ表示
                  </span>
                </div>
                <div className="space-y-4 text-base md:text-lg leading-relaxed text-zinc-100">
                  {previewSegments.length === 0 ? (
                    <p className="text-sm italic text-zinc-500">
                      原稿を入力すると、ここに装飾プレビューが表示されます。
                    </p>
                  ) : (
                    previewSegments.map((seg, sIdx) => {
                      const isNewParagraph =
                        sIdx > 0 &&
                        previewSegments[sIdx - 1].paragraphIndex !==
                          seg.paragraphIndex;
                      return (
                        <div
                          key={seg.id}
                          className={`rounded-xl px-2 py-1 transition ${
                            isNewParagraph ? 'mt-6' : ''
                          }`}
                        >
                          <SegmentRichRenderer
                            text={seg.text}
                            isCurrent={false}
                            enableFormatting={true}
                            enableCharProgress={false}
                            progressRatio={0}
                          />
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {editorTab === 'split' && (
              <div className="flex flex-1 gap-6 overflow-hidden">
                <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-4">
                  <div className="mb-2 flex items-center justify-between border-b border-zinc-800/50 pb-1.5 text-xs text-zinc-400">
                    <span className="font-semibold text-zinc-300">
                      Markdown入力
                    </span>
                    <span className="text-[11px] text-zinc-500">
                      原稿テキスト
                    </span>
                  </div>
                  <textarea
                    ref={textareaRef}
                    value={activeScript.content}
                    onChange={(e) => handleContentChange(e.target.value)}
                    placeholder="ここに原稿を入力..."
                    className="w-full flex-1 resize-none bg-transparent p-2 text-base md:text-lg leading-relaxed text-zinc-100 placeholder-zinc-600 focus:outline-none"
                  />
                </div>
                <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/70 p-4">
                  <div className="mb-2 flex items-center justify-between border-b border-zinc-800/50 pb-1.5 text-xs">
                    <span className="font-semibold text-sky-400">
                      リアルタイム装飾プレビュー
                    </span>
                    <span className="text-[11px] text-zinc-500">
                      ※ 撮影時と同じハイライト・演出表示
                    </span>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-4 p-2 text-base md:text-lg leading-relaxed text-zinc-100">
                    {previewSegments.length === 0 ? (
                      <p className="text-sm italic text-zinc-500">
                        原稿を入力すると、ここに装飾プレビューが表示されます。
                      </p>
                    ) : (
                      previewSegments.map((seg, sIdx) => {
                        const isNewParagraph =
                          sIdx > 0 &&
                          previewSegments[sIdx - 1].paragraphIndex !==
                            seg.paragraphIndex;
                        return (
                          <div
                            key={seg.id}
                            className={`rounded-lg px-2 py-1 ${
                              isNewParagraph ? 'mt-5' : ''
                            }`}
                          >
                            <SegmentRichRenderer
                              text={seg.text}
                              isCurrent={false}
                              enableFormatting={true}
                              enableCharProgress={false}
                              progressRatio={0}
                            />
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/80 pt-3 text-xs text-zinc-400">
              <div className="flex items-center gap-4">
                <span>発話文字数: {charCount} 文字</span>
                <span>想定読み上げ時間: 約 {estimatedMinutes} 分</span>
              </div>
              <span className="text-zinc-500">
                ※ `# 見出し` は目次化、`[ト書き]` は音声照合から自動除外されます
              </span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
