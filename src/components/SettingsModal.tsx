'use client';

import React, { useEffect, useRef, useState } from 'react';
import { PrompterSettings, DEFAULT_PROMPTER_SETTINGS } from '@/types/prompter';
import {
  CameraDeviceOption,
  AudioDeviceOption,
  listMediaInputDevices,
} from '@/lib/cameraRecorder';
import {
  X,
  RotateCcw,
  Eye,
  Type,
  Sliders,
  Camera,
  FlipHorizontal,
  FlipVertical,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Video,
  Smartphone,
  Mic,
  RefreshCw,
} from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: PrompterSettings;
  onUpdateSettings: (partial: Partial<PrompterSettings>) => void;
  onResetSettings: () => void;
}

export function SettingsModal({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  onResetSettings,
}: SettingsModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [videoDevices, setVideoDevices] = useState<CameraDeviceOption[]>([]);
  const [audioDevices, setAudioDevices] = useState<AudioDeviceOption[]>([]);
  const [isScanningDevices, setIsScanningDevices] = useState<boolean>(false);

  const handleScanDevices = async (requestPermission = false) => {
    setIsScanningDevices(true);
    try {
      let { videoDevices: vList, audioDevices: aList } =
        await listMediaInputDevices();

      const needsPermissionForLabels =
        vList.length === 0 ||
        vList.some((d) => !d.deviceId || /^カメラ \d+$/.test(d.label));

      if (
        (requestPermission || needsPermissionForLabels) &&
        typeof navigator !== 'undefined' &&
        navigator.mediaDevices?.getUserMedia
      ) {
        try {
          const tempStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true,
          });
          tempStream.getTracks().forEach((t) => t.stop());
        } catch {
          // Try video-only if audio permission fails or has no mic
          try {
            const videoOnlyStream = await navigator.mediaDevices.getUserMedia({
              video: true,
            });
            videoOnlyStream.getTracks().forEach((t) => t.stop());
          } catch {
            // Ignore if user declined permission
          }
        }
        const refreshed = await listMediaInputDevices();
        vList = refreshed.videoDevices;
        aList = refreshed.audioDevices;
      }

      setVideoDevices(vList);
      setAudioDevices(aList);
    } catch {
      // Ignore permission cancel during scan
    } finally {
      setIsScanningDevices(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      handleScanDevices(false);
    }
  }, [isOpen]);

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

    const handleClose = () => {
      onClose();
    };
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

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: 'any' } as React.DialogHTMLAttributes<HTMLDialogElement>)}
      aria-labelledby="prompter-settings-title"
      className="m-auto w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-950/95 p-0 text-zinc-100 shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    >
      <div className="flex max-h-[85vh] flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800/80 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <Sliders className="h-5 w-5 text-sky-400" />
            <h2
              id="prompter-settings-title"
              className="text-lg font-semibold tracking-tight"
            >
              プロンプター表示・追従設定
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onResetSettings}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
              title="初期設定に戻す"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              初期値に戻す
            </button>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              aria-label="設定を閉じる"
              className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className=" space-y-8 overflow-y-auto px-6 py-6">
          {/* Section 1: 文字とレイアウト設定 */}
          <section className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-sky-400">
              <Type className="h-4 w-4" />
              <span>文字・レイアウト設定</span>
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              {/* 文字サイズ: 16〜100px */}
              <div className="space-y-2 rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-4">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-zinc-300">文字サイズ</span>
                  <span className="font-mono text-sky-400">
                    {settings.fontSize}px
                  </span>
                </div>
                <input
                  type="range"
                  min={16}
                  max={100}
                  step={1}
                  value={settings.fontSize}
                  onChange={(e) =>
                    onUpdateSettings({ fontSize: Number(e.target.value) })
                  }
                  className="w-full accent-sky-500"
                />
                <div className="flex justify-between text-[10px] text-zinc-500">
                  <span>16px (小)</span>
                  <span>56px (標準)</span>
                  <span>100px (特大)</span>
                </div>
              </div>

              {/* 行間: 1.2〜2.5 */}
              <div className="space-y-2 rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-4">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-zinc-300">行間 (Line Height)</span>
                  <span className="font-mono text-sky-400">
                    {settings.lineHeight.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min={1.2}
                  max={2.5}
                  step={0.05}
                  value={settings.lineHeight}
                  onChange={(e) =>
                    onUpdateSettings({ lineHeight: Number(e.target.value) })
                  }
                  className="w-full accent-sky-500"
                />
                <div className="flex justify-between text-[10px] text-zinc-500">
                  <span>1.2 (狭め)</span>
                  <span>1.65 (標準)</span>
                  <span>2.5 (広め)</span>
                </div>
              </div>

              {/* 表示領域の幅: 30〜100% */}
              <div className="space-y-2 rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-4">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-zinc-300">文字表示領域の幅</span>
                  <span className="font-mono text-sky-400">
                    {settings.contentWidthPercent}%
                  </span>
                </div>
                <input
                  type="range"
                  min={30}
                  max={100}
                  step={2}
                  value={settings.contentWidthPercent}
                  onChange={(e) =>
                    onUpdateSettings({
                      contentWidthPercent: Number(e.target.value),
                    })
                  }
                  className="w-full accent-sky-500"
                />
                <div className="flex justify-between text-[10px] text-zinc-500">
                  <span>30% (視線移動最小)</span>
                  <span>80% (標準)</span>
                  <span>100% (全幅)</span>
                </div>
              </div>

              {/* 左右余白: 0〜200px */}
              <div className="space-y-2 rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-4">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-zinc-300">左右余白 (Padding)</span>
                  <span className="font-mono text-sky-400">
                    {settings.marginHorizontalPx}px
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={4}
                  value={settings.marginHorizontalPx}
                  onChange={(e) =>
                    onUpdateSettings({
                      marginHorizontalPx: Number(e.target.value),
                    })
                  }
                  className="w-full accent-sky-500"
                />
              </div>

              {/* 上下余白: 10〜50vh */}
              <div className="space-y-2 rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-4">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-zinc-300">上下余白</span>
                  <span className="font-mono text-sky-400">
                    {settings.marginVerticalVh}vh
                  </span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={50}
                  step={2}
                  value={settings.marginVerticalVh}
                  onChange={(e) =>
                    onUpdateSettings({
                      marginVerticalVh: Number(e.target.value),
                    })
                  }
                  className="w-full accent-sky-500"
                />
              </div>

              {/* テキスト揃え & 反転 */}
              <div className="space-y-3 rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-4">
                <span className="block text-xs font-medium text-zinc-300">
                  文字揃え・反転表示
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ textAlign: 'left' })}
                    className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                      settings.textAlign === 'left'
                        ? 'bg-sky-500 text-white'
                        : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <AlignLeft className="h-3.5 w-3.5" /> 左揃え
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ textAlign: 'center' })}
                    className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                      settings.textAlign === 'center'
                        ? 'bg-sky-500 text-white'
                        : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <AlignCenter className="h-3.5 w-3.5" /> 中央
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ textAlign: 'right' })}
                    className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                      settings.textAlign === 'right'
                        ? 'bg-sky-500 text-white'
                        : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <AlignRight className="h-3.5 w-3.5" /> 右揃え
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateSettings({
                        mirrorHorizontal: !settings.mirrorHorizontal,
                      })
                    }
                    className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                      settings.mirrorHorizontal
                        ? 'bg-amber-500 text-black'
                        : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <FlipHorizontal className="h-3.5 w-3.5" /> 左右反転
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateSettings({
                        mirrorVertical: !settings.mirrorVertical,
                      })
                    }
                    className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                      settings.mirrorVertical
                        ? 'bg-amber-500 text-black'
                        : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <FlipVertical className="h-3.5 w-3.5" /> 上下反転
                  </button>
                </div>
              </div>
            </div>

            {/* 文字色・背景色 */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex items-center justify-between rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-3.5">
                <span className="text-xs font-medium text-zinc-300">文字色</span>
                <div className="flex items-center gap-2">
                  {[
                    { label: '白', color: '#F8FAFC' },
                    { label: '黄', color: '#FDE047' },
                    { label: '水色', color: '#7DD3FC' },
                    { label: '緑', color: '#86EFAC' },
                  ].map((preset) => (
                    <button
                      key={preset.color}
                      type="button"
                      onClick={() =>
                        onUpdateSettings({ textColor: preset.color })
                      }
                      className={`h-6 w-6 rounded-full border ${
                        settings.textColor.toLowerCase() ===
                        preset.color.toLowerCase()
                          ? 'scale-110 border-sky-400 ring-2 ring-sky-400/40'
                          : 'border-zinc-700'
                      }`}
                      style={{ backgroundColor: preset.color }}
                      title={preset.label}
                    />
                  ))}
                  <input
                    type="color"
                    value={settings.textColor}
                    onChange={(e) =>
                      onUpdateSettings({ textColor: e.target.value })
                    }
                    className="h-7 w-8 cursor-pointer rounded border-0 bg-transparent"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-3.5">
                <span className="text-xs font-medium text-zinc-300">背景色</span>
                <div className="flex items-center gap-2">
                  {[
                    { label: 'ピュアブラック', color: '#050507' },
                    { label: 'ダークグレー', color: '#18181B' },
                    { label: 'ネイビー', color: '#0B1120' },
                  ].map((preset) => (
                    <button
                      key={preset.color}
                      type="button"
                      onClick={() =>
                        onUpdateSettings({ backgroundColor: preset.color })
                      }
                      className={`h-6 w-6 rounded-full border ${
                        settings.backgroundColor.toLowerCase() ===
                        preset.color.toLowerCase()
                          ? 'scale-110 border-sky-400 ring-2 ring-sky-400/40'
                          : 'border-zinc-600'
                      }`}
                      style={{ backgroundColor: preset.color }}
                      title={preset.label}
                    />
                  ))}
                  <input
                    type="color"
                    value={settings.backgroundColor}
                    onChange={(e) =>
                      onUpdateSettings({ backgroundColor: e.target.value })
                    }
                    className="h-7 w-8 cursor-pointer rounded border-0 bg-transparent"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Section 2: カメラ目線モード & フォーカスモード */}
          <section className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-sky-400">
              <Camera className="h-4 w-4" />
              <span>カメラ目線モード・フォーカスモード</span>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* カメラ目線モード */}
              <div className="space-y-3 rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="block text-xs font-semibold text-zinc-200">
                      カメラ目線モード (MacBook上部配置)
                    </span>
                    <span className="text-[11px] text-zinc-400">
                      内蔵カメラ直下に表示領域を限定し視線移動を最小化
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.cameraEyelineMode}
                    onChange={(e) =>
                      onUpdateSettings({ cameraEyelineMode: e.target.checked })
                    }
                    className="h-4 w-4 accent-sky-500"
                  />
                </div>

                {settings.cameraEyelineMode && (
                  <div className="space-y-3 border-t border-zinc-800 pt-3">
                    <div>
                      <div className="flex justify-between text-xs">
                        <span className="text-zinc-400">表示領域の高さ</span>
                        <span className="font-mono text-sky-400">
                          {settings.eyelineHeightVh}vh
                        </span>
                      </div>
                      <input
                        type="range"
                        min={20}
                        max={85}
                        step={2}
                        value={settings.eyelineHeightVh}
                        onChange={(e) =>
                          onUpdateSettings({
                            eyelineHeightVh: Number(e.target.value),
                          })
                        }
                        className="w-full accent-sky-500"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-xs">
                        <span className="text-zinc-400">上端からの位置</span>
                        <span className="font-mono text-sky-400">
                          {settings.eyelineTopOffsetVh}vh
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={30}
                        step={1}
                        value={settings.eyelineTopOffsetVh}
                        onChange={(e) =>
                          onUpdateSettings({
                            eyelineTopOffsetVh: Number(e.target.value),
                          })
                        }
                        className="w-full accent-sky-500"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* フォーカスモード */}
              <div className="space-y-3 rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="block text-xs font-semibold text-zinc-200">
                      フォーカスモード
                    </span>
                    <span className="text-[11px] text-zinc-400">
                      現在読み上げ中の文章を明るく強調表示
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.focusMode}
                    onChange={(e) =>
                      onUpdateSettings({ focusMode: e.target.checked })
                    }
                    className="h-4 w-4 accent-sky-500"
                  />
                </div>

                <div className="space-y-2 border-t border-zinc-800 pt-3">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">周囲の文章の明るさ</span>
                    <span className="font-mono text-sky-400">
                      {Math.round(settings.dimOpacity * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.12}
                    max={0.75}
                    step={0.02}
                    value={settings.dimOpacity}
                    onChange={(e) =>
                      onUpdateSettings({ dimOpacity: Number(e.target.value) })
                    }
                    className="w-full accent-sky-500"
                  />

                  <label className="flex items-center justify-between pt-1 text-xs text-zinc-300">
                    <span>現在位置の細いガイドラインを表示</span>
                    <input
                      type="checkbox"
                      checked={settings.showGuideLine}
                      onChange={(e) =>
                        onUpdateSettings({ showGuideLine: e.target.checked })
                      }
                      className="h-4 w-4 accent-sky-500"
                    />
                  </label>
                </div>
              </div>
            </div>
          </section>

          {/* Section 3: スクロール・読み上げ位置設定 */}
          <section className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-sky-400">
              <Eye className="h-4 w-4" />
              <span>スクロール・読み上げ基準位置</span>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2 rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-4">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-zinc-300">
                    読み上げ位置の表示高さ (上端から)
                  </span>
                  <span className="font-mono text-sky-400">
                    {settings.readingLinePositionVh}%
                  </span>
                </div>
                <input
                  type="range"
                  min={15}
                  max={60}
                  step={1}
                  value={settings.readingLinePositionVh}
                  onChange={(e) =>
                    onUpdateSettings({
                      readingLinePositionVh: Number(e.target.value),
                    })
                  }
                  className="w-full accent-sky-500"
                />
                <div className="flex justify-between text-[10px] text-zinc-500">
                  <span>15% (カメラ直下)</span>
                  <span>32% (標準)</span>
                  <span>60% (中央下)</span>
                </div>
              </div>

              <div className="space-y-2 rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-4">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-zinc-300">
                    一定速度スクロールの速さ
                  </span>
                  <span className="font-mono text-sky-400">
                    {settings.constantScrollSpeed} px/秒
                  </span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={260}
                  step={5}
                  value={settings.constantScrollSpeed}
                  onChange={(e) =>
                    onUpdateSettings({
                      constantScrollSpeed: Number(e.target.value),
                    })
                  }
                  className="w-full accent-sky-500"
                />
              </div>

              <div className="space-y-2 rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-4">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-zinc-300">
                    スクロールアニメーション時間
                  </span>
                  <span className="font-mono text-sky-400">
                    {settings.scrollAnimationMs} ms
                  </span>
                </div>
                <input
                  type="range"
                  min={150}
                  max={800}
                  step={25}
                  value={settings.scrollAnimationMs}
                  onChange={(e) =>
                    onUpdateSettings({
                      scrollAnimationMs: Number(e.target.value),
                    })
                  }
                  className="w-full accent-sky-500"
                />
              </div>

              <div className="space-y-2 rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-4">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-zinc-300">音声追従感度</span>
                  <span className="font-mono text-sky-400">
                    {Math.round(settings.trackingSensitivity * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.35}
                  max={0.9}
                  step={0.05}
                  value={settings.trackingSensitivity}
                  onChange={(e) =>
                    onUpdateSettings({
                      trackingSensitivity: Number(e.target.value),
                    })
                  }
                  className="w-full accent-sky-500"
                />
              </div>

              <div className="space-y-2 rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-4">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-zinc-300">
                    次の文・段落へ移るタイミング
                  </span>
                  <span className="font-mono text-sky-400">
                    {Math.round(settings.advanceTriggerRatio * 100)}% 時点
                  </span>
                </div>
                <input
                  type="range"
                  min={0.40}
                  max={0.95}
                  step={0.05}
                  value={settings.advanceTriggerRatio}
                  onChange={(e) =>
                    onUpdateSettings({
                      advanceTriggerRatio: Number(e.target.value),
                    })
                  }
                  className="w-full accent-sky-500"
                />
                <div className="flex justify-between text-[10px] text-zinc-500">
                  <span>40% (早め)</span>
                  <span>90% (標準・文末近く)</span>
                  <span>95% (完全に言い切ってから)</span>
                </div>
              </div>

              <div className="space-y-2 rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-4">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-zinc-300">
                    スクロールの滑らかさ (減衰係数)
                  </span>
                  <span className="font-mono text-sky-400">
                    {settings.scrollSmoothness.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0.06}
                  max={0.3}
                  step={0.02}
                  value={settings.scrollSmoothness}
                  onChange={(e) =>
                    onUpdateSettings({
                      scrollSmoothness: Number(e.target.value),
                    })
                  }
                  className="w-full accent-sky-500"
                />
                <div className="flex justify-between text-[10px] text-zinc-500">
                  <span>0.06 (しっとり)</span>
                  <span>0.14 (標準)</span>
                  <span>0.30 (俊敏)</span>
                </div>
              </div>

              <div className="space-y-2 rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-4">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-zinc-300">追従速度倍率</span>
                  <span className="font-mono text-sky-400">
                    {settings.trackingSpeed.toFixed(1)}x
                  </span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={2.0}
                  step={0.1}
                  value={settings.trackingSpeed}
                  onChange={(e) =>
                    onUpdateSettings({
                      trackingSpeed: Number(e.target.value),
                    })
                  }
                  className="w-full accent-sky-500"
                />
              </div>

              <div className="flex items-center justify-between rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-4">
                <div>
                  <span className="block text-xs font-semibold text-zinc-200">
                    前方進行ロック（一度進んだら戻らない）
                  </span>
                  <span className="text-[11px] text-zinc-400">
                    ONにすると音声認識で前の段落へ逆戻りしなくなります（手動クリックや矢印キーではいつでも戻れます）
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={settings.forwardOnlyMode}
                  onChange={(e) =>
                    onUpdateSettings({ forwardOnlyMode: e.target.checked })
                  }
                  className="h-4 w-4 shrink-0 accent-sky-500"
                />
              </div>
            </div>
          </section>

          {/* Section 4: MacBook / USBスマホカメラ・マイク撮影設定 */}
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-rose-400">
                <Video className="h-4 w-4" />
                <span>カメラ（MacBook内蔵 / USB接続スマホ）＆マイク設定</span>
                <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] font-normal text-zinc-300">
                  検出カメラ: {videoDevices.length}台 / マイク: {audioDevices.length}台
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleScanDevices(true)}
                disabled={isScanningDevices}
                className="flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/25 disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${isScanningDevices ? 'animate-spin' : ''}`}
                />
                <span>カメラ権限を許可してUSBスマホを再スキャン</span>
              </button>
            </div>

            {/* Camera & Microphone Device Selectors */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2 rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-4">
                <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
                  <Smartphone className="h-3.5 w-3.5 text-rose-400" />
                  <span>使用するカメラ（USB接続スマホ / 内蔵カメラ）</span>
                </label>
                <select
                  value={settings.preferredVideoDeviceId}
                  onChange={(e) =>
                    onUpdateSettings({ preferredVideoDeviceId: e.target.value })
                  }
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-rose-500 focus:outline-none"
                >
                  <option value="" className="bg-zinc-950">
                    自動選択（USBスマホカメラ接続時はスマホを優先）
                  </option>
                  {videoDevices.map((d) => (
                    <option
                      key={d.deviceId}
                      value={d.deviceId}
                      className="bg-zinc-950"
                    >
                      {d.label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-zinc-500">
                  ※ スマホ名が表示されない場合は右上の「再スキャン」を押してください。
                </p>
              </div>

              <div className="space-y-2 rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-4">
                <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
                  <Mic className="h-3.5 w-3.5 text-emerald-400" />
                  <span>使用するマイク（外部マイク / スマホ / MacBook）</span>
                </label>
                <select
                  value={settings.preferredAudioDeviceId}
                  onChange={(e) =>
                    onUpdateSettings({ preferredAudioDeviceId: e.target.value })
                  }
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="" className="bg-zinc-950">
                    システム標準マイク
                  </option>
                  {audioDevices.map((a) => (
                    <option
                      key={a.deviceId}
                      value={a.deviceId}
                      className="bg-zinc-950"
                    >
                      {a.label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-zinc-500">
                  ※ 録画音声と音声追従の音量メーターに適用されます。
                </p>
              </div>
            </div>

            {/* Resolution & Aspect Ratio Presets */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2.5 rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-4">
                <span className="block text-xs font-medium text-zinc-300">
                  録画解像度（スマホ高画質対応）
                </span>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: '1080p', label: 'Full HD (1080p)' },
                    { id: '4k', label: '4K UHD (2160p)' },
                    { id: '720p', label: 'HD (720p 軽量)' },
                  ].map((res) => (
                    <button
                      key={res.id}
                      type="button"
                      onClick={() =>
                        onUpdateSettings({
                          cameraResolution:
                            res.id as PrompterSettings['cameraResolution'],
                        })
                      }
                      className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                        settings.cameraResolution === res.id
                          ? 'bg-rose-500 text-white'
                          : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {res.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2.5 rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-4">
                <span className="block text-xs font-medium text-zinc-300">
                  画面比率（横動画 / ショート縦動画）
                </span>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: '16:9', label: '16:9 横画面 (YouTube標準)' },
                    { id: '9:16', label: '9:16 縦画面 (Shorts / Reels)' },
                  ].map((ratio) => (
                    <button
                      key={ratio.id}
                      type="button"
                      onClick={() =>
                        onUpdateSettings({
                          cameraAspectRatio:
                            ratio.id as PrompterSettings['cameraAspectRatio'],
                        })
                      }
                      className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                        settings.cameraAspectRatio === ratio.id
                          ? 'bg-rose-500 text-white'
                          : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {ratio.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2.5 rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-4">
                <span className="block text-xs font-medium text-zinc-300">
                  カメラプレビューの表示スタイル
                </span>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: 'pip', label: '小窓表示 (カメラ直下)' },
                    { id: 'backdrop', label: '背景透過 (文字の背面)' },
                    { id: 'hidden', label: 'プレビュー非表示' },
                  ].map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() =>
                        onUpdateSettings({
                          cameraPreviewMode:
                            mode.id as PrompterSettings['cameraPreviewMode'],
                        })
                      }
                      className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                        settings.cameraPreviewMode === mode.id
                          ? 'bg-rose-500 text-white'
                          : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2.5 rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-4">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-zinc-300">
                    背景透過時のカメラ映像の濃さ
                  </span>
                  <span className="font-mono text-rose-400">
                    {Math.round(settings.cameraBackdropOpacity * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.15}
                  max={0.85}
                  step={0.05}
                  value={settings.cameraBackdropOpacity}
                  onChange={(e) =>
                    onUpdateSettings({
                      cameraBackdropOpacity: Number(e.target.value),
                    })
                  }
                  className="w-full accent-rose-500"
                />
                <div className="flex flex-col gap-1.5 pt-1 text-xs text-zinc-300">
                  <label className="flex items-center justify-between">
                    <span>プレビュー映像を鏡像（左右反転）表示</span>
                    <input
                      type="checkbox"
                      checked={settings.cameraMirrorPreview}
                      onChange={(e) =>
                        onUpdateSettings({
                          cameraMirrorPreview: e.target.checked,
                        })
                      }
                      className="h-4 w-4 accent-rose-500"
                    />
                  </label>
                  <label className="flex items-center justify-between">
                    <span>録画開始と同時に音声追従も自動スタート</span>
                    <input
                      type="checkbox"
                      checked={settings.autoStartPrompterOnRecord}
                      onChange={(e) =>
                        onUpdateSettings({
                          autoStartPrompterOnRecord: e.target.checked,
                        })
                      }
                      className="h-4 w-4 accent-rose-500"
                    />
                  </label>
                </div>
              </div>
            </div>

            {/* USB Smartphone Camera Quick Guide */}
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3.5 text-[11px] leading-relaxed text-zinc-400">
              <p className="font-semibold text-zinc-200">
                💡 MacBookにUSB接続したスマホをカメラとして使う手順：
              </p>
              <ul className="mt-1 list-inside list-disc space-y-1">
                <li>
                  <strong className="text-zinc-300">
                    Google Pixel / Android (Android 14以降)
                  </strong>
                  ：USBケーブルでMacBookに接続し、スマホ画面の通知「このデバイスをUSBで充電中」をタップ ＞ USBの用途で
                  <strong className="text-sky-300">「ウェブカメラ (Webcam)」</strong>
                  を選択すると、『📱 Android Webcam』として自動認識されます。
                </li>
                <li>
                  <strong className="text-zinc-300">iPhone (連係カメラ)</strong>
                  ：USB接続または同一Apple IDで近づけると、『📱 iPhone カメラ』としてそのまま選択できます。
                </li>
              </ul>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-zinc-800/80 px-6 py-3.5">
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="rounded-xl bg-sky-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-sky-400"
          >
            完了
          </button>
        </div>
      </div>
    </dialog>
  );
}
