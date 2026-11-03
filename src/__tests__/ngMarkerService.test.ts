import { describe, it, expect } from 'vitest';
import {
  formatTimecodeHMS,
  computeElapsedVideoSeconds,
  createNGMarkerItem,
  resolveRetakeSegmentIndex,
  serializeMarkersToCSV,
  serializeMarkersToJSON,
} from '@/lib/ngMarkerService';
import { parseScriptToSegments } from '@/lib/scriptParser';

describe('Phase 3: NG & Retake Marker Service', () => {
  it('formats elapsed seconds into HH:MM:SS timecode', () => {
    expect(formatTimecodeHMS(0)).toBe('00:00:00');
    expect(formatTimecodeHMS(85)).toBe('00:01:25');
    expect(formatTimecodeHMS(3661)).toBe('01:01:01');
  });

  it('computes elapsed video playback seconds accounting for paused duration', () => {
    const startMs = 100000;
    const nowMs = 195000; // 95s wall clock
    const pausedMs = 10000; // 10s paused
    expect(computeElapsedVideoSeconds(startMs, nowMs, pausedMs)).toBe(85);
  });

  it('creates single and multiple NG / Retake markers and exports to CSV and JSON', () => {
    const segments = parseScriptToSegments(
      '最初の文です。\n次の段落の最初の文です。ここで言い間違いをしました。'
    );

    const m1 = createNGMarkerItem({
      sessionId: 'sess-1',
      elapsedSeconds: 85,
      scriptId: 'script-1',
      segment: segments[2],
      activeSegmentIndex: 2,
      type: 'ng',
      note: '噛んだため撮り直し',
      nowMs: 1700000000000,
    });

    const m2 = createNGMarkerItem({
      sessionId: 'sess-1',
      elapsedSeconds: 92,
      scriptId: 'script-1',
      segment: segments[1],
      activeSegmentIndex: 1,
      type: 'retake-start',
      note: '段落先頭から再開',
      nowMs: 1700000007000,
    });

    expect(m1.timecode).toBe('00:01:25');
    expect(m1.type).toBe('ng');
    expect(m1.segmentIndex).toBe(2);

    const csv = serializeMarkersToCSV([m1, m2]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('timecode,type,scriptPosition,text,note');
    expect(lines[1]).toBe(
      '00:01:25,NG,3,"ここで言い間違いをしました。","噛んだため撮り直し"'
    );
    expect(lines[2]).toBe(
      '00:01:32,撮り直し開始,2,"次の段落の最初の文です。","段落先頭から再開"'
    );

    const json = JSON.parse(serializeMarkersToJSON([m1, m2]));
    expect(json).toHaveLength(2);
    expect(json[0].timecode).toBe('00:01:25');
    expect(json[1].type).toBe('retake-start');
  });

  it('resolves retake jump indices for current phrase, -1 phrase, paragraph start, and previous heading', () => {
    const raw = [
      '# 第1章 イントロダクション',
      '皆さんこんにちは。今日も動画をご覧いただきありがとうございます。',
      '【第2章 本編の解説】',
      'ここでは具体的な手順を3つ紹介します。まず1つ目の手順です。続いて2つ目の手順です。',
    ].join('\n\n');

    const segments = parseScriptToSegments(raw);
    const lastIdx = segments.length - 1;

    expect(
      resolveRetakeSegmentIndex(segments, lastIdx, 'current-phrase')
    ).toBe(lastIdx);
    expect(resolveRetakeSegmentIndex(segments, lastIdx, 'prev-phrase')).toBe(
      lastIdx - 1
    );

    const paraStartIdx = resolveRetakeSegmentIndex(
      segments,
      lastIdx,
      'current-paragraph-start'
    );
    expect(segments[paraStartIdx].text).toContain('ここでは具体的な手順');

    const prevHeadingIdx = resolveRetakeSegmentIndex(
      segments,
      lastIdx,
      'prev-heading-or-section'
    );
    expect(segments[prevHeadingIdx].text).toContain('【第2章 本編の解説】');
  });
});
