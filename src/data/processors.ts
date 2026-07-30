/**
 * Pixel Peeker — processor (sending card / controller) and receiving card library.
 *
 * See the provenance policy at the top of `cabinets.ts`. Same rules apply.
 *
 * CALIBRATION NOTE — why efficiencies differ between vendors.
 *
 * NovaStar gigabit ports run at 0.95 link efficiency with power-of-two pixel
 * containers, which reproduces their three published MX40 Pro figures exactly
 * (659,722 / 494,791 / 329,861 px at 8 / 10 / 12-bit @ 60 Hz). See `wireBitsPerPixel`.
 *
 * Brompton's effective efficiency is far lower because a Tessera link carries more
 * than raw RGB — per-fixture calibration data, ShutterSync timing and their frame
 * protocol all ride along. Rather than invent an overhead figure, the Brompton port
 * efficiency here is BACK-CALCULATED from their own published headline: 9 million
 * pixels at 12-bit @ 60 Hz across four 10G trunks. That is the number Brompton
 * stand behind, so reproducing it is the right target.
 */

import type { ProcessorSpec, ReceivingCardSpec } from '../domain/types';

// ---------------------------------------------------------------------------
// Receiving cards
// ---------------------------------------------------------------------------

export const RECEIVER_LIBRARY: ReceivingCardSpec[] = [
  {
    id: 'novastar-a10s-pro',
    manufacturer: 'NovaStar',
    model: 'A10s Pro',
    maxPixels: 512000,
    verified: false,
    source:
      'Confirmed as a supported card in the MX40 Pro specification, and the only card that unlocks its 10-bit mode. Pixel limit NOT verified against an A10s Pro datasheet.',
    notes:
      'Required for 10-bit@60Hz on the MX40 Pro — NovaStar call this out explicitly. Also the card required for Frame Rate Adaptive.',
  },
  {
    id: 'novastar-a8s',
    manufacturer: 'NovaStar',
    model: 'A8s',
    maxPixels: 256000,
    verified: false,
    source: 'Listed as supported by the MX40 Pro. Pixel limit NOT verified.',
  },
  {
    id: 'novastar-a5s-plus',
    manufacturer: 'NovaStar',
    model: 'A5s Plus',
    maxPixels: 256000,
    verified: false,
    source: 'Listed as supported by the MX40 Pro. Pixel limit NOT verified.',
  },
  {
    id: 'novastar-a4s',
    manufacturer: 'NovaStar',
    model: 'A4s',
    maxPixels: 256000,
    verified: false,
    source: 'Fitted to the Aluvision Hi-LED 55 2.8. Pixel limit NOT verified.',
  },
  {
    id: 'brompton-r2',
    manufacturer: 'Brompton',
    model: 'Tessera R2',
    maxPixels: 655360,
    verified: false,
    source: 'Receiving card fitted to Absen PL V2 Brompton variants. Limits NOT verified.',
  },
];

export function receiverById(id: string): ReceivingCardSpec | undefined {
  return RECEIVER_LIBRARY.find((r) => r.id === id);
}

// ---------------------------------------------------------------------------
// Processors
// ---------------------------------------------------------------------------

/** NovaStar gigabit output port. */
function novaGigPort(n: number) {
  return {
    id: `eth${n}`,
    label: `ETH ${n}`,
    linkSpeedGbps: 1,
    medium: 'RJ45' as const,
    efficiency: 0.95,
    packing: 'container' as const,
  };
}

/**
 * Brompton 10G trunk.
 *
 * efficiency 0.648 is back-calculated: 9,000,000 px / 4 trunks = 2,250,000 px per
 * trunk at 12-bit @ 60 Hz. With the 48-bit container that is
 * 2.25e6 x 48 x 60 = 6.48 Gbps on a 10 Gbps link => 0.648.
 *
 * Sanity check against Brompton's own sub-link statement: they say each 10G trunk
 * carries ten independent 1G fixture connections "each having the same pixel
 * capacity", giving 225,000 px per 1G link at 12-bit — which is what this produces.
 */
function bromptonTrunk(n: number) {
  return {
    id: `10g${n}`,
    label: `10G ${n}`,
    linkSpeedGbps: 10,
    medium: 'SFP+' as const,
    efficiency: 0.648,
    packing: 'container' as const,
    subLinks: 10,
  };
}

export const PROCESSOR_LIBRARY: ProcessorSpec[] = [
  {
    id: 'novastar-mx40-pro',
    manufacturer: 'NovaStar',
    model: 'MX40 Pro',
    ports: Array.from({ length: 20 }, (_, i) => novaGigPort(i + 1)),
    inputs: [
      { id: 'hdmi1', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 60, maxBitDepth: 12 },
      { id: 'hdmi2', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 60, maxBitDepth: 12 },
      { id: 'hdmi3', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 60, maxBitDepth: 12 },
      { id: 'dp1', connector: 'DP 1.2', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 60, maxBitDepth: 12 },
      { id: 'sdi1', connector: '12G-SDI', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 60, maxBitDepth: 12 },
    ],
    totalCapacityPx: 9_000_000,
    referenceBitDepth: 8,
    referenceFrameRateHz: 60,
    redundancy: 'port-pair',
    verified: true,
    source: 'NovaStar MX40 Pro LED Display Controller Specifications V1.4.1, oss.novastar.tech',
    notes:
      'Device cap of 9 Mpx is well below the 13.2 Mpx the 20 gigabit ports could carry — the box, not the links, is the limit. 4x 10G optical ports carry the same data as the copper ports (20-port mode: OPT1 = ETH 1-10, OPT2 = ETH 11-20, OPT3/4 are copies for redundancy), so they are not modelled as extra capacity. Max input 4096x2160@60 per connector; 8192 px max width in forced 8192x1080 mode.',
  },
  {
    id: 'brompton-sx40',
    manufacturer: 'Brompton',
    model: 'Tessera SX40',
    ports: Array.from({ length: 4 }, (_, i) => bromptonTrunk(i + 1)),
    inputs: [
      { id: 'hdmi1', connector: 'HDMI 2.0b', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 250, maxBitDepth: 12 },
      { id: 'sdi1', connector: '12G-SDI', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 60, maxBitDepth: 12 },
    ],
    totalCapacityPx: 9_000_000,
    referenceBitDepth: 12,
    referenceFrameRateHz: 60,
    redundancy: 'device',
    verified: true,
    source: 'Brompton Tessera SX40 Data Sheet, Feb 2025 EN, bromptontech.com',
    notes:
      'Headline capacity is 9 Mpx at 12-bit 60 Hz — quoted at 12-bit, unlike NovaStar who quote at 8-bit. Each 10G trunk supports up to ten independent 1G fixture connections. Supports Processor Redundancy (whole-device failover). HDMI 2.0b input accepts 23.98-250 Hz at 8/10/12-bit.',
  },
];

export function processorById(id: string): ProcessorSpec | undefined {
  return PROCESSOR_LIBRARY.find((p) => p.id === id);
}
