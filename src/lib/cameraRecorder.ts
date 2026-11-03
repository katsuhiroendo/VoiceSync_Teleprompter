export interface CameraDeviceOption {
  deviceId: string;
  label: string;
}

export interface RecordedVideoClip {
  url: string;
  blob: Blob;
  mimeType: string;
  extension: 'mp4' | 'webm';
  durationSec: number;
  createdAt: number;
}

export type CameraStatus =
  | 'off'
  | 'initializing'
  | 'ready'
  | 'recording'
  | 'error';

/**
 * Chrome / Safari 両対応の最適な録画 MIME タイプを判定する。
 * Safari / macOS では video/mp4、Chrome では video/mp4 または video/webm;codecs=vp9,opus を優先。
 */
export function selectSupportedVideoMimeType(): {
  mimeType: string;
  extension: 'mp4' | 'webm';
} {
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') {
    return { mimeType: '', extension: 'webm' };
  }

  const candidates: Array<{ mimeType: string; extension: 'mp4' | 'webm' }> = [
    { mimeType: 'video/mp4;codecs=avc1,mp4a.40.2', extension: 'mp4' },
    { mimeType: 'video/mp4', extension: 'mp4' },
    { mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp8,opus', extension: 'webm' },
    { mimeType: 'video/webm', extension: 'webm' },
  ];

  for (const item of candidates) {
    if (MediaRecorder.isTypeSupported(item.mimeType)) {
      return item;
    }
  }

  return { mimeType: '', extension: 'webm' };
}

export async function listVideoInputDevices(): Promise<CameraDeviceOption[]> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices ||
    !navigator.mediaDevices.enumerateDevices
  ) {
    return [];
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'videoinput')
      .map((d, idx) => ({
        deviceId: d.deviceId,
        label: d.label || `カメラ ${idx + 1} (MacBook内蔵 / Webカメラ)`,
      }));
  } catch {
    return [];
  }
}

export function formatDurationTimer(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
