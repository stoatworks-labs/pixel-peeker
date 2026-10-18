/*
 * Breakout boxes: chains run from a box's outputs, and the trunk is checked as their sum.
 *
 * The per-output figures are each vendor's own per-port number, which the outputs must
 * reproduce because they are costed by `portCapacity` with the trunk's calibration (or,
 * on the XD-T, the outputs' own) — the pins on the trunks themselves stay in
 * capacity.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { breakoutOutputId, outputLinks, portOutputs } from './breakout';
import { portCapacity } from './capacity';
import { dataLine } from './data-line';
import type { BreakoutSpec, Chain, ProcessorSpec, Project } from './types';
import { buildGrid } from './wall';
import { autoWire, computeLoads, validateWiring } from './wiring';
import { cabinetById } from '../data/cabinets';
import { BREAKOUT_LIBRARY, PROCESSOR_LIBRARY, TESSERA_XD, processorById } from '../data/processors';

const at60 = (bitDepth: 8 | 10 | 12) => ({ bitDepth, frameRateHz: 60, ledRefreshHz: 3840 });

/* A 200x200 px tile: 40,000 px. */
const SPEC_ID = 'absen-pl25-pro-v2-novastar';
const lookup = (id: string) => cabinetById(id);
const procLookup = (id: string) => processorById(id);

function project(specId: string, cols: number, rows: number): Project {
  let n = 0;
  return {
    schema: 'pixel-peeker/1',
    name: 'Breakout',
    canvas: { name: 'Main', widthMm: 50_000, heightMm: 10_000, snapMm: 1 },
    signal: { bitDepth: 8, frameRateHz: 60, ledRefreshHz: 3840 },
    cabinets: buildGrid(cabinetById(SPEC_ID)!, cols, rows, 0, 0, () => `cab-${n++}`),
    processors: [{ id: 'p1', specId, name: 'P1' }],
    chains: [],
    customCabinets: [],
    customProcessors: [],
    customReceivers: [],
  };
}

/*
 * No box in the library has more outputs than its trunk carries, so the trunk check is
 * exercised on a made-up one: twelve 1G outputs on an SX40's ten-link trunk. (A real
 * XD-T on an SX40 does not do this. It runs only its first ten ports there.)
 */
const OVERSUBSCRIBED: BreakoutSpec = {
  ...TESSERA_XD,
  id: 'test-oversubscribed',
  model: 'Test 12-way',
  outputs: 12,
  verified: false,
  source: 'test fixture',
};
const sx40 = processorById('brompton-sx40')!;
const OVER_SPEC: ProcessorSpec = {
  ...sx40,
  id: 'test-oversubscribed-sx40',
  ports: sx40.ports.map((p) => ({ ...p, breakout: OVERSUBSCRIBED })),
};
const overLookup = (id: string) => (id === OVER_SPEC.id ? OVER_SPEC : processorById(id));

function wire(p: Project, fillTo = 1, procs: (id: string) => ProcessorSpec | undefined = procLookup) {
  let c = 0;
  const r = autoWire(p, lookup, procs, { pattern: 'serpentine-v', fillTo, skipPatched: false }, () => `ch-${c++}`);
  p.chains = r.chains;
  return r;
}

describe('breakout outputs reproduce the vendor per-port figure', () => {
  it.each([
    ['novastar-mx6000-pro-5g', 'CVT8-5G', 8, 2_951_200],
    ['novastar-mx2000-pro', 'CVT10', 10, 659_722],
    ['brompton-sx40', 'Tessera XD', 10, 525_000],
    ['brompton-sq200', 'Tessera XD-T', 12, 525_000],
  ] as const)('%s: %s, %i outputs of %i px at 8-bit/60', (id, model, outputs, published) => {
    const trunk = processorById(id)!.ports[0];
    expect(trunk.breakout?.model).toBe(model);
    const links = portOutputs(trunk);
    expect(links).toHaveLength(outputs);
    for (const link of links) {
      expect(link.trunk).toBe(trunk);
      expect(portCapacity(link.port, at60(8)).capacityPx).toBe(published);
    }
  });

  it('gives the CVT8-5G output the published 12-bit figure too', () => {
    const [out] = portOutputs(processorById('novastar-mx6000-pro-5g')!.ports[0]);
    expect(portCapacity(out.port, at60(12)).capacityPx).toBe(1_475_600);
  });

  it('never lets one output carry more than its trunk', () => {
    for (const proc of PROCESSOR_LIBRARY) {
      for (const port of proc.ports.filter((p) => p.breakout)) {
        for (const depth of [8, 10, 12] as const) {
          const trunk = portCapacity(port, at60(depth)).capacityPx;
          for (const o of portOutputs(port)) {
            expect(portCapacity(o.port, at60(depth)).capacityPx).toBeLessThanOrEqual(trunk);
          }
        }
      }
    }
  });

  it('leaves a port with no breakout as its own single output', () => {
    const mx40 = processorById('novastar-mx40-pro')!;
    const links = outputLinks(mx40);
    expect(links.map((l) => l.port)).toEqual(mx40.ports);
    expect(links.every((l) => !l.trunk)).toBe(true);
  });

  it('has a datasheet behind every box', () => {
    for (const b of BREAKOUT_LIBRARY) {
      expect(b.source).toBeTruthy();
      expect(b.verified).toBe(true);
    }
  });

  it('carries all twelve XD-T outputs down an SQ200 trunk, at every depth', () => {
    const trunk = processorById('brompton-sq200')!.ports[0];
    for (const depth of [8, 10, 12] as const) {
      const outputs = portOutputs(trunk).reduce((n, o) => n + portCapacity(o.port, at60(depth)).capacityPx, 0);
      expect(portCapacity(trunk, at60(depth)).capacityPx).toBe(outputs);
    }
  });
});

describe('wiring through a breakout box', () => {
  it('patches chains to CVT8-5G outputs, each within one 5G link', () => {
    /* 400 tiles = 16 Mpx: more than five 5G outputs' worth, so it spills onto a sixth. */
    const p = project('novastar-mx6000-pro-5g', 40, 10);
    const r = wire(p);
    expect(r.unassigned).toEqual([]);
    const trunk = processorById('novastar-mx6000-pro-5g')!.ports[0];
    expect(p.chains[0].portId).toBe(breakoutOutputId(trunk, 1));
    for (const ch of p.chains) expect(ch.cabinetIds.length).toBeLessThanOrEqual(73);
    expect(p.chains).toHaveLength(Math.ceil(400 / 73));

    const loads = computeLoads(p, lookup, procLookup);
    const issues = validateWiring(p, loads, lookup);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(loads[0].ports).toHaveLength(64);
    expect(loads[0].trunks).toHaveLength(8);
    expect(loads[0].trunks[0].usedPx).toBe(400 * 40_000);
  });

  it('flags a chain patched to the trunk itself, as files from before breakouts have', () => {
    const p = project('novastar-mx6000-pro-5g', 10, 10);
    const legacy: Chain = { id: 'old', processorId: 'p1', portId: 'out1-opt1', cabinetIds: p.cabinets.map((c) => c.id) };
    p.chains = [legacy];
    const issues = validateWiring(p, computeLoads(p, lookup, procLookup), lookup);
    const e = issues.find((i) => i.code === 'no-such-output');
    expect(e?.message).toMatch(/CVT8-5G/);
    expect(e?.refs).toEqual(['old']);
  });

  it('fills all twelve XD-T outputs on an SQ200 trunk, as the XD-T sheet allows', () => {
    /* 13 tiles per 1G output, 156 per trunk: the QD-S trunk carries all twelve. */
    const p = project('brompton-sq200', 20, 8);
    const r = wire(p);
    const loads = computeLoads(p, lookup, procLookup);
    const t = loads[0].trunks[0];
    expect(t.usedPx / 40_000).toBe(156);
    expect(t.outputs.filter((o) => o.cabinets.length === 13)).toHaveLength(12);
    expect(r.notes.some((n) => /ran out of trunk/.test(n))).toBe(false);
    expect(validateWiring(p, loads, lookup).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('stops filling at the trunk when a box has more outputs than its trunk carries', () => {
    /* 13 tiles per 1G output; the ten-link trunk holds 131, not 12 x 13 = 156. */
    const p = project(OVER_SPEC.id, 20, 8);
    const r = wire(p, 1, overLookup);
    const loads = computeLoads(p, lookup, overLookup);
    const t = loads[0].trunks[0];
    expect(t.usedPx).toBeLessThanOrEqual(t.capacityPx);
    expect(t.usedPx / 40_000).toBe(131);
    expect(r.notes.some((n) => /ran out of trunk/.test(n))).toBe(true);
    expect(validateWiring(p, loads, lookup).some((i) => i.code === 'trunk-over-capacity')).toBe(false);
  });

  it.each([
    ['brompton-sq200', procLookup, false],
    [OVER_SPEC.id, overLookup, true],
  ] as const)('%s: twelve outputs of 13 tiles wired by hand, trunk over capacity: %s', (id, procs, over) => {
    const p = project(id, 13, 12);
    const trunk = procs(id)!.ports[0];
    p.chains = Array.from({ length: 12 }, (_, i) => ({
      id: `ch-${i}`,
      processorId: 'p1',
      portId: breakoutOutputId(trunk, i + 1),
      cabinetIds: p.cabinets.slice(i * 13, i * 13 + 13).map((c) => c.id),
    }));
    const issues = validateWiring(p, computeLoads(p, lookup, procs), lookup);
    expect(issues.some((i) => i.code === 'port-over-capacity')).toBe(false);
    const trunkIssue = issues.find((i) => i.code === 'trunk-over-capacity');
    if (over) expect(trunkIssue?.refs).toHaveLength(12);
    else expect(trunkIssue).toBeUndefined();
  });
});

describe('Line calc through a breakout box', () => {
  const tile = { pixelsX: 200, pixelsY: 200 };

  it('counts panels per CVT8-5G output, not per 40G trunk', () => {
    const r = dataLine(tile, processorById('novastar-mx6000-pro-5g')!, at60(8));
    expect(r.panelsPerPort).toBe(73);
    expect(r.trunk?.breakout?.model).toBe('CVT8-5G');
    expect(r.portCount).toBe(64);
    expect(r.trunkBound).toBe(false);
  });

  it('counts every XD-T output on an SQ200, and the trunks do not bind', () => {
    const r = dataLine(tile, processorById('brompton-sq200')!, { bitDepth: 8, frameRateHz: 120 });
    /* 262,500 px per output at 120 Hz: 6 tiles, 72 per trunk; the trunk carries 78. */
    expect(r.panelsPerPort).toBe(6);
    expect(r.portCount).toBe(144);
    expect(r.trunk?.breakout?.model).toBe('Tessera XD-T');
    expect(r.trunkBound).toBe(false);
  });

  it('holds a trunk to what it carries when its box has more outputs than that', () => {
    const r = dataLine(tile, OVER_SPEC, { bitDepth: 8, frameRateHz: 120 });
    /* 6 tiles per output, twelve outputs = 72; the ten-link trunk only 65. */
    expect(r.panelsPerPort).toBe(6);
    expect(r.portCount).toBe(48);
    expect(r.trunkBound).toBe(true);
  });
});
