# Pixel Peeker

A browser tool for designing LED video walls: lay out cabinets on a canvas, add
processors, wire the ports, and find out whether it actually fits — before you find
out on site.

Runs entirely in the browser. No account, no server, nothing uploaded. Deploys to
Cloudflare Pages as a static site.

**Status: alpha.** The maths is tested against published manufacturer figures; the
cabinet library is small; one export format is unverified. See below — the honesty is
the point.

## What it does

- **Lay out a wall.** Pick a cabinet from the library or define a custom panel by
  resolution and receiving card. Fill a canvas, build blocks, or place tiles by hand.
- **Add processing.** NovaStar and Brompton controllers with their real port counts,
  input connectors and device capacity limits.
- **Wire it up.** Auto-wire in serpentine or column order to a chosen fill limit, or
  patch ports by hand. Every port shows its load, its headroom, and the highest frame
  rate it could sustain at that load.
- **Check it.** Overlapping cabinets, unpatched tiles, over-capacity ports, a device
  that runs out before its ports do, an input too small to carry the wall, panels that
  cannot reach the wanted refresh rate, chains that jump around the wall.
- **Export.** PDF report, Resolume Advanced Output XML, cabinet schedule CSV, a
  screen-configuration brief for LCT/VMP, and a versioned JSON interchange file.

## The bit that matters: port capacity

Most LED capacity spreadsheets compute `pixels = link rate ÷ (3 × bit depth) ÷ frame
rate`. That is wrong at 10-bit, and wrong in the direction that gets you into trouble —
it overstates capacity by about 7%.

Controllers pack each colour component into a **power-of-two container** so the DMA
engine stays word-aligned:

| Bit depth | Naive (3 × depth) | Actual container |
|-----------|-------------------|------------------|
| 8-bit     | 24 bits/px        | **24 bits/px**   |
| 10-bit    | 30 bits/px        | **32 bits/px**   |
| 12-bit    | 36 bits/px        | **48 bits/px**   |

With those containers, a single link efficiency of **0.9500** reproduces NovaStar's
three published MX40 Pro per-port figures *exactly*:

| Signal          | NovaStar publishes | Pixel Peeker computes |
|-----------------|--------------------|-----------------------|
| 8-bit @ 60 Hz   | 659,722 px         | 659,722 px            |
| 10-bit @ 60 Hz  | 494,791 px         | 494,791 px            |
| 12-bit @ 60 Hz  | 329,861 px         | 329,861 px            |

With naive packing no single efficiency constant fits all three. The published ratios
(1.00 / 0.75 / 0.50) are exactly 24/24, 24/32 and 24/48. These are pinned in
`src/domain/capacity.test.ts`: if they fail, the model has drifted and every number the
app prints is suspect.

**Two other things it gets right:**

- **LED refresh rate does not consume link bandwidth.** The frame arrives once per
  frame period and the receiving card re-scans it locally at 3840 Hz or whatever else.
  Refresh is checked separately, against the panel's quoted figure, and it is *not*
  reduced by input bit depth — the card drives the LEDs at its own internal greyscale
  depth (14–16 bit) regardless.
- **The device cap is often the real limit, not the ports.** An MX40 Pro's twenty
  gigabit ports could carry 13.2 Mpx between them. The box is rated 9 Mpx.

Brompton is modelled separately: their effective link efficiency is much lower because
a Tessera link carries per-fixture calibration and timing data alongside the pixels.
The figure is back-calculated from Brompton's own published headline (9 Mpx at 12-bit
60 Hz over four 10G trunks), and cross-checks against their statement that each 10G
trunk carries ten 1G fixture links.

## Data provenance

Every cabinet and processor record carries a `verified` flag and a `source`. Verified
records were parsed out of the manufacturer datasheet named in `source` — not typed
from memory, and not taken from a rental house's listing page (those are frequently a
different revision of the same product name). Unverified records are badged in the UI
and called out in the PDF report.

| Manufacturer | Models | Verified |
|--------------|--------|----------|
| Absen        | 14 (Polaris PL V2 series) | ✅ datasheet |
| Aluvision    | 4 (Hi-LED 55 range)       | ✅ datasheet |
| ROE Visual   | 1 (Black Pearl BP2 V2)    | ✅ datasheet |
| Unilumin     | 1 (Upad III 2.6)          | ⚠️ power figures unverified |
| NovaStar     | MX40 Pro                  | ✅ datasheet |
| Brompton     | Tessera SX40              | ✅ datasheet |

Receiving-card pixel limits are **not** verified and are conservative placeholders.

**Adding data:** take it from the manufacturer's own datasheet. Do not copy records out
of another tool's curated database — the individual specs are facts, but a compiled
database is a protected work in its own right under UK/EU database right.

## Export honesty

- **PDF report** — complete and reliable.
- **Cabinet schedule CSV, config brief, JSON interchange** — complete and reliable.
  These carry the full pixel map, port assignments and sending order.
- **Resolume Advanced Output XML** — ⚠️ **unverified.** Built from Resolume's documented
  element names but never round-tripped through Arena, and Resolume state the format is
  internal and changes between releases. A slice CSV with identical geometry ships
  alongside it as a no-risk fallback. To fix properly: export a screensetup preset from
  your Arena version, diff it, and correct the constants in `SCHEMA` in
  `src/export/resolume.ts` — everything version-specific is gathered there.
- **NovaStar LCT `.scr` and VMP project files** — **not generated, by choice.** They are
  proprietary and partly binary. Guessing at the container produces a file that either
  fails to load or, worse, loads with a subtly wrong map — which on site is far more
  damaging than no file at all. The cabinet schedule and the config brief carry the same
  information in a form you can type in or script against.

## Develop

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

## Deploy to Cloudflare Pages

Static SPA — no Worker, nothing server-side.

```bash
npm run deploy
```

Or connect the repo in the Pages dashboard with build command `npm run build` and
output directory `dist`. `wrangler.toml`, `public/_headers` and `public/_redirects` are
already in place.

## Licence

MIT.

---

All figures are calculated, not measured. Verify against the controller before the wall
goes live.
