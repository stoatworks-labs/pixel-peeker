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

/**
 * NovaStar COEX gigabit output port.
 *
 * 0.95 is not back-calculated — the MX20, MX30, MX2000 Pro and MX6000 Pro
 * specifications print the constant in the formula itself. See `wireBitsPerPixel`.
 */
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
 * Pre-COEX MCTRL gigabit output port.
 *
 * efficiency 0.936 is back-calculated, and unlike most back-calculations it is
 * over-determined: the MCTRL660 PRO publishes BOTH of its figures — 650,000 px at
 * 8-bit and 325,000 px at 10/12-bit, 60 Hz — and one constant reproduces both exactly.
 *
 *   650,000 x 24 x 60 = 936 Mbps      325,000 x 48 x 60 = 936 Mbps
 *
 * That is 1440 bytes of payload in each 1538-byte slot a gigabit link actually spends
 * on a full frame, which is what a 1500-byte MTU leaves after IP, UDP and a 32-byte
 * vendor header. Suggestive rather than proven, but it is the right order of thing.
 *
 * Note this generation is genuinely slower than COEX, not just quoted more coarsely:
 * 936 Mbps against 950, and no 32-bit container at 10-bit.
 */
function mctrlGigPort(n: number) {
  return {
    id: `eth${n}`,
    label: `ETH ${n}`,
    linkSpeedGbps: 1,
    medium: 'RJ45' as const,
    efficiency: 0.936,
    packing: 'container-legacy' as const,
  };
}

/**
 * NovaStar MX_4x10G_Fiber output card trunk — the "1G solution".
 *
 * Modelled the same way as a Brompton trunk: one 10G fibre carrying ten independent 1G
 * fixture links, which is NovaStar's own description ("A single optical port has the
 * same load capacity of 10x 1G Ethernet ports, and a single card supports up to 40x
 * Ethernet port outputs"). The Ethernet drops themselves live in a CVT10 converter at
 * the far end of the fibre, so the trunk is the thing the controller actually has.
 */
function novaFibreTrunk10G(card: number, n: number) {
  return {
    id: `out${card}-opt${n}`,
    label: `OUT ${card} / OPT ${n}`,
    linkSpeedGbps: 10,
    medium: 'SFP+' as const,
    efficiency: 0.95,
    packing: 'container' as const,
    subLinks: 10,
  };
}

/**
 * NovaStar CX_1x40G_Fiber output card trunk — the "5G solution".
 *
 * One 40G fibre feeding a CVT8-5G converter, which fans out to eight 5-gigabit Ethernet
 * links serving 5G receiving cards (CA50E, CA50C, XA50). Both the packing and the
 * efficiency differ from every other port in this file, and both are taken from
 * NovaStar's published table rather than assumed:
 *
 *   8bit: 2,592,000 px   10bit: 2,073,000 px   12bit: 1,728,000 px   (per 5G link, 60 Hz)
 *
 * Those are 24, 30 and 36 bits per pixel — NAIVE packing, no power-of-two container, the
 * opposite of the gigabit path. The 8-bit and 12-bit figures both come to exactly
 * 3,732,480,000 bps of payload, so 3,732,480,000 / 5e9 = 0.746496 is the efficiency, and
 * it reproduces both of those columns at every frame rate NovaStar tabulate.
 *
 * The 10-bit column is the odd one out: 2,073,000 should be 2,073,600, and NovaStar
 * scaled the rounded value across the whole column, leaving it 0.029% low throughout.
 * Two consistent columns outvote one, so the constant stands. Their prose is looser
 * still — it rounds the efficiency to 0.75, and the MX6000 Pro sheet prints 0.95 for the
 * 10/12-bit rows, contradicting the table directly beneath it. The table is the source.
 */
function novaFibreTrunk40G(card: number) {
  return {
    id: `out${card}-opt1`,
    label: `OUT ${card} / OPT 1`,
    linkSpeedGbps: 40,
    medium: 'Fibre' as const,
    efficiency: 0.746496,
    packing: 'naive' as const,
    subLinks: 8,
  };
}

/** Every OPT trunk across `cards` output cards of the 4x10G kind. */
function fibreTrunks10G(cards: number) {
  return Array.from({ length: cards }, (_, c) =>
    Array.from({ length: 4 }, (_, i) => novaFibreTrunk10G(c + 1, i + 1)),
  ).flat();
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
    id: 'novastar-mx30',
    manufacturer: 'NovaStar',
    model: 'MX30',
    ports: Array.from({ length: 10 }, (_, i) => novaGigPort(i + 1)),
    inputs: [
      { id: 'hdmi1', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 10 },
      { id: 'hdmi2', connector: 'HDMI 1.4', maxWidthPx: 4096, maxHeightPx: 1080, maxFps: 240, maxBitDepth: 10 },
      { id: 'dp1', connector: 'DP 1.1', maxWidthPx: 4096, maxHeightPx: 1080, maxFps: 240, maxBitDepth: 10 },
      { id: 'sdi1', connector: '3G-SDI', maxWidthPx: 1920, maxHeightPx: 1080, maxFps: 60, maxBitDepth: 10 },
      { id: 'sdi2', connector: '3G-SDI', maxWidthPx: 1920, maxHeightPx: 1080, maxFps: 60, maxBitDepth: 10 },
    ],
    totalCapacityPx: 6_500_000,
    referenceBitDepth: 8,
    referenceFrameRateHz: 60,
    redundancy: 'port-pair',
    verified: true,
    source:
      'NovaStar MX30 LED Display Controller Specifications V1.4.0, 2024-06-13, oss.novastar.tech',
    notes:
      'Unlike the MX40 Pro, the 6.5 Mpx headline is not a backplane limit — it is the port sum rounded down (10 gigabit ports carry 6,597,220 px at 8-bit/60). 2x 10G optical carry the same data as the copper: OPT1 = ETH 1-10, OPT2 is its copy for redundancy, so they add nothing. 8-bit and 10-bit inputs only — there is no 12-bit path on this box. HDMI 2.0 takes 8192 px wide in forced 8192x1080 mode. Frame Rate Adaptive (23.98-240 Hz) and Full Grayscale Calibration both require the A10s Pro; so does 10-bit at 494,791 px/port rather than 329,861.',
  },
  {
    id: 'novastar-mx20',
    manufacturer: 'NovaStar',
    model: 'MX20',
    ports: Array.from({ length: 6 }, (_, i) => novaGigPort(i + 1)),
    inputs: [
      { id: 'hdmi1', connector: 'HDMI 1.3', maxWidthPx: 1920, maxHeightPx: 1200, maxFps: 144, maxBitDepth: 10 },
      { id: 'hdmi2', connector: 'HDMI 1.3', maxWidthPx: 1920, maxHeightPx: 1200, maxFps: 144, maxBitDepth: 10 },
      { id: 'sdi1', connector: '3G-SDI', maxWidthPx: 1920, maxHeightPx: 1080, maxFps: 60, maxBitDepth: 10 },
    ],
    totalCapacityPx: 3_900_000,
    referenceBitDepth: 8,
    referenceFrameRateHz: 60,
    redundancy: 'port-pair',
    verified: true,
    source:
      'NovaStar MX20 LED Display Controller Specifications V1.4.1, 2024-08, oss.novastar.tech',
    notes:
      'Smallest COEX box. 3.9 Mpx is the port sum rounded down (6 x 659,722 = 3,958,332 at 8-bit/60). 2x 10G optical: OPT1 = ETH 1-6, OPT2 is its copy. 8/10-bit only. Inputs cap at 1920x1200, but this is an all-in-one with scaling and three layers, so the wall may legitimately be larger than any input — 3840 px wide is available in forced mode. This datasheet is the one that prints NovaStar’s capacity formula in full; see wireBitsPerPixel.',
  },
  {
    id: 'novastar-mx2000-pro',
    manufacturer: 'NovaStar',
    model: 'MX2000 Pro (1G fibre)',
    ports: fibreTrunks10G(2),
    inputs: [
      { id: 'hdmi1', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 12 },
      { id: 'hdmi2', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 12 },
      { id: 'hdmi3', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 12 },
      { id: 'hdmi4', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 12 },
    ],
    totalCapacityPx: 35_380_000,
    referenceBitDepth: 8,
    referenceFrameRateHz: 60,
    redundancy: 'device',
    verified: true,
    source:
      'NovaStar MX2000 Pro LED Display Controller Specifications V1.1.1, 2023-10-13, oss.novastar.tech',
    notes:
      'Card-based 2U chassis, so this record is a CONFIGURATION, not a fixed box: 2x MX_4x10G_Fiber output cards (8 trunks, 80 gigabit drops via CVT10 converters) and one MX_4xHDMI 2.0 input card. The chassis takes 2 input cards — up to 8x 4K or 4x 8K — from HDMI 2.0, HDMI 2.1, DP 1.2, DP 1.4 and 12G-SDI; the inputs listed here are one card’s worth. For the 5G output card see the MX2000 Pro (5G fibre) record, which has different maths. The 35.38 Mpx device cap is the real limit: the eight trunks could carry 52.8 Mpx. Authentic 12-bit, and up to 360 Hz where the panels allow it.',
  },
  {
    id: 'novastar-mx2000-pro-5g',
    manufacturer: 'NovaStar',
    model: 'MX2000 Pro (5G fibre)',
    ports: [novaFibreTrunk40G(1), novaFibreTrunk40G(2)],
    inputs: [
      { id: 'hdmi1', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 12 },
      { id: 'hdmi2', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 12 },
      { id: 'hdmi3', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 12 },
      { id: 'hdmi4', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 12 },
    ],
    totalCapacityPx: 35_380_000,
    referenceBitDepth: 8,
    referenceFrameRateHz: 60,
    redundancy: 'device',
    verified: true,
    source:
      'NovaStar MX2000 Pro LED Display Controller Specifications V1.1.1, 2023-10-13, oss.novastar.tech',
    notes:
      'Same chassis as the 1G record, fitted with 2x CX_1x40G_Fiber output cards instead: two 40G trunks, each fanning out through a CVT8-5G to eight 5-gigabit links. This is a different SYSTEM, not just a different cable — it needs 5G receiving cards (CA50E, CA50C, XA50), and the pixels are packed naively (24/30/36 bits) rather than into power-of-two containers. Sixteen 5G links carry 41.5 Mpx at 8-bit/60, so the 35.38 Mpx chassis cap still binds.',
  },
  {
    id: 'novastar-mx6000-pro',
    manufacturer: 'NovaStar',
    model: 'MX6000 Pro (1G fibre)',
    ports: fibreTrunks10G(8),
    inputs: [
      { id: 'hdmi1', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 12 },
      { id: 'hdmi2', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 12 },
      { id: 'hdmi3', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 12 },
      { id: 'hdmi4', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 12 },
    ],
    totalCapacityPx: 141_000_000,
    referenceBitDepth: 8,
    referenceFrameRateHz: 60,
    redundancy: 'device',
    verified: true,
    source:
      'NovaStar MX6000 Pro LED Display Controller Specifications V1.1.1, 2023-10-13, oss.novastar.tech',
    notes:
      'The flagship: a 6U card-based chassis, modelled here fully populated with 8x MX_4x10G_Fiber output cards — 32 trunks, 320 gigabit drops via CVT10 converters. The chassis takes 8 input cards (up to 32x 4K or 8x 8K, including SMPTE ST 2110 VoIP at 25G); the four inputs listed are one MX_4xHDMI 2.0 card’s worth. 141 Mpx is a genuine chassis limit — the 32 trunks could carry 211 Mpx. Hot backup at three levels: between devices, between output cards, and between Ethernet ports, with dual PSUs.',
  },
  {
    id: 'novastar-mx6000-pro-5g',
    manufacturer: 'NovaStar',
    model: 'MX6000 Pro (5G fibre)',
    ports: Array.from({ length: 8 }, (_, i) => novaFibreTrunk40G(i + 1)),
    inputs: [
      { id: 'hdmi1', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 12 },
      { id: 'hdmi2', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 12 },
      { id: 'hdmi3', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 12 },
      { id: 'hdmi4', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 12 },
    ],
    totalCapacityPx: 141_000_000,
    referenceBitDepth: 8,
    referenceFrameRateHz: 60,
    redundancy: 'device',
    verified: true,
    source:
      'NovaStar MX6000 Pro LED Display Controller Specifications V1.1.1, 2023-10-13, oss.novastar.tech',
    notes:
      'Same chassis with 8x CX_1x40G_Fiber output cards: eight 40G trunks, each feeding a CVT8-5G that fans out to eight 5-gigabit links, so 64 drops instead of 320 for 166 Mpx of link — comfortably past the 141 Mpx chassis cap, which is the point of the 5G solution. Needs 5G receiving cards (CA50E, CA50C, XA50) and packs pixels naively at 24/30/36 bits; see novaFibreTrunk40G for the calibration.',
  },
  {
    id: 'novastar-mctrl4k',
    manufacturer: 'NovaStar',
    model: 'MCTRL4K',
    ports: Array.from({ length: 16 }, (_, i) => mctrlGigPort(i + 1)),
    inputs: [
      { id: 'dp1', connector: 'DP 1.2', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 120, maxBitDepth: 12 },
      { id: 'hdmi1', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 120, maxBitDepth: 12 },
      { id: 'dvi1', connector: 'DL-DVI', maxWidthPx: 3840, maxHeightPx: 1080, maxFps: 120, maxBitDepth: 12 },
      { id: 'dvi2', connector: 'DL-DVI', maxWidthPx: 3840, maxHeightPx: 1080, maxFps: 120, maxBitDepth: 12 },
    ],
    maxCanvasPx: 8_800_000,
    redundancy: 'port-pair',
    verified: true,
    source:
      'NovaStar MCTRL4K LED Display Controller Specifications V1.2.1, 2024-08-22, oss.novastar.tech',
    notes:
      'A send-only controller, not an all-in-one: no layers, no scaling, so the wall is the input canvas and 8.8 Mpx is a canvas ceiling rather than a bandwidth one — it is exactly 4096x2160 rounded down. From DVI the ceiling is 8.3 Mpx (2x 3840x1080). The 16 ports could carry 10.4 Mpx at 8-bit, so the canvas binds there and the ports bind at 10/12-bit. 4x 10G optical mirror the copper (OPT1 = ETH 1-8, OPT2 = ETH 9-16, OPT3/4 are their copies). NovaStar print 650,000 px/port at 8-bit and 320,000 at 10/12-bit; the 320,000 is a round-down of the 325,000 that their own MCTRL660 PRO figures imply, so this model shows ~1.6% more at 10/12-bit than the datasheet headline. HDR halves per-port capacity and needs 10-bit HDMI; so does 3D, and so does a forced 144 Hz input. Up to 10 units cascade.',
  },
  {
    id: 'novastar-mctrl660-pro',
    manufacturer: 'NovaStar',
    model: 'MCTRL660 PRO',
    ports: Array.from({ length: 6 }, (_, i) => mctrlGigPort(i + 1)),
    inputs: [
      { id: 'dvi1', connector: 'SL-DVI', maxWidthPx: 1920, maxHeightPx: 1200, maxFps: 60, maxBitDepth: 12 },
      { id: 'hdmi1', connector: 'HDMI 1.4a', maxWidthPx: 1920, maxHeightPx: 1200, maxFps: 60, maxBitDepth: 12 },
      { id: 'sdi1', connector: '3G-SDI', maxWidthPx: 1920, maxHeightPx: 1080, maxFps: 60, maxBitDepth: 12 },
    ],
    maxCanvasPx: 2_304_000,
    redundancy: 'port-pair',
    verified: true,
    source:
      'NovaStar MCTRL660 PRO Independent Controller Specifications V1.4.1, 2024-08-22, oss.novastar.tech',
    notes:
      'The box the mctrlGigPort efficiency is calibrated from: NovaStar publish both figures, 650,000 px/port at 8-bit and 325,000 at 10/12-bit, and the exact 2:1 is what proves the 48-bit container at 10-bit on this generation. 2.304 Mpx canvas ceiling is 1920x1200 at 60 Hz — the six ports could carry 3.9 Mpx, so the pipeline is the limit, not the links. At 30 Hz a forced 800x3840 gives 3.07 Mpx, which this ceiling does not model. 2x 10G optical: OPT1 carries all six Ethernet ports, OPT2 backs it up; the box also runs as a fibre converter rather than a sending card.',
  },
  {
    id: 'novastar-mctrl660',
    manufacturer: 'NovaStar',
    model: 'MCTRL660',
    ports: Array.from({ length: 4 }, (_, i) => mctrlGigPort(i + 1)),
    inputs: [
      { id: 'dvi1', connector: 'SL-DVI', maxWidthPx: 1920, maxHeightPx: 1200, maxFps: 60, maxBitDepth: 12 },
      { id: 'hdmi1', connector: 'HDMI 1.3', maxWidthPx: 1920, maxHeightPx: 1200, maxFps: 60, maxBitDepth: 12 },
    ],
    maxCanvasPx: 2_304_000,
    redundancy: 'port-pair',
    verified: true,
    source:
      'NovaStar MCTRL660 LED Display Controller Specifications V1.4.4, 2024-08-22, oss.novastar.tech',
    notes:
      'The workhorse four-port sender. NovaStar publish only the 8-bit figure, 650,000 px/port; the 325,000 shown at 10/12-bit is inherited from the MCTRL660 PRO datasheet, which shares this port generation and states both. 2.304 Mpx canvas ceiling is 1920x1200 at 60 Hz, below the 2.6 Mpx the four ports could carry. No optical ports. Up to 20 units cascade over UART.',
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
