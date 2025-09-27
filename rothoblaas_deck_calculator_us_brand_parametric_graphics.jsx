/**
 * Rothoblaas — TERRALOCK Fastener Takeoff (UMD+Babel, compact)
 * - Sketch drawer: grid snap (6/12/24/36/48 in), click to add, hold‑drag to move, right‑click to delete,
 *   click a line to insert a midpoint (keeps order), click a length label to edit that segment in feet.
 * - US construction wording; boards always run ⟂ to joists; joist 90° toggle.
 * - Inputs: L (board width, in), f (gap, in), i (joist spacing, on‑center, in), waste factor.
 * - Outputs: board rows across, joist count, TERRALOCK clip count (± waste), area.
 * - UMD+Babel friendly (no imports/exports). Exposes `window.DeckCalculator` and **auto‑mounts safely** if possible.
 */

// ===== Helpers =====
const inToFt = (i) => i / 12;
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const floor = (n) => Math.floor(n);
const fmtFt = (n) => `${round(n, 2)}'`;
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) { const t = b; b = a % b; a = t; } return a || 1; };
const fmtInFrac = (n) => { const neg = n < 0; n = Math.abs(n); const w = Math.floor(n + 1e-9), f = n - w, D = 16; let r = Math.round(f * D); if (!r) return `${neg ? '-' : ''}${w}"`; if (r === D) return `${neg ? '-' : ''}${w + 1}"`; const g = gcd(r, D); return `${neg ? '-' : ''}${w ? w + ' ' : ''}${r / g}/${D / g}"`; };
const polyAreaPerimeter = (pts) => { if (!pts || pts.length < 3) return { area: 0, perim: 0, bbox: { w: 0, h: 0 } }; let a = 0, p = 0; for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length; a += pts[i].x * pts[j].y - pts[j].x * pts[i].y; const dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y; p += Math.hypot(dx, dy); } a = Math.abs(a) / 2; const xs = pts.map(p => p.x), ys = pts.map(p => p.y); return { area: a, perim: p, bbox: { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) } }; };
const snapPointToGrid = (p, sIn) => { const ft = inToFt(sIn); return { x: Math.round(p.x / ft) * ft, y: Math.round(p.y / ft) * ft }; };
const adjustSegmentLength = (a, b, L) => { const dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy) || 1e-9; return { x: a.x + (dx / d) * L, y: a.y + (dy / d) * L }; };

// ===== Branding TopBar =====
function TopBar() {
  // single wrapper avoids any fragment/adjacency parsing issues
  return (
    <div>
      <style>{`.topbar{position:sticky;top:0;z-index:1000;width:100%;background:#0b1220;border-bottom:1px solid rgba(148,163,184,.18);padding:14px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px}.brandlogo{height:36px;filter:brightness(0) invert(1)}.backlink{margin-left:auto;display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid #334155;border-radius:9999px;color:#f8fafc;background:#0b1220}.backlink:hover{background:#111827}`}</style>
      <div className="topbar">
        <a className="homeLink" href="https://blaashannes.github.io/myproject/" title="Go to homepage"><img className="brandlogo" src="https://www.rothoblaas.com/assets/images/rothoblaas-logo.svg" alt="Rothoblaas" /></a>
        <a className="backlink" href="https://blaashannes.github.io/myproject/" aria-label="Back to start page">← Back to start</a>
      </div>
    </div>
  );
}

// ===== Grid =====
function renderGrid(PAD, maxW, maxH, stepPx = 24, label = "") {
  const L = [];
  for (let x = PAD; x < maxW - PAD + 1; x += stepPx) L.push(<line key={`gx${x}`} x1={x} y1={PAD} x2={x} y2={maxH - PAD} className="stroke-neutral-200" strokeWidth={1} />);
  for (let y = PAD; y < maxH - PAD + 1; y += stepPx) L.push(<line key={`gy${y}`} x1={PAD} y1={y} x2={maxW - PAD} y2={y} className="stroke-neutral-200" strokeWidth={1} />);
  if (label) L.push(<text key="gridnote" x={maxW - PAD} y={maxH - 6} textAnchor="end" className="text-[10px] fill-neutral-400">Grid tile = {label}</text>);
  return <g>{L}</g>;
}

// ===== Sketcher =====
function DeckSketcher({ points, setPoints }) {
  const PAD = 24, maxW = 860, maxH = 400;
  const [snapIn, setSnapIn] = React.useState(12); // 6,12,24,36,48 inches
  const [sel, setSel] = React.useState(-1);
  const [drag, setDrag] = React.useState(false);
  const sup = React.useRef(false);
  const [editI, setEditI] = React.useState(-1);
  const [editV, setEditV] = React.useState(0);
  const [editPos, setEditPos] = React.useState({ x: 0, y: 0 });

  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const minX = Math.min(...xs, 0), minY = Math.min(...ys, 0);
  const maxX = Math.max(...xs, 20), maxY = Math.max(...ys, 13);
  const w = maxX - minX, h = maxY - minY;
  const scale = Math.min((maxW - PAD * 2) / Math.max(w, 1), (maxH - PAD * 2) / Math.max(h, 1));

  const stepFt = inToFt(snapIn), stepPx = stepFt * scale, label = `${snapIn}\" (${round(stepFt, 2)} ft)`;
  const toPx = (p) => ({ x: PAD + (p.x - minX) * scale, y: PAD + (p.y - minY) * scale });
  const fromPx = (x, y) => ({ x: (x - PAD) / scale + minX, y: (y - PAD) / scale + minY });
  const pathD = points.map((p, i) => { const { x, y } = toPx(p); return `${i ? 'L' : 'M'}${x},${y}`; }).join(' ') + (points.length >= 3 ? ' Z' : '');

  const onCanvasClick = (e) => {
    if (sup.current) { sup.current = false; return; }
    if (editI >= 0) return; // editing a label — don't also add a point
    const r = e.currentTarget.getBoundingClientRect();
    const ft = fromPx(e.clientX - r.left, e.clientY - r.top);
    setPoints([...points, snapPointToGrid(ft, snapIn)]);
  };
  const onDown = (i) => (e) => { e.stopPropagation(); setSel(i); setDrag(true); };
  const onMove = (e) => {
    if (!drag || sel < 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    const theFt = fromPx(e.clientX - r.left, e.clientY - r.top);
    const s = snapPointToGrid(theFt, snapIn);
    setPoints(points.map((p, i) => i === sel ? s : p));
  };
  const end = () => { if (drag) sup.current = true; setDrag(false); setSel(-1); };

  const delNear = (xc, yc, rect) => {
    const ft = fromPx(xc - rect.left, yc - rect.top), thr = stepFt / 2;
    let bi = -1, bd = 1e9;
    points.forEach((p, i) => { const d = Math.hypot(p.x - ft.x, p.y - ft.y); if (d < bd) { bd = d; bi = i; } });
    if (bi >= 0 && bd <= thr) setPoints(points.filter((_, i) => i !== bi));
  };

  const setEdge = (i, L) => {
    if (points.length < 2 || !Number.isFinite(L) || L <= 0) return;
    const a = points[i], b = points[(i + 1) % points.length];
    const nb = snapPointToGrid(adjustSegmentLength(a, b, L), snapIn);
    const nx = [...points]; nx[(i + 1) % points.length] = nb; setPoints(nx);
  };
  const openEdit = (i, px) => {
    const a = points[i], b = points[(i + 1) % points.length];
    setEditI(i); setEditV(round(Math.hypot(b.x - a.x, b.y - a.y), 2)); setEditPos(px);
  };
  const insertMid = (i) => {
    const a = points[i], b = points[(i + 1) % points.length];
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const s = snapPointToGrid(m, snapIn);
    const nx = [...points]; nx.splice(i + 1, 0, s); setPoints(nx);
  };

  // hit areas & labels
  const segLabels = [], hits = [];
  if (points.length >= 2) {
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      if (i === points.length - 1 && points.length < 3) break; // don't draw closing edge for open polyline
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, mp = toPx(mid), L = Math.hypot(b.x - a.x, b.y - a.y);
      segLabels.push(
        <text key={`len-${i}`} x={mp.x} y={mp.y - 6} textAnchor="middle" className="cursor-pointer select-none text-[10px] fill-neutral-700"
              onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); openEdit(i, { x: mp.x, y: mp.y - 24 }); }}>{round(L, 2)}'</text>
      );
      const ap = toPx(a), bp = toPx(b);
      hits.push(
        <line key={`hit-${i}`} x1={ap.x} y1={ap.y} x2={bp.x} y2={bp.y} strokeWidth={12} stroke="transparent"
              onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); insertMid(i); }} />
      );
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-2 text-sm">
        <label className="flex items-center gap-2">Grid spacing
          <select className="border rounded px-2 py-1 text-sm" value={snapIn} onChange={(e) => setSnapIn(parseFloat(e.target.value))}>
            <option value={6}>6" (0.5 ft)</option>
            <option value={12}>12" (1 ft)</option>
            <option value={24}>24" (2 ft)</option>
            <option value={36}>36" (3 ft)</option>
            <option value={48}>48" (4 ft)</option>
          </select>
        </label>
        <span className="text-xs text-neutral-500">Grid tile = <b>{label}</b>. Click to add • hold to drag • right‑click delete • click a line to insert midpoint • click length label to edit.</span>
        <button onClick={() => setPoints([])} className="rounded px-3 py-1 border">Clear</button>
      </div>
      <svg viewBox={`0 0 ${maxW} ${maxH}`} className="w-full h-[260px] md:h-[400px] bg-white border border-neutral-200 rounded-xl select-none"
           onMouseMove={onMove} onMouseUp={end} onMouseLeave={end} onClick={onCanvasClick}
           onContextMenu={(e) => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); delNear(e.clientX, e.clientY, r); }}>
        {renderGrid(PAD, maxW, maxH, stepPx, label)}
        {points.length > 0 && <path d={pathD} className="fill-emerald-50 stroke-emerald-500" strokeWidth={2} />}
        {hits}
        {points.map((p, i) => { const { x, y } = toPx(p); return (
          <g key={i} onMouseDown={onDown(i)}>
            <circle cx={x} cy={y} r={6} className={i === sel ? "fill-emerald-600" : "fill-emerald-500"} />
            <text x={x + 8} y={y - 8} className="text-[10px] fill-neutral-600">{i + 1}</text>
          </g>
        ); })}
        {segLabels}
        {editI >= 0 && (
          <foreignObject x={editPos.x - 45} y={editPos.y - 12} width={90} height={28}>
            <div xmlns="http://www.w3.org/1999/xhtml" style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 6, padding: '2px 6px' }}>
              <input autoFocus type="number" step={0.01} value={editV} onChange={(e) => setEditV(e.target.valueAsNumber)}
                     onKeyDown={(e) => { if (e.key === 'Enter') { setEdge(editI, editV); setEditI(-1); } if (e.key === 'Escape') { setEditI(-1); } }}
                     onBlur={() => { setEdge(editI, editV); setEditI(-1); }} style={{ width: 54 }} />
              <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 4 }}>ft</span>
            </div>
          </foreignObject>
        )}
      </svg>
    </div>
  );
}

// ===== Main (TERRALOCK‑only) =====
function DeckCalculator() {
  // Sketch points (default: 20' x 13' rectangle for a quick start)
  const [sketchPts, setSketchPts] = React.useState([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 13 }, { x: 0, y: 13 }]);
  const { area: sketchArea, perim: sketchPerim, bbox } = polyAreaPerimeter(sketchPts);
  const B = bbox.w || 20; // ft
  const H = bbox.h || 13; // ft

  // Inputs (US construction)
  const [L, setL] = React.useState(5.5);   // board width L [in]
  const [f, setf] = React.useState(0.25);  // board gap f [in]
  const [iOC, setIOC] = React.useState(16); // joist spacing i (on-center) [in]
  const [rot, setRot] = React.useState(false); // rotate joists 90°
  const [waste, setWaste] = React.useState(1.05);

  // Orientation: boards ⟂ joists
  const boardsParallelToB = !rot;            // boards run along B when joists are not rotated
  const boardsRunLengthFt = boardsParallelToB ? B : H;
  const acrossFt = boardsParallelToB ? H : B; // span across rows
  const joistsAcrossFt = rot ? boardsRunLengthFt : acrossFt;

  // Counts
  const moduleIn = L + f;
  const boardsAcross = React.useMemo(() => floor((acrossFt * 12 + f) / Math.max(moduleIn, 0.01)), [acrossFt, moduleIn, f]);
  const joistCount = React.useMemo(() => floor((joistsAcrossFt * 12) / Math.max(iOC, 0.01)) + 1, [joistsAcrossFt, iOC]);
  const clipsNoWaste = boardsAcross * joistCount;
  const clips = Math.ceil(clipsNoWaste * waste);
  const areaSqft = round(sketchArea, 2);

  // Parametric preview (boards + joists)
  const Graphic = React.useMemo(() => {
    const PAD = 24, maxW = 860, maxH = 420; const bounds = { w: B, h: H };
    const s = Math.min((maxW - PAD * 2) / Math.max(bounds.w, 1), (maxH - PAD * 2) / Math.max(bounds.h, 1));
    const toPx = (p) => ({ x: PAD + p.x * s, y: PAD + p.y * s });
    const poly = (sketchPts.length >= 3 ? sketchPts : [{ x: 0, y: 0 }, { x: B, y: 0 }, { x: B, y: H }, { x: 0, y: H }]).map(toPx);
    const d = poly.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ') + ' Z';

    const stripes = []; const mFt = inToFt(moduleIn); const cnt = Math.max(1, boardsAcross);
    for (let k = 0; k < cnt; k++) {
      const off = k * mFt;
      if (boardsParallelToB) { const y = PAD + off * s; stripes.push(<rect key={`s-${k}`} x={PAD} y={y} width={bounds.w * s} height={inToFt(L) * s} className="fill-amber-200/70" />); }
      else { const x = PAD + off * s; stripes.push(<rect key={`s-${k}`} x={x} y={PAD} width={inToFt(L) * s} height={bounds.h * s} className="fill-amber-200/70" />); }
    }

    const jo = []; const n = joistCount;
    for (let j = 0; j < n; j++) {
      const off = inToFt(iOC) * j;
      if (!rot) { // joists horizontal when not rotated
        if (boardsParallelToB) { const y = PAD + off * s; jo.push(<line key={`j-${j}`} x1={PAD} y1={y} x2={PAD + bounds.w * s} y2={y} className="stroke-neutral-700" strokeWidth={1} />); }
        else { const x = PAD + off * s; jo.push(<line key={`j-${j}`} x1={x} y1={PAD} x2={x} y2={PAD + bounds.h * s} className="stroke-neutral-700" strokeWidth={1} />); }
      } else { // rotated 90°
        if (boardsParallelToB) { const x = PAD + off * s; jo.push(<line key={`j-${j}`} x1={x} y1={PAD} x2={x} y2={PAD + bounds.h * s} className="stroke-neutral-700" strokeWidth={1} />); }
        else { const y = PAD + off * s; jo.push(<line key={`j-${j}`} x1={PAD} y1={y} x2={PAD + bounds.w * s} y2={y} className="stroke-neutral-700" strokeWidth={1} />); }
      }
    }

    return (
      <svg viewBox={`0 0 ${maxW} ${maxH}`} className="w-full h-[280px] md:h-[420px]">
        <defs><clipPath id="clip"><path d={d} /></clipPath></defs>
        <path d={d} className="fill-white stroke-black" strokeWidth={2} />
        <g clipPath="url(#clip)">{[...stripes, ...jo]}</g>
        <text x={PAD + (bounds.w * s) / 2} y={PAD - 8} textAnchor="middle" className="text-[12px]">B = {fmtFt(B)}</text>
        <text x={PAD - 8} y={PAD + (bounds.h * s) / 2} textAnchor="end" dominantBaseline="middle" className="text-[12px]">H = {fmtFt(H)}</text>
      </svg>
    );
  }, [sketchPts, B, H, L, f, moduleIn, boardsAcross, iOC, joistCount, rot, boardsParallelToB]);

  // Lightweight tests (kept + extra)
  React.useEffect(() => { try {
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], s = polyAreaPerimeter(sq);
    console.assert(Math.abs(s.area - 100) < 1e-6, 'Area 10x10');
    console.assert(Math.abs(s.perim - 40) < 1e-6, 'Perim 10x10');
    const A = { x: 0, y: 0 }, B2 = { x: 3, y: 0 }; const B3 = adjustSegmentLength(A, B2, 5);
    console.assert(Math.abs(B3.x - 5) < 1e-6, 'Adjust seg');
    const rows = floor((10 * 12 + 0.25) / (5.5 + 0.25)); console.assert(rows === 20, 'Rows calc');
    const jc = floor((8 * 12) / 16) + 1; console.assert(jc === 7, 'Joists count');
    const p = snapPointToGrid({ x: 2.49, y: 3.51 }, 12); console.assert(Math.abs(p.x - 2) < 1e-9 && Math.abs(p.y - 4) < 1e-9, 'Snap 12in');
  } catch (e) { console.warn('Tests failed:', e); } }, []);

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <TopBar />
      <main className="max-w-6xl mx-auto px-4 pb-20 space-y-10">
        <Section title="0. DRAW YOUR DECK (Sketch Tool)">
          <div className="mb-3 text-xs text-neutral-500">Snap to 6/12/24/36/48 in intersections. Click to add • hold to drag • right‑click delete • click a line to insert midpoint • click a length label to edit.</div>
          <DeckSketcher points={sketchPts} setPoints={setSketchPts} />
          <div className="mt-3 grid sm:grid-cols-5 gap-3">
            <Readout label="Sketch area" value={`${round(areaSqft, 1)} sq ft`} />
            <Readout label="Perimeter" value={`${round(sketchPerim, 1)} ft`} />
            <Readout label="Bounding B" value={fmtFt(B)} />
            <Readout label="Bounding H" value={fmtFt(H)} />
            <Readout label="Vertices" value={sketchPts.length} />
          </div>
        </Section>

        <Section title="1. SHAPE & JOISTS">
          <div className="grid sm:grid-cols-4 gap-3">
            <NumInput label={'Board width L [in]'} value={L} setValue={setL} step={0.01} />
            <NumInput label={'Board gap f [in]'} value={f} setValue={setf} step={0.01} />
            <NumInput label={'Joist spacing i (on-center) [in]'} value={iOC} setValue={setIOC} step={1} />
            <label className="block"><span className="text-xs text-neutral-600">Joists: rotate 90°</span><div className="mt-1"><input type="checkbox" checked={rot} onChange={(e) => setRot(e.target.checked)} /></div></label>
          </div>
          <div className="text-xs text-neutral-500 mt-2">Boards run <b>perpendicular</b> to joists. Variables: <b>L</b> board width, <b>f</b> gap, <b>i</b> joist spacing (o.c.).</div>
          <div className="mt-4">{Graphic}</div>
        </Section>

        <Section title="2. TERRALOCK — FASTENER TAKEOFF">
          <div className="grid sm:grid-cols-4 gap-3">
            <Readout label="Board rows (across)" value={boardsAcross} />
            <Readout label="Joists (count)" value={joistCount} />
            <Readout label="Clips (no waste)" value={clipsNoWaste} />
            <label className="block"><span className="text-xs text-neutral-600">Waste factor</span><input type="number" step={0.01} value={waste} onChange={(e) => setWaste(e.target.valueAsNumber)} className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm" /></label>
          </div>
          <div className="grid sm:grid-cols-3 gap-3 mt-3">
            <Readout label="TERRALOCK clips (with waste)" value={clips} />
            <Readout label="Deck board span (ft)" value={fmtFt(boardsRunLengthFt)} />
            <Readout label="Area (sq ft)" value={round(areaSqft, 1)} />
          </div>
        </Section>
      </main>
      <footer className="py-10 text-center text-xs text-neutral-500">© Rothoblaas — TERRALOCK Takeoff Tool</footer>
    </div>
  );
}

// ===== UI bits =====
const Section = ({ title, children }) => (
  <section className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-5 md:p-6">
    <h2 className="text-lg md:text-xl font-extrabold tracking-tight mb-4">{title}</h2>
    {children}
  </section>
);
const Readout = ({ label, value }) => (
  <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
    <div className="text-xs text-neutral-500">{label}</div>
    <div className="text-lg font-semibold tabular-nums">{value}</div>
  </div>
);
const NumInput = ({ label, value, setValue, step = 1 }) => (
  <label className="block">
    <span className="text-xs text-neutral-600">{label}</span>
    <input type="number" value={Number.isFinite(value) ? value : ''} step={step} onChange={(e) => setValue(e.target.valueAsNumber)}
           className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10" />
  </label>
);

// ===== Expose for UMD+Babel =====
window.DeckCalculator = DeckCalculator;

// Optional safe auto‑mount (prevents common #130 by ensuring we create a React element)
(function tryAutoMount(){
  try {
    if (!window || !window.React || !window.ReactDOM) return; // require UMDs
    const host = document.getElementById('root');
    if (!host || host.__rbMounted) return;
    // If a previous script already mounted, skip.
    host.__rbMounted = true;
    const root = window.ReactDOM.createRoot(host);
    root.render(React.createElement(window.DeckCalculator));
  } catch (e) {
    // swallow — only a convenience path
  }
})();

// Sanity: ensure global export type
try { console.assert(typeof window.DeckCalculator === 'function', 'DeckCalculator must be a function'); } catch (_) {}
