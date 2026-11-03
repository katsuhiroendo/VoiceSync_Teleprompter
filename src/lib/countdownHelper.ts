import { CountdownSecondsPreset } from '@/types/prompter';

export type CountdownDisplayStep = number | 'REC' | null;

/**
 * Web Audio API を用いた軽量なカウントダウン通知音・REC開始音の生成。
 * 録音への混入を防ぐため標準設定では OFF であり、ON の場合のみ短く発音して即座に AudioContext を解放する。
 */
export function playCountdownTone(kind: 'tick' | 'rec'): void {
  if (typeof window === 'undefined') return;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioCtx) return;

  try {
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.value = kind === 'rec' ? 1320 : 880;

    const durationSec = kind === 'rec' ? 0.18 : 0.09;
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + durationSec);

    osc.onended = () => {
      ctx.close().catch(() => {});
    };
  } catch {
    // Ignore audio context restriction errors
  }
}

export interface CountdownCallbacks {
  onStep: (step: CountdownDisplayStep) => void;
  onComplete: () => Promise<void> | void;
  onCancel?: () => void;
}

/**
 * 撮影開始カウントダウン制御クラス
 * - 二重起動防止
 * - 0秒 / 3秒 / 5秒 / 10秒 対応
 * - カウントダウン中のキャンセル対応
 */
export class CountdownController {
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private cancelled = false;

  public isRunning(): boolean {
    return this.running;
  }

  public start(
    seconds: CountdownSecondsPreset,
    options: {
      beepOnTick: boolean;
      beepOnRec: boolean;
    },
    callbacks: CountdownCallbacks
  ): boolean {
    // Prevent duplicate start (Section 3.5)
    if (this.running) {
      return false;
    }

    this.running = true;
    this.cancelled = false;

    if (seconds <= 0) {
      this.running = false;
      if (options.beepOnRec) {
        playCountdownTone('rec');
      }
      callbacks.onStep('REC');
      this.timerId = setTimeout(() => {
        callbacks.onStep(null);
      }, 650);
      void callbacks.onComplete();
      return true;
    }

    let remaining: number = seconds;
    callbacks.onStep(remaining);
    if (options.beepOnTick) {
      playCountdownTone('tick');
    }

    const tick = () => {
      if (this.cancelled) return;
      remaining -= 1;
      if (remaining > 0) {
        callbacks.onStep(remaining);
        if (options.beepOnTick) {
          playCountdownTone('tick');
        }
        this.timerId = setTimeout(tick, 1000);
      } else {
        this.running = false;
        if (options.beepOnRec) {
          playCountdownTone('rec');
        }
        callbacks.onStep('REC');
        this.timerId = setTimeout(() => {
          callbacks.onStep(null);
        }, 700);
        void callbacks.onComplete();
      }
    };

    this.timerId = setTimeout(tick, 1000);
    return true;
  }

  public cancel(callbacks?: Pick<CountdownCallbacks, 'onStep' | 'onCancel'>): void {
    if (!this.running) return;
    this.cancelled = true;
    this.running = false;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    callbacks?.onStep(null);
    callbacks?.onCancel?.();
  }
}
