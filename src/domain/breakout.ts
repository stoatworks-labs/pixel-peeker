/**
 * Pixel Peeker — breakout boxes: where a trunk port turns into cable runs.
 *
 * A trunk (a 40G fibre to a CVT8-5G, a 10G fibre to a CVT10, a Tessera 10G trunk to an
 * XD) is not something a cabinet plugs into. The chain of cabinets runs from one of the
 * box's outputs, so the limit on a chain is ONE output link, not the trunk. Patching a
 * chain to the trunk itself let one daisy-chain take eight 5G links' worth of pixels.
 *
 * NOT A SECOND CAPACITY MODEL. An output is a `PortSpec` like any other — the trunk
 * port's own efficiency and packing at the box's output link rate — and is costed by
 * `portCapacity`. Every output in the library reproduces its vendor's per-port figure
 * that way (breakout.test.ts): 2,951,200 px per CVT8-5G output, 659,722 per CVT10
 * output, 525,000 per XD and XD-T output, all at 8-bit/60. The XD-T is the one box
 * whose trunk runs faster than its outputs (an SQ200's QD-S trunk carries twelve 1G
 * links), so it names its outputs' efficiency instead (`BreakoutSpec.outputEfficiency`).
 *
 * Every processor port is an "output link" here; a port without a breakout is its own
 * single output. Wiring, auto-wire, the exports and Line calc all walk output links,
 * so a direct-port box behaves exactly as it did before breakouts existed.
 */

import type { PortSpec, ProcessorSpec } from './types';

export interface OutputLink {
  /** What a chain is patched to and costed against — the port, or one box output. */
  port: PortSpec;
  /** Set when `port` is an output of a breakout box on this trunk port. */
  trunk?: PortSpec;
  /** 1-based output number on the box. */
  output?: number;
}

/** The id a chain uses for output `n` of the box on `trunk`. */
export function breakoutOutputId(trunk: PortSpec, n: number): string {
  return `${trunk.id}/${n}`;
}

/** The output links one processor port provides: itself, or its box's outputs. */
export function portOutputs(port: PortSpec): OutputLink[] {
  const box = port.breakout;
  if (!box) return [{ port }];
  return Array.from({ length: box.outputs }, (_, i) => {
    const n = i + 1;
    const { breakout: _box, efficiencyByDepth, ...link } = port;
    const calibration =
      box.outputEfficiency != null
        ? { efficiency: box.outputEfficiency }
        : efficiencyByDepth
          ? { efficiencyByDepth }
          : {};
    return {
      port: {
        ...link,
        ...calibration,
        id: breakoutOutputId(port, n),
        label: `${port.label} › ${box.model} ${n}`,
        linkSpeedGbps: box.outputLinkGbps,
        medium: box.outputMedium,
      },
      trunk: port,
      output: n,
    };
  });
}

/** Every output link on a processor, in port order. */
export function outputLinks(spec: ProcessorSpec): OutputLink[] {
  return spec.ports.flatMap(portOutputs);
}
