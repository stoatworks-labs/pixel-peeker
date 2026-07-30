/**
 * Pixel Peeker — core domain types.
 *
 * Units convention (enforced by naming, there is no unit-checking type system here):
 *   *Mm   millimetres
 *   *Px   pixels
 *   *Hz   hertz
 *   *W    watts
 *   *Kg   kilograms
 *
 * PROVENANCE: every spec record carries `verified` + `source`. `verified: true` means the
 * numbers were taken from a manufacturer datasheet that a human checked. Everything else is
 * a plausible placeholder for UI work and MUST NOT be used to quote a real job. The UI
 * surfaces this; do not silently flip the flag.
 */

export type Provenance = {
  /** True only when a human has checked these numbers against a manufacturer datasheet. */
  verified: boolean;
  /** Where the numbers came from, or what still needs checking. */
  source?: string;
};

export type Manufacturer =
  | 'Aluvision'
  | 'Absen'
  | 'ROE Visual'
  | 'Unilumin'
  | 'Custom';

export type ProcessorMake = 'NovaStar' | 'Brompton' | 'Custom';

/** Colour depth of the pixel data on the wire, per colour component. */
export type BitDepth = 8 | 10 | 12;

// ---------------------------------------------------------------------------
// Receiving cards
// ---------------------------------------------------------------------------

export interface ReceivingCardSpec extends Provenance {
  id: string;
  manufacturer: ProcessorMake;
  model: string;
  /** Hard cap on pixels the card can drive, regardless of geometry. */
  maxPixels: number;
  /** Geometry caps, if the card has them (many do — e.g. 256 wide max). */
  maxWidthPx?: number;
  maxHeightPx?: number;
  /** Highest visual refresh the card's driver stage can sustain, at `refreshRefBitDepth`. */
  maxRefreshHz?: number;
  refreshRefBitDepth?: BitDepth;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Cabinets (tiles)
// ---------------------------------------------------------------------------

export interface CabinetSpec extends Provenance {
  id: string;
  manufacturer: Manufacturer;
  series: string;
  model: string;
  pixelPitchMm: number;

  widthMm: number;
  heightMm: number;
  depthMm: number;

  pixelsX: number;
  pixelsY: number;

  weightKg: number;
  /** Peak power draw with an all-white frame at full brightness. */
  powerMaxW: number;
  /** Typical / average power draw for a real programme. */
  powerAvgW: number;

  /** Multiplex ratio denominator — 16 means 1/16 scan. Undefined for static drive. */
  scanRate?: number;
  /** Receiving card fitted as standard, referencing the receiver library. */
  receivingCardId?: string;
  /** Manufacturer-quoted visual refresh rate. Authoritative over the modelled value. */
  maxRefreshHz?: number;
  /**
   * The panel's INTERNAL greyscale processing depth, per colour — typically 14–16 bit.
   * This is not the same thing as `SignalFormat.bitDepth`, which is the depth of the
   * video on the wire (8/10/12). The receiving card takes the 8/10/12-bit input and
   * drives the LEDs at this internal depth, which is why input depth does not change
   * the achievable refresh rate. Conflating the two is the classic error.
   */
  greyscaleBits?: number;
  /** Nits at the quoted refresh/bit depth. */
  brightnessNits?: number;

  notes?: string;
}

export function cabinetPixels(spec: CabinetSpec): number {
  return spec.pixelsX * spec.pixelsY;
}

// ---------------------------------------------------------------------------
// Processors (sending cards / LED processors)
// ---------------------------------------------------------------------------

export type PortMedium = 'RJ45' | 'SFP' | 'SFP+' | 'Fibre';

export interface PortSpec {
  id: string;
  label: string;
  /** Physical line rate of the link. */
  linkSpeedGbps: number;
  medium: PortMedium;
  /**
   * Fraction of the line rate that actually carries pixel payload, after framing,
   * preamble, inter-packet gap and the vendor's own protocol overhead.
   * See `DEFAULT_LINK_EFFICIENCY` in capacity.ts for how the default was calibrated.
   */
  efficiency?: number;
  /** How pixels are packed onto the wire. See `wireBitsPerPixel` in capacity.ts. */
  packing?: 'container' | 'naive';
  /**
   * Some vendors present one physical port as N independent fixture links —
   * a Brompton 10G trunk is ten 1G connections. Informational: capacity is still
   * computed from the trunk's total link rate.
   */
  subLinks?: number;
}

export interface InputSpec {
  id: string;
  connector: string;
  maxWidthPx: number;
  maxHeightPx: number;
  maxFps: number;
  maxBitDepth: BitDepth;
}

export interface ProcessorSpec extends Provenance {
  id: string;
  manufacturer: ProcessorMake;
  model: string;
  ports: PortSpec[];
  inputs: InputSpec[];
  /**
   * Whole-device pixel ceiling at `referenceBitDepth` / `referenceFrameRateHz`.
   * Often lower than the sum of the ports — the device backplane, not the links,
   * is the limit. Undefined means "ports are the only limit".
   */
  totalCapacityPx?: number;
  referenceBitDepth?: BitDepth;
  referenceFrameRateHz?: number;
  /** How the device does backup. `port-pair` = ports pair up as main/backup. */
  redundancy: 'none' | 'port-pair' | 'device';
  notes?: string;
}

// ---------------------------------------------------------------------------
// Signal format — the conditions the whole wall runs at
// ---------------------------------------------------------------------------

export interface SignalFormat {
  bitDepth: BitDepth;
  /** Frame rate of the video signal. This is what consumes link bandwidth. */
  frameRateHz: number;
  /**
   * Visual refresh rate of the LED (the PWM rate the driver ICs run at).
   * This does NOT consume link bandwidth — it is a receiving-card/driver limit.
   * Kept here because it is the number cameras care about.
   */
  ledRefreshHz: number;
}

// ---------------------------------------------------------------------------
// Wall layout
// ---------------------------------------------------------------------------

/** One physical cabinet hung on the wall. */
export interface CabinetInstance {
  id: string;
  specId: string;
  /** Top-left corner, millimetres, in wall space. */
  xMm: number;
  yMm: number;
  /** 0 or 180 only — LED cabinets are not rotated 90° in practice. */
  rotation: 0 | 180;
}

export interface Canvas {
  name: string;
  /** Design envelope. Cabinets may be placed outside it; that is flagged, not blocked. */
  widthMm: number;
  heightMm: number;
  /** Snap grid for placement. */
  snapMm: number;
}

// ---------------------------------------------------------------------------
// Systems and wiring
// ---------------------------------------------------------------------------

/** A processor placed in the show — an instance of a ProcessorSpec. */
export interface ProcessorInstance {
  id: string;
  specId: string;
  name: string;
}

/**
 * An ordered daisy-chain of cabinets hanging off one output port.
 * Order matters: it is the physical cable run, and it is what LCT/VMP call the
 * "sending order". `cabinetIds[0]` is the first cabinet out of the port.
 */
export interface Chain {
  id: string;
  processorId: string;
  portId: string;
  cabinetIds: string[];
  /** Optional colour override for the wiring view. */
  colour?: string;
}

export interface Project {
  schema: 'pixel-peeker/1';
  name: string;
  client?: string;
  venue?: string;
  designer?: string;
  notes?: string;
  canvas: Canvas;
  signal: SignalFormat;
  cabinets: CabinetInstance[];
  processors: ProcessorInstance[];
  chains: Chain[];
  /** Specs authored in this project (custom panels/processors), merged over the library. */
  customCabinets: CabinetSpec[];
  customProcessors: ProcessorSpec[];
  customReceivers: ReceivingCardSpec[];
}
