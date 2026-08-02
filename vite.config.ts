import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
import react from '@vitejs/plugin-react';

/**
 * Replace the NovaStar export module with an empty stub in `lite` mode.
 *
 * Why this is needed on top of the `NOVASTAR_EXPORTS` flag: Rollup does eliminate the
 * guarded JSX, but it decides chunk boundaries from the module graph *before* that
 * elimination, so it still emitted a `novastar-*.js` chunk that nothing imported. An
 * orphaned 4 kB chunk is never fetched, but shipping dead code in a build whose whole
 * purpose is "this variant does not do NovaStar" is the wrong signal.
 *
 * Resolving the specifier to a stub means the real module never enters the graph at all.
 */
function stripNovaStarExports(): Plugin {
  const STUB = '\0pixel-peeker:absent-export';
  return {
    name: 'pixel-peeker:strip-novastar-exports',
    enforce: 'pre',
    resolveId(source) {
      return /(^|\/)export\/novastar(\.ts)?$/.test(source) ? STUB : null;
    },
    load(id) {
      if (id !== STUB) return null;
      // Never reached at runtime: every call site sits behind a false constant and is
      // eliminated. These exist only so the import still resolves.
      const dead = '() => { throw new Error("NovaStar exports are not in this build"); }';
      return [
        `export const buildCabinetScheduleCsv = ${dead};`,
        `export const buildLctBrief = ${dead};`,
        `export const buildInterchange = ${dead};`,
      ].join('\n');
    },
  };
}

export default defineConfig(({ mode }) => ({
  // The About dialog shows the version the build actually produced. about-data.js
  // carries one baked at sync time as a fallback, and it goes stale the moment a
  // release is tagged; this is the one that is always right.
  define: { __APP_VERSION__: JSON.stringify(`v${pkg.version}`) },
  plugins: [react(), ...(mode === 'lite' ? [stripNovaStarExports()] : [])],
}));
