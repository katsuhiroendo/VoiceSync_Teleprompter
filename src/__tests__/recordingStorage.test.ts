import { describe, it, expect } from 'vitest';
import {
  buildChunkKey,
  formatBytesHuman,
  ProgressiveRecordingSessionWriter,
  estimateBrowserStorage,
} from '@/lib/recordingStorage';

describe('Phase 6: Progressive Recording Storage & Crash Recovery Helpers', () => {
  it('builds zero-padded lexicographically ordered chunk keys', () => {
    const key0 = buildChunkKey('sess_123', 0);
    const key9 = buildChunkKey('sess_123', 9);
    const key10 = buildChunkKey('sess_123', 10);
    const key720 = buildChunkKey('sess_123', 720); // 60 min @ 5s chunks

    expect(key0).toBe('sess_123_000000');
    expect(key9).toBe('sess_123_000009');
    expect(key10).toBe('sess_123_000010');
    expect(key720).toBe('sess_123_000720');
    expect([key720, key10, key0, key9].sort()).toEqual([
      key0,
      key9,
      key10,
      key720,
    ]);
  });

  it('formats byte sizes into human-readable KB / MB / GB strings', () => {
    expect(formatBytesHuman(0)).toBe('0 MB');
    expect(formatBytesHuman(2048)).toBe('2 KB');
    expect(formatBytesHuman(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytesHuman(2.5 * 1024 * 1024 * 1024)).toBe('2.50 GB');
  });

  it('initializes ProgressiveRecordingSessionWriter and tracks chunk metadata in order', async () => {
    const writer = new ProgressiveRecordingSessionWriter({
      scriptId: 'script-1',
      scriptTitle: 'テスト原稿',
      videoDeviceLabel: 'MacBook Air Camera',
      audioDeviceLabel: 'Built-in Mic',
      resolution: '1080p',
      aspectRatio: '16:9',
      mimeType: 'video/webm',
      extension: 'webm',
    });

    const initialMeta = await writer.initializeSession();
    expect(initialMeta.status).toBe('recording');
    expect(initialMeta.chunkCount).toBe(0);

    // Enqueue 3 chunks sequentially
    writer.enqueueChunk(new Blob(['chunk-0'], { type: 'video/webm' }), 5);
    writer.enqueueChunk(new Blob(['chunk-1'], { type: 'video/webm' }), 10);
    writer.enqueueChunk(new Blob(['chunk-2'], { type: 'video/webm' }), 15);

    const finalMeta = await writer.finalizeSession(15);
    expect(finalMeta.chunkCount).toBe(3);
    expect(finalMeta.durationSec).toBe(15);
    expect(finalMeta.totalBytes).toBe(21);
  });

  it('returns safe fallback when navigator.storage.estimate is unavailable', async () => {
    const info = await estimateBrowserStorage();
    expect(typeof info.supported).toBe('boolean');
    expect(typeof info.isLowStorageWarning).toBe('boolean');
  });
});
