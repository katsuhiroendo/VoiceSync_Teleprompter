'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  ScriptItem,
  PrompterSettings,
  ScrollMode,
  SpeechStatus,
  RecordingSessionMeta,
  NGMarkerItem,
  NGMarkerType,
} from '@/types/prompter';
import {
   parseScriptToSegments,
  normalizeTextForMatching,
} from '@/lib/scriptParser';
import {
  SpeechRecognitionController,
  SpeechTranscriptEvent,
  SpeechErrorInfo,
} from '@/lib/speechEngine';
import {
  findBestMatchingSegment,
  MatchEvaluationResult,
} from '@/lib/fuzzyMatcher';
import {
  CameraDeviceOption,
  AudioDeviceOption,
  CameraStatus,
  RecordedVideoClip,
  selectSupportedVideoMimeType,
  listMediaInputDevices,
  buildVideoTrackConstraints,
  formatDurationTimer,
} from '@/lib/cameraRecorder';
import {
  ProgressiveRecordingSessionWriter,
  StorageEstimateInfo,
  estimateBrowserStorage,
  detectRecoverableSessions,
  reconstructSessionVideoBlob,
  deleteRecordingSessionAndChunks,
  formatBytesHuman,
} from '@/lib/recordingStorage';
import {
  CountdownController,
  CountdownDisplayStep,
} from '@/lib/countdownHelper';
import {
  NG_MARKER_TYPE_LABELS,
  RetakeTargetAction,
  computeElapsedVideoSeconds,
  createNGMarkerItem,
  resolveRetakeSegmentIndex,
  serializeMarkersToCSV,
  serializeMarkersToJSON,
} from '@/lib/ngMarkerService';
import {
  Play,
  Pause,
  RotateCcw,
  SkipBack,
  SkipForward,
  Sliders,
  Maximize2,
  Minimize2,
  ArrowLeft,
  Mic,
  Gauge,
  Hand,
  Camera,
  Eye,
  Minus,
  Plus,
  Bug,
  AlertTriangle,
  WifiOff,
  CheckCircle2,
  X,
  Video,
  VideoOff,
  Circle,
  Square,
  Download,
  Layers,
  Smartphone,
  HardDrive,
  Trash2,
  Flag,
} from 'lucide-react';

interface TeleprompterStageProps {
  script: ScriptItem;
  settings: PrompterSettings;
  onUpdateSettings: (partial: Partial<PrompterSettings>) => void;
  onExitStage: () => void;
  onOpenSettings: () => void;
}

const STATUS_LABELS: Record<
  SpeechStatus,
  { label: string; badgeClass: string; dotClass: string }
> = {
  idle: {
    label: '待機中',
    badgeClass: 'border-zinc-700 bg-zinc-900/90 text-zinc-300',
    dotClass: 'bg-zinc-400',
  },
  connecting: {
    label: 'マイク接続中',
    badgeClass: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
    dotClass: 'bg-amber-400 animate-pulse',
  },
  listening: {
    label: '音声認識中',
    badgeClass: 'border-sky-500/40 bg-sky-500/15 text-sky-300',
    dotClass: 'bg-sky-400 animate-pulse',
  },
  speaking: {
    label: '発話検出中',
    badgeClass: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
    dotClass: 'bg-emerald-400 animate-ping',
  },
  matching: {
    label: '原稿照合中',
    badgeClass: 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300',
    dotClass: 'bg-indigo-400 animate-pulse',
  },
  paused: {
    label: '一時停止中',
    badgeClass: 'border-zinc-700 bg-zinc-900/90 text-zinc-400',
    dotClass: 'bg-zinc-500',
  },
  error: {
    label: 'エラー',
    badgeClass: 'border-red-500/50 bg-red-500/15 text-red-300',
    dotClass: 'bg-red-400',
  },
};

export function TeleprompterStage({
  script,
  settings,
  onUpdateSettings,
  onExitStage,
  onOpenSettings,
}: TeleprompterStageProps) {
  const segments = useMemo(
    () => parseScriptToSegments(script.content),
    [script.content]
  );

  // Default to voice tracking mode (Section 4)
  const [scrollMode, setScrollMode] = useState<ScrollMode>('voice');
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number>(0);
  const [speechStatus, setSpeechStatus] = useState<SpeechStatus>('idle');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [controlsVisible, setControlsVisible] = useState<boolean>(true);

  // Real-time speech recognition & debug state (Phase 2 & 3)
  const [latestTranscript, setLatestTranscript] = useState<string>('');
  const [isInterimTranscript, setIsInterimTranscript] =
    useState<boolean>(false);
  const [micVolumeLevel, setMicVolumeLevel] = useState<number>(0);
  const [lastMatchResult, setLastMatchResult] =
    useState<MatchEvaluationResult | null>(null);
  const [speechError, setSpeechError] = useState<SpeechErrorInfo | null>(null);
  const [isOffline, setIsOffline] = useState<boolean>(false);
  const [simulationInput, setSimulationInput] = useState<string>('');

  // Camera Preview & Video Recording State (MacBook built-in / USB Smartphone / External Mic)
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('off');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [videoDevices, setVideoDevices] = useState<CameraDeviceOption[]>([]);
  const [audioDevices, setAudioDevices] = useState<AudioDeviceOption[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(
    settings.preferredVideoDeviceId || ''
  );
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState<string>(
    settings.preferredAudioDeviceId || ''
  );
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const [recordedClip, setRecordedClip] = useState<RecordedVideoClip | null>(
    null
  );

  // Phase 6: Long-Recording Progressive Session & Crash Recovery State
  const [activeSessionMeta, setActiveSessionMeta] =
    useState<RecordingSessionMeta | null>(null);
  const [pendingChunkWrites, setPendingChunkWrites] = useState<number>(0);
  const [isSavingRecording, setIsSavingRecording] = useState<boolean>(false);
  const [storageInfo, setStorageInfo] = useState<StorageEstimateInfo | null>(
    null
  );
  const [recoverableSessions, setRecoverableSessions] = useState<
    RecordingSessionMeta[]
  >([]);
  const [confirmDeleteRecoveryId, setConfirmDeleteRecoveryId] = useState<
    string | null
  >(null);
  const [wakeLockSupported, setWakeLockSupported] = useState<boolean>(true);
  // Phase 1: Recording Start Countdown & Post-Record Silent Wait states
  const [countdownStep, setCountdownStep] =
    useState<CountdownDisplayStep>(null);
  const [isWaitingPostRecordSilence, setIsWaitingPostRecordSilence] =
    useState<boolean>(false);
  // Phase 3: NG & Retake Markers states
  const [sessionMarkers, setSessionMarkers] = useState<NGMarkerItem[]>([]);
  const [isRetakeMenuOpen, setIsRetakeMenuOpen] = useState<boolean>(false);
  const [lastMarkerToast, setLastMarkerToast] = useState<NGMarkerItem | null>(
    null
  );
  const [customMarkerNote, setCustomMarkerNote] = useState<string>('');

  const cameraStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const sessionWriterRef = useRef<ProgressiveRecordingSessionWriter | null>(
    null
  );
  const countdownControllerRef = useRef<CountdownController>(
    new CountdownController()
  );
  const postRecordSilenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const wakeLockSentinelRef = useRef<{ release: () => Promise<void> } | null>(
    null
  );
  const recordingStartMsRef = useRef<number>(0);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);
  const backdropVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const segmentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rafRef = useRef<number | null>(null);
  const smoothScrollRafRef = useRef<number | null>(null);
  const targetScrollTopRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);
  const hideControlsTimerRef = useRef<NodeJS.Timeout | null>(null);
  const programmaticScrollRef = useRef<boolean>(false);

  // Refs to hold fresh state for the non-restarting SpeechRecognitionController
  const activeIndexRef = useRef<number>(activeSegmentIndex);
  activeIndexRef.current = activeSegmentIndex;
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const speechControllerRef = useRef<SpeechRecognitionController | null>(null);

  // Smooth spring-damped scroll engine (Section 4.4: 滑らかなアニメーション、ちらつき防止)
  const animateScrollToTarget = useCallback((desiredTop: number) => {
    const container = scrollContainerRef.current;
    if (!container) return;

    targetScrollTopRef.current = Math.max(
      0,
      Math.min(desiredTop, container.scrollHeight - container.clientHeight)
    );

    if (smoothScrollRafRef.current !== null) {
      return; // Animation loop already running toward updated targetScrollTopRef
    }

    programmaticScrollRef.current = true;

    const step = () => {
      const el = scrollContainerRef.current;
      const target = targetScrollTopRef.current;
      if (!el || target === null) {
        smoothScrollRafRef.current = null;
        programmaticScrollRef.current = false;
        return;
      }

      const current = el.scrollTop;
      const diff = target - current;

      if (Math.abs(diff) < 1.2) {
        el.scrollTop = target;
        targetScrollTopRef.current = null;
        smoothScrollRafRef.current = null;
        programmaticScrollRef.current = false;
        return;
      }

      // Compute damping factor from settings.scrollSmoothness & trackingSpeed
      const damping = Math.min(
        0.45,
        Math.max(
          0.06,
          settingsRef.current.scrollSmoothness *
            settingsRef.current.trackingSpeed
        )
      );
      el.scrollTop = current + diff * damping;
      smoothScrollRafRef.current = requestAnimationFrame(step);
    };

    smoothScrollRafRef.current = requestAnimationFrame(step);
  }, []);

  // Scroll a specific segment smoothly to the reading guide line
  const scrollToSegment = useCallback(
    (index: number) => {
      const container = scrollContainerRef.current;
      const targetEl = segmentRefs.current[index];
      if (!container || !targetEl) return;

      const containerHeight = container.clientHeight;
      const readingAnchorPx =
        (settingsRef.current.readingLinePositionVh / 100) * containerHeight;

      // Anchor the top of the active segment right at the reading guide line
      const targetOffsetTop = targetEl.offsetTop;
      const desiredScrollTop = Math.max(
        0,
        targetOffsetTop - Math.max(0, readingAnchorPx - 4)
      );

      animateScrollToTarget(desiredScrollTop);
    },
    [animateScrollToTarget]
  );

  // Re-align the active segment whenever layout/position settings change so the first sentence
  // and current highlight immediately match the reading guide line!
  useEffect(() => {
    const timer = setTimeout(() => {
      scrollToSegment(activeIndexRef.current);
    }, 30);
    return () => clearTimeout(timer);
  }, [
    settings.cameraEyelineMode,
    settings.eyelineHeightVh,
    settings.eyelineTopOffsetVh,
    settings.readingLinePositionVh,
    settings.marginVerticalVh,
    settings.fontSize,
    scrollToSegment,
  ]);

  // Keep track of the normalized transcript & source segment when we last advanced,
  // so the remaining words of the previous phrase don't cause ping-pong backtracking or double advances.
  const lastAdvanceSpokenLengthRef = useRef<number>(0);
  const lastAdvanceResultIndexRef = useRef<number>(-1);
  const lastAdvancedFromIndexRef = useRef<number | null>(null);
  const lastAdvanceTimestampRef = useRef<number>(0);
  const latestSpokenNormLenRef = useRef<number>(0);
  const latestResultIndexRef = useRef<number>(-1);

  /**
   * Section 5.4: 原稿位置を手動・撮り直しで移動した際、見かけのスクロール位置と
   * 音声追従エンジンの内部照合位置（および累積バッファオフセット）を完全に同期する。
   */
  const syncActiveSegmentPosition = useCallback(
    (targetIdx: number) => {
      const clampedIdx = Math.max(
        0,
        Math.min(Math.max(0, segmentsRef.current.length - 1), targetIdx)
      );
      activeIndexRef.current = clampedIdx;
      setActiveSegmentIndex(clampedIdx);
      scrollToSegment(clampedIdx);

      // Synchronize internal speech matcher state so prior spoken words in the current utterance buffer
      // do not immediately jump forward to the old position.
      lastAdvancedFromIndexRef.current = null;
      lastAdvanceTimestampRef.current = Date.now();
      lastAdvanceResultIndexRef.current = latestResultIndexRef.current;
      lastAdvanceSpokenLengthRef.current = latestSpokenNormLenRef.current;
    },
    [scrollToSegment]
  );

  // Process recognized speech (from microphone or debug simulator) and match against script
  const processRecognizedSpeech = useCallback(
    (event: SpeechTranscriptEvent) => {
      setLatestTranscript(event.transcript);
      setIsInterimTranscript(!event.isFinal);
      setSpeechStatus('matching');

      // Keep track of the normalized transcript & source segment when we last advanced,
      // so the remaining words of the previous phrase don't cause ping-pong backtracking or double advances.
      const now = Date.now();
      const timeSinceLastAdvance = now - lastAdvanceTimestampRef.current;

      // Reset offset tracking if Web Speech API moved to a brand-new recognition utterance (resultIndex)
      if (event.resultIndex !== lastAdvanceResultIndexRef.current) {
        lastAdvanceSpokenLengthRef.current = 0;
      }

      // Normalize first so kanji conversion changes on the prefix do not break length-based slicing
      const fullSpokenNorm = normalizeTextForMatching(event.transcript);
      latestResultIndexRef.current = event.resultIndex;
      latestSpokenNormLenRef.current = fullSpokenNorm.length;

      // Chrome's continuous SpeechRecognition in Japanese often keeps appending to a single buffer
      // ("皆さんこんにちは 今日も動画をご覧いただき... 今回の動画では...").
      // If we pass the entire 60+ char cumulative history into findBestMatchingSegment, words from 10 seconds ago
      // or shared vocabulary ("テレプロンプター", "撮影") will falsely match a paragraph 3-4 segments ahead!
      // Therefore:
      // 1) If we already advanced within this resultIndex, slice strictly after the advance point.
      // 2) Even if we haven't advanced in this resultIndex, cap the evaluated window to the length of the current segment (+12 chars margin).
      let effectiveTranscript = fullSpokenNorm;
      if (
        lastAdvanceSpokenLengthRef.current > 0 &&
        event.resultIndex === lastAdvanceResultIndexRef.current
      ) {
        const newlyAddedNormLen =
          fullSpokenNorm.length - lastAdvanceSpokenLengthRef.current;

        // Require at least 4 newly spoken normalized characters after an advance before evaluating again,
        // and enforce a 550ms minimum cooldown between consecutive advances.
        if (newlyAddedNormLen < 4 || timeSinceLastAdvance < 550) {
          setTimeout(() => {
            setSpeechStatus((prev) =>
              prev === 'matching' ? 'listening' : prev
            );
          }, 200);
          return;
        }

        effectiveTranscript = fullSpokenNorm.slice(
          lastAdvanceSpokenLengthRef.current
        );
      }

      const currentSegNormLen =
        segmentsRef.current[activeIndexRef.current]?.normalizedText.length || 35;
      const maxWindowChars = Math.max(36, currentSegNormLen + 10);
      if (effectiveTranscript.length > maxWindowChars) {
        effectiveTranscript = effectiveTranscript.slice(-maxWindowChars);
      }

      // Protect against ping-pong backtracking or residual double-advancing from the segment we just left
      const preventBacktrackToIndex =
        timeSinceLastAdvance < 6000 ? lastAdvancedFromIndexRef.current : null;

      const evaluation = findBestMatchingSegment(
        effectiveTranscript,
        segmentsRef.current,
        {
          currentIndex: activeIndexRef.current,
          sensitivity: settingsRef.current.trackingSensitivity,
          advanceTriggerRatio: settingsRef.current.advanceTriggerRatio,
          isFinal: event.isFinal,
          preventBacktrackToIndex,
          allowBacktrack: !settingsRef.current.forwardOnlyMode,
        }
      );

      setLastMatchResult(evaluation);

      if (
        evaluation.shouldAdvance &&
        evaluation.matchedSegmentIndex !== activeIndexRef.current
      ) {
        const prevIdx = activeIndexRef.current;
        activeIndexRef.current = evaluation.matchedSegmentIndex;
        setActiveSegmentIndex(evaluation.matchedSegmentIndex);
        scrollToSegment(evaluation.matchedSegmentIndex);

        if (evaluation.matchedSegmentIndex > prevIdx) {
          lastAdvancedFromIndexRef.current = prevIdx;
          lastAdvanceTimestampRef.current = now;
          lastAdvanceResultIndexRef.current = event.resultIndex;
          lastAdvanceSpokenLengthRef.current = fullSpokenNorm.length;
        } else {
          // Intentional backtrack reread
          lastAdvancedFromIndexRef.current = null;
          lastAdvanceSpokenLengthRef.current = 0;
        }
      }

      // Restore status badge to listening after brief matching indicator
      setTimeout(() => {
        setSpeechStatus((prev) => (prev === 'matching' ? 'listening' : prev));
      }, 260);
    },
    [scrollToSegment]
  );

  // Instantiate singleton SpeechRecognitionController once on mount (4.1 再描画で再起動しない)
  useEffect(() => {
    const controller = new SpeechRecognitionController({
      onStatusChange: (status) => setSpeechStatus(status),
      onTranscript: (ev) => processRecognizedSpeech(ev),
      onVolumeChange: (rms) => setMicVolumeLevel(rms),
      onError: (err) => {
        setSpeechError(err);
        if (err) {
          setIsPlaying(false);
        }
      },
    });
    speechControllerRef.current = controller;

    return () => {
      controller.destroy();
      speechControllerRef.current = null;
      if (smoothScrollRafRef.current) {
        cancelAnimationFrame(smoothScrollRafRef.current);
      }
    };
  }, [processRecognizedSpeech]);

  // Attach active camera stream to video preview elements whenever stream or preview mode changes
  const attachStreamToVideoElements = useCallback(
    (stream: MediaStream | null) => {
      if (pipVideoRef.current && pipVideoRef.current.srcObject !== stream) {
        pipVideoRef.current.srcObject = stream;
      }
      if (
        backdropVideoRef.current &&
        backdropVideoRef.current.srcObject !== stream
      ) {
        backdropVideoRef.current.srcObject = stream;
      }
    },
    []
  );

  useEffect(() => {
    attachStreamToVideoElements(cameraStreamRef.current);
  }, [settings.cameraPreviewMode, cameraStatus, attachStreamToVideoElements]);

  // Stop camera stream & release tracks cleanly
  const stopCameraStream = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== 'inactive'
    ) {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
    }
    mediaRecorderRef.current = null;

    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }
    attachStreamToVideoElements(null);
    setCameraStatus('off');
    setRecordingSeconds(0);
  }, [attachStreamToVideoElements]);

  // Refresh available video (MacBook / USB Smartphone) & audio (Mic) devices on mount and hot-plug
  const refreshMediaDevices = useCallback(async () => {
    const { videoDevices: vList, audioDevices: aList } =
      await listMediaInputDevices();
    setVideoDevices(vList);
    setAudioDevices(aList);
    return { vList, aList };
  }, []);

  useEffect(() => {
    refreshMediaDevices();
    if (
      typeof navigator !== 'undefined' &&
      navigator.mediaDevices &&
      navigator.mediaDevices.addEventListener
    ) {
      navigator.mediaDevices.addEventListener(
        'devicechange',
        refreshMediaDevices
      );
      return () => {
        navigator.mediaDevices.removeEventListener(
          'devicechange',
          refreshMediaDevices
        );
      };
    }
  }, [refreshMediaDevices]);

  // Start MacBook built-in / USB-connected Smartphone camera stream
  const startCameraStream = useCallback(
    async (
      overrideVideoDeviceId?: string,
      overrideAudioDeviceId?: string
    ): Promise<MediaStream | null> => {
      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
      ) {
        setCameraError(
          'お使いのブラウザではカメラ機能 (getUserMedia) が利用できません。'
        );
        setCameraStatus('error');
        return null;
      }

      setCameraError(null);
      setCameraStatus('initializing');

      try {
        if (cameraStreamRef.current) {
          cameraStreamRef.current.getTracks().forEach((t) => t.stop());
        }

        // Determine target video device (prefer user selection, or auto-detect USB smartphone if none selected)
        let targetVideoId =
          overrideVideoDeviceId !== undefined
            ? overrideVideoDeviceId
            : selectedDeviceId || settingsRef.current.preferredVideoDeviceId;

        const targetAudioId =
          overrideAudioDeviceId !== undefined
            ? overrideAudioDeviceId
            : selectedAudioDeviceId || settingsRef.current.preferredAudioDeviceId;

        const videoConstraints = buildVideoTrackConstraints({
          deviceId: targetVideoId || undefined,
          resolution: settingsRef.current.cameraResolution,
          aspectRatio: settingsRef.current.cameraAspectRatio,
        });

        const audioConstraints: MediaTrackConstraints = {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...(targetAudioId ? { deviceId: { ideal: targetAudioId } } : {}),
        };

        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: videoConstraints,
            audio: audioConstraints,
          });
        } catch {
          // Fallback: if USB UVC webcam rejects ideal resolution/aspectRatio or audio track fails, retry with relaxed video constraints
          stream = await navigator.mediaDevices.getUserMedia({
            video: targetVideoId ? { deviceId: { ideal: targetVideoId } } : true,
            audio: true,
          });
        }

        // After permission is granted, enumerate device labels so we can detect USB Smartphone cameras (Pixel / iPhone)
        const { vList, aList } = await refreshMediaDevices();

        // If no explicit video device was chosen and a USB smartphone camera is connected, automatically switch to it
        if (!targetVideoId && vList.length > 1) {
          const smartphoneCam = vList.find((d) => d.isSmartphoneOrExternal);
          const currentTrackId = stream
            .getVideoTracks()[0]
            ?.getSettings()?.deviceId;

          if (
            smartphoneCam &&
            smartphoneCam.deviceId &&
            smartphoneCam.deviceId !== currentTrackId
          ) {
            targetVideoId = smartphoneCam.deviceId;
            stream.getTracks().forEach((t) => t.stop());
            try {
              stream = await navigator.mediaDevices.getUserMedia({
                video: buildVideoTrackConstraints({
                  deviceId: targetVideoId,
                  resolution: settingsRef.current.cameraResolution,
                  aspectRatio: settingsRef.current.cameraAspectRatio,
                }),
                audio: audioConstraints,
              });
            } catch {
              stream = await navigator.mediaDevices.getUserMedia({
                video: { deviceId: { exact: targetVideoId } },
                audio: audioConstraints,
              });
            }
          }
        }

        cameraStreamRef.current = stream;
        setCameraStatus('ready');
        attachStreamToVideoElements(stream);

        const activeVideoTrack = stream.getVideoTracks()[0];
        const activeVideoId =
          activeVideoTrack?.getSettings()?.deviceId ||
          targetVideoId ||
          vList[0]?.deviceId ||
          '';
        setSelectedDeviceId(activeVideoId);

        const activeAudioTrack = stream.getAudioTracks()[0];
        const activeAudioId =
          activeAudioTrack?.getSettings()?.deviceId ||
          targetAudioId ||
          aList[0]?.deviceId ||
          '';
        setSelectedAudioDeviceId(activeAudioId);

        return stream;
      } catch (err) {
        const domErr = err as DOMException;
        setCameraStatus('error');
        if (
          domErr?.name === 'NotAllowedError' ||
          domErr?.name === 'PermissionDeniedError'
        ) {
          setCameraError(
            'カメラまたはマイクの権限が拒否されました。ブラウザのアドレスバー左側の設定、またはmacOSの「システム設定 ＞ プライバシーとセキュリティ ＞ カメラ」から許可してください。'
          );
        } else {
          setCameraError(
            '指定されたカメラまたはマイクを起動できませんでした。USB接続スマホが「ウェブカメラ (Webcam)」モードになっているか確認してください。'
          );
        }
        return null;
      }
    },
    [
      attachStreamToVideoElements,
      refreshMediaDevices,
      selectedAudioDeviceId,
      selectedDeviceId,
    ]
  );

  // Sync camera/audio selection and resolution changes made inside SettingsModal
  useEffect(() => {
    const nextVideoId = settings.preferredVideoDeviceId || '';
    const nextAudioId = settings.preferredAudioDeviceId || '';
    const videoChanged =
      nextVideoId !== '' && nextVideoId !== selectedDeviceId;
    const audioChanged =
      nextAudioId !== '' && nextAudioId !== selectedAudioDeviceId;

    if (videoChanged) {
      setSelectedDeviceId(nextVideoId);
    }
    if (audioChanged) {
      setSelectedAudioDeviceId(nextAudioId);
    }

    if (cameraStatus === 'ready' && (videoChanged || audioChanged)) {
      startCameraStream(
        nextVideoId || selectedDeviceId,
        nextAudioId || selectedAudioDeviceId
      );
    }
  }, [
    cameraStatus,
    selectedAudioDeviceId,
    selectedDeviceId,
    settings.preferredAudioDeviceId,
    settings.preferredVideoDeviceId,
    startCameraStream,
  ]);

  // Phase 6: Check storage estimate & detect unfinished crash-recovery sessions on mount
  useEffect(() => {
    let mounted = true;
    async function checkStorageAndRecovery() {
      const [est, unfinished] = await Promise.all([
        estimateBrowserStorage(),
        detectRecoverableSessions(),
      ]);
      if (!mounted) return;
      setStorageInfo(est);
      if (unfinished.length > 0) {
        setRecoverableSessions(unfinished);
      }
    }
    checkStorageAndRecovery();
    return () => {
      mounted = false;
    };
  }, []);

  // Phase 6 (8.8): Warn before unloading page during active recording & manage Wake Lock
  useEffect(() => {
    if (cameraStatus !== 'recording') {
      if (wakeLockSentinelRef.current) {
        wakeLockSentinelRef.current.release().catch(() => {});
        wakeLockSentinelRef.current = null;
      }
      return;
    }

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue =
        '現在カメラ録画中です。ページを離れると撮影が中断されます。';
      return e.returnValue;
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Request Screen Wake Lock if supported
    const navWithWakeLock = navigator as Navigator & {
      wakeLock?: {
        request: (
          type: 'screen'
        ) => Promise<{ release: () => Promise<void> }>;
      };
    };
    if (navWithWakeLock.wakeLock?.request) {
      navWithWakeLock.wakeLock
        .request('screen')
        .then((sentinel) => {
          wakeLockSentinelRef.current = sentinel;
        })
        .catch(() => {
          setWakeLockSupported(false);
        });
    } else {
      setWakeLockSupported(false);
    }

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (wakeLockSentinelRef.current) {
        wakeLockSentinelRef.current.release().catch(() => {});
        wakeLockSentinelRef.current = null;
      }
    };
  }, [cameraStatus]);

  // Recover a previous unfinished recording session from IndexedDB chunks
  const handleRecoverSession = useCallback(
    async (session: RecordingSessionMeta) => {
      setIsSavingRecording(true);
      try {
        const { blob, error } = await reconstructSessionVideoBlob(
          session.sessionId
        );
        if (!blob || error) {
          setCameraError(
            error || '録画データの復旧に失敗しました。データが不完全な可能性があります。'
          );
          return;
        }
        if (recordedClip?.url) {
          URL.revokeObjectURL(recordedClip.url);
        }
        const url = URL.createObjectURL(blob);
        setRecordedClip({
          url,
          blob,
          mimeType: session.mimeType || 'video/webm',
          extension: session.extension || 'webm',
          durationSec: Math.max(1, session.durationSec),
          createdAt: session.startedAt,
        });
        setActiveSessionMeta(session);
        setSessionMarkers(session.markers || []);
        setRecoverableSessions((prev) =>
          prev.filter((s) => s.sessionId !== session.sessionId)
        );
      } finally {
        setIsSavingRecording(false);
      }
    },
    [recordedClip?.url]
  );

  const handleDeleteRecoverableSession = useCallback(
    async (sessionId: string) => {
      await deleteRecordingSessionAndChunks(sessionId);
      setRecoverableSessions((prev) =>
        prev.filter((s) => s.sessionId !== sessionId)
      );
      setConfirmDeleteRecoveryId(null);
      const est = await estimateBrowserStorage();
      setStorageInfo(est);
    },
    []
  );

  // Cancel active recording start countdown (Phase 1 Section 3.3)
  const handleCancelCountdown = useCallback(() => {
    countdownControllerRef.current.cancel({
      onStep: setCountdownStep,
    });
    if (postRecordSilenceTimerRef.current) {
      clearTimeout(postRecordSilenceTimerRef.current);
      postRecordSilenceTimerRef.current = null;
    }
    setIsWaitingPostRecordSilence(false);
  }, []);

  // Start video recording on the MacBook / USB Smartphone camera with Countdown (Phase 1) & Progressive 5s Chunk Saving (Phase 6)
  const handleStartVideoRecording = useCallback(async () => {
    // Prevent duplicate countdown or duplicate recording start (Section 3.5)
    if (
      countdownControllerRef.current.isRunning() ||
      cameraStatus === 'recording'
    ) {
      return;
    }

    let stream = cameraStreamRef.current;
    if (!stream || cameraStatus === 'off' || cameraStatus === 'error') {
      stream = await startCameraStream();
    }
    if (!stream) return;

    // Verify camera & microphone tracks are alive before starting countdown (Section 3.3)
    const liveVideoTracks = stream
      .getVideoTracks()
      .filter((t) => t.readyState === 'live');
    if (liveVideoTracks.length === 0) {
      setCameraError(
        'カメラ映像ストリームが有効ではありません。カメラ接続を確認してください。'
      );
      return;
    }

    // Pre-recording storage check (8.7)
    const est = await estimateBrowserStorage();
    setStorageInfo(est);
    if (est.isLowStorageWarning) {
      setCameraError(
        `ブラウザの推定空き容量が少なくなっています（残り約 ${formatBytesHuman(
          est.availableBytes
        )}）。長時間録画では保存領域が不足する可能性があります。`
      );
    }

    const beginActualRecordingAfterCountdown = async () => {
      const currentStream = cameraStreamRef.current;
      if (
        !currentStream ||
        currentStream
          .getVideoTracks()
          .filter((t) => t.readyState === 'live').length === 0
      ) {
        setCameraError(
          'カウントダウン中にカメラ接続が失われたため、録画開始を中止しました。'
        );
        return;
      }

      // Monitor unexpected camera or microphone track disconnection during recording (8.8)
      currentStream.getVideoTracks().forEach((track) => {
        track.onended = () => {
          setCameraError(
            '⚠️ カメラの接続が切断されました（USBケーブル抜け等）。そこまでの録画データは自動保存されています。'
          );
          if (
            mediaRecorderRef.current &&
            mediaRecorderRef.current.state !== 'inactive'
          ) {
            mediaRecorderRef.current.stop();
          }
        };
      });
      currentStream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          setCameraError(
            '⚠️ マイクの接続が切断されました。音声入力を確認してください。'
          );
        };
      });

      // Clean up previous recorded blob URL if present
      if (recordedClip?.url) {
        URL.revokeObjectURL(recordedClip.url);
        setRecordedClip(null);
      }

      const { mimeType, extension } = selectSupportedVideoMimeType();
      const videoLabel =
        currentStream.getVideoTracks()[0]?.label ||
        videoDevices.find((d) => d.deviceId === selectedDeviceId)?.label ||
        'カメラ';
      const audioLabel =
        currentStream.getAudioTracks()[0]?.label ||
        audioDevices.find((a) => a.deviceId === selectedAudioDeviceId)?.label ||
        'マイク';

      const sessionWriter = new ProgressiveRecordingSessionWriter(
        {
          scriptId: script.id,
          scriptTitle: script.title,
          videoDeviceLabel: videoLabel,
          audioDeviceLabel: audioLabel,
          resolution: settingsRef.current.cameraResolution,
          aspectRatio: settingsRef.current.cameraAspectRatio,
          mimeType: mimeType || 'video/webm',
          extension,
        },
        {
          onProgress: (meta, pendingCount) => {
            setActiveSessionMeta(meta);
            setPendingChunkWrites(pendingCount);
          },
          onQueueBacklogWarning: (pendingCount) => {
            setPendingChunkWrites(pendingCount);
            setCameraError(
              `録画データのストレージ書き込みが遅延しています（待機チャンク: ${pendingCount}件）。タブを閉じずにお待ちください。`
            );
          },
          onWriteError: (msg) => {
            setCameraError(msg);
          },
        }
      );

      await sessionWriter.initializeSession();
      sessionWriterRef.current = sessionWriter;
      setActiveSessionMeta(sessionWriter.getMeta());
      setSessionMarkers([]);

      try {
        const recorder = mimeType
          ? new MediaRecorder(currentStream, { mimeType })
          : new MediaRecorder(currentStream);

        recorder.ondataavailable = (ev: BlobEvent) => {
          if (ev.data && ev.data.size > 0) {
            const elapsedSec = Math.max(
              1,
              Math.round((Date.now() - recordingStartMsRef.current) / 1000)
            );
            sessionWriter.enqueueChunk(ev.data, elapsedSec);
          }
        };

        // Section 3.3: Verify MediaRecorder actually entered 'recording' state via onstart before starting voice tracking
        recorder.onstart = () => {
          if (recorder.state !== 'recording') {
            setCameraError(
              '録画の開始状態を確認できませんでした。音声追従の単独起動を防止しました。'
            );
            return;
          }

          recordingStartMsRef.current = Date.now();
          setRecordingSeconds(0);
          setCameraStatus('recording');

          if (recordingTimerRef.current)
            clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = setInterval(() => {
            setRecordingSeconds(
              Math.floor((Date.now() - recordingStartMsRef.current) / 1000)
            );
          }, 500);

          // Automatically start teleprompter voice/constant scrolling after optional post-record silent wait (0-3s)
          if (settingsRef.current.autoStartPrompterOnRecord) {
            const silentWaitSec = Math.max(
              0,
              Math.min(3, settingsRef.current.postRecordSilentWaitSec ?? 0)
            );
            if (silentWaitSec > 0) {
              setIsWaitingPostRecordSilence(true);
              if (postRecordSilenceTimerRef.current) {
                clearTimeout(postRecordSilenceTimerRef.current);
              }
              postRecordSilenceTimerRef.current = setTimeout(() => {
                setIsWaitingPostRecordSilence(false);
                if (mediaRecorderRef.current?.state === 'recording') {
                  setIsPlaying(true);
                }
              }, silentWaitSec * 1000);
            } else {
              setIsPlaying(true);
            }
          }
        };

        recorder.onerror = () => {
          setIsWaitingPostRecordSilence(false);
          setCameraError(
            'MediaRecorderで録画エラーが発生しました。音声追従を停止しました。'
          );
          setIsPlaying(false);
        };

        recorder.onstop = async () => {
          if (postRecordSilenceTimerRef.current) {
            clearTimeout(postRecordSilenceTimerRef.current);
            postRecordSilenceTimerRef.current = null;
          }
          setIsWaitingPostRecordSilence(false);
          setIsSavingRecording(true);
          const durationSec = Math.max(
            1,
            Math.round((Date.now() - recordingStartMsRef.current) / 1000)
          );
          try {
            const finalMeta = await sessionWriter.finalizeSession(durationSec);
            setActiveSessionMeta(finalMeta);
            setPendingChunkWrites(0);

            const { blob } = await reconstructSessionVideoBlob(
              finalMeta.sessionId
            );
            if (blob) {
              const finalMime =
                recorder.mimeType || mimeType || 'video/webm';
              const url = URL.createObjectURL(blob);
              setRecordedClip({
                url,
                blob,
                mimeType: finalMime,
                extension: finalMime.includes('mp4') ? 'mp4' : extension,
                durationSec,
                createdAt: finalMeta.startedAt,
              });
            }
            const updatedEst = await estimateBrowserStorage();
            setStorageInfo(updatedEst);
          } finally {
            setIsSavingRecording(false);
            setCameraStatus(cameraStreamRef.current ? 'ready' : 'off');
          }
        };

        // Phase 6 (8.2): Use 5-second timeslice (5000ms) for progressive chunk saving without holding all video in RAM
        mediaRecorderRef.current = recorder;
        recorder.start(5000);
      } catch {
        setIsWaitingPostRecordSilence(false);
        setCameraError(
          '録画の開始に失敗しました。音声追従のみの開始を防止しました。'
        );
      }
    };

    countdownControllerRef.current.start(
      settingsRef.current.countdownSeconds ?? 3,
      {
        beepOnTick: Boolean(settingsRef.current.countdownBeepEnabled),
        beepOnRec: Boolean(settingsRef.current.recStartBeepEnabled),
      },
      {
        onStep: setCountdownStep,
        onComplete: beginActualRecordingAfterCountdown,
        onCancel: () => setCountdownStep(null),
      }
    );
  }, [
    audioDevices,
    cameraStatus,
    recordedClip,
    script.id,
    script.title,
    selectedAudioDeviceId,
    selectedDeviceId,
    startCameraStream,
    videoDevices,
  ]);

  // Stop video recording
  const handleStopVideoRecording = useCallback(() => {
    handleCancelCountdown();
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== 'inactive'
    ) {
      mediaRecorderRef.current.stop();
    }
    setIsPlaying(false);
  }, [handleCancelCountdown]);

  // Download recorded video clip to MacBook
  const handleDownloadRecordedVideo = useCallback(() => {
    if (!recordedClip) return;
    const safeTitle =
      script.title.trim().replace(/[\\/:*?"<>|]/g, '_') || 'voicesync_recording';
    const timestamp = new Date(recordedClip.createdAt)
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, '-');
    const a = document.createElement('a');
    a.href = recordedClip.url;
    a.download = `${safeTitle}_${timestamp}.${recordedClip.extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [recordedClip, script.title]);

  // Ensure camera & blob URLs are cleaned up on unmount
  useEffect(() => {
    const countdownCtrl = countdownControllerRef.current;
    return () => {
      countdownCtrl.cancel();
      if (postRecordSilenceTimerRef.current) {
        clearTimeout(postRecordSilenceTimerRef.current);
      }
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // Keep language & preferred audio device synchronized without recreating the controller
  useEffect(() => {
    speechControllerRef.current?.setLanguage(script.language);
  }, [script.language]);

  useEffect(() => {
    speechControllerRef.current?.setAudioDeviceId(
      selectedAudioDeviceId || settings.preferredAudioDeviceId
    );
  }, [selectedAudioDeviceId, settings.preferredAudioDeviceId]);

  // Monitor online/offline status & auto-switch to manual mode if offline (Section 9)
  useEffect(() => {
    const updateOnlineState = () => {
      const offline = !navigator.onLine;
      setIsOffline(offline);
      if (offline && scrollMode === 'voice') {
        speechControllerRef.current?.stop();
        setIsPlaying(false);
        setScrollMode('manual');
      }
    };
    updateOnlineState();
    window.addEventListener('online', updateOnlineState);
    window.addEventListener('offline', updateOnlineState);
    return () => {
      window.removeEventListener('online', updateOnlineState);
      window.removeEventListener('offline', updateOnlineState);
    };
  }, [scrollMode]);

  // Start / Stop SpeechRecognitionController when play state or scrollMode changes
  useEffect(() => {
    const controller = speechControllerRef.current;
    if (!controller) return;

    if (isPlaying && scrollMode === 'voice') {
      controller.start(
        script.language,
        selectedAudioDeviceId || settings.preferredAudioDeviceId
      );
    } else {
      controller.stop();
      if (!isPlaying) {
        setSpeechStatus((prev) => (prev === 'error' ? 'error' : 'paused'));
      } else {
        setSpeechStatus('idle');
      }
    }
  }, [
    isPlaying,
    scrollMode,
    script.language,
    selectedAudioDeviceId,
    settings.preferredAudioDeviceId,
  ]);

  // Auto-hide controls during active playback for distraction-free recording
  const resetControlsIdleTimer = useCallback(() => {
    setControlsVisible(true);
    if (hideControlsTimerRef.current) {
      clearTimeout(hideControlsTimerRef.current);
    }
    if (isPlaying && !speechError) {
      hideControlsTimerRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 3400);
    }
  }, [isPlaying, speechError]);

  useEffect(() => {
    resetControlsIdleTimer();
    return () => {
      if (hideControlsTimerRef.current) {
        clearTimeout(hideControlsTimerRef.current);
      }
    };
  }, [isPlaying, resetControlsIdleTimer]);

  // Compute which segment is closest to the reading guide line when scrolling manually or at constant speed
  const updateActiveSegmentFromScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || segments.length === 0) return;

    const readingAnchorY =
      container.scrollTop +
      (settings.readingLinePositionVh / 100) * container.clientHeight;

    let closestIdx = 0;
    let minDistance = Number.POSITIVE_INFINITY;

    for (let i = 0; i < segments.length; i++) {
      const el = segmentRefs.current[i];
      if (!el) continue;
      const center = el.offsetTop + el.offsetHeight / 2;
      const dist = Math.abs(center - readingAnchorY);
      if (dist < minDistance) {
        minDistance = dist;
        closestIdx = i;
      }
    }

    setActiveSegmentIndex((prev) => (prev !== closestIdx ? closestIdx : prev));
  }, [segments.length, settings.readingLinePositionVh]);

  // Constant speed scrolling loop via requestAnimationFrame
  useEffect(() => {
    if (!isPlaying || scrollMode !== 'constant') {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastFrameTimeRef.current = null;
      return;
    }

    const tick = (timestamp: number) => {
      if (lastFrameTimeRef.current === null) {
        lastFrameTimeRef.current = timestamp;
      }
      const deltaSec = (timestamp - lastFrameTimeRef.current) / 1000;
      lastFrameTimeRef.current = timestamp;

      const container = scrollContainerRef.current;
      if (container) {
        const maxScroll = container.scrollHeight - container.clientHeight;
        if (container.scrollTop < maxScroll - 1) {
          container.scrollTop += settings.constantScrollSpeed * deltaSec;
          updateActiveSegmentFromScroll();
        } else {
          setIsPlaying(false);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [
    isPlaying,
    scrollMode,
    settings.constantScrollSpeed,
    updateActiveSegmentFromScroll,
  ]);

  // Navigation Handlers (all synchronize internal speech matcher position per Section 5.4)
  const handleResetToTop = useCallback(() => {
    setIsPlaying(false);
    syncActiveSegmentPosition(0);
  }, [syncActiveSegmentPosition]);

  const handleJumpParagraph = useCallback(
    (direction: 'prev' | 'next') => {
      if (segments.length === 0) return;
      const currentParagraph =
        segments[activeSegmentIndex]?.paragraphIndex ?? 0;

      if (direction === 'next') {
        const nextSeg = segments.find(
          (s, idx) =>
            idx > activeSegmentIndex && s.paragraphIndex > currentParagraph
        );
        const targetIdx = nextSeg
          ? nextSeg.index
          : Math.min(segments.length - 1, activeSegmentIndex + 1);
        syncActiveSegmentPosition(targetIdx);
      } else {
        let targetParagraph = Math.max(0, currentParagraph - 1);
        const firstInCurrent = segments.find(
          (s) => s.paragraphIndex === currentParagraph
        );
        if (firstInCurrent && activeSegmentIndex > firstInCurrent.index) {
          targetParagraph = currentParagraph;
        }
        const prevSeg = segments.find(
          (s) => s.paragraphIndex === targetParagraph
        );
        const targetIdx = prevSeg
          ? prevSeg.index
          : Math.max(0, activeSegmentIndex - 1);
        syncActiveSegmentPosition(targetIdx);
      }
    },
    [activeSegmentIndex, segments, syncActiveSegmentPosition]
  );

  // Phase 3 (Section 5.2 & 5.3): Record an NG / Retake / Edit Note marker
  const handleRecordNGMarker = useCallback(
    (type: NGMarkerType = 'ng', customNote?: string) => {
      const elapsedSec =
        cameraStatus === 'recording' && recordingStartMsRef.current > 0
          ? computeElapsedVideoSeconds(recordingStartMsRef.current, Date.now())
          : recordingSeconds;

      const currentIdx = activeIndexRef.current;
      const currentSeg = segmentsRef.current[currentIdx];
      const sessionId =
        sessionWriterRef.current?.getSessionId() ||
        activeSessionMeta?.sessionId ||
        `session-${Date.now()}`;

      const marker = createNGMarkerItem({
        sessionId,
        elapsedSeconds: elapsedSec,
        scriptId: script.id,
        segment: currentSeg,
        activeSegmentIndex: currentIdx,
        type,
        note: customNote,
      });

      setSessionMarkers((prev) => {
        const next = [...prev, marker];
        sessionWriterRef.current?.updateMarkers(next);
        return next;
      });

      setLastMarkerToast(marker);
      setIsRetakeMenuOpen(true);
    },
    [activeSessionMeta?.sessionId, cameraStatus, recordingSeconds, script.id]
  );

  // Phase 3 (Section 5.4): Retake quick reposition with full internal speech matcher sync
  const handleRetakeJump = useCallback(
    (action: RetakeTargetAction) => {
      const targetIdx = resolveRetakeSegmentIndex(
        segmentsRef.current,
        activeIndexRef.current,
        action
      );
      syncActiveSegmentPosition(targetIdx);
    },
    [syncActiveSegmentPosition]
  );

  // Phase 3 (Section 5.5): Export markers as CSV or JSON
  const handleExportMarkers = useCallback(
    (format: 'csv' | 'json') => {
      if (sessionMarkers.length === 0) return;
      const content =
        format === 'csv'
          ? serializeMarkersToCSV(sessionMarkers)
          : serializeMarkersToJSON(sessionMarkers);
      const mime =
        format === 'csv'
          ? 'text/csv;charset=utf-8;'
          : 'application/json;charset=utf-8;';
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const safeTitle =
        script.title.trim().replace(/[\\/:*?"<>|]/g, '_') || 'voicesync';
      const dateStr = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeTitle}_markers_${dateStr}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    },
    [script.title, sessionMarkers]
  );

  // Fullscreen toggle
  const handleToggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch {
      // Ignore fullscreen permissions error on restricted webviews
    }
  }, []);

  // Keyboard shortcuts during Teleprompter Stage
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.querySelector('dialog[open]') ||
        document.activeElement?.tagName === 'INPUT'
      ) {
        return;
      }

      if (e.code === 'Escape' && countdownStep !== null) {
        e.preventDefault();
        handleCancelCountdown();
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying((prev) => !prev);
      } else if (e.code === 'KeyM' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        handleRecordNGMarker('ng');
      } else if (e.code === 'ArrowDown' || e.code === 'ArrowRight') {
        e.preventDefault();
        const nextIdx = Math.min(segments.length - 1, activeSegmentIndex + 1);
        syncActiveSegmentPosition(nextIdx);
      } else if (e.code === 'ArrowUp' || e.code === 'ArrowLeft') {
        e.preventDefault();
        const prevIdx = Math.max(0, activeSegmentIndex - 1);
        syncActiveSegmentPosition(prevIdx);
      } else if (e.code === 'Home') {
        e.preventDefault();
        handleResetToTop();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeSegmentIndex,
    countdownStep,
    handleCancelCountdown,
    handleRecordNGMarker,
    handleResetToTop,
    segments.length,
    syncActiveSegmentPosition,
  ]);

  const statusMeta = STATUS_LABELS[speechStatus];

  const mirrorTransform = [
    settings.mirrorHorizontal ? 'scaleX(-1)' : '',
    settings.mirrorVertical ? 'scaleY(-1)' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      onMouseMove={resetControlsIdleTimer}
      onTouchStart={resetControlsIdleTimer}
      style={{ backgroundColor: settings.backgroundColor }}
      className="relative flex h-screen w-screen flex-col overflow-hidden select-none"
    >
      {/* Top Status & Quick Action Bar */}
      <header
        className={`fixed top-0 right-0 left-0 z-30 flex items-center justify-between border-b border-white/10 bg-black/70 px-4 py-3 backdrop-blur-md transition-opacity duration-300 sm:px-6 ${
          controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (cameraStatus === 'recording') {
                const ok = window.confirm(
                  '現在カメラ録画中です。録画を停止して編集画面へ戻りますか？'
                );
                if (!ok) return;
                handleStopVideoRecording();
              }
              onExitStage();
            }}
            className="flex min-h-[42px] items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/90 px-3.5 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-800 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>編集へ戻る</span>
          </button>

          <div className="hidden sm:block">
            <h1 className="max-w-xs truncate text-xs font-semibold text-zinc-200">
              {script.title}
            </h1>
            <p className="text-[10px] text-zinc-400">
              フレーズ {activeSegmentIndex + 1} / {Math.max(1, segments.length)}
            </p>
          </div>
        </div>

        {/* Center Status Indicator Badge & Mic Level Meter (Section 8) */}
        <div className="flex items-center gap-2.5">
          {isOffline && (
            <div className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-[11px] font-medium text-amber-300">
              <WifiOff className="h-3.5 w-3.5" />
              <span>オフライン（手動モード動作中）</span>
            </div>
          )}

          <div
            className={`flex items-center gap-2.5 rounded-full border px-3.5 py-1.5 text-xs font-medium shadow-sm ${statusMeta.badgeClass}`}
          >
            <span className={`h-2 w-2 rounded-full ${statusMeta.dotClass}`} />
            <span>{statusMeta.label}</span>

            {/* Real-time Microphone Input Level Bar */}
            {scrollMode === 'voice' && isPlaying && (
              <div
                className="flex h-3 w-12 items-center overflow-hidden rounded-full bg-zinc-800 p-0.5"
                title="マイク入力レベル"
              >
                <div
                  style={{ width: `${Math.max(8, Math.round(micVolumeLevel * 100))}%` }}
                  className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-400 transition-all duration-75"
                />
              </div>
            )}
          </div>

          {/* Camera REC Timer Badge & Progressive Chunk Storage Status (Phase 6) */}
          {cameraStatus === 'recording' && (
            <div className="flex items-center gap-2 rounded-full border border-red-500/50 bg-red-500/20 px-3.5 py-1.5 text-xs font-bold text-red-200 shadow-lg">
              <span className="h-2.5 w-2.5 animate-ping rounded-full bg-red-500" />
              <span className="font-mono">
                REC {formatDurationTimer(recordingSeconds)}
              </span>
              {activeSessionMeta && (
                <span
                  className="hidden border-l border-red-400/30 pl-2 font-mono text-[10px] font-normal text-red-100/90 md:inline"
                  title="5秒ごとにIndexedDBへ自動分割保存中"
                >
                  保存済 {activeSessionMeta.chunkCount}塊 ({formatBytesHuman(activeSessionMeta.totalBytes)})
                  {pendingChunkWrites > 0 ? ` [書込待:${pendingChunkWrites}]` : ''}
                </span>
              )}
              {!wakeLockSupported && (
                <span
                  className="hidden text-[10px] font-normal text-amber-300 lg:inline"
                  title="お使いの環境ではスリープ防止APIが非対応のため、自動ロックをオフにしてください"
                >
                  ※スリープ注意
                </span>
              )}
            </div>
          )}

          {isSavingRecording && (
            <div className="flex items-center gap-1.5 rounded-full border border-sky-500/40 bg-sky-500/15 px-3 py-1 text-[11px] font-semibold text-sky-300">
              <HardDrive className="h-3.5 w-3.5 animate-pulse" />
              <span>録画データ保存処理中...</span>
            </div>
          )}

          {storageInfo?.isLowStorageWarning && (
            <div
              className="flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/15 px-2.5 py-1 text-[10px] font-semibold text-amber-300"
              title="設定画面から不要な録画セッションを削除できます"
            >
              <HardDrive className="h-3 w-3" />
              <span>容量残少 ({formatBytesHuman(storageInfo.availableBytes)})</span>
            </div>
          )}
        </div>

        {/* Right Quick Toggles */}
        <div className="flex items-center gap-2">
          {/* MacBook Camera Preview Toggle */}
          <button
            type="button"
            onClick={() => {
              if (cameraStatus === 'off' || cameraStatus === 'error') {
                startCameraStream();
              } else {
                stopCameraStream();
              }
            }}
            className={`flex min-h-[42px] items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition ${
              cameraStatus === 'ready' || cameraStatus === 'recording'
                ? 'border-rose-500/60 bg-rose-500/20 text-rose-300'
                : 'border-zinc-800 bg-zinc-900/90 text-zinc-400 hover:text-zinc-200'
            }`}
            title="MacBookカメラの起動 / 停止"
          >
            {cameraStatus === 'ready' || cameraStatus === 'recording' ? (
              <Video className="h-4 w-4" />
            ) : (
              <VideoOff className="h-4 w-4" />
            )}
            <span className="hidden xl:inline">
              {cameraStatus === 'off' || cameraStatus === 'error'
                ? 'カメラ起動'
                : 'カメラON'}
            </span>
          </button>

          {/* Switch Camera Preview Layout (PiP / Backdrop) when Camera is active */}
          {(cameraStatus === 'ready' || cameraStatus === 'recording') && (
            <button
              type="button"
              onClick={() =>
                onUpdateSettings({
                  cameraPreviewMode:
                    settings.cameraPreviewMode === 'pip'
                      ? 'backdrop'
                      : settings.cameraPreviewMode === 'backdrop'
                        ? 'hidden'
                        : 'pip',
                })
              }
              className="flex min-h-[42px] items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/90 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
              title="カメラプレビュー表示切替 (小窓 PiP / 背景透過 / 非表示)"
            >
              <Layers className="h-4 w-4 text-sky-400" />
              <span className="hidden lg:inline">
                {settings.cameraPreviewMode === 'pip'
                  ? '小窓表示'
                  : settings.cameraPreviewMode === 'backdrop'
                    ? '背景透過'
                    : '映像非表示'}
              </span>
            </button>
          )}
          {/* Font Size Quick Stepper */}
          <div className="hidden items-center rounded-xl border border-zinc-800 bg-zinc-900/90 p-1 lg:flex">
            <button
              type="button"
              onClick={() =>
                onUpdateSettings({
                  fontSize: Math.max(16, settings.fontSize - 4),
                })
              }
              className="rounded-lg p-1.5 text-zinc-300 hover:bg-zinc-800 hover:text-white"
              title="文字を小さく"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="px-2 font-mono text-xs text-zinc-200">
              {settings.fontSize}px
            </span>
            <button
              type="button"
              onClick={() =>
                onUpdateSettings({
                  fontSize: Math.min(100, settings.fontSize + 4),
                })
              }
              className="rounded-lg p-1.5 text-zinc-300 hover:bg-zinc-800 hover:text-white"
              title="文字を大きく"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={() =>
              onUpdateSettings({
                cameraEyelineMode: !settings.cameraEyelineMode,
              })
            }
            className={`flex min-h-[42px] items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition ${
              settings.cameraEyelineMode
                ? 'border-sky-500/60 bg-sky-500/20 text-sky-300'
                : 'border-zinc-800 bg-zinc-900/90 text-zinc-400 hover:text-zinc-200'
            }`}
            title="カメラ目線モード切替"
          >
            <Camera className="h-4 w-4" />
            <span className="hidden xl:inline">カメラ目線</span>
          </button>

          <button
            type="button"
            onClick={() =>
              onUpdateSettings({ focusMode: !settings.focusMode })
            }
            className={`flex min-h-[42px] items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition ${
              settings.focusMode
                ? 'border-sky-500/60 bg-sky-500/20 text-sky-300'
                : 'border-zinc-800 bg-zinc-900/90 text-zinc-400 hover:text-zinc-200'
            }`}
            title="フォーカスモード切替"
          >
            <Eye className="h-4 w-4" />
            <span className="hidden xl:inline">フォーカス</span>
          </button>

          <button
            type="button"
            onClick={() =>
              onUpdateSettings({
                showDebugOverlay: !settings.showDebugOverlay,
              })
            }
            className={`flex min-h-[42px] items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition ${
              settings.showDebugOverlay
                ? 'border-emerald-500/60 bg-emerald-500/20 text-emerald-300'
                : 'border-zinc-800 bg-zinc-900/90 text-zinc-400 hover:text-zinc-200'
            }`}
            title="音声認識デバッグ表示切替"
          >
            <Bug className="h-4 w-4" />
            <span className="hidden xl:inline">デバッグ</span>
          </button>

          <button
            type="button"
            onClick={handleToggleFullscreen}
            className="min-h-[42px] rounded-xl border border-zinc-800 bg-zinc-900/90 p-2.5 text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
            title="全画面表示切替"
          >
            {isFullscreen ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            className="min-h-[42px] rounded-xl border border-zinc-800 bg-zinc-900/90 p-2.5 text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
            title="設定画面を開く"
          >
            <Sliders className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Microphone Permission / Error Recovery Guide Banner (Section 8 & 12) */}
      {speechError && (
        <div className="fixed top-20 right-4 left-4 z-40 mx-auto max-w-2xl rounded-2xl border border-red-500/40 bg-zinc-950/95 p-5 text-zinc-100 shadow-2xl backdrop-blur-xl">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-red-500/20 p-2 text-red-400">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-red-300">
                  {speechError.title}
                </h3>
                <p className="mt-1 text-xs text-zinc-300">
                  {speechError.message}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSpeechError(null)}
              className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900/80 p-3.5">
            <p className="mb-2 text-xs font-semibold text-zinc-200">
              解決方法・復旧ステップ：
            </p>
            <ul className="list-inside list-decimal space-y-1.5 text-xs text-zinc-300">
              {speechError.recoverySteps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ul>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={() => {
                setSpeechError(null);
                setScrollMode('constant');
                setIsPlaying(true);
              }}
              className="rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-700"
            >
              一定速度スクロールで撮影を続行
            </button>
            <button
              type="button"
              onClick={() => {
                setSpeechError(null);
                setScrollMode('manual');
              }}
              className="rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-700"
            >
              手動モードへ切替
            </button>
            <button
              type="button"
              onClick={() => {
                setSpeechError(null);
                setIsPlaying(true);
              }}
              className="rounded-xl bg-sky-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-sky-400"
            >
              音声認識を再試行
            </button>
          </div>
        </div>
      )}

      {/* Camera Error Toast */}
      {cameraError && (
        <div className="fixed top-20 right-4 left-4 z-40 mx-auto flex max-w-xl items-center justify-between gap-3 rounded-2xl border border-rose-500/40 bg-zinc-950/95 px-4 py-3 text-xs text-rose-200 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
            <span>{cameraError}</span>
          </div>
          <button
            type="button"
            onClick={() => setCameraError(null)}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Phase 6 (8.5 & 8.6): Unfinished Recording Session Crash Recovery Prompt */}
      {recoverableSessions.length > 0 && cameraStatus !== 'recording' && (
        <div className="fixed top-20 right-4 left-4 z-40 mx-auto max-w-xl rounded-2xl border border-amber-500/50 bg-zinc-950/95 p-4 text-xs text-zinc-100 shadow-2xl backdrop-blur-xl">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <div className="rounded-xl bg-amber-500/20 p-2 text-amber-400">
                <HardDrive className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-amber-300">
                  前回の録画データが残っています。復旧しますか？
                </h3>
                <p className="mt-0.5 text-[11px] text-zinc-300">
                  異常終了または中断された録画セッション（{recoverableSessions.length}件）がIndexedDBに保存されています。
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setRecoverableSessions([])}
              className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
              title="後で確認する"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 max-h-40 space-y-2 overflow-y-auto">
            {recoverableSessions.map((sess) => (
              <div
                key={sess.sessionId}
                className="flex flex-col justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-900/90 p-3 sm:flex-row sm:items-center"
              >
                <div>
                  <p className="font-semibold text-zinc-100">
                    {sess.scriptTitle || '無題の原稿'}
                  </p>
                  <p className="mt-0.5 text-[10px] text-zinc-400">
                    {new Date(sess.startedAt).toLocaleString('ja-JP')} ・ 約
                    {formatDurationTimer(sess.durationSec)} ・ {sess.chunkCount}
                    チャンク ({formatBytesHuman(sess.totalBytes)})
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    disabled={isSavingRecording}
                    onClick={() => handleRecoverSession(sess)}
                    className="rounded-lg bg-amber-500 px-3 py-1.5 text-[11px] font-bold text-black transition hover:bg-amber-400 disabled:opacity-50"
                  >
                    復旧を試みる
                  </button>
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-[11px] font-medium text-zinc-200 transition hover:bg-zinc-700"
                  >
                    保存済みデータを確認する
                  </button>
                  {confirmDeleteRecoveryId === sess.sessionId ? (
                    <button
                      type="button"
                      onClick={() =>
                        handleDeleteRecoverableSession(sess.sessionId)
                      }
                      className="rounded-lg bg-rose-600 px-2.5 py-1.5 text-[11px] font-bold text-white transition hover:bg-rose-500"
                    >
                      本当に削除する
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmDeleteRecoveryId(sess.sessionId)
                      }
                      className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-[11px] font-medium text-rose-300 transition hover:bg-rose-500/20"
                    >
                      <Trash2 className="inline h-3 w-3" /> 削除する
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-2.5 flex justify-end">
            <button
              type="button"
              onClick={() => setRecoverableSessions([])}
              className="text-[11px] text-zinc-400 underline hover:text-zinc-200"
            >
              後で確認する（データを残して閉じる）
            </button>
          </div>
        </div>
      )}

      {/* Recorded Video Instant Preview, NG Marker Seek List & Download Banner (Phase 3 & Phase 6) */}
      {recordedClip && cameraStatus !== 'recording' && (
        <div className="fixed top-16 left-4 z-40 w-80 sm:w-96 rounded-2xl border border-white/15 bg-zinc-950/95 p-3.5 text-xs text-zinc-100 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
            <span className="font-semibold text-emerald-400">
              カメラ録画が完了しました ({formatDurationTimer(recordedClip.durationSec)})
            </span>
            <button
              type="button"
              onClick={() => {
                URL.revokeObjectURL(recordedClip.url);
                setRecordedClip(null);
              }}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
              title="閉じる"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <video
            ref={previewVideoRef}
            src={recordedClip.url}
            controls
            playsInline
            className="mt-2.5 aspect-video w-full rounded-xl bg-black object-cover"
          />

          {/* Phase 3 (Section 5.5): Post-Recording NG & Retake Marker List with Click-to-Seek */}
          {sessionMarkers.length > 0 && (
            <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900/80 p-2.5">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5">
                <span className="flex items-center gap-1 font-semibold text-amber-300">
                  <Flag className="h-3.5 w-3.5" />
                  <span>NG・編集マーカー ({sessionMarkers.length}件)</span>
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleExportMarkers('csv')}
                    className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] font-semibold text-sky-300 transition hover:bg-zinc-700"
                    title="CSV形式で書き出し"
                  >
                    CSV出力
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExportMarkers('json')}
                    className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] font-semibold text-sky-300 transition hover:bg-zinc-700"
                    title="JSON形式で書き出し"
                  >
                    JSON出力
                  </button>
                </div>
              </div>
              <div className="mt-1.5 max-h-36 space-y-1 overflow-y-auto pr-1">
                {sessionMarkers.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      if (previewVideoRef.current) {
                        previewVideoRef.current.currentTime = m.elapsedSeconds;
                        previewVideoRef.current.play().catch(() => {});
                      }
                      syncActiveSegmentPosition(m.segmentIndex);
                    }}
                    className="flex w-full items-start justify-between gap-2 rounded-lg border border-zinc-800/80 bg-zinc-950/80 px-2.5 py-1.5 text-left transition hover:border-amber-500/40 hover:bg-zinc-800/70"
                    title="クリックしてこの動画位置へジャンプ"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[10px] font-bold text-amber-400">
                          {m.timecode}
                        </span>
                        <span className="rounded bg-amber-500/20 px-1.5 py-0.2 text-[9px] font-semibold text-amber-200">
                          {NG_MARKER_TYPE_LABELS[m.type]}
                        </span>
                        <span className="text-[10px] text-zinc-400">
                          #{m.segmentIndex + 1}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[10px] text-zinc-300">
                        {m.segmentText || m.note}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadRecordedVideo}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-sky-500 py-2 text-xs font-bold text-white shadow transition hover:bg-sky-400"
            >
              <Download className="h-3.5 w-3.5" />
              動画を保存 (.{recordedClip.extension})
            </button>
          </div>
        </div>
      )}

      {/* Backdrop Camera Preview Mode (Full Stage Background behind text) */}
      {(cameraStatus === 'ready' || cameraStatus === 'recording') &&
        settings.cameraPreviewMode === 'backdrop' && (
          <video
            ref={backdropVideoRef}
            autoPlay
            muted
            playsInline
            style={{
              opacity: settings.cameraBackdropOpacity,
              transform: settings.cameraMirrorPreview ? 'scaleX(-1)' : undefined,
            }}
            className="pointer-events-none fixed inset-0 z-0 h-full w-full object-cover transition-opacity duration-300"
          />
        )}

      {/* Picture-in-Picture (PiP) Top-Center Camera Preview right below MacBook Webcam */}
      {(cameraStatus === 'ready' || cameraStatus === 'recording') &&
        settings.cameraPreviewMode === 'pip' && (
          <div className="fixed top-14 left-1/2 z-30 -translate-x-1/2 overflow-hidden rounded-2xl border border-white/20 bg-black/90 shadow-2xl">
            <video
              ref={pipVideoRef}
              autoPlay
              muted
              playsInline
              style={{
                transform: settings.cameraMirrorPreview
                  ? 'scaleX(-1)'
                  : undefined,
              }}
              className={
                settings.cameraAspectRatio === '9:16'
                  ? 'h-44 w-28 object-cover sm:h-52 sm:w-32'
                  : 'h-28 w-48 object-cover sm:h-32 sm:w-56'
              }
            />
            <div className="absolute right-1.5 bottom-1.5 left-1.5 flex flex-col gap-1 rounded-lg bg-black/75 px-2 py-1 text-[10px] text-zinc-200 backdrop-blur-sm">
              <div className="flex items-center justify-between gap-1">
                <span className="flex items-center gap-1 truncate font-medium">
                  <Smartphone className="h-3 w-3 shrink-0 text-rose-400" />
                  {cameraStatus === 'recording'
                    ? `REC ${formatDurationTimer(recordingSeconds)}`
                    : settings.cameraResolution.toUpperCase()}
                </span>
                {videoDevices.length > 0 && (
                  <select
                    value={selectedDeviceId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setSelectedDeviceId(nextId);
                      onUpdateSettings({ preferredVideoDeviceId: nextId });
                      startCameraStream(nextId, selectedAudioDeviceId);
                    }}
                    aria-label="カメラ切替 (MacBook / USBスマホ)"
                    className="max-w-[115px] truncate bg-transparent text-[10px] text-sky-300 focus:outline-none"
                  >
                    {videoDevices.map((d) => (
                      <option
                        key={d.deviceId}
                        value={d.deviceId}
                        className="bg-zinc-900 text-white"
                      >
                        {d.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {audioDevices.length > 0 && (
                <div className="flex items-center justify-between gap-1 border-t border-white/10 pt-0.5">
                  <span className="flex items-center gap-1 text-[9px] text-zinc-400">
                    <Mic className="h-2.5 w-2.5 text-emerald-400" />
                    マイク
                  </span>
                  <select
                    value={selectedAudioDeviceId}
                    onChange={(e) => {
                      const nextAudioId = e.target.value;
                      setSelectedAudioDeviceId(nextAudioId);
                      onUpdateSettings({ preferredAudioDeviceId: nextAudioId });
                      if (
                        cameraStatus === 'ready' ||
                        cameraStatus === 'recording'
                      ) {
                        startCameraStream(selectedDeviceId, nextAudioId);
                      }
                    }}
                    aria-label="マイク切替"
                    className="max-w-[115px] truncate bg-transparent text-[9px] text-emerald-300 focus:outline-none"
                  >
                    {audioDevices.map((a) => (
                      <option
                        key={a.deviceId}
                        value={a.deviceId}
                        className="bg-zinc-900 text-white"
                      >
                        {a.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
        )}

      {/* Main Prompter Stage Container (supports Camera Eyeline Mode) */}
      <div
        style={{
          marginTop: settings.cameraEyelineMode
            ? `${settings.eyelineTopOffsetVh}vh`
            : '0px',
          height: settings.cameraEyelineMode
            ? `${settings.eyelineHeightVh}vh`
            : '100vh',
          transform: mirrorTransform || undefined,
        }}
        className={`relative mx-auto w-full transition-all duration-300 ${
          settings.cameraEyelineMode
            ? 'rounded-b-3xl border-b border-white/15 shadow-2xl'
            : ''
        }`}
      >
        {/* Reading Position Guide Line */}
        {settings.showGuideLine && (
          <div
            style={{ top: `${settings.readingLinePositionVh}%` }}
            className="pointer-events-none absolute right-0 left-0 z-20 flex items-center"
          >
            <div className="h-2.5 w-2.5 rounded-r-full bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.9)]" />
            <div className="h-[1px] w-full bg-gradient-to-r from-sky-400/70 via-sky-400/25 to-sky-400/70" />
            <div className="h-2.5 w-2.5 rounded-l-full bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.9)]" />
          </div>
        )}

        {/* Phase 1 (Section 3.2): Recording Start Countdown Overlay (3 -> 2 -> 1 -> REC) */}
        {countdownStep !== null && (
          <div className="pointer-events-auto absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/45 backdrop-blur-[2px]">
            <div className="flex flex-col items-center rounded-3xl border border-white/20 bg-zinc-950/85 px-10 py-8 shadow-2xl">
              <span className="text-xs font-semibold tracking-widest text-zinc-400 uppercase">
                {countdownStep === 'REC'
                  ? '撮影スタート'
                  : 'まもなくカメラ録画を開始します'}
              </span>
              <div
                className={`mt-2 font-mono font-black tracking-tighter drop-shadow-[0_0_28px_rgba(244,63,94,0.65)] ${
                  countdownStep === 'REC'
                    ? 'text-6xl text-rose-500 sm:text-7xl'
                    : 'text-7xl text-white sm:text-8xl'
                }`}
              >
                {countdownStep === 'REC' ? '● REC' : countdownStep}
              </div>
              {typeof countdownStep === 'number' && (
                <button
                  type="button"
                  onClick={handleCancelCountdown}
                  className="mt-5 flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-800 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                  <span>カウントダウンをキャンセル (Esc)</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Post-record silent wait indicator badge */}
        {isWaitingPostRecordSilence && (
          <div className="pointer-events-none absolute top-4 left-1/2 z-30 -translate-x-1/2 rounded-full border border-amber-400/50 bg-zinc-950/90 px-4 py-1.5 text-xs font-semibold text-amber-300 shadow-lg">
            録画開始後の無音待機中（{settings.postRecordSilentWaitSec}秒後に音声追従を開始します）...
          </div>
        )}

        {/* Scrollable Script Viewport */}
        <div
          ref={scrollContainerRef}
          onScroll={() => {
            if (!programmaticScrollRef.current && scrollMode === 'manual') {
              updateActiveSegmentFromScroll();
            }
          }}
          style={{
            paddingTop: settings.cameraEyelineMode
              ? `${Math.max(1, (settings.eyelineHeightVh * settings.readingLinePositionVh) / 100)}vh`
              : `${Math.min(settings.marginVerticalVh, settings.readingLinePositionVh)}vh`,
            paddingBottom: `${Math.max(48, settings.marginVerticalVh)}vh`,
            paddingLeft: `${settings.marginHorizontalPx}px`,
            paddingRight: `${settings.marginHorizontalPx}px`,
          }}
          className="h-full w-full overflow-y-auto"
        >
          <div
            style={{
              width: `${settings.contentWidthPercent}%`,
              fontSize: `${settings.fontSize}px`,
              lineHeight: settings.lineHeight,
              color: settings.textColor,
              textAlign: settings.textAlign,
            }}
            className="mx-auto space-y-6 font-medium tracking-wide"
          >
            {segments.map((seg, idx) => {
              const isCurrent = idx === activeSegmentIndex;
              const isNewParagraph =
                idx > 0 &&
                segments[idx - 1].paragraphIndex !== seg.paragraphIndex;

              const opacity = settings.focusMode
                ? isCurrent
                  ? 1
                  : settings.dimOpacity
                : 1;

              return (
                <div
                  key={seg.id}
                  ref={(el) => {
                    segmentRefs.current[idx] = el;
                  }}
                  onClick={() => {
                    syncActiveSegmentPosition(idx);
                  }}
                  style={{ opacity }}
                  className={`cursor-pointer rounded-2xl px-4 py-2 transition-opacity duration-200 ${
                    isNewParagraph ? 'mt-10' : ''
                  } ${
                    isCurrent
                      ? 'bg-white/[0.04] ring-1 ring-sky-400/25'
                      : 'hover:opacity-75'
                  }`}
                >
                  {seg.text}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Speech Recognition Live Debug Overlay & Simulator (Section 8 & Phase 2/3) */}
      {settings.showDebugOverlay && (
        <aside className="fixed right-4 bottom-24 z-30 w-full max-w-md rounded-2xl border border-white/15 bg-zinc-950/90 p-3.5 text-xs text-zinc-200 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
            <div className="flex items-center gap-1.5 font-semibold text-emerald-400">
              <Bug className="h-3.5 w-3.5" />
              <span>リアルタイム音声認識・照合デバッグ</span>
            </div>
            <span className="font-mono text-[10px] text-zinc-400">
              {script.language} | 感度 {Math.round(settings.trackingSensitivity * 100)}% | 先行送り {Math.round(settings.advanceTriggerRatio * 100)}%
            </span>
          </div>

          <div className="mt-2.5 space-y-2">
            <div className="rounded-xl bg-zinc-900/90 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] text-zinc-400">
                <span>最新認識 ({isInterimTranscript ? '途中 interim' : '確定 final'})</span>
                {lastMatchResult && (
                  <span className="font-mono text-sky-400">
                    類似度 {Math.round(lastMatchResult.similarityScore * 100)}% | フレーズ進捗 {Math.round(lastMatchResult.progressRatio * 100)}% ({lastMatchResult.reason})
                  </span>
                )}
              </div>
              <p className="mt-1 truncate font-medium text-white">
                {latestTranscript || '（マイクに向かって原稿を読み上げてください）'}
              </p>
            </div>

            {/* Interactive Utterance Simulator for testing matching without speaking */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!simulationInput.trim()) return;
                processRecognizedSpeech({
                  transcript: simulationInput.trim(),
                  isFinal: true,
                  resultIndex: Date.now(),
                  confidence: 0.95,
                  timestamp: Date.now(),
                });
                setSimulationInput('');
              }}
              className="flex items-center gap-1.5"
            >
              <input
                type="text"
                value={simulationInput}
                onChange={(e) => setSimulationInput(e.target.value)}
                placeholder="発話シミュレート入力（テスト用）..."
                className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-sky-500 focus:outline-none"
              />
              <button
                type="submit"
                className=" flex items-center gap-1 rounded-lg bg-zinc-800 px-2.5 py-1.5 text-[11px] font-semibold text-sky-300 transition hover:bg-zinc-700"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                照合テスト
              </button>
            </form>
          </div>
        </aside>
      )}

      {/* Bottom Floating Recording Control Dock (Section 7: Large touch-friendly controls) */}
      <footer
        className={`fixed right-0 bottom-5 left-0 z-30 mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-3 px-4 transition-opacity duration-300 ${
          controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/15 bg-zinc-950/90 p-2.5 shadow-2xl backdrop-blur-xl">
          {/* Scroll Mode Selector */}
          <div className="flex items-center rounded-xl bg-zinc-900 p-1">
            <button
              type="button"
              onClick={() => setScrollMode('voice')}
              className={`flex min-h-[42px] items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
                scrollMode === 'voice'
                  ? 'bg-sky-500 text-white shadow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="音声追従モード"
            >
              <Mic className="h-4 w-4" />
              <span>音声追従</span>
            </button>
            <button
              type="button"
              onClick={() => setScrollMode('constant')}
              className={`flex min-h-[42px] items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
                scrollMode === 'constant'
                  ? 'bg-sky-500 text-white shadow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="一定速度スクロールモード"
            >
              <Gauge className="h-4 w-4" />
              <span>一定速度</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setScrollMode('manual');
                setIsPlaying(false);
              }}
              className={`flex min-h-[42px] items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
                scrollMode === 'manual'
                  ? 'bg-sky-500 text-white shadow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="手動スクロールモード"
            >
              <Hand className="h-4 w-4" />
              <span>手動</span>
            </button>
          </div>

          <div className="h-6 w-[1px] bg-zinc-800" />

          {/* Reset & Paragraph Navigation */}
          <button
            type="button"
            onClick={handleResetToTop}
            className="flex min-h-[44px] items-center gap-1 rounded-xl bg-zinc-900 px-3.5 py-2.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 active:scale-95"
            title="原稿先頭へ戻る (Home)"
          >
            <RotateCcw className="h-4 w-4" />
            <span className="hidden sm:inline">先頭へ</span>
          </button>

          <button
            type="button"
            onClick={() => handleJumpParagraph('prev')}
            className="flex min-h-[44px] items-center gap-1 rounded-xl bg-zinc-900 px-3.5 py-2.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 active:scale-95"
            title="前の段落へ移動"
          >
            <SkipBack className="h-4 w-4" />
            <span className="hidden sm:inline">前段落</span>
          </button>

          {/* Primary Play / Pause Button */}
          <button
            type="button"
            onClick={() => setIsPlaying((prev) => !prev)}
            className={`flex min-h-[44px] min-w-[144px] items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white shadow-lg transition active:scale-95 ${
              isPlaying
                ? 'bg-amber-500 text-black hover:bg-amber-400'
                : 'bg-sky-500 hover:bg-sky-400'
            }`}
          >
            {isPlaying ? (
              <>
                <Pause className="h-4 w-4 fill-current" />
                <span>一時停止</span>
              </>
            ) : (
              <>
                <Play className="h-4 w-4 fill-current" />
                <span>
                  {scrollMode === 'voice' ? '音声認識開始' : '再開 / 開始'}
                </span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleJumpParagraph('next')}
            className="flex min-h-[44px] items-center gap-1 rounded-xl bg-zinc-900 px-3.5 py-2.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 active:scale-95"
            title="次の段落へ移動"
          >
            <span className="hidden sm:inline">次段落</span>
            <SkipForward className="h-4 w-4" />
          </button>

          <div className="h-6 w-[1px] bg-zinc-800" />

          {/* MacBook Camera Video Record / Stop Button */}
          {cameraStatus === 'recording' ? (
            <button
              type="button"
              onClick={handleStopVideoRecording}
              className="flex min-h-[44px] items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-rose-600/30 transition hover:bg-rose-500 active:scale-95"
              title="カメラ録画を停止して動画ファイルを生成"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              <span>録画停止 ({formatDurationTimer(recordingSeconds)})</span>
            </button>
          ) : typeof countdownStep === 'number' ? (
            <button
              type="button"
              onClick={handleCancelCountdown}
              className="flex min-h-[44px] items-center gap-2 rounded-xl border border-amber-500/60 bg-amber-500/20 px-4 py-2.5 text-xs font-bold text-amber-200 transition hover:bg-amber-500/30 active:scale-95"
              title="カウントダウンをキャンセル"
            >
              <X className="h-3.5 w-3.5" />
              <span>開始キャンセル ({countdownStep}秒)</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStartVideoRecording}
              className="flex min-h-[44px] items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/15 px-4 py-2.5 text-xs font-bold text-rose-200 transition hover:bg-rose-500/25 active:scale-95"
              title="MacBookカメラで動画撮影を開始（プロンプター連動）"
            >
              <Circle className="h-3.5 w-3.5 fill-rose-500 text-rose-500" />
              <span>
                カメラ録画開始
                {settings.countdownSeconds > 0
                  ? ` (${settings.countdownSeconds}秒)`
                  : ''}
              </span>
            </button>
          )}

          {/* Phase 3 (Section 5.3 & 5.4): NG / Retake Marker Button & Retake Assist Popover */}
          <div className="relative flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => handleRecordNGMarker('ng')}
              className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-amber-500/50 bg-amber-500/15 px-3.5 py-2.5 text-xs font-bold text-amber-200 transition hover:bg-amber-500/25 active:scale-95"
              title="言い間違い・撮り直し位置にNGマーカーを記録 (ショートカット: Mキー)"
            >
              <Flag className="h-3.5 w-3.5 text-amber-400" />
              <span>NG記録</span>
              {sessionMarkers.length > 0 && (
                <span className="rounded-full bg-amber-500 px-1.5 py-0.2 text-[10px] font-black text-black">
                  {sessionMarkers.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setIsRetakeMenuOpen((prev) => !prev)}
              className={`min-h-[44px] rounded-xl border px-2.5 py-2.5 text-xs font-semibold transition ${
                isRetakeMenuOpen
                  ? 'border-amber-400 bg-amber-500/25 text-amber-200'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
              }`}
              title="撮り直し再開メニューを開く / 閉じる"
            >
              撮り直し支援
            </button>

            {isRetakeMenuOpen && (
              <div className=" absolute bottom-14 left-1/2 z-40 w-80 -translate-x-1/2 rounded-2xl border border-amber-500/40 bg-zinc-950/95 p-3.5 text-xs text-zinc-100 shadow-2xl backdrop-blur-xl">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                  <span className="flex items-center gap-1.5 font-bold text-amber-300">
                    <Flag className="h-3.5 w-3.5" />
                    <span>NG・撮り直し支援パネル</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsRetakeMenuOpen(false)}
                    className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                {lastMarkerToast && (
                  <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">
                    記録済: [{lastMarkerToast.timecode}]{' '}
                    {NG_MARKER_TYPE_LABELS[lastMarkerToast.type]} (フレーズ #
                    {lastMarkerToast.segmentIndex + 1})
                  </div>
                )}

                <div className="mt-2.5">
                  <span className="block text-[10px] font-semibold text-zinc-400">
                    1. 撮り直し開始位置へジャンプ（音声追従位置も自動同期）：
                  </span>
                  <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleRetakeJump('current-phrase')}
                      className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-left text-[11px] font-medium text-zinc-200 transition hover:border-sky-500/50 hover:bg-zinc-800"
                    >
                      現在フレーズから再開
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRetakeJump('prev-phrase')}
                      className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-left text-[11px] font-medium text-zinc-200 transition hover:border-sky-500/50 hover:bg-zinc-800"
                    >
                      1フレーズ戻る
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleRetakeJump('current-paragraph-start')
                      }
                      className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-left text-[11px] font-medium text-zinc-200 transition hover:border-sky-500/50 hover:bg-zinc-800"
                    >
                      現在段落の先頭へ戻る
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleRetakeJump('prev-heading-or-section')
                      }
                      className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-left text-[11px] font-medium text-zinc-200 transition hover:border-sky-500/50 hover:bg-zinc-800"
                    >
                      前の見出し・章へ戻る
                    </button>
                  </div>
                </div>

                <div className="mt-3 border-t border-zinc-800 pt-2.5">
                  <span className="block text-[10px] font-semibold text-zinc-400">
                    2. マーカー種別の追加記録：
                  </span>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {(
                      [
                        { type: 'retake-start', label: '撮り直し開始' },
                        { type: 'retake-complete', label: '撮り直し完了' },
                        { type: 'edit-note', label: '編集メモ' },
                      ] as const
                    ).map((btn) => (
                      <button
                        key={btn.type}
                        type="button"
                        onClick={() =>
                          handleRecordNGMarker(
                            btn.type,
                            customMarkerNote.trim() || undefined
                          )
                        }
                        className="rounded-lg bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-amber-200 transition hover:bg-zinc-700"
                      >
                        + {btn.label}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={customMarkerNote}
                    onChange={(e) => setCustomMarkerNote(e.target.value)}
                    placeholder="任意の編集メモ（例: カメラ目線やり直し）"
                    className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] text-zinc-100 placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
                  />
                </div>

                {sessionMarkers.length > 0 && (
                  <div className="mt-2.5 flex items-center justify-between border-t border-zinc-800 pt-2">
                    <span className="text-[10px] text-zinc-400">
                      記録済マーカー: {sessionMarkers.length}件
                    </span>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleExportMarkers('csv')}
                        className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-sky-300 hover:bg-zinc-700"
                      >
                        CSV保存
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExportMarkers('json')}
                        className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-sky-300 hover:bg-zinc-700"
                      >
                        JSON保存
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Speed Slider when in Constant Speed Mode */}
          {scrollMode === 'constant' && (
            <>
              <div className="h-6 w-[1px] bg-zinc-800" />
              <div className="flex items-center gap-2 px-2">
                <span className="text-[11px] text-zinc-400">速度</span>
                <input
                  type="range"
                  min={15}
                  max={220}
                  step={5}
                  value={settings.constantScrollSpeed}
                  onChange={(e) =>
                    onUpdateSettings({
                      constantScrollSpeed: Number(e.target.value),
                    })
                  }
                  className="w-24 accent-sky-500"
                />
                <span className="w-12 font-mono text-xs text-sky-400">
                  {settings.constantScrollSpeed}px/s
                </span>
              </div>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}
