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

describe('NovaStar COEX published device capacity', () => {
  // Sources: MX30 Specifications V1.4.0 and MX20 Specifications V1.4.1, oss.novastar.tech.
  // Both quote the same per-port figures as the MX40 Pro, so the whole COEX gigabit
  // family is pinned by one calibration.
  it.each([
    ['novastar-mx30', 10, 6_500_000],
    ['novastar-mx20', 6, 3_900_000],
  ] as const)('%s caps at its published headline', (id, ports, headline) => {
    const spec = processorById(id)!;
    expect(spec.ports).toHaveLength(ports);
    expect(processorCapacity(spec, at60(8))).toBe(headline);
  });

  it('shows the COEX headline is the port sum rounded down, not a backplane cap', () => {
    // Unlike the MX40 Pro, where 9 Mpx is well under what the ports could carry.
    const mx30 = processorById('novastar-mx30')!;
    const portSum = mx30.ports.reduce((n, p) => n + portCapacity(p, at60(8)).capacityPx, 0);
    expect(portSum).toBe(6_597_220);
    expect(portSum - 6_500_000).toBeLessThan(100_000);
  });

  it('gives the MX_4x10G_Fiber trunk the load of ten gigabit ports, as published', () => {
    const trunk = processorById('novastar-mx2000-pro')!.ports[0];
    expect(trunk.subLinks).toBe(10);
    // "A single optical port has the same load capacity of 10x 1G Ethernet ports."
    const perSubLink = portCapacity(trunk, at60(8)).capacityPx / 10;
    expect(perSubLink).toBeCloseTo(659_722, -1);
  });

  it.each([
    ['novastar-mx2000-pro', 8, 35_380_000],
    ['novastar-mx6000-pro', 32, 141_000_000],
  ] as const)('%s is capped by the chassis, not the trunks', (id, trunks, cap) => {
    const spec = processorById(id)!;
    expect(spec.ports).toHaveLength(trunks);
    const portSum = spec.ports.reduce((n, p) => n + portCapacity(p, at60(8)).capacityPx, 0);
    expect(portSum).toBeGreaterThan(cap);
    expect(processorCapacity(spec, at60(8))).toBe(cap);
  });
});

describe('NovaStar 5G fibre solution (CX_1x40G_Fiber output card)', () => {
  // Source: MX2000 Pro / MX6000 Pro Specifications V1.1.1, "5G Solution" load table.
  // The 5G path packs pixels NAIVELY at 24/30/36 bits — the opposite of the gigabit
  // path — and runs at a different efficiency. Both come from the published table.
  const trunk = processorById('novastar-mx6000-pro-5g')!.ports[0];

  it.each([
    [8, 2_592_000],
    [12, 1_728_000],
  ] as const)('matches the published per-5G-link figure at %i-bit', (depth, published) => {
    expect(portCapacity(trunk, at60(depth)).capacityPx / (trunk.subLinks ?? 1)).toBe(
      published,
    );
  });

  it('reproduces the published 24 Hz, 30 Hz and 240 Hz rows too', () => {
    expect(perLink(24, 8)).toBe(6_480_000);
    expect(perLink(30, 12)).toBe(3_456_000);
    expect(perLink(240, 12)).toBe(432_000);
  });

  it('is 0.03% above NovaStar’s 10-bit column, which is theirs to reconcile', () => {
    // The 8-bit and 12-bit columns agree exactly on 3,732,480,000 bps of payload. The
    // 10-bit column does not: every cell in it is that figure rounded down at 60 Hz
    // (2,073,600 -> 2,073,000) and then scaled, so the whole column sits 0.029% low.
    // Two columns outvote one; the model keeps the constant the other two agree on.
    expect(perLink(60, 10)).toBe(2_073_600);
    expect(perLink(30, 10)).toBe(4_147_200);
    expect(2_073_000 / 2_073_600).toBeCloseTo(0.99971, 5);
  });

  function perLink(fps: number, bitDepth: 8 | 10 | 12) {
    return (
      portCapacity(trunk, { bitDepth, frameRateHz: fps, ledRefreshHz: 3840 }).capacityPx /
      (trunk.subLinks ?? 1)
    );
  }
});

describe('NovaStar MCTRL generation (pre-COEX)', () => {
  // Source: MCTRL660 PRO Independent Controller Specifications V1.4.1 — 650,000 px at
  // 8-bit and 325,000 at 10/12-bit, per gigabit port at 60 Hz. Exactly 2:1, which is
  // 24 vs 48 bits and rules out the 32-bit 10-bit container the COEX boxes have.
  const port = processorById('novastar-mctrl660-pro')!.ports[0];

  it.each([
    [8, 650_000],
    [10, 325_000],
    [12, 325_000],
  ] as const)('matches the published MCTRL660 PRO figure at %i-bit', (depth, published) => {
    expect(portCapacity(port, at60(depth)).capacityPx).toBe(published);
  });

  it('costs 48 bits at 10-bit, where a COEX port costs 32', () => {
    expect(wireBitsPerPixel(10, 'container-legacy')).toBe(48);
    expect(wireBitsPerPixel(8, 'container-legacy')).toBe(24);
    expect(wireBitsPerPixel(10, 'container')).toBe(32);
  });

  it('holds the MCTRL4K canvas ceiling flat while the ports derate', () => {
    // 8.8 Mpx is 4096x2160, a pipeline limit, so it must NOT scale with bit depth.
    // At 8-bit it binds under the 10.4 Mpx the 16 ports carry; at 12-bit the ports bind.
    const mctrl4k = processorById('novastar-mctrl4k')!;
    expect(mctrl4k.maxCanvasPx).toBe(8_800_000);
    expect(processorCapacity(mctrl4k, at60(8))).toBe(8_800_000);
    expect(processorCapacity(mctrl4k, at60(12))).toBe(16 * 325_000);
  });

  it('caps the MCTRL660 at its 1920x1200 canvas, below what its four ports carry', () => {
    const mctrl660 = processorById('novastar-mctrl660')!;
    const portSum = mctrl660.ports.reduce(
      (n, p) => n + portCapacity(p, at60(8)).capacityPx,
      0,
    );
    expect(portSum).toBe(2_600_000);
    expect(processorCapacity(mctrl660, at60(8))).toBe(1920 * 1200);
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
