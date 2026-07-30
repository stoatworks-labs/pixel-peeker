/**
 * These tests pin the capacity model to figures the manufacturers publish.
 *
 * If one of these fails, the model has drifted away from what a NovaStar or Brompton
 * engineer would tell you — which makes every number the app prints untrustworthy.
 * Fix the model, do not relax the test.
 */

import { describe, expect, it } from 'vitest';
import { portCapacity, processorCapacity, wireBitsPerPixel } from './capacity';
import { processorById } from '../data/processors';
import type { PortSpec, SignalFormat } from './types';

const at60 = (bitDepth: 8 | 10 | 12): SignalFormat => ({
  bitDepth,
  frameRateHz: 60,
  ledRefreshHz: 3840,
});

const novaGig: PortSpec = {
  id: 'eth1',
  label: 'ETH 1',
  linkSpeedGbps: 1,
  medium: 'RJ45',
  efficiency: 0.95,
  packing: 'container',
};

describe('pixel container packing', () => {
  // Vendors word-align each component; 10-bit costs the same wire space as 16-bit.
  it('packs to power-of-two containers, not 3 x bitDepth', () => {
    expect(wireBitsPerPixel(8)).toBe(24);
    expect(wireBitsPerPixel(10)).toBe(32);
    expect(wireBitsPerPixel(12)).toBe(48);
  });

  it('can still do naive packing when asked', () => {
    expect(wireBitsPerPixel(10, 'naive')).toBe(30);
  });
});

describe('NovaStar MX40 Pro published port capacity', () => {
  // Source: MX40 Pro LED Display Controller Specifications V1.4.1, oss.novastar.tech.
  // "8bit@60Hz: 659,722 pixels / 10bit@60Hz: 494,791 pixels / 10bit/12bit@60Hz: 329,861 pixels"
  it.each([
    [8, 659_722],
    [10, 494_791],
    [12, 329_861],
  ] as const)('matches the published figure at %i-bit', (depth, published) => {
    expect(portCapacity(novaGig, at60(depth)).capacityPx).toBe(published);
  });

  it('reproduces the published ratios 1.00 / 0.75 / 0.50', () => {
    const base = portCapacity(novaGig, at60(8)).capacityPx;
    expect(portCapacity(novaGig, at60(10)).capacityPx / base).toBeCloseTo(0.75, 4);
    expect(portCapacity(novaGig, at60(12)).capacityPx / base).toBeCloseTo(0.5, 4);
  });

  it('caps at the 9 Mpx device limit, not the 13.2 Mpx the ports could carry', () => {
    const mx40 = processorById('novastar-mx40-pro')!;
    const portSum = mx40.ports.reduce(
      (n, p) => n + portCapacity(p, at60(8)).capacityPx,
      0,
    );
    expect(portSum).toBeGreaterThan(13_000_000);
    expect(processorCapacity(mx40, at60(8))).toBe(9_000_000);
  });
});

describe('Brompton Tessera SX40 published capacity', () => {
  // Source: Brompton SX40 Data Sheet Feb 2025 EN — 9 Mpx at 12-bit 60 Hz over 4x 10G.
  const sx40 = processorById('brompton-sx40')!;

  it('reaches 9 Mpx at 12-bit 60 Hz', () => {
    expect(processorCapacity(sx40, at60(12))).toBe(9_000_000);
  });

  it('gives 2.25 Mpx per 10G trunk at 12-bit', () => {
    expect(portCapacity(sx40.ports[0], at60(12)).capacityPx).toBe(2_250_000);
  });

  it('gives 225,000 px per 1G sub-link, matching Brompton’s own statement', () => {
    const trunk = sx40.ports[0];
    const perSubLink =
      portCapacity(trunk, at60(12)).capacityPx / (trunk.subLinks ?? 1);
    expect(perSubLink).toBe(225_000);
  });
});

describe('frame rate scaling', () => {
  it('halves capacity when frame rate doubles', () => {
    const at60px = portCapacity(novaGig, at60(8)).capacityPx;
    const at120px = portCapacity(novaGig, {
      bitDepth: 8,
      frameRateHz: 120,
      ledRefreshHz: 3840,
    }).capacityPx;
    expect(at120px).toBeCloseTo(at60px / 2, -1);
  });

  it('LED refresh rate does not change link capacity', () => {
    const slow = portCapacity(novaGig, { bitDepth: 8, frameRateHz: 60, ledRefreshHz: 1920 });
    const fast = portCapacity(novaGig, { bitDepth: 8, frameRateHz: 60, ledRefreshHz: 7680 });
    expect(slow.capacityPx).toBe(fast.capacityPx);
  });
});
