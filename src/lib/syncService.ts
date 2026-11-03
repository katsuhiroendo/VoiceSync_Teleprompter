import { ScriptItem } from '@/types/prompter';

export interface CloudSyncProviderConfig {
  endpointUrl: string;
  apiKey: string;
  deviceId: string;
}

export interface SyncStatusReport {
  state: 'local-only' | 'syncing' | 'synced' | 'offline-queued' | 'conflict-resolved' | 'error';
  lastSyncedAt: number | null;
  message: string;
}

const SYNC_CONFIG_STORAGE_KEY = 'voicesync_cloud_sync_config';

export function loadCloudSyncConfig(): CloudSyncProviderConfig | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SYNC_CONFIG_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CloudSyncProviderConfig;
  } catch {
    return null;
  }
}

export function saveCloudSyncConfig(config: CloudSyncProviderConfig | null): void {
  if (typeof window === 'undefined') return;
  if (!config) {
    localStorage.removeItem(SYNC_CONFIG_STORAGE_KEY);
  } else {
    localStorage.setItem(SYNC_CONFIG_STORAGE_KEY, JSON.stringify(config));
  }
}

/**
 * MacBookとiPad間で同一IDの原稿が編集された場合の競合解決アルゴリズム。
 * - updatedAt が新しい方を優先するが、本文が大きく異なっており両方とも直近（60秒以内）に
 *   別端末で編集されていた場合は、データ消失を防ぐためバックアップ複製を残してマージする（Section 10: 同期失敗・競合時にデータを消失しない）。
 */
export function mergeScriptsWithConflictProtection(
  localScripts: ScriptItem[],
  remoteScripts: ScriptItem[]
): { merged: ScriptItem[]; conflictsCreated: number } {
  const map = new Map<string, ScriptItem>();
  let conflictsCreated = 0;

  for (const local of localScripts) {
    map.set(local.id, local);
  }

  for (const remote of remoteScripts) {
    const existingLocal = map.get(remote.id);
    if (!existingLocal) {
      map.set(remote.id, remote);
      continue;
    }

    if (existingLocal.content === remote.content && existingLocal.title === remote.title) {
      // 内容が同一の場合は新しいタイムスタンプを採用
      map.set(
        remote.id,
        remote.updatedAt > existingLocal.updatedAt ? remote : existingLocal
      );
      continue;
    }

    const timeDiffMs = Math.abs(remote.updatedAt - existingLocal.updatedAt);
    if (timeDiffMs < 60_000) {
      // 両端末でほぼ同時に異なる編集が行われた場合は、古い方を別IDのバックアップとして保持しデータ消失を防止
      const newer = remote.updatedAt >= existingLocal.updatedAt ? remote : existingLocal;
      const older = remote.updatedAt >= existingLocal.updatedAt ? existingLocal : remote;
      const conflictCopyId = `${older.id}-conflict-${older.updatedAt}`;
      map.set(newer.id, newer);
      map.set(conflictCopyId, {
        ...older,
        id: conflictCopyId,
        title: `${older.title} (競合バックアップ)`,
      });
      conflictsCreated++;
    } else {
      // 明確な時刻差がある場合はLast-Write-Wins
      map.set(
        remote.id,
        remote.updatedAt > existingLocal.updatedAt ? remote : existingLocal
      );
    }
  }

  const merged = Array.from(map.values()).sort(
    (a, b) => b.updatedAt - a.updatedAt
  );
  return { merged, conflictsCreated };
}

/**
 * 任意のREST JSONエンドポイント（またはデバイス間エクスポートバンドル）と原稿リストを同期する。
 * 失敗時・オフライン時はローカルのIndexedDBデータを一切変更・消失させず安全にフォールバックする。
 */
export async function syncScriptsWithEndpoint(
  localScripts: ScriptItem[],
  config: CloudSyncProviderConfig
): Promise<{ scripts: ScriptItem[]; report: SyncStatusReport }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      scripts: localScripts,
      report: {
        state: 'offline-queued',
        lastSyncedAt: null,
        message: 'オフラインのためローカル保存（IndexedDB）を維持しています。オンライン復帰後に同期可能です。',
      },
    };
  }

  try {
    const getRes = await fetch(config.endpointUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
    });

    let remoteScripts: ScriptItem[] = [];
    if (getRes.ok) {
      const payload = await getRes.json();
      if (Array.isArray(payload)) {
        remoteScripts = payload;
      } else if (payload && Array.isArray(payload.scripts)) {
        remoteScripts = payload.scripts;
      }
    }

    const { merged, conflictsCreated } = mergeScriptsWithConflictProtection(
      localScripts,
      remoteScripts
    );

    await fetch(config.endpointUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        deviceId: config.deviceId,
        updatedAt: Date.now(),
        scripts: merged,
      }),
    });

    return {
      scripts: merged,
      report: {
        state: conflictsCreated > 0 ? 'conflict-resolved' : 'synced',
        lastSyncedAt: Date.now(),
        message:
          conflictsCreated > 0
            ? `同期完了（同時編集があった${conflictsCreated}件の原稿をバックアップ保護しました）`
            : 'MacBook / iPad クラウド同期が完了しました',
      },
    };
  } catch {
    return {
      scripts: localScripts,
      report: {
        state: 'error',
        lastSyncedAt: null,
        message:
          '同期サーバーへ接続できませんでした。ローカルの原稿データはすべて安全に保持されています。',
      },
    };
  }
}
