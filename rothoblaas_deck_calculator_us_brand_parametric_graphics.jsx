import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Rothoblaas Deck Calculator — US (Imperial), Branded, with Parametric Graphics + Sketch Tool
 *
 * DeckSketcher lets users draw an arbitrary deck outline (polygon) on a selectable grid.
 *  - Click empty canvas to add a vertex.
 *  - Hold mouse on an existing vertex to drag/move. Releasing the mouse **does not** add a new vertex.
 *  - Right‑click to delete a nearby vertex (within ~half a grid tile).
 *  - Grid spacing options: 6\", 12\", 24\", 36\", 48\" (default 12\" = 1 ft). Points snap to grid intersections by default.
 *  - Click a **line** to insert a midpoint vertex **between those two endpoints** (the new point becomes the next index).
 *  - Click a **length label** to edit that edge’s numeric length (no new points created).
 */

// ---------------------- Helpers ----------------------
const psfOptions = [40, 60, 100]; // informational
const DEFLECTIONS = ["L/240", "L/300", "L/360"]; // informational

const FASTENINGS = ["Hidden (FLAT/FLIP)", "Face screw"];
const GROOVING = ["Symmetrical groove", "Asymmetrical groove", "No groove (face screw)"];

const SUPPORT_TYPES = [
  { value: "SUP-M", name: "SUP-M" },
  { value: "SUP-MAXI", name: "SUP-MAXI" },
  { value: "Fixed shim", name: "Fixed shim" },
];

function inToFt(inches) { return inches / 12; }
function toNumber(n, fallback = 0) { const v = typeof n === 'number' ? n : parseFloat(n); return Number.isFinite(v) ? v : fallback; }
function ceil(n) { return Math.ceil(n); }
function floor(n) { return Math.floor(n); }
function round(n, d = 2) { return Math.round(n * 10 ** d) / 10 ** d; }
function feetInchesToFeet(feet, inches) { return toNumber(feet) + inToFt(toNumber(inches)); }
function fmtIn(n) { return `${round(n, 2)}\"`; }
function fmtFt(n) { return `${round(n, 2)}'`; }

// Fractional-inch formatter (US construction, to 1/16")
function gcd(a,b){ a=Math.abs(a); b=Math.abs(b); while(b){ const t=b; b=a%b; a=t; } return a || 1; }
function fmtInFrac(n){
  const neg = n < 0; n = Math.abs(n);
  const whole = Math.floor(n + 1e-9);
  const frac = n - whole;
  const DEN = 16; // 1/16"
  let num = Math.round(frac * DEN);
  if (num === 0) return `${neg?'-':''}${whole}"`;
  if (num === DEN) return `${neg?'-':''}${whole + 1}"`;
  const g = gcd(num, DEN);
  const rn = num / g, rd = DEN / g;
  return `${neg?'-':''}${whole ? whole + ' ' : ''}${rn}/${rd}"`;
}

// Shoelace area (ft^2) and perimeter (ft)
function polyAreaPerimeter(pts) {
  if (!pts || pts.length < 3) return { area: 0, perim: 0, bbox: { w: 0, h: 0 } };
  let a = 0, p = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    const dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y;
    p += Math.hypot(dx, dy);
  }
  a = Math.abs(a) / 2;
  const xs = pts.map(p=>p.x), ys = pts.map(p=>p.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  return { area: a, perim: p, bbox: { w, h } };
}

// Snap a point (feet) to a grid with snap step in inches
function snapPointToGrid(p, snapInches) {
  const sft = inToFt(snapInches);
  return { x: Math.round(p.x / sft) * sft, y: Math.round(p.y / sft) * sft };
}

// Compute a new endpoint B' s.t. |AB'| = newLenFt along direction AB
export function adjustSegmentLength(a, b, newLenFt) {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const curLen = Math.hypot(dx, dy) || 1e-9;
  const ux = dx / curLen; const uy = dy / curLen;
  return { x: a.x + ux * newLenFt, y: a.y + uy * newLenFt };
}

// ---------------------- Main ----------------------
function TopBar(){
  return (
    <>
      <style>{`/* --- Rothoblaas top bar --- */
.topbar{
  position:relative;
  width:100%;
  background:#0b1220;                       /* same dark header as the calculator */
  border-bottom:1px solid rgba(148,163,184,.18);
  padding:14px 20px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
}
.brandlogo{ height:36px; width:auto; display:block; filter:brightness(0) invert(1); }
/* ^ forces the black SVG to render white on dark backgrounds */
.brandlogo--top{ height:36px; }

.homeLink{ display:inline-flex; align-items:center; text-decoration:none; }
.backlink{
  margin-left:auto;
  display:inline-flex; align-items:center; gap:8px;
  padding:6px 10px;
  border:1px solid #334155;
  border-radius:9999px;
  text-decoration:none;
  color:#f8fafc; background:#0b1220;
}
.backlink:hover{ background:#111827; }
`}</style>
      <div className="topbar">
        <a className="homeLink" href="https://blaashannes.github.io/myproject/" title="Go to homepage">
          <img className="brandlogo brandlogo--top"
               src="https://www.rothoblaas.com/assets/images/rothoblaas-logo.svg"
               alt="Rothoblaas logo" />
        </a>
        <a className="backlink" href="https://blaashannes.github.io/myproject/" aria-label="Back to start page">
          ← Back to start
        </a>
      </div>
    </>
  );
}

export default function DeckCalculatorUS() {
  // 0. Sketch toggle & data (in FEET coordinates)
  const [useSketch, setUseSketch] = useState(true);
  const [sketchPts, setSketchPts] = useState([
    { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 13 }, { x: 0, y: 13 }
  ]);
  const { area: sketchArea, perim: sketchPerim, bbox } = polyAreaPerimeter(sketchPts);

  // 1. Geometry (rectangle fallback ~ 20' x 13') — inputs hidden in UI; sketch drives size
  const [Bft] = useState(20);
  const [Bin] = useState(0);
  const [Hft] = useState(13);
  const [Hin] = useState(0);

  const Brect = feetInchesToFeet(Bft, Bin); // decimal ft
  const Hrect = feetInchesToFeet(Hft, Hin);

  const B = useSketch ? bbox.w || Brect : Brect;
  const H = useSketch ? bbox.h || Hrect : Hrect;

  // 1. Loading (info only)
  const [qPsf, setQPsf] = useState(40);
  const [deflection, setDeflection] = useState("L/300");

  // 2. Boards & design
    const [fastening, setFastening] = useState(FASTENINGS[0]);
  const [groovingType, setGroovingType] = useState(GROOVING[0]);
  const [gapIn, setGapIn] = useState(0.25); // inches (1/4")

  // Boards (nominal 1x6)
  const [boardWidthIn, setBoardWidthIn] = useState(5.5);
  const [boardThickIn, setBoardThickIn] = useState(1.0);
  const [grooveHIn, setGrooveHIn] = useState(0.28);
  const [grooveFIn, setGrooveFIn] = useState(0.16);

  // 3. Substructure
  const [joistOCIn, setJoistOCIn] = useState(16);
  const [supportType, setSupportType] = useState("SUP-M");
  const [supportSpacingIn, setSupportSpacingIn] = useState(24);
  const [waste, setWaste] = useState(1.05);

  // NEW: allow rotating joist direction by 90° (independent of board orientation)
  const [joistsRotate90, setJoistsRotate90] = useState(false);

  const areaSqft = useMemo(() => useSketch ? sketchArea : B * H, [useSketch, sketchArea, B, H]);

  // Orientation logic — boards are always perpendicular to joists (American practice)
  // Convention: When joistsRotate90 = false, joists run along H (left-right), boards run along B (front-back).
  // When joistsRotate90 = true, joists run along B, boards run along H.
  const boardsParallelToB = !joistsRotate90; // enforce perpendicularity
  const boardsRunLengthFt = boardsParallelToB ? B : H; // along B/H bbox
  const deckSpanAcrossFt = boardsParallelToB ? H : B; // across B/H bbox

  // Joists across span can be toggled to rotate 90°
  const joistsAcrossSpanFt = joistsRotate90 ? boardsRunLengthFt : deckSpanAcrossFt;
  const joistLengthFt = joistsRotate90 ? deckSpanAcrossFt : boardsRunLengthFt;

  // Count rows of boards
  const moduleIn = boardWidthIn + gapIn;
  const boardsAcross = useMemo(() => {
    const raw = (deckSpanAcrossFt * 12 + gapIn) / moduleIn; // include far gap
    return floor(raw);
  }, [deckSpanAcrossFt, moduleIn, gapIn]);

  // Joists count depends on joistsAcrossSpanFt
  const joistCount = useMemo(() => floor((joistsAcrossSpanFt * 12) / joistOCIn) + 1, [joistsAcrossSpanFt, joistOCIn]);

  // Supports per joist (include both ends) — based on joistLengthFt
  const supportsPerRow = useMemo(() => {
    const aFt = inToFt(supportSpacingIn);
    const intervals = ceil(joistLengthFt / Math.max(aFt, 0.5));
    return intervals + 1;
  }, [joistLengthFt, supportSpacingIn]);

  const totalSupports = joistCount * supportsPerRow;
  const totalJoistFeet = Math.round(joistCount * joistLengthFt * 100) / 100;

  const longBoards = boardsAcross;
  const connectorsNoWaste = longBoards * joistCount;
  const connectorsWithWaste = Math.ceil(connectorsNoWaste * waste);

  // ---------------------- Parametric SVG (with polygon clip) ----------------------
  const SketchAndGraphic = useMemo(() => {
    const PAD = 24; // px
    const maxW = 860, maxH = 420; // canvas

    // Build polygon path from sketch (ft -> px via scale)
    const bounds = bbox.w > 0 && bbox.h > 0 ? { w: bbox.w, h: bbox.h } : { w: Brect, h: Hrect };
    const scale = Math.min((maxW - PAD * 2) / Math.max(bounds.w, 1), (maxH - PAD * 2) / Math.max(bounds.h, 1));

    const xs = sketchPts.map(p=>p.x), ys = sketchPts.map(p=>p.y);
    const minX = Math.min(...xs), minY = Math.min(...ys);

    const toPx = (p) => ({ x: PAD + (p.x - minX) * scale, y: PAD + (p.y - minY) * scale });
    const polyPx = (useSketch && sketchPts.length >= 3 ? sketchPts : [
      { x: 0, y: 0 }, { x: Brect, y: 0 }, { x: Brect, y: Hrect }, { x: 0, y: Hrect }
    ]).map(toPx);

    const pathD = polyPx.map((p,i)=>`${i===0?"M":"L"}${p.x},${p.y}`).join(" ") + " Z";

    // Boards stripes (clipped)
    const stripes = [];
    const moduleFt = inToFt(moduleIn);
    const stripesCount = Math.max(1, boardsAcross);

    for (let i = 0; i < stripesCount; i++) {
      const offFt = i * moduleFt;
      if (boardsParallelToB) {
        const y = PAD + (offFt) * scale; // relative to minY assumed 0 in local space
        stripes.push(<rect key={`s-${i}`} x={PAD} y={y} width={(bounds.w) * scale} height={inToFt(boardWidthIn) * scale} className="fill-amber-200/70" />);
      } else {
        const x = PAD + (offFt) * scale;
        stripes.push(<rect key={`s-${i}`} x={x} y={PAD} width={inToFt(boardWidthIn) * scale} height={(bounds.h) * scale} className="fill-amber-200/70" />);
      }
    }

    // Joists — orientation depends on joistsRotate90
    const joists = [];
    const jCount = joistCount;
    for (let j = 0; j < jCount; j++) {
      const offFt = inToFt(joistOCIn) * j;
      if (!joistsRotate90) {
        // Default: across span perpendicular to boards
        if (boardsParallelToB) {
          const y = PAD + offFt * scale;
          joists.push(<line key={`j-${j}`} x1={PAD} y1={y} x2={PAD + bounds.w*scale} y2={y} className="stroke-neutral-700" strokeWidth={1} />);
        } else {
          const x = PAD + offFt * scale;
          joists.push(<line key={`j-${j}`} x1={x} y1={PAD} x2={x} y2={PAD + bounds.h*scale} className="stroke-neutral-700" strokeWidth={1} />);
        }
      } else {
        // Rotated 90°: swap orientation
        if (boardsParallelToB) {
          const x = PAD + offFt * scale;
          joists.push(<line key={`j-${j}`} x1={x} y1={PAD} x2={x} y2={PAD + bounds.h*scale} className="stroke-neutral-700" strokeWidth={1} />);
        } else {
          const y = PAD + offFt * scale;
          joists.push(<line key={`j-${j}`} x1={PAD} y1={y} x2={PAD + bounds.w*scale} y2={y} className="stroke-neutral-700" strokeWidth={1} />);
        }
      }
    }    // ===== Annotations: American variables (L = board width, f = board gap, i = joist spacing o.c.) =====
    const annotations = [];
    // Board width L and gap f
    if (boardsAcross >= 1) {
      if (boardsParallelToB) {
        const y0 = PAD; // first board top
        const y1 = PAD + inToFt(boardWidthIn) * scale; // first board bottom
        const yGap = y1 + inToFt(gapIn) * scale; // end of first gap
        const midX = PAD + (bounds.w * scale) - 60; // right side for labels
        // L bracket
        annotations.push(<line key="L1" x1={midX} y1={y0} x2={midX} y2={y1} className="stroke-emerald-700" strokeWidth={1} markerStart="url(#arrow)" markerEnd="url(#arrow)"/>);
        annotations.push(<text key="Ltxt" x={midX - 4} y={(y0+y1)/2} textAnchor="end" dominantBaseline="middle" className="fill-emerald-700 text-[11px] font-medium">{`L = ${fmtInFrac(boardWidthIn)}`}</text>);
        // f tick
        annotations.push(<line key="f1" x1={midX} y1={y1} x2={midX} y2={yGap} className="stroke-amber-600" strokeWidth={1} markerStart="url(#arrow)" markerEnd="url(#arrow)"/>);
        annotations.push(<text key="ftxt" x={midX - 4} y={(y1+yGap)/2} textAnchor="end" dominantBaseline="middle" className="fill-amber-600 text-[11px] font-medium">{`f = ${fmtInFrac(gapIn)}`}</text>);
      } else {
        const x0 = PAD; // first board left
        const x1 = PAD + inToFt(boardWidthIn) * scale; // first board right
        const xGap = x1 + inToFt(gapIn) * scale; // end of first gap
        const midY = PAD + 18; // top area for labels
        // L bracket
        annotations.push(<line key="L1" x1={x0} y1={midY} x2={x1} y2={midY} className="stroke-emerald-700" strokeWidth={1} markerStart="url(#arrow)" markerEnd="url(#arrow)"/>);
        annotations.push(<text key="Ltxt" x={(x0+x1)/2} y={midY - 4} textAnchor="middle" className="fill-emerald-700 text-[11px] font-medium">{`L = ${fmtInFrac(boardWidthIn)}`}</text>);
        // f tick
        annotations.push(<line key="f1" x1={x1} y1={midY} x2={xGap} y2={midY} className="stroke-amber-600" strokeWidth={1} markerStart="url(#arrow)" markerEnd="url(#arrow)"/>);
        annotations.push(<text key="ftxt" x={(x1+xGap)/2} y={midY - 4} textAnchor="middle" className="fill-amber-600 text-[11px] font-medium">{`f = ${fmtInFrac(gapIn)}`}</text>);
      }
    }
    // Joist spacing i (o.c.) between first two joists if available
    if (jCount >= 2) {
      if (!joistsRotate90) {
        if (boardsParallelToB) {
          const yA = PAD + inToFt(joistOCIn) * 0 * scale;
          const yB = PAD + inToFt(joistOCIn) * 1 * scale;
          const xDim = PAD + 40;
          annotations.push(<line key="i1" x1={xDim} y1={yA} x2={xDim} y2={yB} className="stroke-sky-700" strokeWidth={1} markerStart="url(#arrow)" markerEnd="url(#arrow)"/>);
          annotations.push(<text key="itxt" x={xDim + 4} y={(yA+yB)/2} dominantBaseline="middle" className="fill-sky-700 text-[11px] font-medium">{`i = ${fmtInFrac(joistOCIn)} o.c.`}</text>);
        } else {
          const xA = PAD + inToFt(joistOCIn) * 0 * scale;
          const xB = PAD + inToFt(joistOCIn) * 1 * scale;
          const yDim = PAD + bounds.h*scale - 20;
          annotations.push(<line key="i1" x1={xA} y1={yDim} x2={xB} y2={yDim} className="stroke-sky-700" strokeWidth={1} markerStart="url(#arrow)" markerEnd="url(#arrow)"/>);
          annotations.push(<text key="itxt" x={(xA+xB)/2} y={yDim - 4} textAnchor="middle" className="fill-sky-700 text-[11px] font-medium">{`i = ${fmtInFrac(joistOCIn)} o.c.`}</text>);
        }
      } else {
        if (boardsParallelToB) {
          const xA = PAD + inToFt(joistOCIn) * 0 * scale;
          const xB = PAD + inToFt(joistOCIn) * 1 * scale;
          const yDim = PAD + bounds.h*scale - 20;
          annotations.push(<line key="i1" x1={xA} y1={yDim} x2={xB} y2={yDim} className="stroke-sky-700" strokeWidth={1} markerStart="url(#arrow)" markerEnd="url(#arrow)"/>);
          annotations.push(<text key="itxt" x={(xA+xB)/2} y={yDim - 4} textAnchor="middle" className="fill-sky-700 text-[11px] font-medium">{`i = ${fmtInFrac(joistOCIn)} o.c.`}</text>);
        } else {
          const yA = PAD + inToFt(joistOCIn) * 0 * scale;
          const yB = PAD + inToFt(joistOCIn) * 1 * scale;
          const xDim = PAD + 40;
          annotations.push(<line key="i1" x1={xDim} y1={yA} x2={xDim} y2={yB} className="stroke-sky-700" strokeWidth={1} markerStart="url(#arrow)" markerEnd="url(#arrow)"/>);
          annotations.push(<text key="itxt" x={xDim + 4} y={(yA+yB)/2} dominantBaseline="middle" className="fill-sky-700 text-[11px] font-medium">{`i = ${fmtInFrac(joistOCIn)} o.c.`}</text>);
        }
      }
    }

    return (
      <svg viewBox={`0 0 ${maxW} ${maxH}`} className="w-full h-[280px] md:h-[420px]">
        <defs>
          <clipPath id="deckClip">
            <path d={pathD} />
          </clipPath>
          {/* Arrowheads for dimension lines */}
          <marker id="arrow" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L6,3 L0,6 Z" className="fill-neutral-600" />
          </marker>
        </defs>
        {/* Boundary */}
        <path d={pathD} className="fill-white stroke-black" strokeWidth={2} />
        {/* Boards, joists clipped to polygon */}
        <g clipPath="url(#deckClip)">
          {stripes}
          {joists}
          {annotations}
        </g>
        {/* Labels (bbox) */}
        <text x={PAD + (bounds.w*scale)/2} y={PAD - 8} textAnchor="middle" className="fill-black text-[12px]">B = {fmtFt(B)}</text>
        <text x={PAD - 8} y={PAD + (bounds.h*scale)/2} textAnchor="end" dominantBaseline="middle" className="fill-black text-[12px]">H = {fmtFt(H)}</text>
      </svg>
    );
  }, [useSketch, sketchPts, bbox, Brect, Hrect, boardsAcross, boardWidthIn, deckSpanAcrossFt, boardsRunLengthFt, joistOCIn, joistCount, moduleIn, B, H, joistsRotate90]);

  // Run tests once in-browser (avoids stray global try/catch at EOF)
  useEffect(() => {
    try { runTests(); } catch (e) { console.warn('Tests failed:', e); }
  }, []);

  return (
    <div className="min-h-screen w-full bg-white text-neutral-900">
      <TopBar />

      <main className="max-w-6xl mx-auto px-4 pb-24 space-y-10">
        <Section title="0. DRAW YOUR DECK (Beta Sketch Tool)">
          <div className="mb-3 flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={useSketch} onChange={(e)=>setUseSketch(e.target.checked)} /> Use sketch</label>
            <span className="text-xs text-neutral-500">Use the <b>Grid spacing</b> dropdown (6"/12"/24"/36"/48"). Points snap to intersections. Click to add • hold to drag • right‑click to delete • click a line to insert a midpoint • click a length label to edit length.</span>
          </div>
          <DeckSketcher points={sketchPts} setPoints={setSketchPts} />
          <div className="mt-3 grid md:grid-cols-5 gap-4">
            <Readout label="Sketch area" value={`${round(sketchArea,1)} sq ft`} />
            <Readout label="Perimeter" value={`${round(sketchPerim,1)} ft`} />
            <Readout label="Bounding B" value={fmtFt(B)} />
            <Readout label="Bounding H" value={fmtFt(H)} />
            <Readout label="Vertices" value={sketchPts.length} />
          </div>
        </Section>

        <Section title="1. SHAPE & LOAD (US)">
          <div className="grid md:grid-cols-4 gap-4">
            <Select label="Live load [psf]" value={qPsf} onChange={setQPsf} options={psfOptions.map(v=>({label:String(v), value:v}))} />
            <Select label="Deflection (info)" value={deflection} onChange={setDeflection} options={DEFLECTIONS.map(v=>({label:v, value:v}))} />
            <Readout label="Area used in BOQ" value={`${round(areaSqft,1)} sq ft`} />
            <label className="block">
              <span className="text-xs text-neutral-600">Joists: rotate 90°</span>
              <div className="mt-1"><input type="checkbox" checked={joistsRotate90} onChange={(e)=>setJoistsRotate90(e.target.checked)} /></div>
            </label>
          </div>
          <div className="mt-2 text-xs text-neutral-500">Deck size is driven by your sketch above. Length/width inputs were removed. Toggle rotates joists independently of board direction.</div>
          <div className="mt-4">{SketchAndGraphic}</div>
        </Section>

        <Section title="2. DECKING (Boards) & FINISH">
          <div className="grid md:grid-cols-3 gap-4">
            <Select label="Fastening" value={fastening} onChange={setFastening} options={FASTENINGS.map(v=>({label:v, value:v}))} />
            <Select label="Grooving" value={groovingType} onChange={setGroovingType} options={GROOVING.map(v=>({label:v, value:v}))} />
            <Readout label="Boards run" value="Perpendicular to joists" />
          </div>
          <div className="mt-4 grid md:grid-cols-5 gap-4">
            <NumInput label={'Board gap f [in]'} value={gapIn} setValue={setGapIn} step={0.01} />
            <NumInput label={'Board width L [in]'} value={boardWidthIn} setValue={setBoardWidthIn} step={0.01} />
            <NumInput label={'Board thickness [in]'} value={boardThickIn} setValue={setBoardThickIn} step={0.01} />
            <NumInput label={'Groove H [in]'} value={grooveHIn} setValue={setGrooveHIn} step={0.01} />
            <NumInput label={'Groove F [in]'} value={grooveFIn} setValue={setGrooveFIn} step={0.01} />
          </div>
          <div className="text-xs text-neutral-500 mt-2">Notation: <b>L</b> = board width, <b>f</b> = board gap, <b>i</b> = joist spacing (o.c.). Deck boards always run perpendicular to joists.</div>
        </Section>

        <Section title="Reference: Deck Variables (L, f, i)">
          <div className="grid md:grid-cols-2 gap-4 items-start">
            <img
              src="https://github.com/blaashannes/myproject/blob/main/images/deck%20variables.png?raw=true"
              alt="Deck variables illustration: L (board width), f (gap), i (joist spacing o.c.)"
              className="w-full rounded-xl border border-neutral-200 shadow-sm"
            />
            <div className="text-sm text-neutral-700 space-y-2">
              <p><b>L</b> = deck board width (inches). <b>f</b> = board gap (inches). <b>i</b> = joist spacing on-center (inches).</p>
              <p>The graphic is for reference only. Live values in the preview update from your inputs and snap grid.</p>
            </div>
          </div>
        </Section>

        <Section title="3. FRAMING (Substructure)">
          <div className="grid md:grid-cols-4 gap-4">
            <NumInput label={'Joist spacing i (o.c.) [in]'} value={joistOCIn} setValue={setJoistOCIn} step={1} />
            <Select label="Support type" value={supportType} onChange={setSupportType} options={SUPPORT_TYPES.map(s=>({label:s.name, value:s.value}))} />
            <NumInput label={'Support spacing along joist [in]'} value={supportSpacingIn} setValue={setSupportSpacingIn} step={1} />
            <NumInput label={'Waste factor'} value={waste} setValue={setWaste} step={0.01} />
          </div>
        </Section>

        <Section title="4. RESULTS (IMPERIAL)">
          <div className="grid md:grid-cols-4 gap-4">
            <Readout label="Number of deck boards" value={boardsAcross} />
            <Readout label="Deck board span (ft)" value={fmtFt(boardsRunLengthFt)} />
            <Readout label="Joist count" value={joistCount} />
            <Readout label="Total supports" value={totalSupports} />
          </div>
          <div className="grid md:grid-cols-4 gap-4 mt-4">
            <Readout label="Joist linear feet" value={`${totalJoistFeet} ft`} />
            <Readout label="Connector intersections" value={connectorsNoWaste} />
            <Readout label="Connectors (with waste)" value={connectorsWithWaste} />
            <Readout label="Module (L + f) [in]" value={fmtIn(moduleIn)} />
          </div>
        </Section>

        <Section title="5. BILL OF QUANTITIES — ROTHOBLAAS (US)">
          <BrandTable>
            <BoQRow label="Supports:" name={supportType} code={supportType} qty={totalSupports} />
            <BoQRow label="Support screws:" name="KKA COLOR" code="KKAN430" qty={totalSupports*2} />
            <BoQRow label="Joists:" name="Profiles / Timber" code="ALUTERRA / SPF" qty={`${totalJoistFeet} ft`} />
            <BoQRow label="Connectors:" name="FLAT/FLIP" code="FLAT/FLIP" qty={connectorsWithWaste} />
            <BoQRow label="Connector screws:" name="KKA COLOR" code="KKAN440" qty={connectorsWithWaste} />
          </BrandTable>
          <p className="text-xs text-neutral-500 mt-4">Notes: Sketch-based counts for non-rectangular shapes are approximate; verify layout and quantities on detailed drawings.</p>
        </Section>
      </main>

      <footer className="py-10 text-center text-xs text-neutral-500">© Rothoblaas — US Deck Calculator</footer>
    </div>
  );
}

// ---------------------- UI Building Blocks ----------------------
function Section({ title, children }) {
  return (
    <section className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-5 md:p-6">
      <h2 className="text-lg md:text-xl font-extrabold tracking-tight mb-4">{title}</h2>
      {children}
    </section>
  );
}

function Readout({ label, value }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function NumInput({ label, value, setValue, step = 1 }) {
  return (
    <label className="block">
      <span className="text-xs text-neutral-600">{label}</span>
      <input type="number" value={value} step={step} onChange={(e)=>setValue(e.target.valueAsNumber)} className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10" />
    </label>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="text-xs text-neutral-600">{label}</span>
      <select value={value} onChange={(e)=>onChange(e.target.value)} className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10">
        {options.map(o => <option key={String(o.value)} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function FeetInches({ label, feet, inches, setFeet, setInches }) {
  return (
    <div>
      <div className="text-xs text-neutral-600">{label}</div>
      <div className="mt-1 grid grid-cols-2 gap-2">
        <div className="relative">
          <input type="number" value={feet} onChange={(e)=>setFeet(e.target.valueAsNumber)} className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm" />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-neutral-500">ft</span>
        </div>
        <div className="relative">
          <input type="number" value={inches} step={0.25} onChange={(e)=>setInches(e.target.valueAsNumber)} className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm" />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-neutral-500">in</span>
        </div>
      </div>
    </div>
  );
}

function BrandTable({ children }) {
  return (
    <div className="mt-2 border border-neutral-200 rounded-xl overflow-hidden">
      <div className="bg-black text-white px-4 py-2 text-sm font-semibold">Bill of Quantities</div>
      <div className="divide-y divide-neutral-200">{children}</div>
    </div>
  );
}

function BoQRow({ label, name, code, qty }) {
  return (
    <div className="grid grid-cols-4 gap-3 items-center px-4 py-2 text-sm">
      <div className="text-neutral-600">{label}</div>
      <div className="font-medium">{name}</div>
      <div className="text-neutral-500">{code}</div>
      <div className="text-right tabular-nums">{qty}</div>
    </div>
  );
}

// ---------------------- DeckSketcher ----------------------
function DeckSketcher({ points, setPoints }) {
  // Coordinates in FEET; we render to SVG with scale
  const PAD = 24;
  const maxW = 860, maxH = 400;
  const [snapIn, setSnapIn] = useState(12); // default snap: 12" (1 ft)
  const [selected, setSelected] = useState(-1);
  const [dragging, setDragging] = useState(false);
  const suppressClickRef = useRef(false);

  // Inline length editor for segments
  const [editSegIdx, setEditSegIdx] = useState(-1);
  const [editValue, setEditValue] = useState(0); // feet
  const [editPos, setEditPos] = useState({ x: 0, y: 0 }); // px for editor

  // Compute local bounds to center drawing
  const xs = points.map(p=>p.x), ys = points.map(p=>p.y);
  const minX = Math.min(...xs, 0), minY = Math.min(...ys, 0);
  const maxX = Math.max(...xs, 20), maxY = Math.max(...ys, 13);
  const widthFt = maxX - minX, heightFt = maxY - minY;
  const scale = Math.min((maxW - PAD*2) / Math.max(widthFt,1), (maxH - PAD*2) / Math.max(heightFt,1));

  // Grid tile matches snap (6, 12, 24, 36, 48 inches)
  const gridStepFt = inToFt(snapIn);
  const gridStepPx = gridStepFt * scale;
  const gridLabel = `${snapIn}\" (${round(gridStepFt,2)} ft)`;

  const toPx = (p) => ({ x: PAD + (p.x - minX) * scale, y: PAD + (p.y - minY) * scale });
  const fromPx = (x,y) => ({ x: (x - PAD)/scale + minX, y: (y - PAD)/scale + minY });

  const pathD = points.map((p,i)=>{ const {x,y} = toPx(p); return `${i===0?"M":"L"}${x},${y}`; }).join(" ") + (points.length>=3?" Z":"");

  const onCanvasClick = (e) => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    // Ignore clicks when inline editor is open
    if (editSegIdx >= 0) return;
    const svg = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - svg.left; const y = e.clientY - svg.top;
    const ft = fromPx(x, y);
    const snapped = snapPointToGrid(ft, snapIn);
    setPoints([...points, snapped]);
  };

  const onPointerDownPt = (idx) => (e) => {
    e.stopPropagation();
    setSelected(idx);
    setDragging(true);
  };

  const onPointerMove = (e) => {
    if (!dragging || selected < 0) return;
    const svg = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - svg.left; const y = e.clientY - svg.top;
    const ft = fromPx(x, y);
    const snapped = snapPointToGrid(ft, snapIn);
    const next = points.map((p,i)=> i===selected ? snapped : p);
    setPoints(next);
  };

  const endDrag = () => {
    if (dragging) { suppressClickRef.current = true; }
    setDragging(false);
    setSelected(-1);
  };

  // Delete nearest point on right-click; if none close, delete selected; else delete last
  const deleteNearestOrSelected = (xClient, yClient, svgRect) => {
    const cursorFt = fromPx(xClient - svgRect.left, yClient - svgRect.top);
    const threshFt = gridStepFt / 2; // within half-grid
    let bestIdx = -1, bestDist = Infinity;
    points.forEach((p, i) => {
      const d = Math.hypot(p.x - cursorFt.x, p.y - cursorFt.y);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    });
    if (bestIdx >= 0 && bestDist <= threshFt) {
      const next = points.filter((_,i)=>i!==bestIdx);
      setPoints(next);
      return;
    }
    if (selected >= 0) {
      const next = points.filter((_,i)=>i!==selected);
      setSelected(-1); setPoints(next);
      return;
    }
    if (points.length > 0) {
      setPoints(points.slice(0, -1));
    }
  };

  // Set explicit segment length by editing label
  const setEdgeLength = (segIndex, newLenFt) => {
    if (points.length < 2 || !Number.isFinite(newLenFt) || newLenFt <= 0) return;
    const a = points[segIndex];
    const b = points[(segIndex+1)%points.length];
    const nb = adjustSegmentLength(a, b, newLenFt);
    const snapped = snapPointToGrid(nb, snapIn);
    const next = [...points];
    next[(segIndex+1)%points.length] = snapped;
    setPoints(next);
  };

  const openEditForSegment = (i, px) => {
    const a = points[i];
    const b = points[(i+1)%points.length];
    const lenFt = Math.hypot(b.x - a.x, b.y - a.y);
    setEditSegIdx(i);
    setEditValue(round(lenFt, 2));
    setEditPos(px);
  };

  // Insert midpoint by clicking a line (not the label)
  const insertMidpoint = (segIndex) => {
    const a = points[segIndex];
    const b = points[(segIndex+1) % points.length];
    const mid = { x: (a.x+b.x)/2, y: (a.y+b.y)/2 };
    const snapped = snapPointToGrid(mid, snapIn);
    const next = [...points];
    next.splice(segIndex+1, 0, snapped);
    setPoints(next);
  };

  // Segment visuals, labels, and click targets
  const segmentLabels = [];
  const segmentHitTargets = [];
  if (points.length >= 2) {
    for (let i=0; i<points.length; i++) {
      const a = points[i];
      const b = points[(i+1)%points.length];
      if (i === points.length-1 && points.length < 3) break;
      const mid = { x: (a.x+b.x)/2, y: (a.y+b.y)/2 };
      const lenFt = Math.hypot(b.x-a.x, b.y-a.y);
      const mpx = toPx(mid);
      // Label: click to edit explicit length (no new point)
      segmentLabels.push(
        <text key={`len-${i}`}
              x={mpx.x}
              y={mpx.y-6}
              textAnchor="middle"
              className="cursor-pointer select-none text-[10px] fill-neutral-700"
              onMouseDown={(e)=>{ e.stopPropagation(); }}
              onClick={(e)=>{ e.stopPropagation(); openEditForSegment(i, {x: mpx.x, y: mpx.y-24}); }}>
          {round(lenFt,2)}'
        </text>
      );
      // Invisible thick line for easy clicking: inserts midpoint **between those vertices**
      const ap = toPx(a); const bp = toPx(b);
      segmentHitTargets.push(
        <line key={`hit-${i}`}
              x1={ap.x} y1={ap.y} x2={bp.x} y2={bp.y}
              strokeWidth={12} stroke="transparent"
              onMouseDown={(e)=>{ e.stopPropagation(); }}
              onClick={(e)=>{ e.stopPropagation(); insertMidpoint(i); }} />
      );
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-2 text-sm">
        <label className="flex items-center gap-2">Grid spacing
          <select className="border rounded px-2 py-1 text-sm" value={snapIn} onChange={(e)=>setSnapIn(parseFloat(e.target.value))}>
            <option value={6}>6" (0.5 ft)</option>
            <option value={12}>12" (1 ft)</option>
            <option value={24}>24" (2 ft)</option>
            <option value={36}>36" (3 ft)</option>
            <option value={48}>48" (4 ft)</option>
          </select>
        </label>
        <span className="text-xs text-neutral-500">Grid tile = <b>{gridLabel}</b>. Click to add a point • hold to drag a point • right‑click to delete a nearby point • click a line to insert a midpoint • click a length label to edit that edge.</span>
        <button onClick={()=>setPoints([])} className="rounded px-3 py-1 border">Clear</button>
      </div>

      <svg
        viewBox={`0 0 ${maxW} ${maxH}`}
        className="w-full h-[260px] md:h-[400px] bg-white border border-neutral-200 rounded-xl select-none"
        onMouseMove={onPointerMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        onClick={onCanvasClick}
        onContextMenu={(e)=>{ e.preventDefault(); const rect = e.currentTarget.getBoundingClientRect(); deleteNearestOrSelected(e.clientX, e.clientY, rect); }}
      >
        {/* Grid (tile = selected snap) */}
        {renderGrid(PAD, maxW, maxH, gridStepPx, gridLabel)}
        {/* Polygon path */}
        {points.length>0 && <path d={pathD} className="fill-emerald-50 stroke-emerald-500" strokeWidth={2} />}
        {/* Segment hit targets (before handles so clicks land) */}
        {segmentHitTargets}
        {/* Handles */}
        {points.map((p,i)=>{ const {x,y} = toPx(p); return (
          <g key={i} onMouseDown={onPointerDownPt(i)}>
            <circle cx={x} cy={y} r={6} className={"" + (i===selected?"fill-emerald-600":"fill-emerald-500")} />
            <text x={x+8} y={y-8} className="text-[10px] fill-neutral-600">{i+1}</text>
          </g>
        );})}
        {/* Segment length labels (click to open editor) */}
        {segmentLabels}

        {/* Inline editor using foreignObject */}
        {editSegIdx>=0 && (
          <foreignObject x={editPos.x - 45} y={editPos.y - 12} width={90} height={28}>
            <div xmlns="http://www.w3.org/1999/xhtml" style={{background:'white', border:'1px solid #e5e5e5', borderRadius:6, padding:'2px 6px'}}>
              <input autoFocus type="number" step={0.01} value={editValue}
                     onChange={(e)=>setEditValue(e.target.valueAsNumber)}
                     onKeyDown={(e)=>{ if (e.key==='Enter'){ setEdgeLength(editSegIdx, editValue); setEditSegIdx(-1); } if (e.key==='Escape'){ setEditSegIdx(-1); } }}
                     onBlur={()=>{ setEdgeLength(editSegIdx, editValue); setEditSegIdx(-1); }}
                     style={{ width: 54 }} />
              <span style={{fontSize:11, color:'#6b7280', marginLeft:4}}>ft</span>
            </div>
          </foreignObject>
        )}
      </svg>
    </div>
  );
}

function renderGrid(PAD, maxW, maxH, stepPx = 24, gridLabel = "") {
  const lines = [];
  // verticals
  for (let x = PAD; x < maxW - PAD + 1; x += stepPx) {
    lines.push(<line key={`gx${x}`} x1={x} y1={PAD} x2={x} y2={maxH-PAD} className="stroke-neutral-200" strokeWidth={1} />);
  }
  // horizontals
  for (let y = PAD; y < maxH - PAD + 1; y += stepPx) {
    lines.push(<line key={`gy${y}`} x1={PAD} y1={y} x2={maxW-PAD} y2={y} className="stroke-neutral-200" strokeWidth={1} />);
  }
  // label tile note in corner
  if (gridLabel) {
    lines.push(<text key="gridnote" x={maxW - PAD} y={maxH - 6} textAnchor="end" className="text-[10px] fill-neutral-400">Grid tile = {gridLabel}</text>);
  }
  return <g>{lines}</g>;
}

// ---------------------- Lightweight Tests (console) ----------------------
function runTests() {
  // 10×10 square
  const square = [{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];
  const s = polyAreaPerimeter(square);
  console.assert(Math.abs(s.area - 100) < 1e-6, 'Area square 10x10');
  console.assert(Math.abs(s.perim - 40) < 1e-6, 'Perimeter square 10x10');
  console.assert(s.bbox.w === 10 && s.bbox.h === 10, 'BBox square');

  // 3-4-5 triangle (area = 6, perim = 12)
  const tri = [{x:0,y:0},{x:4,y:0},{x:0,y:3}];
  const t = polyAreaPerimeter(tri);
  console.assert(Math.abs(t.area - 6) < 1e-6, 'Area triangle 3-4-5');
  console.assert(Math.abs(t.perim - (3+4+5)) < 1e-6, 'Perimeter triangle 3-4-5');

  // Snap tests (0.5 ft, 1 ft, 3 ft, 4 ft)
  const snapped0_5 = snapPointToGrid({x:5.3,y:7.7}, 6); // 0.5 ft snap
  console.assert(Math.abs(snapped0_5.x - 5.5) < 1e-6 && Math.abs(snapped0_5.y - 7.5) < 1e-6, 'Snap to 0.5 ft grid');

  const snapped1 = snapPointToGrid({x:5.1,y:7.9}, 12); // 1 ft snap
  console.assert(Math.abs(snapped1.x - 5) < 1e-6 && Math.abs(snapped1.y - 8) < 1e-6, 'Snap to 1 ft grid');
  console.assert(Math.abs(snapped1.x - 5) < 1e-6 && Math.abs(snapped1.y - 8) < 1e-6, 'Snap to 1 ft grid');

  const snapped3 = snapPointToGrid({x:5.1,y:7.9}, 36); // 3 ft snap
  console.assert(Math.abs(snapped3.x - 6) < 1e-6 && Math.abs(snapped3.y - 9) < 1e-6, 'Snap to 3 ft grid');

  const snapped4 = snapPointToGrid({x:7.9,y:8.2}, 48); // 4 ft snap
  console.assert(Math.abs(snapped4.x - 8) < 1e-6 && Math.abs(snapped4.y - 8) < 1e-6, 'Snap to 4 ft grid');

  // Rectangle 20 x 13
  const rect = [{x:0,y:0},{x:20,y:0},{x:20,y:13},{x:0,y:13}];
  const r = polyAreaPerimeter(rect);
  console.assert(Math.abs(r.area - 260) < 1e-6, 'Area 20x13');
  console.assert(Math.abs(r.perim - 66) < 1e-6, 'Perimeter 20x13');

  // NEW: adjustSegmentLength helper tests
  const A = {x:0,y:0}, B = {x:3,y:0};
  const B2 = adjustSegmentLength(A, B, 5);
  console.assert(Math.abs(B2.x - 5) < 1e-6 && Math.abs(B2.y - 0) < 1e-6, 'Adjust length horizontal 3->5');

  const C = {x:0,y:0}, D = {x:0,y:4};
  const D2 = adjustSegmentLength(C, D, 2.5);
  console.assert(Math.abs(D2.x - 0) < 1e-6 && Math.abs(D2.y - 2.5) < 1e-6, 'Adjust length vertical 4->2.5');

  console.assert(fmtInFrac(5.5) === '5 1/2"', 'fmtInFrac 5.5');
  console.assert(fmtInFrac(0.25) === '1/4"', 'fmtInFrac 0.25');
  console.assert(fmtInFrac(16) === '16"', 'fmtInFrac 16');

  console.log('[DeckCalculator] lightweight tests passed');
}
