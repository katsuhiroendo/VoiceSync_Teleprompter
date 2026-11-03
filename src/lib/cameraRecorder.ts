import {
  CameraResolutionPreset,
  CameraAspectRatioPreset,
} from '@/types/prompter';

export interface CameraDeviceOption {
  deviceId: string;
  label: string;
  isSmartphoneOrExternal: boolean;
}

export interface AudioDeviceOption {
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
 * デバイスラベルからUSB接続スマホカメラ（Google Pixel / Android Webcam / iPhone Continuity Camera / Camo / Iriun 等）
 * または外付けキャプチャデバイスかどうかを判定する。
 */
export function isSmartphoneCameraLabel(label: string): boolean {
  if (!label) return false;
  return /pixel|android|webcam|iphone|ipad|continuity|連係|外部|usb|camo|iriun|droidcam|epoccam|elgato/i.test(
    label
  );
}

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

export async function listMediaInputDevices(): Promise<{
  videoDevices: CameraDeviceOption[];
  audioDevices: AudioDeviceOption[];
}> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices ||
    !navigator.mediaDevices.enumerateDevices
  ) {
    return { videoDevices: [], audioDevices: [] };
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices: CameraDeviceOption[] = devices
      .filter((d) => d.kind === 'videoinput')
      .map((d, idx) => {
        const rawLabel = d.label || `カメラ ${idx + 1}`;
        const isPhone = isSmartphoneCameraLabel(rawLabel);
        return {
          deviceId: d.deviceId,
          label: isPhone ? `📱 ${rawLabel}` : rawLabel,
          isSmartphoneOrExternal: isPhone,
        };
      });

    const audioDevices: AudioDeviceOption[] = devices
      .filter((d) => d.kind === 'audioinput')
      .map((d, idx) => ({
        deviceId: d.deviceId,
        label: d.label || `マイク ${idx + 1}`,
      }));

    return { videoDevices, audioDevices };
  } catch {
    return { videoDevices: [], audioDevices: [] };
  }
}

export async function listVideoInputDevices(): Promise<CameraDeviceOption[]> {
  const { videoDevices } = await listMediaInputDevices();
  return videoDevices;
}

export function buildVideoTrackConstraints(options: {
  deviceId?: string;
  resolution: CameraResolutionPreset;
  aspectRatio: CameraAspectRatioPreset;
}): MediaTrackConstraints {
  const baseDim =
    options.resolution === '4k'
      ? { long: 3840, short: 2160 }
      : options.resolution === '720p'
        ? { long: 1280, short: 720 }
        : { long: 1920, short: 1080 };

  const widthIdeal =
    options.aspectRatio === '9:16' ? baseDim.short : baseDim.long;
  const heightIdeal =
    options.aspectRatio === '9:16' ? baseDim.long : baseDim.short;

  return {
    width: { ideal: widthIdeal },
    height: { ideal: heightIdeal },
    frameRate: { ideal: 30 },
    ...(options.deviceId
      ? { deviceId: { exact: options.deviceId } }
      : { facingMode: 'user' }),
  };
}

export function formatDurationTimer(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
