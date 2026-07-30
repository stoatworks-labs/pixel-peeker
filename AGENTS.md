# AGENTS.md — bringing an LLM up to speed on Pixel Peeker

Orientation for an AI assistant (or a new human) picking this up cold. `README.md` is
the user-facing story; this file is the map, the invariants, and how to tell finished
work from scaffolding.

---

## 1. What this is

A **static browser app** for designing LED video walls — cabinet layout, processor
patching, port capacity, and export to the formats a video crew actually uses. React +
TypeScript + Vite, deployed to Cloudflare Pages. Everything runs client-side; there is
no backend and there should never be one.

Public repo, MIT.

## 2. Layout

```
src/
  domain/       The whole model. No React in here, ever.
    types.ts       Data shapes + the provenance contract
    capacity.ts    THE IMPORTANT FILE — port/device capacity + refresh feasibility
    wall.ts        Geometry, derived physical figures, layout validation
    wiring.ts      Port loading, wiring validation, auto-wire
    pixelmap.ts    Shared pixel-space map that every export builds on
  data/         The library. Facts from datasheets, each with a provenance flag.
  export/       PDF, Resolume XML, NovaStar/interchange
  state/        One zustand store: project document + selection + undo
  ui/           React components. Presentation only — no maths in here.
```

**`domain/` must stay React-free and side-effect-free.** It is the part that is tested,
and the part whose correctness the whole product rests on. If you find yourself
importing a hook into `domain/`, the design has gone wrong.

**`ui/` must not do arithmetic that belongs in `domain/`.** If a component computes a
capacity, a pixel coordinate or a power figure inline, move it. The exports and the
canvas have to agree, and the only way to guarantee that is one implementation.

## 3. Build, run, test

```bash
npm run dev        # vite dev server
npm test           # vitest — capacity model + export regression
npm run typecheck  # tsc -b across app + test configs
npm run build      # tsc -b && vite build
npm run deploy     # build + wrangler pages deploy
```

**tsconfig trap:** tests are Node-flavoured (`node:fs`, `Buffer`, `process`) and are
excluded from `tsconfig.app.json`, which is browser-only. They are typechecked by
`tsconfig.test.json`. If you add a test and `tsc -b` complains it cannot find `process`,
you have put it somewhere the test config does not `include`.

## 4. The invariants that matter

### 4.1 Capacity maths is calibrated, not guessed

`src/domain/capacity.ts` is the heart of the app. Two rules:

1. **Pixels are packed into power-of-two containers** — 8-bit → 24 bits/px, 10-bit → 32,
   12-bit → 48. Not `3 × bitDepth`. This is derived from NovaStar's published figures,
   not assumed.
2. **Link efficiency is 0.9500 for NovaStar**, which reproduces all three of their
   published MX40 Pro per-port numbers to the pixel. Brompton is calibrated separately
   from their own headline figure.

`capacity.test.ts` pins these against the published numbers. **If those tests fail, fix
the model — do not relax the test.** They are the only thing standing between this app
and a plausible-looking spreadsheet that is quietly wrong.

### 4.2 Link bandwidth and drive capability are different things

The single most common error in this domain, and one an earlier draft of this file made:

- **Link capacity** depends on link rate, bit depth and **frame rate**. LED refresh rate
  is irrelevant to it.
- **Drive capability** (can the card paint it at 3840 Hz?) depends on the driver IC,
  scan ratio and the panel's **internal greyscale depth** (14–16 bit). Input bit depth
  is irrelevant to it — the card upsamples to its own depth regardless.

Anything that scales refresh rate by input bit depth is a bug. That was written once and
corrected; do not reintroduce it.

### 4.3 Provenance is not decoration

Every record in `data/` has `verified: boolean` and `source: string`.

- `verified: true` means **a human checked it against the manufacturer datasheet named
  in `source`**. Nothing else earns that flag.
- Do not flip a flag to true to silence a UI badge.
- Do not populate the library from another tool's database. Primary sources only —
  individual specs are facts, a compiled database is not.

Rental-house listing pages are *not* primary sources; they routinely describe a
different revision under the same product name.

### 4.4 Exports must not fabricate proprietary containers

`export/novastar.ts` deliberately does **not** emit `.scr` or `.vmp` files. This is a
decision, not an omission — read the block comment before "fixing" it. A file that loads
with a subtly wrong map is worse on site than no file.

`export/resolume.ts` *does* emit XML, but is clearly labelled unverified in the code, in
the UI and in the report. Everything version-specific lives in the `SCHEMA` constant so
that correcting it against a real Arena export is one edit.

## 5. What is genuinely done vs scaffolding

**Done and tested:**
- Capacity model, calibrated against two vendors' published figures (12 tests)
- Wall geometry, stats, layout validation
- Auto-wire (serpentine/column/row) with fill limits, and wiring validation
- Pixel map, PDF report, cabinet schedule, config brief, JSON interchange (9 tests)
- Canvas: place, marquee-select, nudge, delete, pan/zoom, undo/redo
- Cloudflare Pages config, lazy-loaded PDF bundle

**Scaffolding / known gaps:**
- **Cabinet library is small** — 20 models. The schema and importer path matter more
  than the count, but it needs filling out from datasheets.
- **Receiving card limits are placeholders**, all `verified: false`.
- **Resolume XML is unverified** against a real Arena install.
- **No manual port patching UI** — you can auto-wire or clear, but not drag a cabinet
  onto a specific port. `patchCabinetsTo` exists in the store and is unused.
- **No CSV/JSON import** for bulk-loading a cabinet library.
- **No redundancy modelling** — `ProcessorSpec.redundancy` is recorded but not used in
  any calculation or check.
- **Mixed-pitch walls** produce an approximate pixel map, flagged but not solved.

## 6. Conventions

- British spelling in user-facing text and comments (`colour`, `metre`, `utilisation`).
- Units are carried in identifier names: `xMm`, `capacityPx`, `powerMaxW`, `frameRateHz`.
  There is no unit type system; the naming is the discipline.
- Comments explain **why**, especially where a number looks arbitrary. Every magic
  constant in `capacity.ts` has its derivation written next to it.
- The wall coordinate system is millimetres, origin top-left, +x right, +y down.
  Pixel space is derived from it, never stored.
