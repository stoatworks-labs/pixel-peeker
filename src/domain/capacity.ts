/**
 * Pixel Peeker — capacity maths.
 *
 * THE CENTRAL DISTINCTION, and the thing most spreadsheets get wrong:
 *
 *   1. LINK capacity (how many pixels fit down one output port) is set by
 *      link rate, colour bit depth and FRAME rate. The LED's visual refresh
 *      rate is irrelevant here — the frame arrives once per frame period and
 *      the receiving card re-scans it locally.
 *
 *   2. DRIVE capacity (whether the receiving card can actually paint those
 *      pixels at the wanted refresh) is set by the driver IC clock, the scan
 *      ratio and the panel's internal greyscale depth. Frame rate and input
 *      bit depth are nearly irrelevant here.
 *
 * Mixing the two is why people "lose" capacity at high refresh rates and can't
 * explain where it went. We model them separately and report both.
 */

import type {
  BitDepth,
  CabinetSpec,
  PortSpec,
  ProcessorSpec,
  ReceivingCardSpec,
  SignalFormat,
} from './types';

/**
 * How a vendor packs a pixel onto the wire.
 *
 * THIS IS NOT `3 x bitDepth`, and assuming it is will overstate 10-bit capacity by
 * about 7%. Controllers pack each colour component into a power-of-two container so
 * the DMA engine stays word-aligned, so 10-bit costs the same wire space as 16-bit:
 *
 *   8-bit  -> 8+8+8    packed into 24 bits/px
 *   10-bit -> 10+10+10 packed into 32 bits/px   (not 30)
 *   12-bit -> 12+12+12 packed into 48 bits/px   (not 36)
 *
 * VERIFICATION: NovaStar publish three per-port figures for the MX40 Pro at 60 Hz —
 * 659,722 px at 8-bit, 494,791 px at 10-bit and 329,861 px at 10/12-bit. With the
 * containers above, ONE efficiency constant of exactly 0.9500 reproduces all three
 * to the pixel. With naive 3 x bitDepth packing no single constant fits. The published
 * ratios (1.00 / 0.75 / 0.50) are exactly 24/24, 24/32 and 24/48.
 */
export type PixelPacking = 'container' | 'naive';

export function wireBitsPerPixel(
  bitDepth: BitDepth,
  packing: PixelPacking = 'container',
): number {
  if (packing === 'naive') return 3 * bitDepth;
  if (bitDepth <= 8) return 24;
  if (bitDepth <= 10) return 32;
  return 48;
}

/**
 * Fraction of the raw line rate available to pixel payload, after framing, preamble,
 * inter-packet gap and the vendor's own protocol overhead.
 *
 * 0.95 is not a guess — see the verification note on `wireBitsPerPixel`. It reproduces
 * NovaStar's three published MX40 Pro figures exactly. Brompton's links carry
 * substantially more than raw RGB and are calibrated separately, per port, in the
 * processor library.
 */
export const DEFAULT_LINK_EFFICIENCY = 0.95;

export interface PortCapacity {
  /** Pixels this port can carry at the given signal format. */
  capacityPx: number;
  /** Payload bits per second the port can move. */
  payloadBps: number;
  /** Bits each pixel occupies on the wire, after container packing. */
  bitsPerPixel: number;
}

/**
 * Pixels one output port can carry.
 *
 *   capacity = (linkRate x efficiency) / wireBitsPerPixel / frameRate
 *
 * No safety derate is applied: these figures match what the vendor's own software
 * will allow, and a designer comparing Pixel Peeker against VMP or Tessera needs the
 * numbers to agree. Headroom is a design decision, exposed as `fillTo` in auto-wiring.
 */
export function portCapacity(port: PortSpec, signal: SignalFormat): PortCapacity {
  const efficiency = port.efficiency ?? DEFAULT_LINK_EFFICIENCY;
  const bitsPerPixel = wireBitsPerPixel(signal.bitDepth, port.packing);
  const payloadBps = port.linkSpeedGbps * 1e9 * efficiency;
  return {
    capacityPx: Math.floor(payloadBps / bitsPerPixel / signal.frameRateHz),
    payloadBps,
    bitsPerPixel,
  };
}

/**
 * Whole-device capacity at the given signal format.
 *
 * Vendors quote `totalCapacityPx` at a reference bit depth and frame rate; scale it to
 * the actual signal by wire cost. The device cap is frequently *lower* than the sum of
 * the ports and is then the real limit — the MX40 Pro has 20 gigabit ports that could
 * carry 13.2 Mpx between them but the box is rated 9 Mpx.
 */
export function processorCapacity(spec: ProcessorSpec, signal: SignalFormat): number {
  const portSum = spec.ports.reduce((n, p) => n + portCapacity(p, signal).capacityPx, 0);
  if (spec.totalCapacityPx == null) return portSum;

  const refBits = wireBitsPerPixel(spec.referenceBitDepth ?? 8, spec.ports[0]?.packing);
  const refFps = spec.referenceFrameRateHz ?? 60;
  const nowBits = wireBitsPerPixel(signal.bitDepth, spec.ports[0]?.packing);
  const scaled = Math.floor(
    (spec.totalCapacityPx * refBits * refFps) / nowBits / signal.frameRateHz,
  );
  return Math.min(portSum, scaled);
}

// ---------------------------------------------------------------------------
// Drive-side model — can the receiving card actually paint it?
// ---------------------------------------------------------------------------

export interface DriveCheck {
  /** Highest visual refresh achievable, per whichever source we trust most. */
  achievableRefreshHz: number;
  /** True when `achievableRefreshHz` came from a manufacturer figure, not the model. */
  fromDatasheet: boolean;
  ok: boolean;
  detail: string;
}

/**
 * Can this cabinet hit the wanted visual refresh rate?
 *
 * NOTE ON WHAT DOES *NOT* MATTER HERE: the signal bit depth. A panel's quoted refresh
 * rate is achieved at its own internal greyscale depth (`spec.greyscaleBits`, typically
 * 14-16 bit). The receiving card takes the 8/10/12-bit input and drives the LEDs at that
 * internal depth regardless, so feeding a panel 10-bit instead of 8-bit costs link
 * bandwidth but does not cost refresh rate.
 *
 * When a manufacturer figure exists it is used as-is. Otherwise we fall back to a MODEL:
 * a multiplexed panel clocks out `2^greyscaleBits` grey slots for each of `scanRate`
 * row-groups per refresh period, so
 *
 *   maxRefresh = driverClock x spwmGain / (scanRate x 2^greyscaleBits)
 *
 * Real S-PWM driver ICs spread those slots and beat the naive figure, hence the gain
 * term. The model is rough and is labelled as such wherever it surfaces in the UI.
 */
export function driveCheck(
  spec: CabinetSpec,
  receiver: ReceivingCardSpec | undefined,
  signal: SignalFormat,
): DriveCheck {
  const quoted = spec.maxRefreshHz ?? receiver?.maxRefreshHz;
  if (quoted != null) {
    return {
      achievableRefreshHz: quoted,
      fromDatasheet: true,
      ok: quoted >= signal.ledRefreshHz,
      detail: `Manufacturer-quoted ${quoted.toLocaleString()} Hz${
        spec.greyscaleBits ? ` at ${spec.greyscaleBits}-bit internal greyscale` : ''
      }.`,
    };
  }

  const scan = spec.scanRate ?? 1;
  const grey = spec.greyscaleBits ?? 14;
  const DRIVER_CLOCK_HZ = 30e6; // typical 30 MHz shift clock
  const SPWM_GAIN = 512; // S-PWM slot-spreading gain over naive binary-weighted PWM
  const achievable = Math.floor((DRIVER_CLOCK_HZ * SPWM_GAIN) / (scan * 2 ** grey));
  return {
    achievableRefreshHz: achievable,
    fromDatasheet: false,
    ok: achievable >= signal.ledRefreshHz,
    detail: `Modelled from 1/${scan} scan at ${grey}-bit greyscale — this cabinet has no manufacturer refresh figure, treat as indicative only.`,
  };
}

/** Does one cabinet exceed what its receiving card can address? */
export function receiverCheck(
  spec: CabinetSpec,
  receiver: ReceivingCardSpec | undefined,
): { ok: boolean; detail: string } {
  if (!receiver) {
    return { ok: true, detail: 'No receiving card assigned — not checked.' };
  }
  const px = spec.pixelsX * spec.pixelsY;
  if (px > receiver.maxPixels) {
    return {
      ok: false,
      detail: `${px.toLocaleString()} px exceeds the ${receiver.model} limit of ${receiver.maxPixels.toLocaleString()} px.`,
    };
  }
  if (receiver.maxWidthPx && spec.pixelsX > receiver.maxWidthPx) {
    return {
      ok: false,
      detail: `${spec.pixelsX} px wide exceeds the ${receiver.model} limit of ${receiver.maxWidthPx} px.`,
    };
  }
  if (receiver.maxHeightPx && spec.pixelsY > receiver.maxHeightPx) {
    return {
      ok: false,
      detail: `${spec.pixelsY} px high exceeds the ${receiver.model} limit of ${receiver.maxHeightPx} px.`,
    };
  }
  return {
    ok: true,
    detail: `${px.toLocaleString()} px of ${receiver.maxPixels.toLocaleString()} px on the ${receiver.model}.`,
  };
}

/** Highest frame rate a port can sustain for a given pixel count. */
export function maxFrameRateFor(
  port: PortSpec,
  pixels: number,
  bitDepth: BitDepth,
): number {
  if (pixels <= 0) return Infinity;
  const efficiency = port.efficiency ?? DEFAULT_LINK_EFFICIENCY;
  const bps = port.linkSpeedGbps * 1e9 * efficiency;
  return bps / wireBitsPerPixel(bitDepth, port.packing) / pixels;
}
