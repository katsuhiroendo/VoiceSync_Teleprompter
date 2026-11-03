import {
  RecordingSessionMeta,
  NGMarkerItem,
  CameraResolutionPreset,
  CameraAspectRatioPreset,
} from '@/types/prompter';
import {
  openDB,
  RECORDING_SESSIONS_STORE,
  RECORDING_CHUNKS_STORE,
} from '@/lib/db';

export interface StoredRecordingChunk {
  chunkKey: string;      // `${sessionId}_${String(chunkIndex).padStart(6, '0')}`
  sessionId: string;
  chunkIndex: number;
  blob: Blob;
  sizeBytes: number;
  createdAt: number;
}

export interface StorageEstimateInfo {
  usageBytes: number;
  quotaBytes: number;
  availableBytes: number;
  usageRatio: number;    // 0.0 to 1.0
  isLowStorageWarning: boolean;
  supported: boolean;
}

// Required minimum free space before warning (250 MB)
export const MIN_RECOMMENDED_FREE_BYTES = 250 * 1024 * 1024;
export const MAX_PENDING_WRITE_QUEUE = 8;

export function buildChunkKey(sessionId: string, chunkIndex: number): string {
  return `${sessionId}_${String(chunkIndex).padStart(6, '0')}`;
}

export function formatBytesHuman(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  if (mb >= 1) {
    return `${mb.toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export async function estimateBrowserStorage(): Promise<StorageEstimateInfo> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.storage ||
    typeof navigator.storage.estimate !== 'function'
  ) {
    return {
      usageBytes: 0,
      quotaBytes: 0,
      availableBytes: 0,
      usageRatio: 0,
      isLowStorageWarning: false,
      supported: false,
    };
  }

  try {
    const est = await navigator.storage.estimate();
    const usageBytes = est.usage ?? 0;
    const quotaBytes = est.quota ?? 0;
    const availableBytes = Math.max(0, quotaBytes - usageBytes);
    const usageRatio = quotaBytes > 0 ? usageBytes / quotaBytes : 0;
    const isLowStorageWarning =
      quotaBytes > 0 &&
      (availableBytes < MIN_RECOMMENDED_FREE_BYTES || usageRatio > 0.9);

    return {
      usageBytes,
      quotaBytes,
      availableBytes,
      usageRatio,
      isLowStorageWarning,
      supported: true,
    };
  } catch {
    return {
      usageBytes: 0,
      quotaBytes: 0,
      availableBytes: 0,
      usageRatio: 0,
      isLowStorageWarning: false,
      supported: false,
    };
  }
}

export async function saveRecordingSessionMeta(
  meta: RecordingSessionMeta
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECORDING_SESSIONS_STORE, 'readwrite');
    const store = tx.objectStore(RECORDING_SESSIONS_STORE);
    const req = store.put(meta);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getRecordingSessionMeta(
  sessionId: string
): Promise<RecordingSessionMeta | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(RECORDING_SESSIONS_STORE, 'readonly');
      const store = tx.objectStore(RECORDING_SESSIONS_STORE);
      const req = store.get(sessionId);
      req.onsuccess = () =>
        resolve((req.result as RecordingSessionMeta) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function getAllRecordingSessions(): Promise<
  RecordingSessionMeta[]
> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(RECORDING_SESSIONS_STORE, 'readonly');
      const store = tx.objectStore(RECORDING_SESSIONS_STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        const list = ((req.result as RecordingSessionMeta[]) || []).sort(
          (a, b) => b.startedAt - a.startedAt
        );
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

/**
 * 起動時に未完了（'recording' のままブラウザが終了した）または 'interrupted' のセッションを検出する。
 * チャンクが1つ以上保存されているセッションのみ復旧対象として返す。
 */
export async function detectRecoverableSessions(): Promise<
  RecordingSessionMeta[]
> {
  const all = await getAllRecordingSessions();
  const recoverable: RecordingSessionMeta[] = [];

  for (const session of all) {
    if (
      (session.status === 'recording' || session.status === 'interrupted') &&
      session.chunkCount > 0
    ) {
      if (session.status === 'recording') {
        const updated: RecordingSessionMeta = {
          ...session,
          status: 'interrupted',
          updatedAt: Date.now(),
        };
        try {
          await saveRecordingSessionMeta(updated);
          recoverable.push(updated);
        } catch {
          recoverable.push(session);
        }
      } else {
        recoverable.push(session);
      }
    }
  }

  return recoverable;
}

export async function saveRecordingChunkToDB(
  chunk: StoredRecordingChunk
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECORDING_CHUNKS_STORE, 'readwrite');
    const store = tx.objectStore(RECORDING_CHUNKS_STORE);
    const req = store.put(chunk);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getChunksForSession(
  sessionId: string
): Promise<StoredRecordingChunk[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECORDING_CHUNKS_STORE, 'readonly');
    const store = tx.objectStore(RECORDING_CHUNKS_STORE);
    const index = store.index('sessionId');
    const req = index.getAll(IDBKeyRange.only(sessionId));
    req.onsuccess = () => {
      const chunks = ((req.result as StoredRecordingChunk[]) || []).sort(
        (a, b) => a.chunkIndex - b.chunkIndex
      );
      resolve(chunks);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * 保存済みチャンクを順序通りに結合して再生・ダウンロード可能な動画 Blob を再構成する。
 * 先頭チャンク（初期化セグメント / EBML Header / ftyp+moov box）が欠落していないかも検証する。
 */
export async function reconstructSessionVideoBlob(sessionId: string): Promise<{
  blob: Blob | null;
  meta: RecordingSessionMeta | null;
  chunkCount: number;
  hasHeaderChunk: boolean;
  error?: string;
}> {
  try {
    const meta = await getRecordingSessionMeta(sessionId);
    const chunks = await getChunksForSession(sessionId);

    if (!chunks.length) {
      return {
        blob: null,
        meta,
        chunkCount: 0,
        hasHeaderChunk: false,
        error: '保存された録画チャンクが見つかりませんでした。',
      };
    }

    const hasHeaderChunk = chunks[0].chunkIndex === 0 && chunks[0].sizeBytes > 0;
    const mimeType = meta?.mimeType || chunks[0].blob.type || 'video/webm';
    const orderedBlobs = chunks.map((c) => c.blob);
    const combinedBlob = new Blob(orderedBlobs, { type: mimeType });

    return {
      blob: combinedBlob,
      meta,
      chunkCount: chunks.length,
      hasHeaderChunk,
    };
  } catch {
    return {
      blob: null,
      meta: null,
      chunkCount: 0,
      hasHeaderChunk: false,
      error: '録画データの再構成中にエラーが発生しました。',
    };
  }
}

export async function deleteRecordingSessionAndChunks(
  sessionId: string
): Promise<void> {
  const db = await openDB();
  const chunks = await getChunksForSession(sessionId);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      [RECORDING_SESSIONS_STORE, RECORDING_CHUNKS_STORE],
      'readwrite'
    );
    const sessionStore = tx.objectStore(RECORDING_SESSIONS_STORE);
    const chunkStore = tx.objectStore(RECORDING_CHUNKS_STORE);

    sessionStore.delete(sessionId);
    for (const c of chunks) {
      chunkStore.delete(c.chunkKey);
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export interface ProgressiveSessionWriterCallbacks {
  onProgress?: (meta: RecordingSessionMeta, pendingQueueSize: number) => void;
  onQueueBacklogWarning?: (pendingQueueSize: number) => void;
  onWriteError?: (errorMessage: string) => void;
}

/**
 * 8.3 & 8.4 非同期順序保証キューを備えた録画セッション逐次保存マネージャー
 * - MediaRecorder の ondataavailable チャンクをメモリに溜め込まず、順序を保証して1つずつ IndexedDB へ書き込む
 * - 書き込み遅延（キュー滞留）や書き込み失敗をリアルタイムに通知する
 * - stop / finalize 時に未完了のキューがすべて書き込まれるまで待機する（flush）
 */
export class ProgressiveRecordingSessionWriter {
  private meta: RecordingSessionMeta;
  private callbacks: ProgressiveSessionWriterCallbacks;
  private nextChunkIndex = 0;
  private writeChain: Promise<void> = Promise.resolve();
  private pendingWrites = 0;
  private hasWriteError = false;

  constructor(
    options: {
      sessionId?: string;
      scriptId: string;
      scriptTitle: string;
      videoDeviceLabel: string;
      audioDeviceLabel: string;
      resolution: CameraResolutionPreset;
      aspectRatio: CameraAspectRatioPreset;
      mimeType: string;
      extension: 'mp4' | 'webm';
    },
    callbacks: ProgressiveSessionWriterCallbacks = {}
  ) {
    const now = Date.now();
    this.meta = {
      sessionId:
        options.sessionId ||
        `rec-${now}-${Math.random().toString(36).slice(2, 8)}`,
      scriptId: options.scriptId,
      scriptTitle: options.scriptTitle,
      startedAt: now,
      updatedAt: now,
      status: 'recording',
      videoDeviceLabel: options.videoDeviceLabel || 'デフォルトカメラ',
      audioDeviceLabel: options.audioDeviceLabel || 'デフォルトマイク',
      resolution: options.resolution,
      aspectRatio: options.aspectRatio,
      mimeType: options.mimeType,
      extension: options.extension,
      chunkCount: 0,
      totalBytes: 0,
      durationSec: 0,
      markers: [],
    };
    this.callbacks = callbacks;
  }

  public getSessionId(): string {
    return this.meta.sessionId;
  }

  public getMeta(): RecordingSessionMeta {
    return { ...this.meta, markers: [...this.meta.markers] };
  }

  public getPendingWriteCount(): number {
    return this.pendingWrites;
  }

  public async initializeSession(): Promise<RecordingSessionMeta> {
    try {
      await saveRecordingSessionMeta(this.meta);
    } catch {
      this.hasWriteError = true;
      this.callbacks.onWriteError?.(
        '録画セッション情報の初期化保存に失敗しました。ストレージ空き容量を確認してください。'
      );
    }
    return this.getMeta();
  }

  public enqueueChunk(blob: Blob, currentDurationSec: number): void {
    if (!blob || blob.size === 0) return;

    const chunkIndex = this.nextChunkIndex++;
    const chunkRecord: StoredRecordingChunk = {
      chunkKey: buildChunkKey(this.meta.sessionId, chunkIndex),
      sessionId: this.meta.sessionId,
      chunkIndex,
      blob,
      sizeBytes: blob.size,
      createdAt: Date.now(),
    };

    this.pendingWrites++;
    if (this.pendingWrites >= MAX_PENDING_WRITE_QUEUE) {
      this.callbacks.onQueueBacklogWarning?.(this.pendingWrites);
    }

    this.writeChain = this.writeChain
      .then(async () => {
        this.meta = {
          ...this.meta,
          chunkCount: this.meta.chunkCount + 1,
          totalBytes: this.meta.totalBytes + blob.size,
          durationSec: Math.max(this.meta.durationSec, currentDurationSec),
          updatedAt: Date.now(),
        };
        try {
          await saveRecordingChunkToDB(chunkRecord);
          await saveRecordingSessionMeta(this.meta);
          this.callbacks.onProgress?.(this.getMeta(), this.pendingWrites - 1);
        } catch {
          this.hasWriteError = true;
          this.callbacks.onWriteError?.(
            '録画データの逐次保存（IndexedDB書き込み）に失敗しました。ディスク容量不足の可能性があります。'
          );
        } finally {
          this.pendingWrites = Math.max(0, this.pendingWrites - 1);
        }
      })
      .catch(() => {
        this.pendingWrites = Math.max(0, this.pendingWrites - 1);
      });
  }

  public updateMarkers(markers: NGMarkerItem[]): void {
    this.meta = {
      ...this.meta,
      markers: [...markers],
      updatedAt: Date.now(),
    };
    this.writeChain = this.writeChain
      .then(async () => {
        try {
          await saveRecordingSessionMeta(this.meta);
        } catch {
          // ignore non-critical marker metadata save error
        }
      })
      .catch(() => {});
  }

  public async finalizeSession(finalDurationSec: number): Promise<RecordingSessionMeta> {
    await this.writeChain;
    this.meta = {
      ...this.meta,
      status: this.hasWriteError ? 'interrupted' : 'completed',
      durationSec: Math.max(1, finalDurationSec, this.meta.durationSec),
      updatedAt: Date.now(),
    };
    try {
      await saveRecordingSessionMeta(this.meta);
    } catch {
      // ignore
    }
    return this.getMeta();
  }
}
