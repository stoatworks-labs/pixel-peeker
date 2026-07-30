/**
 * Pixel Peeker — top-level layout.
 *
 * The signal format lives in the top bar rather than a settings dialog on purpose:
 * changing bit depth or frame rate re-costs every port on the wall, and that needs to
 * be one click away with the consequences visible in the same glance.
 */

import { useStore } from '../state/store';
import { LibraryPanel } from './LibraryPanel';
import { SystemPanel } from './SystemPanel';
import { WallCanvas } from './WallCanvas';
import { wireBitsPerPixel } from '../domain/capacity';
import type { BitDepth } from '../domain/types';

const FRAME_RATES = [23.98, 24, 25, 29.97, 30, 50, 59.94, 60, 100, 119.88, 120, 240];
const REFRESH_RATES = [1920, 2880, 3840, 7680];

export function App() {
  const project = useStore((s) => s.project);
  const setSignal = useStore((s) => s.setSignal);
  const setMeta = useStore((s) => s.setMeta);
  const stats = useStore((s) => s.derived.stats);
  const loads = useStore((s) => s.derived.loads);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);

  const totalCapacity = loads.reduce((n, l) => n + l.capacityPx, 0);
  const totalUsed = loads.reduce((n, l) => n + l.usedPx, 0);

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          PIXEL<span>PEEKER</span>
        </div>

        <input
          className="name-input"
          value={project.name}
          onChange={(e) => setMeta({ name: e.target.value })}
          aria-label="Project name"
        />

        <div className="field">
          <label>Bit depth</label>
          <select
            value={project.signal.bitDepth}
            onChange={(e) => setSignal({ bitDepth: Number(e.target.value) as BitDepth })}
          >
            <option value={8}>8-bit</option>
            <option value={10}>10-bit</option>
            <option value={12}>12-bit</option>
          </select>
        </div>

        <div className="field">
          <label>Frame rate</label>
          <select
            value={project.signal.frameRateHz}
            onChange={(e) => setSignal({ frameRateHz: Number(e.target.value) })}
          >
            {FRAME_RATES.map((f) => (
              <option key={f} value={f}>
                {f} Hz
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>LED refresh</label>
          <select
            value={project.signal.ledRefreshHz}
            onChange={(e) => setSignal({ ledRefreshHz: Number(e.target.value) })}
          >
            {REFRESH_RATES.map((f) => (
              <option key={f} value={f}>
                {f.toLocaleString()} Hz
              </option>
            ))}
          </select>
        </div>

        <div
          className="field"
          title="Bits each pixel occupies on the wire. Vendors pack colour components into power-of-two containers, so 10-bit costs 32 bits, not 30."
        >
          <label>Wire cost</label>
          <span style={{ fontFamily: 'var(--mono)' }}>
            {wireBitsPerPixel(project.signal.bitDepth)} bpp
          </span>
        </div>

        <div className="spacer" />

        <div className="stats">
          <div className="stat">
            <div className="k">Cabinets</div>
            <div className="v">{stats.cabinetCount}</div>
          </div>
          <div className="stat">
            <div className="k">Resolution</div>
            <div className="v">
              {stats.boundingPixels
                ? `${stats.boundingPixels.width}×${stats.boundingPixels.height}`
                : '—'}
            </div>
          </div>
          <div className="stat">
            <div className="k">Pixels</div>
            <div className="v">{stats.totalPixels.toLocaleString()}</div>
          </div>
          <div className="stat">
            <div className="k">Size</div>
            <div className="v">
              {stats.boundsMm
                ? `${(stats.boundsMm.widthMm / 1000).toFixed(2)}×${(stats.boundsMm.heightMm / 1000).toFixed(2)} m`
                : '—'}
            </div>
          </div>
          <div className="stat">
            <div className="k">Weight</div>
            <div className="v">{stats.totalWeightKg.toFixed(0)} kg</div>
          </div>
          <div className="stat">
            <div className="k">Peak power</div>
            <div className="v">{(stats.powerMaxW / 1000).toFixed(1)} kW</div>
          </div>
          <div className="stat" title="Pixels patched versus total processing capacity">
            <div className="k">System load</div>
            <div className="v">
              {totalCapacity
                ? `${Math.round((totalUsed / totalCapacity) * 100)}%`
                : '—'}
            </div>
          </div>
        </div>

        <div className="row">
          <button onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">
            ↶
          </button>
          <button onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">
            ↷
          </button>
        </div>
      </div>

      <div className="main">
        <LibraryPanel />
        <WallCanvas />
        <SystemPanel />
      </div>
    </div>
  );
}
