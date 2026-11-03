import { describe, it, expect } from 'vitest';
import {
  analyzeWaveformFrame,
  evaluateAudioQualityFrames,
  FrameAudioSampleMetric,
} from '@/lib/audioQualityAnalyzer';

describe('Phase 2: Audio Recording Quality Analyzer', () => {
  it('computes RMS, Peak, and clipping count from a waveform frame', () => {
    const samples = new Float32Array([0.1, -0.2, 0.99, -0.995, 0.0]);
    const metric = analyzeWaveformFrame(samples, 500);

    expect(metric.peak).toBeCloseTo(0.995, 3);
    expect(metric.clippedSamples).toBe(2);
    expect(metric.rms).toBeGreaterThan(0.5);
  });

  it('evaluates normal clear speech with quiet ambient room as "good" (良好)', () => {
    const frames: FrameAudioSampleMetric[] = [
      // First 2s: quiet ambient floor (RMS ~ 0.002 -> -54 dBFS)
      { timestampMs: 500, rms: 0.002, peak: 0.005, clippedSamples: 0 },
      { timestampMs: 1500, rms: 0.0025, peak: 0.006, clippedSamples: 0 },
      // 2s-10s: healthy speech (RMS ~ 0.12 -> -18.4 dBFS)
      { timestampMs: 3000, rms: 0.12, peak: 0.45, clippedSamples: 0 },
      { timestampMs: 5000, rms: 0.14, peak: 0.52, clippedSamples: 0 },
      { timestampMs: 7000, rms: 0.11, peak: 0.4, clippedSamples: 0 },
    ];

    const report = evaluateAudioQualityFrames(frames);
    expect(report.verdictCode).toBe('good');
    expect(report.verdictLabel).toBe('良好');
    expect(report.clippingSuspected).toBe(false);
    expect(report.estimatedSnrDb).toBeGreaterThan(25);
  });

  it('evaluates very quiet input as "too-quiet" (音量が小さい可能性)', () => {
    const frames: FrameAudioSampleMetric[] = [
      { timestampMs: 500, rms: 0.001, peak: 0.002, clippedSamples: 0 },
      { timestampMs: 1500, rms: 0.001, peak: 0.002, clippedSamples: 0 },
      // Speech RMS = 0.012 (~ -38.4 dBFS, below -32 dBFS threshold)
      { timestampMs: 3500, rms: 0.012, peak: 0.03, clippedSamples: 0 },
      { timestampMs: 5500, rms: 0.011, peak: 0.028, clippedSamples: 0 },
    ];

    const report = evaluateAudioQualityFrames(frames);
    expect(report.verdictCode).toBe('too-quiet');
    expect(report.verdictLabel).toBe('音量が小さい可能性');
  });

  it('evaluates distorted / loud input as "clipping" (音割れの可能性)', () => {
    const frames: FrameAudioSampleMetric[] = [
      { timestampMs: 500, rms: 0.003, peak: 0.008, clippedSamples: 0 },
      { timestampMs: 3000, rms: 0.55, peak: 0.992, clippedSamples: 12 },
      { timestampMs: 4500, rms: 0.6, peak: 0.998, clippedSamples: 18 },
      { timestampMs: 6000, rms: 0.52, peak: 0.99, clippedSamples: 8 },
    ];

    const report = evaluateAudioQualityFrames(frames);
    expect(report.verdictCode).toBe('clipping');
    expect(report.clippingSuspected).toBe(true);
    expect(report.clippingSuspectedCount).toBe(3);
  });

  it('evaluates complete silence as "no-signal" (マイク入力が検出されない)', () => {
    const frames: FrameAudioSampleMetric[] = [
      { timestampMs: 500, rms: 0.0001, peak: 0.0002, clippedSamples: 0 },
      { timestampMs: 3000, rms: 0.0001, peak: 0.0003, clippedSamples: 0 },
      { timestampMs: 6000, rms: 0.0001, peak: 0.0002, clippedSamples: 0 },
    ];

    const report = evaluateAudioQualityFrames(frames);
    expect(report.verdictCode).toBe('no-signal');
    expect(report.verdictLabel).toBe('マイク入力が検出されない');
    expect(report.silenceRatioPercent).toBe(100);
  });

  it('evaluates loud background noise in first 2s as "noisy-environment" (周囲の騒音が大きい可能性)', () => {
    const frames: FrameAudioSampleMetric[] = [
      // Loud cafe / AC background noise in first 2s (RMS = 0.035 -> -29.1 dBFS > -36 dBFS)
      { timestampMs: 500, rms: 0.035, peak: 0.08, clippedSamples: 0 },
      { timestampMs: 1500, rms: 0.038, peak: 0.09, clippedSamples: 0 },
      // Normal speech afterward
      { timestampMs: 3500, rms: 0.1, peak: 0.3, clippedSamples: 0 },
      { timestampMs: 5500, rms: 0.11, peak: 0.32, clippedSamples: 0 },
    ];

    const report = evaluateAudioQualityFrames(frames);
    expect(report.verdictCode).toBe('noisy-environment');
    expect(report.verdictLabel).toBe('周囲の騒音が大きい可能性');
  });
});
