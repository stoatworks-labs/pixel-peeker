# CLAUDE.md — command reference

See `AGENTS.md` for the mental model, invariants and traps. This file is commands only.

```bash
npm install
npm run dev        # vite dev server (port 5173)
npm test           # vitest: capacity calibration + export regression
npm run typecheck  # tsc -b (app + test projects)
npm run build      # tsc -b && vite build -> dist/
npm run deploy     # build + wrangler pages deploy dist
```

Write export artefacts to disk while testing:

```bash
PP_WRITE_ARTEFACTS=/tmp/pp npx vitest run
```

Key files:

- `src/domain/capacity.ts` — port/device capacity. Calibrated against published vendor
  figures; `capacity.test.ts` pins it. Fix the model, never the test.
- `src/data/cabinets.ts`, `src/data/processors.ts` — the library. Every record needs
  `verified` + `source`. Primary datasheets only.
- `src/export/resolume.ts` — version-specific bits live in `SCHEMA`.
- `src/export/novastar.ts` — deliberately does not emit `.scr`/`.vmp`. Read the comment.
