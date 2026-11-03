'use client';

import React, { useRef, useState } from 'react';
import { ScriptItem, LanguageCode } from '@/types/prompter';
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
}: ScriptEditorWorkspaceProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [saveIndicator, setSaveIndicator] = useState<'saved' | 'saving'>('saved');
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const charCount = activeScript.content.replace(/\s+/g, '').length;
  // 日本語平均 320文字/分、英語平均 140ワード/分 で想定読み上げ時間を算出
  const estimatedMinutes =
    activeScript.language === 'ja-JP'
      ? Math.max(0.5, Math.round((charCount / 320) * 10) / 10)
      : Math.max(
          0.5,
          Math.round(
            (activeScript.content.trim().split(/\s+/).filter(Boolean).length /
              140) *
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
              <h1 className="text-sm font-bold tracking-tight text-white">
                VoiceSync
              </h1>
              <p className="text-[11px] text-zinc-400">
                Studio Teleprompter
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
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
              className="w-full max-w-lg rounded-xl border border-transparent bg-transparent px-2 py-1 text-lg font-bold text-white transition focus:border-zinc-700 focus:bg-zinc-900 focus:outline-none"
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
        <div className="flex flex-1 flex-col overflow-hidden p-6">
          <div className="mx-auto flex h-full w-full max-w-4xl flex-col rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-5 shadow-inner">
            <textarea
              value={activeScript.content}
              onChange={(e) => handleContentChange(e.target.value)}
              placeholder="ここにYouTube撮影用の原稿を入力またはペーストしてください。句点（。）や改行ごとに自動でフレーズ分割され、撮影モードでスムーズに追従・表示されます。"
              className="w-full flex-1 resize-none bg-transparent text-base leading-relaxed text-zinc-100 placeholder-zinc-600 focus:outline-none"
            />

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/80 pt-3 text-xs text-zinc-400">
              <div className="flex items-center gap-4">
                <span>文字数: {charCount} 文字</span>
                <span>想定読み上げ時間: 約 {estimatedMinutes} 分</span>
              </div>
              <span className="text-zinc-500">
                ※ 撮影モード中は誤編集防止のためロックされます
              </span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
