import { NGMarkerItem, NGMarkerType, ScriptSegment } from '@/types/prompter';

export const NG_MARKER_TYPE_LABELS: Record<NGMarkerType, string> = {
  ng: 'NG',
  'retake-start': '撮り直し開始',
  'retake-complete': '撮り直し完了',
  'edit-note': '編集メモ',
};

/**
 * 秒数を HH:MM:SS 形式のタイムコードに変換する（例: 85 -> "00:01:25"）
 */
export function formatTimecodeHMS(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;

  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(seconds).padStart(2, '0'),
  ].join(':');
}

/**
 * 録画開始時刻・一時停止累積時間から、実際の動画再生時間と一致する経過秒数を算出する (Section 5.6)
 */
export function computeElapsedVideoSeconds(
  recordingStartMs: number,
  nowMs: number = Date.now(),
  totalPausedMs: number = 0
): number {
  if (recordingStartMs <= 0 || nowMs <= recordingStartMs) return 0;
  const activeMs = Math.max(0, nowMs - recordingStartMs - totalPausedMs);
  return Math.floor(activeMs / 1000);
}

/**
 * 新しい NG / 撮り直しマーカーレコードを生成する
 */
export function createNGMarkerItem(params: {
  sessionId: string;
  elapsedSeconds: number;
  scriptId: string;
  segment: ScriptSegment | undefined;
  activeSegmentIndex: number;
  type?: NGMarkerType;
  note?: string;
  nowMs?: number;
}): NGMarkerItem {
  const now = params.nowMs ?? Date.now();
  const type = params.type ?? 'ng';
  const elapsedSec = Math.max(0, Math.floor(params.elapsedSeconds));
  const defaultNote =
    params.note !== undefined
      ? params.note
      : type === 'ng'
        ? '言い間違い・撮り直し'
        : NG_MARKER_TYPE_LABELS[type];

  return {
    id: `mk-${now}-${Math.random().toString(36).slice(2, 7)}`,
    sessionId: params.sessionId || 'unlinked-session',
    elapsedMs: elapsedSec * 1000,
    elapsedSeconds: elapsedSec,
    timecode: formatTimecodeHMS(elapsedSec),
    scriptId: params.scriptId,
    segmentId: params.segment?.id || `seg-${params.activeSegmentIndex}`,
    segmentIndex: params.activeSegmentIndex,
    paragraphIndex: params.segment?.paragraphIndex ?? 0,
    segmentText: params.segment?.text || '',
    type,
    note: defaultNote,
    createdAt: now,
  };
}

export type RetakeTargetAction =
  | 'current-phrase'
  | 'prev-phrase'
  | 'current-paragraph-start'
  | 'prev-heading-or-section';

/**
 * 見出し・章パターン（# 見出し、【章】、■、◆、第N章、1. 等）の判定
 */
export function isHeadingSegment(text: string): boolean {
  const trimmed = text.trim();
  return /^(#{1,6}\s+|【.+】|■|◆|●|▼|第[0-9０-９一二三四五六七八九十]+[章節部]|Step\s*\d+|STEP\s*\d+|\d+[\.．\s])/i.test(
    trimmed
  );
}

/**
 * 撮り直し再開位置（インデックス）を計算する (Section 5.4)
 */
export function resolveRetakeSegmentIndex(
  segments: ScriptSegment[],
  currentIndex: number,
  action: RetakeTargetAction
): number {
  if (segments.length === 0) return 0;
  const safeCurrent = Math.max(0, Math.min(segments.length - 1, currentIndex));

  switch (action) {
    case 'current-phrase':
      return safeCurrent;

    case 'prev-phrase':
      return Math.max(0, safeCurrent - 1);

    case 'current-paragraph-start': {
      const currentPara = segments[safeCurrent]?.paragraphIndex ?? 0;
      const firstInPara = segments.find(
        (s) => s.paragraphIndex === currentPara
      );
      return firstInPara ? firstInPara.index : safeCurrent;
    }

    case 'prev-heading-or-section': {
      // Search backward from safeCurrent - 1 for a heading segment
      for (let i = safeCurrent - 1; i >= 0; i--) {
        if (isHeadingSegment(segments[i].text)) {
          return i;
        }
      }
      // Fallback: jump to the start of the previous paragraph if no explicit heading exists
      const currentPara = segments[safeCurrent]?.paragraphIndex ?? 0;
      const targetPara = Math.max(0, currentPara - 1);
      const firstInPrevPara = segments.find(
        (s) => s.paragraphIndex === targetPara
      );
      return firstInPrevPara ? firstInPrevPara.index : 0;
    }
  }
}

function escapeCsvCell(value: string): string {
  const normalized = value.replace(/\r?\n/g, ' ').replace(/"/g, '""');
  return `"${normalized}"`;
}

/**
 * マーカー一覧を CSV 形式に変換する (Section 5.5)
 * Header: timecode,type,scriptPosition,text,note
 */
export function serializeMarkersToCSV(markers: NGMarkerItem[]): string {
  const header = 'timecode,type,scriptPosition,text,note';
  const rows = markers.map((m) => {
    const typeLabel = NG_MARKER_TYPE_LABELS[m.type] || m.type;
    const scriptPosition = m.segmentIndex + 1; // 1-based phrase number for editors
    return [
      m.timecode,
      typeLabel,
      String(scriptPosition),
      escapeCsvCell(m.segmentText),
      escapeCsvCell(m.note),
    ].join(',');
  });
  return [header, ...rows].join('\n');
}

/**
 * マーカー一覧を JSON 形式に変換する (Section 5.5)
 */
export function serializeMarkersToJSON(markers: NGMarkerItem[]): string {
  return JSON.stringify(markers, null, 2);
}
