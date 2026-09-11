# Notes

Working notes for this repo: status, decisions, and the traps that have actually bitten.
Migrated out of Claude Code's memory on 2026-08-24, so they are written in the first
person and dated by when each thing was learned — that date is usually the useful part.

Cross-cutting notes that are not specific to this repo live in
[fleet-notes](https://github.com/stoatworks-labs/fleet-notes).

*Pixel Peeker — static browser app for designing LED video walls (cabinet layout, processor patching, port capacity, exports); the capacity model is calibrated against published vendor figures*

**PUBLIC since 2026-08-05** — the private-repo statements below are historical; the repo, its Docker packaging and its `/software` page are all live. See [browser tools published](https://github.com/stoatworks-labs/fleet-notes/blob/main/notes/project_browser_tools_published.md).

**Pixel Peeker** — LED video wall designer, React+TS+Vite static SPA for Cloudflare
Pages. `~/Projects/pixel-peeker`, MIT, **GitHub PRIVATE** (verified 2026-07-31) at
`stoatworks-labs/pixel-peeker` (pushed 2026-07-30). No CI workflow yet; not yet
deployed to Pages; no `diag` module yet.

**Private on purpose, and permanently: the repo exists only to feed the deployed web
app.** Not a distributable product — no releases, no installers, no download links, and
correctly absent from the fleet's download tooling (`gen-downloads.py`). Same for
[blend calc](https://github.com/stoatworks-labs/blend-calc/blob/main/docs/NOTES.md) (`blend-calc`). Missing downloads here is the design, not a gap to close.

The differentiator is the capacity maths, which is *calibrated, not assumed*:

- Vendors pack colour components into **power-of-two containers** — 8-bit → 24 bits/px,
  10-bit → **32** (not 30), 12-bit → **48** (not 36). Naive `3 × bitDepth` overstates
  10-bit capacity by ~7%.
- With those containers, a single link efficiency of **0.9500** reproduces all three of
  NovaStar's published MX40 Pro per-port figures exactly (659,722 / 494,791 / 329,861 px
  at 8/10/12-bit @60Hz). Naive packing fits none of them.
- **LED refresh rate does not consume link bandwidth** — only frame rate does. Refresh is
  a receiving-card/driver limit, checked separately, and is *not* reduced by input bit
  depth (the card drives at its own 14–16-bit internal greyscale).
- **Device cap is often below the sum of the ports** — MX40 Pro's 20 GbE ports could
  carry 13.2 Mpx; the box is rated 9 Mpx.
- Brompton calibrated separately (much lower effective efficiency — Tessera links carry
  calibration/timing data too), back-calculated from their 9 Mpx @ 12-bit/60Hz headline.

All of the above is pinned in `src/domain/capacity.test.ts`. Fix the model, never the test.

**Deliberate non-features:** LCT `.scr` and VMP project files are proprietary/partly
binary and are **not fabricated** — a subtly wrong map is worse on site than no file.

**Resolume export reuses blend-calc's verified schema.** Written first from Resolume's
public docs and it was substantially wrong (rects as attributes, no Warper/OutputDevice/
uniqueIds); replaced with the Arena 7.27.0 schema `blend-calc` reverse-engineered from
real files on this Mac. **Always check whether another fleet repo already solved a
format before generating one from documentation.** Layout here is one Screen per
processor, one Slice per port.

Related: [led panel data sources](https://github.com/stoatworks-labs/fleet-notes/blob/main/notes/reference_led_panel_data_sources.md), **commit means push** (working-practice note, kept in Claude memory).

## Processor library: NovaStar, 2026-08-28

Added the rest of the COEX MX line (MX30, MX20, MX2000 Pro, MX6000 Pro) and the MCTRL
generation (MCTRL4K, MCTRL660, MCTRL660 PRO), all from `oss.novastar.tech` specification
PDFs. Eleven processors now, up from two.

**The calibration is no longer a derivation.** The MX20, MX30, MX2000 Pro and MX6000 Pro
datasheets print NovaStar's formula outright — `Load capacity × 24 × Frame rate < 1e9 ×
0.95`, and the same at 32 and 48 bits. Both constants this app had reverse-engineered
from three MX40 Pro figures are stated by the vendor. Worth remembering when a vendor
number looks unobtainable: **look in the smaller sibling's datasheet, not the flagship's**
— the MX20 sheet is the one that shows the working, and the MX40 Pro sheet does not.

Three things that were genuinely new, not just more records:

- **The 10-bit container is a receiving-card property, not a controller one.** NovaStar
  print two load tables per box: A10s Pro gets a 32-bit container (494,791 px/port at
  60 Hz), every other Armor card gets 48 (329,861). The model assumes A10s Pro
  throughout, so it overstates 10-bit by 50% on an A8s wall. Recorded as a known gap in
  AGENTS.md rather than half-fixed — `portCapacity` has no receiver in scope.
- **The MCTRL generation is a slower link, not just a coarser quote.** 0.936 rather than
  0.95, and no 32-bit path at all. Over-determined: the MCTRL660 PRO publishes 650,000
  and 325,000, exactly 2:1, which only works at 24 vs 48 bits. Added `container-legacy`.
- **A canvas ceiling is not a bandwidth ceiling.** The MCTRLs are send-only, so the wall
  *is* the input canvas and the MCTRL4K's 8.8 Mpx is just 4096×2160 — it does not shrink
  when you feed the box 12-bit, whereas its ports do. Scaling it by wire cost like
  `totalCapacityPx` would have understated the box by 15% at 12-bit. Added `maxCanvasPx`,
  which is deliberately exempt from bit-depth scaling. The COEX all-in-ones scale and
  compose layers, so they get no such ceiling.

Two vendor errors found in passing, both left as-is with the model calibrated against
the self-consistent majority: the MX6000 Pro sheet prints `× 0.95` for the 5G solution's
10/12-bit rows while the table beneath it works out at 0.7465, and the 5G table's whole
10-bit column is 0.029% low because they rounded 2,073,600 to 2,073,000 at 60 Hz and
then scaled that across the column.

MX2000 Pro and MX6000 Pro are card-based chassis, so each is **two** records — the 1G
(`MX_4x10G_Fiber`) and 5G (`CX_1x40G_Fiber`) solutions are different systems needing
different receiving cards, and their maths has nothing in common. Modelled with the
trunk-plus-`subLinks` pattern already used for Brompton. Input cards are represented as
one card's worth, with the slot count in `notes`.

## Library expansion and two recalibrations, 2026-09-11

150 cabinets (from 20) and 15 processors (from 11), every new record from the maker's
own sheet. The cabinet library is now `src/data/cabinets/<maker>.ts` with an `index.ts`
aggregator, and `src/data/library.test.ts` sanity-checks every record — pitch against
pixel count, W/m² against W/panel, receiving-card ids — because at 150 records a typo
is a matter of when.

**Where each maker's sheets actually are** (the fleet note on data sources still holds,
these are the additions):

- **Gloshine** — `gloshine.com/service/download` has single-page datasheets for the
  Carbon, Curface Pro, Dawn, Column, AR, Legend and Vanish series. They are *image*
  PDFs: `pdftotext` returns nothing, `tesseract` gets the light-on-dark tables about
  half right, and the reliable route is `pdftoppm -r 110`, crop the table, and read it.
  The website's product tables (MV Ultra, MR, CS II, ZS III…) omit power and resolution,
  so those series are not in the library.
- **Absen** — `usabsen.com` product pages link both a "Specifications" PDF (one page
  per SKU, the primary) and a marketing cutsheet. They disagree: PL2.5-C Plus V2X power
  (700 vs 640 W/m²) and the whole AX1.5 Pro (810/270 W/m² at 1000 nits in the 2022
  spec, 546/182 at 1800 nits in the 2025 cutsheet). The spec is used and the
  disagreement is in the record's notes.
- **Aluvision** — their own site gates datasheets behind an extranet login and a
  newsletter form; PSCo (UK distributor) mirrors the Hi-LED pro P1.9 sheets, which are
  in Absen's house format. The four Hi-LED 55 tiles already here are the whole straight
  range; the US 2025 catalogue is the only edition that prints scan rates.
- **ROE** — every product page on `roevisual.com` links a brochure with a
  "Specifications" page; `pdftotext -layout` parses cleanly, multi-model tables split on
  two-space runs. Power is per panel. The Vanish Acoustics brochure prints no weight.
- **Unilumin** — `unilumin.com` gates its PDFs behind a captcha; `unilumin-usa.com`
  product pages link per-model sheets on HubSpot with no gate. Where a tile ships with
  either card the sheet prints two power figures ("150/155 W") — Nova/Brompton in
  that order — and the higher is recorded.
- **NovaStar** — `novastar.tech/download` (JS-rendered; read the links out of the DOM)
  now serves V1.5.1 specifications from `en-website001.oss-*.aliyuncs.com`, not
  `oss.novastar.tech`.

**NovaStar re-rated the 5G solution and nobody announced it.** V1.1.1 (2023) gave the
`CX_1x40G_Fiber` card 2,592,000 / 2,073,000 / 1,728,000 px per 5G link at 60 Hz —
naive 24/30/36 packing at 0.7465, which this app faithfully modelled. V1.5.0
(2025-09-30) prints a new formula (`× 24 < 5G × 0.85`, `× 32 < 5G × 0.88`,
`× 48 < 5G × 0.85`) and table: 2,951,200 / 2,291,312 / 1,475,600. Same card, same
CVT8-5G; new receiving cards named (XA50 Pro, CA50E). The release notes do not mention
it. The model now follows V1.5.1, `naive` packing is no longer used by any NovaStar
port, and `PortSpec.efficiencyByDepth` exists because 10-bit runs at its own constant.
The 24 Hz row is rounded down to a thousand and the column scaled from it, so the
reproducing constant is 0.8499456 rather than 0.85 — same trick as 0.746496 before it.
The 1G figures are unchanged across every V1.5.1 sheet checked (MX40 Pro, MX30, MX20,
MX2000 Pro, MX6000 Pro).

**Brompton's link was mis-calibrated, and their own table says so.** The 0.648 constant
was back-calculated from "9 Mpx at 12-bit over four 10G trunks" on the assumption that
9 Mpx was a link limit. Brompton publish a per-port table
(`dl.bromptontech.com/tessera/docs/processor_capacity/`, JS-rendered — read the
`<table>` elements): 525,000 / 420,000 / 350,000 px per gigabit output at 8/10/12-bit,
60 Hz, i.e. 24 : 30 : 36 bits at 756 Mbps. Naive packing, at a Brompton constant. And
the SX40 is 9 Mpx at *every* bit depth up to 60 Hz, 7.5 at 72 Hz, 4.5 at 120 — a
processor cap that ignores bit depth and halves with frame rate, which neither
`totalCapacityPx` (scales by both) nor `maxCanvasPx` (scales by neither) could express.
`ProcessorSpec.capacityScaling: 'pixel-rate'` is the third shape. The old model
understated every Brompton port by 30% at 8-bit and overstated the SX40 by 2× at 8-bit.

**Receiving cards are verified now.** A10s Pro 512×512 (512×384 at 12-bit), A8s Pro
512×512, A8s and A5s Plus 512×384, A4s 256×256, Brompton R2 262,144. The old R2
placeholder was 2.5× too generous.

**The pixel map was dividing by the datasheet's rounded pitch.** `pixelPitchMm` is a
label — Absen print 2.97 for 500/168 = 2.976 — and `Math.round(1000 / 2.97)` is 337,
not 336, so the second PL2.9 across sat a pixel out and every one after it too. Nothing
in the 20-record library tripped it in a test because the test wall was PL2.5, whose
pitch is exactly 2.5. `truePitchMm` (width / pixels) is what the map divides by now;
the label stays for display and mixed-pitch detection. `pixelmap.test.ts` pins it.

Deliberately not added: mesh and transparent panels with a non-square pitch (the model
has one pitch per axis), curved-only and cube-only variants, fixed-install fine pitch,
and Absen's PL V3 corner panels. Colorlight, Megapixel HELIOS and Evision processors
would need a `ProcessorMake` extension; ROE now list Evision as the *only* platform on
Graphite and Topaz.
