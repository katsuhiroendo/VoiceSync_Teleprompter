import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CountdownController,
  CountdownDisplayStep,
} from '@/lib/countdownHelper';

describe('Phase 1: Recording Start CountdownController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('executes 0-second countdown immediately with REC step', () => {
    const controller = new CountdownController();
    const steps: CountdownDisplayStep[] = [];
    let completed = false;

    const started = controller.start(
      0,
      { beepOnTick: false, beepOnRec: false },
      {
        onStep: (s) => steps.push(s),
        onComplete: () => {
          completed = true;
        },
      }
    );

    expect(started).toBe(true);
    expect(completed).toBe(true);
    expect(steps).toEqual(['REC']);

    vi.advanceTimersByTime(700);
    expect(steps).toEqual(['REC', null]);
  });

  it('counts down 3 -> 2 -> 1 -> REC and triggers onComplete after 3 seconds', () => {
    const controller = new CountdownController();
    const steps: CountdownDisplayStep[] = [];
    let completed = false;

    controller.start(
      3,
      { beepOnTick: false, beepOnRec: false },
      {
        onStep: (s) => steps.push(s),
        onComplete: () => {
          completed = true;
        },
      }
    );

    expect(steps).toEqual([3]);
    expect(completed).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(steps).toEqual([3, 2]);
    expect(completed).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(steps).toEqual([3, 2, 1]);
    expect(completed).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(steps).toEqual([3, 2, 1, 'REC']);
    expect(completed).toBe(true);
  });

  it('supports 5-second and 10-second countdowns accurately', () => {
    const controller = new CountdownController();
    const steps: CountdownDisplayStep[] = [];
    let completed = false;

    controller.start(
      5,
      { beepOnTick: false, beepOnRec: false },
      {
        onStep: (s) => steps.push(s),
        onComplete: () => {
          completed = true;
        },
      }
    );

    vi.advanceTimersByTime(5000);
    expect(steps).toEqual([5, 4, 3, 2, 1, 'REC']);
    expect(completed).toBe(true);

    const steps10: CountdownDisplayStep[] = [];
    controller.start(
      10,
      { beepOnTick: false, beepOnRec: false },
      {
        onStep: (s) => steps10.push(s),
        onComplete: () => {},
      }
    );
    vi.advanceTimersByTime(10000);
    expect(steps10).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 'REC']);
  });

  it('prevents duplicate countdown starts while already running', () => {
    const controller = new CountdownController();
    const first = controller.start(
      3,
      { beepOnTick: false, beepOnRec: false },
      { onStep: () => {}, onComplete: () => {} }
    );
    const second = controller.start(
      3,
      { beepOnTick: false, beepOnRec: false },
      { onStep: () => {}, onComplete: () => {} }
    );

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('cancels mid-countdown without firing onComplete', () => {
    const controller = new CountdownController();
    let completed = false;
    let cancelled = false;
    const steps: CountdownDisplayStep[] = [];

    controller.start(
      3,
      { beepOnTick: false, beepOnRec: false },
      {
        onStep: (s) => steps.push(s),
        onComplete: () => {
          completed = true;
        },
      }
    );

    vi.advanceTimersByTime(1000);
    expect(steps).toEqual([3, 2]);

    controller.cancel({
      onStep: (s) => steps.push(s),
      onCancel: () => {
        cancelled = true;
      },
    });

    vi.advanceTimersByTime(5000);
    expect(cancelled).toBe(true);
    expect(completed).toBe(false);
    expect(steps[steps.length - 1]).toBeNull();
  });
});
