/**
 * The wall view.
 *
 * SVG rather than canvas: the wall is a few hundred rectangles at most, hit-testing
 * comes free, and the same geometry can be handed straight to the PDF and the
 * exports without a second implementation.
 *
 * View space is millimetres. The SVG viewBox does the zooming, so nothing in here
 * has to think in screen pixels except the wheel handler.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { chainColour } from '../domain/wiring';
import { wallBoundsMm } from '../domain/wall';

interface View {
  xMm: number;
  yMm: number;
  wMm: number;
}

export function WallCanvas() {
  const project = useStore((s) => s.project);
  const cabinetSpec = useStore((s) => s.cabinetSpec);
  const selected = useStore((s) => s.selectedCabinets);
  const select = useStore((s) => s.select);
  const activeSpecId = useStore((s) => s.activeSpecId);
  const addCabinetAt = useStore((s) => s.addCabinetAt);
  const deleteCabinets = useStore((s) => s.deleteCabinets);
  const moveCabinets = useStore((s) => s.moveCabinets);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);

  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ xMm: -500, yMm: -500, wMm: 10000 });
  const [tool, setTool] = useState<'select' | 'place'>('select');
  const [showOrder, setShowOrder] = useState(true);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const panRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  const aspect = useAspect(svgRef);
  const viewH = view.wMm * aspect;

  const chainOf = useMemo(() => {
    const m = new Map<string, { colour: string; index: number }>();
    project.chains.forEach((chain, i) => {
      chain.cabinetIds.forEach((id, j) =>
        m.set(id, { colour: chain.colour ?? chainColour(i), index: j + 1 }),
      );
    });
    return m;
  }, [project.chains]);

  const placed = useMemo(
    () =>
      project.cabinets
        .map((inst) => ({ inst, spec: cabinetSpec(inst.specId) }))
        .filter((r): r is { inst: typeof r.inst; spec: NonNullable<typeof r.spec> } => !!r.spec),
    [project.cabinets, cabinetSpec],
  );

  /** Fit the view to the wall, or to the canvas if the wall is empty. */
  function zoomToFit() {
    const b = wallBoundsMm(project, cabinetSpec);
    const box = b ?? {
      xMm: 0,
      yMm: 0,
      widthMm: project.canvas.widthMm,
      heightMm: project.canvas.heightMm,
    };
    const pad = Math.max(box.widthMm, box.heightMm) * 0.08 + 200;
    const wMm = Math.max(box.widthMm + pad * 2, (box.heightMm + pad * 2) / aspect);
    setView({
      xMm: box.xMm - (wMm - box.widthMm) / 2,
      yMm: box.yMm + box.heightMm / 2 - (wMm * aspect) / 2,
      wMm,
    });
  }

  useEffect(() => {
    if (project.cabinets.length && view.wMm === 10000 && view.xMm === -500) zoomToFit();
    // Only on first content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.cabinets.length]);

  // Keyboard: delete, nudge, undo/redo.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length) {
        e.preventDefault();
        deleteCabinets(selected);
      } else if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (e.key === 'Escape') {
        select([]);
      } else if (e.key === 'f') {
        zoomToFit();
      } else if (e.key.startsWith('Arrow') && selected.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : project.canvas.snapMm || 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        moveCabinets(selected, dx, dy);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function toMm(e: { clientX: number; clientY: number }) {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      xMm: view.xMm + ((e.clientX - rect.left) / rect.width) * view.wMm,
      yMm: view.yMm + ((e.clientY - rect.top) / rect.height) * viewH,
    };
  }

  function onWheel(e: React.WheelEvent) {
    const { xMm, yMm } = toMm(e);
    const factor = Math.exp(e.deltaY * 0.0015);
    const wMm = Math.min(200000, Math.max(200, view.wMm * factor));
    // Keep the point under the cursor fixed.
    setView({
      wMm,
      xMm: xMm - (xMm - view.xMm) * (wMm / view.wMm),
      yMm: yMm - (yMm - view.yMm) * (wMm / view.wMm),
    });
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button === 1 || e.altKey || (e.button === 0 && e.shiftKey && e.metaKey)) {
      panRef.current = { x: e.clientX, y: e.clientY, vx: view.xMm, vy: view.yMm };
      (e.target as Element).setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const p = toMm(e);
    if (tool === 'place' && activeSpecId) {
      const spec = cabinetSpec(activeSpecId);
      if (spec) addCabinetAt(activeSpecId, p.xMm - spec.widthMm / 2, p.yMm - spec.heightMm / 2);
      return;
    }
    setMarquee({ x0: p.xMm, y0: p.yMm, x1: p.xMm, y1: p.yMm });
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (panRef.current) {
      const rect = svgRef.current!.getBoundingClientRect();
      const dx = ((e.clientX - panRef.current.x) / rect.width) * view.wMm;
      const dy = ((e.clientY - panRef.current.y) / rect.height) * viewH;
      setView((v) => ({ ...v, xMm: panRef.current!.vx - dx, yMm: panRef.current!.vy - dy }));
      return;
    }
    if (marquee) {
      const p = toMm(e);
      setMarquee((m) => (m ? { ...m, x1: p.xMm, y1: p.yMm } : null));
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    panRef.current = null;
    if (!marquee) return;
    const x0 = Math.min(marquee.x0, marquee.x1);
    const x1 = Math.max(marquee.x0, marquee.x1);
    const y0 = Math.min(marquee.y0, marquee.y1);
    const y1 = Math.max(marquee.y0, marquee.y1);
    setMarquee(null);

    // A click rather than a drag clears the selection.
    if (x1 - x0 < 20 && y1 - y0 < 20) {
      if (!e.shiftKey) select([]);
      return;
    }
    const hit = placed
      .filter(
        ({ inst, spec }) =>
          inst.xMm < x1 && inst.xMm + spec.widthMm > x0 &&
          inst.yMm < y1 && inst.yMm + spec.heightMm > y0,
      )
      .map(({ inst }) => inst.id);
    select(hit, e.shiftKey);
  }

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  return (
    <div className="stage">
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`${view.xMm} ${view.yMm} ${view.wMm} ${viewH}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ cursor: tool === 'place' ? 'crosshair' : 'default', display: 'block' }}
      >
        {/* design envelope */}
        <rect
          x={0}
          y={0}
          width={project.canvas.widthMm}
          height={project.canvas.heightMm}
          fill="none"
          stroke="#3a4552"
          strokeWidth={view.wMm / 600}
          strokeDasharray={`${view.wMm / 90} ${view.wMm / 140}`}
        />

        {placed.map(({ inst, spec }) => {
          const chain = chainOf.get(inst.id);
          const isSel = selectedSet.has(inst.id);
          return (
            <g
              key={inst.id}
              onPointerDown={(e) => {
                if (tool === 'place') return;
                e.stopPropagation();
                select([inst.id], e.shiftKey);
              }}
              style={{ cursor: 'pointer' }}
            >
              <rect
                x={inst.xMm}
                y={inst.yMm}
                width={spec.widthMm}
                height={spec.heightMm}
                fill={chain ? chain.colour : '#39414c'}
                fillOpacity={chain ? 0.85 : 0.6}
                stroke={isSel ? '#ffffff' : '#0e1116'}
                strokeWidth={isSel ? view.wMm / 400 : view.wMm / 1400}
              />
              {showOrder && chain && spec.widthMm / view.wMm > 0.022 && (
                <text
                  x={inst.xMm + spec.widthMm / 2}
                  y={inst.yMm + spec.heightMm / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#0e1116"
                  fontWeight="700"
                  fontSize={spec.heightMm * 0.3}
                >
                  {chain.index}
                </text>
              )}
            </g>
          );
        })}

        {/* chain routes */}
        {showOrder &&
          project.chains.map((chain, i) => {
            const pts = chain.cabinetIds
              .map((id) => placed.find((p) => p.inst.id === id))
              .filter(Boolean)
              .map((p) => `${p!.inst.xMm + p!.spec.widthMm / 2},${p!.inst.yMm + p!.spec.heightMm / 2}`);
            if (pts.length < 2) return null;
            return (
              <polyline
                key={chain.id}
                points={pts.join(' ')}
                fill="none"
                stroke={chain.colour ?? chainColour(i)}
                strokeWidth={view.wMm / 500}
                strokeOpacity={0.9}
                strokeLinejoin="round"
                strokeLinecap="round"
                pointerEvents="none"
              />
            );
          })}

        {marquee && (
          <rect
            x={Math.min(marquee.x0, marquee.x1)}
            y={Math.min(marquee.y0, marquee.y1)}
            width={Math.abs(marquee.x1 - marquee.x0)}
            height={Math.abs(marquee.y1 - marquee.y0)}
            fill="#2f9ee022"
            stroke="#2f9ee0"
            strokeWidth={view.wMm / 800}
          />
        )}
      </svg>

      <div className="hint">
        {tool === 'place'
          ? 'Click to place a cabinet'
          : 'Drag to marquee-select · Alt-drag to pan · Scroll to zoom'}
        {selected.length > 0 && ` · ${selected.length} selected`}
      </div>

      <div className="overlay">
        <button
          className={tool === 'select' ? 'primary' : ''}
          onClick={() => setTool('select')}
        >
          Select
        </button>
        <button
          className={tool === 'place' ? 'primary' : ''}
          onClick={() => setTool('place')}
          disabled={!activeSpecId}
        >
          Place
        </button>
        <button onClick={zoomToFit}>Fit</button>
        <button
          className={showOrder ? 'primary' : ''}
          onClick={() => setShowOrder((v) => !v)}
        >
          Wiring
        </button>
        <button
          className="danger"
          disabled={!selected.length}
          onClick={() => deleteCabinets(selected)}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

/** Height/width ratio of the SVG element, so the viewBox stays square in mm. */
function useAspect(ref: React.RefObject<SVGSVGElement | null>) {
  const [aspect, setAspect] = useState(0.6);
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const update = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0) setAspect(r.height / r.width);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return aspect;
}
