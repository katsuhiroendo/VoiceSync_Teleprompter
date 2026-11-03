'use client';

import React, { useEffect, useRef } from 'react';
import { PrompterSettings, DEFAULT_PROMPTER_SETTINGS } from '@/types/prompter';
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
