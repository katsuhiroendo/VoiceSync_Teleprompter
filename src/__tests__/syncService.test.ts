import { describe, it, expect } from 'vitest';
import { mergeScriptsWithConflictProtection } from '@/lib/syncService';
import { ScriptItem } from '@/types/prompter';

describe('Sync Service & Conflict Resolution (Phase 6)', () => {
  const baseScript: ScriptItem = {
    id: 'script-1',
    title: 'テスト原稿',
    content: '初期の原稿テキストです。',
    language: 'ja-JP',
    createdAt: 1000,
    updatedAt: 10000,
  };

  it('adopts newer script when updatedAt timestamps differ by more than 60s', () => {
    const local = [baseScript];
    const remote: ScriptItem[] = [
      {
        ...baseScript,
        content: 'iPadで後から更新された原稿テキストです。',
        updatedAt: 10000 + 120_000,
      },
    ];

    const { merged, conflictsCreated } = mergeScriptsWithConflictProtection(
      local,
      remote
    );
    expect(conflictsCreated).toBe(0);
    expect(merged.length).toBe(1);
    expect(merged[0].content).toBe('iPadで後から更新された原稿テキストです。');
  });

  it('preserves both versions as conflict backup when edited simultaneously (<60s) on MacBook and iPad', () => {
    const local: ScriptItem[] = [
      {
        ...baseScript,
        content: 'MacBookで編集した内容',
        updatedAt: 50000,
      },
    ];
    const remote: ScriptItem[] = [
      {
        ...baseScript,
        content: 'iPadで同時に編集した内容',
        updatedAt: 50015,
      },
    ];

    const { merged, conflictsCreated } = mergeScriptsWithConflictProtection(
      local,
      remote
    );
    expect(conflictsCreated).toBe(1);
    expect(merged.length).toBe(2);
    expect(merged.some((s) => s.title.includes('競合バックアップ'))).toBe(true);
  });
});
