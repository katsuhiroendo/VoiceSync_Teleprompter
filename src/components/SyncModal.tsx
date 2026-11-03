'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ScriptItem } from '@/types/prompter';
import {
  CloudSyncProviderConfig,
  loadCloudSyncConfig,
  saveCloudSyncConfig,
  syncScriptsWithEndpoint,
  mergeScriptsWithConflictProtection,
} from '@/lib/syncService';
import {
  X,
  Cloud,
  Download,
  Upload,
  RefreshCw,
  CheckCircle2,
  ShieldCheck,
} from 'lucide-react';

interface SyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  scripts: ScriptItem[];
  onApplyMergedScripts: (merged: ScriptItem[]) => Promise<void>;
}

export function SyncModal({
  isOpen,
  onClose,
  scripts,
  onApplyMergedScripts,
}: SyncModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const bundleInputRef = useRef<HTMLInputElement>(null);

  const [endpointUrl, setEndpointUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [deviceId, setDeviceId] = useState('MacBook-Studio');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  useEffect(() => {
    const saved = loadCloudSyncConfig();
    if (saved) {
      setEndpointUrl(saved.endpointUrl);
      setApiKey(saved.apiKey);
      setDeviceId(saved.deviceId || 'MacBook-Studio');
    }
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  // Fallback for browsers without native closedby="any" support (e.g. Safari)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => onClose();
    dialog.addEventListener('close', handleClose);

    if (!('closedBy' in HTMLDialogElement.prototype)) {
      const handleClick = (event: MouseEvent) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const isDialogContent =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;
        if (isDialogContent) return;
        dialog.close();
      };
      dialog.addEventListener('click', handleClick);
      return () => {
        dialog.removeEventListener('close', handleClose);
        dialog.removeEventListener('click', handleClick);
      };
    }

    return () => {
      dialog.removeEventListener('close', handleClose);
    };
  }, [onClose]);

  const handleExportSyncBundle = () => {
    const payload = {
      exportedAt: Date.now(),
      deviceId,
      scripts,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `voicesync-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatusMessage(
      '全原稿の同期バンドル (.json) を書き出しました。AirDropやiCloud Drive経由でiPadへ共有できます。'
    );
  };

  const handleImportSyncBundle = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const remoteScripts: ScriptItem[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.scripts)
          ? parsed.scripts
          : [];

      if (remoteScripts.length === 0) {
        setStatusMessage('有効な原稿データが含まれていません。');
        return;
      }

      const { merged, conflictsCreated } = mergeScriptsWithConflictProtection(
        scripts,
        remoteScripts
      );
      await onApplyMergedScripts(merged);
      setStatusMessage(
        conflictsCreated > 0
          ? `${remoteScripts.length}件の原稿を統合しました（競合した${conflictsCreated}件はバックアップとして両方保持しました）。`
          : `${remoteScripts.length}件の原稿をデータ消失なく同期・統合しました。`
      );
    } catch {
      setStatusMessage('JSON同期ファイルの読み込みに失敗しました。');
    } finally {
      e.target.value = '';
    }
  };

  const handleCloudEndpointSync = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!endpointUrl.trim()) {
      setStatusMessage('同期先エンドポイントURLを入力してください。');
      return;
    }

    const config: CloudSyncProviderConfig = {
      endpointUrl: endpointUrl.trim(),
      apiKey: apiKey.trim(),
      deviceId: deviceId.trim() || 'MacBook',
    };
    saveCloudSyncConfig(config);
    setIsSyncing(true);
    setStatusMessage('クラウドエンドポイントと同期中...');

    try {
      const { scripts: merged, report } = await syncScriptsWithEndpoint(
        scripts,
        config
      );
      await onApplyMergedScripts(merged);
      setStatusMessage(report.message);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: 'any' } as React.DialogHTMLAttributes<HTMLDialogElement>)}
      aria-labelledby="sync-modal-title"
      className="m-auto w-full max-w-xl rounded-2xl border border-zinc-800 bg-zinc-950/95 p-0 text-zinc-100 shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    >
      <div className="flex flex-col">
        <div className="flex items-center justify-between border-b border-zinc-800/80 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <Cloud className="h-5 w-5 text-sky-400" />
            <h2
              id="sync-modal-title"
              className="text-base font-semibold tracking-tight"
            >
              MacBook / iPad 原稿同期・バックアップ
            </h2>
          </div>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            aria-label="閉じる"
            className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 p-6">
          {/* Option 1: Zero-cost Instant Sync via JSON Bundle (AirDrop / iCloud Drive / Google Drive) */}
          <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-sky-400">
                1. AirDrop / iCloud Drive ファイル同期（完全無料・設定不要）
              </span>
              <span className="flex items-center gap-1 text-[11px] text-emerald-400">
                <ShieldCheck className="h-3.5 w-3.5" /> 競合保護対応
              </span>
            </div>
            <p className="text-xs text-zinc-400">
              MacBookで編集したすべての原稿を1つのJSONバンドルとして書き出し、iPadで読み込むと更新日時と競合をチェックして安全にマージします。
            </p>
            <div className="flex flex-wrap gap-2.5 pt-1">
              <button
                type="button"
                onClick={handleExportSyncBundle}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-sky-500 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-sky-400"
              >
                <Download className="h-4 w-4" />
                同期データを書き出す (.json)
              </button>
              <input
                ref={bundleInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleImportSyncBundle}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => bundleInputRef.current?.click()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-700"
              >
                <Upload className="h-4 w-4" />
                同期データを読み込む (.json)
              </button>
            </div>
          </div>

          {/* Option 2: Custom Cloud Endpoint Sync */}
          <form
            onSubmit={handleCloudEndpointSync}
            className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
          >
            <span className="block text-xs font-bold text-zinc-200">
              2. クラウドエンドポイント同期（任意設定・REST JSON / KV対応）
            </span>
            <p className="text-xs text-zinc-400">
              独自のクラウドストレージURLとBearerトークンを設定すると、ワンクリックでMacBookとiPad間の双方向マージを実行します。通信失敗時もローカルデータは一切消失しません。
            </p>

            <div className="space-y-2.5 pt-1">
              <div>
                <label className="block text-[11px] text-zinc-400">
                  端末識別名
                </label>
                <input
                  type="text"
                  value={deviceId}
                  onChange={(e) => setDeviceId(e.target.value)}
                  placeholder="MacBook-Pro / iPad-Pro"
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 focus:border-sky-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] text-zinc-400">
                  同期エンドポイントURL (GET / PUT JSON)
                </label>
                <input
                  type="url"
                  value={endpointUrl}
                  onChange={(e) => setEndpointUrl(e.target.value)}
                  placeholder="https://example.com/api/voicesync/scripts"
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 focus:border-sky-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] text-zinc-400">
                  認証トークン / API Key (任意)
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Bearer token..."
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 focus:border-sky-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={isSyncing}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-sky-500/40 bg-sky-500/15 py-2.5 text-xs font-semibold text-sky-300 transition hover:bg-sky-500/25 disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`}
                />
                <span>クラウドと双方向同期を実行</span>
              </button>
            </div>
          </form>

          {statusMessage && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{statusMessage}</span>
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
