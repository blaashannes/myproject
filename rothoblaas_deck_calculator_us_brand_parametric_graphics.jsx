const { useEffect, useMemo, useRef, useState } = React;

/**
 * TERRALOCK Fastener Takeoff Tool — Rothoblaas (US / Imperial)
 *
 * Slimmed down to focus on TERRALOCK clip quantities while preserving:
 *  - The sketch-based deck shape drawer (grid + snapping + edit segment length + add midpoint + right‑click delete)
 *  - Joist orientation/spacing controls (to get accurate joist/board intersections)
 *  - Board module inputs (L = board width, f = gap) used to count board rows
 */

// ---------------------- Helpers ----------------------
function inToFt(inches){ return inches / 12; }
function toNumber(n, fb=0){ const v = typeof n === 'number' ? n : parseFloat(n); return Number.isFinite(v) ? v : fb; }
function ceil(n){ return Math.ceil(n); }
function floor(n){ return Math.floor(n); }
function round(n, d=2){ return Math.round(n * 10**d) / 10**d; }
function fmtIn(n){ return `${round(n,2)}"`; }
function fmtFt(n){ return `${round(n,2)}'`; }

// Fractional-inch formatter (US construction, to 1/16")
function gcd(a,b){ a=Math.abs(a); b=Math.abs(b); while(b){ const t=b; b=a%b; a=t; } return a||1; }
function fmtInFrac(n){ const neg=n<0; n=Math.abs(n); const whole=Math.floor(n+1e-9); const frac=n-whole; const DEN=16; let num=Math.round(frac*DEN); if(num===0) return `${neg?'-':''}${whole}"`; if(num===DEN) return `${neg?'-':''}${whole+1}"`; const g=gcd(num,DEN); const rn=num/g, rd=DEN/g; return `${neg?'-':''}${whole?whole+' ':''}${rn}/${rd}"`; }

// Polygon area/perimeter (ft^2 / ft)
function polyAreaPerimeter(pts){
  if(!pts || pts.length<3) return {area:0, perim:0, bbox:{w:0,h:0}};
  let a=0,p=0; for(let i=0;i<pts.length;i++){ const j=(i+1)%pts.length; a += pts[i].x*pts[j].y - pts[j].x*pts[i].y; const dx=pts[j].x-pts[i].x, dy=pts[j].y-pts[i].y; p += Math.hypot(dx,dy); }
  a=Math.abs(a)/2; const xs=pts.map(p=>p.x), ys=pts.map(p=>p.y); const w=Math.max(...xs)-Math.min(...xs), h=Math.max(...ys)-Math.min(...ys); return {area:a, perim:p, bbox:{w,h}};
}

// Grid snap
function snapPointToGrid(p, snapInches){ const sft=inToFt(snapInches); return { x: Math.round(p.x/sft)*sft, y: Math.round(p.y/sft)*sft }; }

// Adjust segment AB to new length (move B along AB)
function adjustSegmentLength(a,b,newLenFt){ const dx=b.x-a.x, dy=b.y-a.y; const L=Math.hypot(dx,dy)||1e-9; const ux=dx/L, uy=dy/L; return { x:a.x+ux*newLenFt, y:a.y+uy*newLenFt } }

// ---------------------- Branding Top Bar ----------------------
function TopBar(){
  return (
    <>
      <style>{`/* --- Rothoblaas top bar --- */
.topbar{ position:relative; width:100%; background:#0b1220; border-bottom:1px solid rgba(148,163,184,.18); padding:14px 20px; display:flex; align-items:center; justify-content:space-between; gap:12px; }
.brandlogo{ height:36px; width:auto; display:block; filter:brightness(0) invert(1); }
.brandlogo--top{ height:36px; }
.homeLink{ display:inline-flex; align-items:center; text-decoration:none; }
.backlink{ margin-left:auto; display:inline-flex; align-items:center; gap:8px; padding:6px 10px; border:1px solid #334155; border-radius:9999px; text-decoration:none; color:#f8fafc; background:#0b1220; }
.backlink:hover{ background:#111827; }
`}</style>
      <div className="topbar">
        <a className="homeLink" href="https://blaashannes.github.io/myproject/" title="Go to homepage">
          <img className="brandlogo brandlogo--top" src="https://www.rothoblaas.com/assets/images/rothoblaas-logo.svg" alt="Rothoblaas logo" />
        </a>
        <a className="backlink" href="https://blaashannes.github.io/myproject/" aria-label="Back to start page">← Back to start</a>
      </div>
    </>
  );
}

// ---------------------- DeckSketcher ----------------------
function DeckSketcher({ points, setPoints }){
  // Coordinates in FEET; we render to SVG with scale
  const PAD=24, maxW=860, maxH=400;
  const [snapIn, setSnapIn] = useState(12); // default 12" (1 ft)
  const [selected, setSelected] = useState(-1);
  const [dragging, setDragging] = useState(false);
  const suppressClickRef = useRef(false);

  // Inline length editor for segments
  const [editSegIdx, setEditSegIdx] = useState(-1);
  const [editValue, setEditValue] = useState(0); // feet
  const [editPos, setEditPos] = useState({x:0,y:0}); // px

  // Bounds & scale
  const xs=points.map(p=>p.x), ys=points.map(p=>p.y);
  const minX=Math.min(...xs,0), minY=Math.min(...ys,0); const maxX=Math.max(...xs,20), maxY=Math.max(...ys,13);
  const widthFt=maxX-minX, heightFt=maxY-minY;
  const scale = Math.min((maxW-PAD*2)/Math.max(widthFt,1),(maxH-PAD*2)/Math.max(heightFt,1));

  // Grid
  const gridStepFt = inToFt(snapIn); const gridStepPx = gridStepFt*scale; const gridLabel = `${snapIn}\" (${round(gridStepFt,2)} ft)`;
  const toPx = (p)=>({ x: PAD+(p.x-minX)*scale, y: PAD+(p.y-minY)*scale });
  const fromPx = (x,y)=>({ x:(x-PAD)/scale+minX, y:(y-PAD)/scale+minY });
  const pathD = points.map((p,i)=>{ const {x,y}=toPx(p); return `${i===0?"M":"L"}${x},${y}`; }).join(" ") + (points.length>=3?" Z":"");

  const onCanvasClick = (e)=>{ if(suppressClickRef.current){ suppressClickRef.current=false; return; } if(editSegIdx>=0) return; const r=e.currentTarget.getBoundingClientRect(); const ft=fromPx(e.clientX-r.left,e.clientY-r.top); const snapped=snapPointToGrid(ft,snapIn); setPoints([...points,snapped]); };
  const onPointerDownPt = (idx)=> (e)=>{ e.stopPropagation(); setSelected(idx); setDragging(true); };
  const onPointerMove = (e)=>{ if(!dragging||selected<0) return; const r=e.currentTarget.getBoundingClientRect(); const ft=fromPx(e.clientX-r.left,e.clientY-r.top); const snapped=snapPointToGrid(ft,snapIn); const next=points.map((p,i)=> i===selected?snapped:p); setPoints(next); };
  const endDrag = ()=>{ if(dragging){ suppressClickRef.current=true; } setDragging(false); setSelected(-1); };

  // Right-click delete nearest
  const deleteNearest = (xClient,yClient,rect)=>{ const cursorFt=fromPx(xClient-rect.left,yClient-rect.top); const threshFt=gridStepFt/2; let best=-1,bd=Infinity; points.forEach((p,i)=>{ const d=Math.hypot(p.x-cursorFt.x,p.y-cursorFt.y); if(d<bd){ bd=d; best=i; } }); if(best>=0 && bd<=threshFt){ const next=points.filter((_,i)=>i!==best); setPoints(next); } };

  // Segment editing
  const setEdgeLength = (segIndex,newLenFt)=>{ if(points.length<2||!Number.isFinite(newLenFt)||newLenFt<=0) return; const a=points[segIndex], b=points[(segIndex+1)%points.length]; const nb=adjustSegmentLength(a,b,newLenFt); const snapped=snapPointToGrid(nb,snapIn); const next=[...points]; next[(segIndex+1)%points.length]=snapped; setPoints(next); };
  const openEditForSegment = (i,px)=>{ const a=points[i], b=points[(i+1)%points.length]; const lenFt=Math.hypot(b.x-a.x,b.y-a.y); setEditSegIdx(i); setEditValue(round(lenFt,2)); setEditPos(px); };
  const insertMidpoint = (i)=>{ const a=points[i], b=points[(i+1)%points.length]; const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2}; const snapped=snapPointToGrid(mid,snapIn); const next=[...points]; next.splice(i+1,0,snapped); setPoints(next); };

  // Segment overlays
  const segmentLabels=[]; const hits=[];
  if(points.length>=2){ for(let i=0;i<points.length;i++){ const a=points[i], b=points[(i+1)%points.length]; if(i===points.length-1 && points.length<3) break; const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2}; const lenFt=Math.hypot(b.x-a.x,b.y-a.y); const mpx=toPx(mid); // label to edit length
      segmentLabels.push(<text key={`len-${i}`} x={mpx.x} y={mpx.y-6} textAnchor="middle" className="cursor-pointer select-none text-[10px] fill-neutral-700" onMouseDown={(e)=>e.stopPropagation()} onClick={(e)=>{ e.stopPropagation(); openEditForSegment(i,{x:mpx.x,y:mpx.y-24}); }}>{round(lenFt,2)}'</text>);
      const ap=toPx(a), bp=toPx(b); hits.push(<line key={`hit-${i}`} x1={ap.x} y1={ap.y} x2={bp.x} y2={bp.y} strokeWidth={12} stroke="transparent" onMouseDown={(e)=>e.stopPropagation()} onClick={(e)=>{ e.stopPropagation(); insertMidpoint(i); }} />);
  }}

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
        <span className="text-xs text-neutral-500">Grid tile = <b>{gridLabel}</b>. Click to add • hold to drag • right‑click delete • click a line to insert a midpoint • click a length label to edit.</span>
        <button onClick={()=>setPoints([])} className="rounded px-3 py-1 border">Clear</button>
      </div>
      <svg viewBox={`0 0 ${maxW} ${maxH}`} className="w-full h-[260px] md:h-[400px] bg-white border border-neutral-200 rounded-xl select-none"
        onMouseMove={onPointerMove} onMouseUp={endDrag} onMouseLeave={endDrag} onClick={onCanvasClick}
        onContextMenu={(e)=>{ e.preventDefault(); const r=e.currentTarget.getBoundingClientRect(); deleteNearest(e.clientX,e.clientY,r); }}>
        {renderGrid(PAD,maxW,maxH,gridStepPx,gridLabel)}
        {points.length>0 && <path d={pathD} className="fill-emerald-50 stroke-emerald-500" strokeWidth={2} />}
        {hits}
        {points.map((p,i)=>{ const {x,y}=toPx(p); return (<g key={i} onMouseDown={onPointerDownPt(i)}><circle cx={x} cy={y} r={6} className={i===selected?"fill-emerald-600":"fill-emerald-500"} /><text x={x+8} y={y-8} className="text-[10px] fill-neutral-600">{i+1}</text></g>); })}
        {segmentLabels}
        {editSegIdx>=0 && (
          <foreignObject x={editPos.x-45} y={editPos.y-12} width={90} height={28}>
            <div xmlns="http://www.w3.org/1999/xhtml" style={{background:'white',border:'1px solid #e5e5e5',borderRadius:6,padding:'2px 6px'}}>
              <input autoFocus type="number" step={0.01} value={editValue}
                onChange={(e)=>setEditValue(e.target.valueAsNumber)}
                onKeyDown={(e)=>{ if(e.key==='Enter'){ setEdgeLength(editSegIdx,editValue); setEditSegIdx(-1);} if(e.key==='Escape'){ setEditSegIdx(-1);} }}
                onBlur={()=>{ setEdgeLength(editSegIdx,editValue); setEditSegIdx(-1);} }
                style={{width:54}} />
              <span style={{fontSize:11,color:'#6b7280',marginLeft:4}}>ft</span>
            </div>
          </foreignObject>
        )}
      </svg>
    </div>
  );
}

function renderGrid(PAD,maxW,maxH,stepPx=24,gridLabel=""){ const lines=[]; for(let x=PAD;x<maxW-PAD+1;x+=stepPx){ lines.push(<line key={`gx${x}`} x1={x} y1={PAD} x2={x} y2={maxH-PAD} className="stroke-neutral-200" strokeWidth={1} />); } for(let y=PAD;y<maxH-PAD+1;y+=stepPx){ lines.push(<line key={`gy${y}`} x1={PAD} y1={y} x2={maxW-PAD} y2={y} className="stroke-neutral-200" strokeWidth={1} />); } if(gridLabel){ lines.push(<text key="gridnote" x={maxW-PAD} y={maxH-6} textAnchor="end" className="text-[10px] fill-neutral-400">Grid tile = {gridLabel}</text>); } return <g>{lines}</g>; }

// ---------------------- Main (TERRALOCK Takeoff) ----------------------
function DeckCalculator(){
  // Sketch
  const [useSketch, setUseSketch] = useState(true);
  const [sketchPts, setSketchPts] = useState([{x:0,y:0},{x:20,y:0},{x:20,y:13},{x:0,y:13}]);
  const { area: sketchArea, perim: sketchPerim, bbox } = polyAreaPerimeter(sketchPts);

  // Rectangle fallback
  const Brect=20, Hrect=13;
  const B = useSketch ? (bbox.w||Brect) : Brect;
  const H = useSketch ? (bbox.h||Hrect) : Hrect;

  // Board module (for rows)
  const [boardWidthIn, setBoardWidthIn] = useState(5.5); // L
  const [gapIn, setGapIn] = useState(0.25);             // f

  // Joists
  const [joistOCIn, setJoistOCIn] = useState(16); // i (o.c.)
  const [joistsRotate90, setJoistsRotate90] = useState(false);

  // Waste factor (clips)
  const [waste, setWaste] = useState(1.05);

  const areaSqft = useMemo(()=> useSketch ? sketchArea : B*H, [useSketch, sketchArea, B, H]);

  // Boards ⟂ Joists (enforced)
  const boardsParallelToB = !joistsRotate90; // boards along B when joists not rotated
  const boardsRunLengthFt  = boardsParallelToB ? B : H;
  const deckSpanAcrossFt   = boardsParallelToB ? H : B; // across boards
  const joistsAcrossSpanFt = joistsRotate90 ? boardsRunLengthFt : deckSpanAcrossFt;
  const joistLengthFt      = joistsRotate90 ? deckSpanAcrossFt : boardsRunLengthFt;

  const moduleIn = boardWidthIn + gapIn;
  const boardsAcross = useMemo(()=>{ const raw=(deckSpanAcrossFt*12 + gapIn) / Math.max(moduleIn,0.01); return floor(raw); }, [deckSpanAcrossFt, moduleIn, gapIn]);
  const joistCount  = useMemo(()=> floor((joistsAcrossSpanFt*12)/Math.max(joistOCIn,0.01)) + 1, [joistsAcrossSpanFt, joistOCIn]);

  // TERRALOCK clips = intersections of board rows with joists (approx)
  const clipsNoWaste = boardsAcross * joistCount;
  const clipsWithWaste = Math.ceil(clipsNoWaste * waste);

  // Parametric preview (boards + joists + annotations)
  const SketchAndGraphic = useMemo(()=>{
    const PAD=24, maxW=860, maxH=420; const bounds={w:B||Brect,h:H||Hrect};
    const scale=Math.min((maxW-PAD*2)/Math.max(bounds.w,1),(maxH-PAD*2)/Math.max(bounds.h,1));
    const toPx=(p)=>({x:PAD+p.x*scale,y:PAD+p.y*scale});
    const poly= (useSketch && sketchPts.length>=3? sketchPts : [{x:0,y:0},{x:Brect,y:0},{x:Brect,y:Hrect},{x:0,y:Hrect}]).map(toPx);
    const pathD = poly.map((p,i)=>`${i===0?"M":"L"}${p.x},${p.y}`).join(" ")+" Z";

    // Boards (stripes)
    const stripes=[]; const moduleFt=inToFt(moduleIn); const count=Math.max(1,boardsAcross);
    for(let i=0;i<count;i++){ const offFt=i*moduleFt; if(boardsParallelToB){ const y=PAD+offFt*scale; stripes.push(<rect key={`s-${i}`} x={PAD} y={y} width={bounds.w*scale} height={inToFt(boardWidthIn)*scale} className="fill-amber-200/70"/>);} else { const x=PAD+offFt*scale; stripes.push(<rect key={`s-${i}`} x={x} y={PAD} width={inToFt(boardWidthIn)*scale} height={bounds.h*scale} className="fill-amber-200/70"/>);} }

    // Joists (guides)
    const joists=[]; const jCount=joistCount; for(let j=0;j<jCount;j++){ const offFt=inToFt(joistOCIn)*j; if(!joistsRotate90){ if(boardsParallelToB){ const y=PAD+offFt*scale; joists.push(<line key={`j-${j}`} x1={PAD} y1={y} x2={PAD+bounds.w*scale} y2={y} className="stroke-neutral-700" strokeWidth={1}/>);} else { const x=PAD+offFt*scale; joists.push(<line key={`j-${j}`} x1={x} y1={PAD} x2={x} y2={PAD+bounds.h*scale} className="stroke-neutral-700" strokeWidth={1}/>);} } else { if(boardsParallelToB){ const x=PAD+offFt*scale; joists.push(<line key={`j-${j}`} x1={x} y1={PAD} x2={x} y2={PAD+bounds.h*scale} className="stroke-neutral-700" strokeWidth={1}/>);} else { const y=PAD+offFt*scale; joists.push(<line key={`j-${j}`} x1={PAD} y1={y} x2={PAD+bounds.w*scale} y2={y} className="stroke-neutral-700" strokeWidth={1}/>);} } }

    // Annotations L, f, i (with arrowheads)
    const defs=(<defs>
      <clipPath id="deckClip"><path d={pathD} /></clipPath>
      <marker id="arrow" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L6,3 L0,6 Z" className="fill-neutral-600" />
      </marker>
    </defs>);

    const ann=[];
    if(boardsAcross>=1){ if(boardsParallelToB){ const y0=PAD, y1=PAD+inToFt(boardWidthIn)*scale, yGap=y1+inToFt(gapIn)*scale; const midX=PAD+bounds.w*scale-60; ann.push(<line key="L1" x1={midX} y1={y0} x2={midX} y2={y1} className="stroke-emerald-700" strokeWidth={1} markerStart="url(#arrow)" markerEnd="url(#arrow)"/>); ann.push(<text key="Ltxt" x={midX-4} y={(y0+y1)/2} textAnchor="end" dominantBaseline="middle" className="fill-emerald-700 text-[11px] font-medium">{`L = ${fmtInFrac(boardWidthIn)}`}</text>); ann.push(<line key="f1" x1={midX} y1={y1} x2={midX} y2={yGap} className="stroke-amber-600" strokeWidth={1} markerStart="url(#arrow)" markerEnd="url(#arrow)"/>); ann.push(<text key="ftxt" x={midX-4} y={(y1+yGap)/2} textAnchor="end" dominantBaseline="middle" className="fill-amber-600 text-[11px] font-medium">{`f = ${fmtInFrac(gapIn)}`}</text>); } else { const x0=PAD, x1=PAD+inToFt(boardWidthIn)*scale, xGap=x1+inToFt(gapIn)*scale, midY=PAD+18; ann.push(<line key="L1" x1={x0} y1={midY} x2={x1} y2={midY} className="stroke-emerald-700" strokeWidth={1} markerStart="url(#arrow)" markerEnd="url(#arrow)"/>); ann.push(<text key="Ltxt" x={(x0+x1)/2} y={midY-4} textAnchor="middle" className="fill-emerald-700 text-[11px] font-medium">{`L = ${fmtInFrac(boardWidthIn)}`}</text>); ann.push(<line key="f1" x1={x1} y1={midY} x2={xGap} y2={midY} className="stroke-amber-600" strokeWidth={1} markerStart="url(#arrow)" markerEnd="url(#arrow)"/>); ann.push(<text key="ftxt" x={(x1+xGap)/2} y={midY-4} textAnchor="middle" className="fill-amber-600 text-[11px] font-medium">{`f = ${fmtInFrac(gapIn)}`}</text>); } }

    if(joistCount>=2){ if(!joistsRotate90){ if(boardsParallelToB){ const yA=PAD+inToFt(joistOCIn)*0*scale, yB=PAD+inToFt(joistOCIn)*1*scale; const xDim=PAD+40; ann.push(<line key="i1" x1={xDim} y1={yA} x2={xDim} y2={yB} className="stroke-sky-700" strokeWidth={1} markerStart="url(#arrow)" markerEnd="url(#arrow)"/>); ann.push(<text key="itxt" x={xDim+4} y={(yA+yB)/2} dominantBaseline="middle" className="fill-sky-700 text-[11px] font-medium">{`i = ${fmtInFrac(joistOCIn)} o.c.`}</text>);} else { const xA=PAD+inToFt(joistOCIn)*0*scale, xB=PAD+inToFt(joistOCIn)*1*scale; const yDim=PAD+bounds.h*scale-20; ann.push(<line key="i1" x1={xA} y1={yDim} x2={xB} y2={yDim} className="stroke-sky-700" strokeWidth={1} markerStart="url(#arrow)" markerEnd="url(#arrow)"/>); ann.push(<text key="itxt" x={(xA+xB)/2} y={yDim-4} textAnchor="middle" className="fill-sky-700 text-[11px] font-medium">{`i = ${fmtInFrac(joistOCIn)} o.c.`}</text>);} } else { if(boardsParallelToB){ const xA=PAD+inToFt(joistOCIn)*0*scale, xB=PAD+inToFt(joistOCIn)*1*scale; const yDim=PAD+bounds.h*scale-20; ann.push(<line key="i1" x1={xA} y1={yDim} x2={xB} y2={yDim} className="stroke-sky-700" strokeWidth={1} markerStart="url(#arrow)" markerEnd="url(#arrow)"/>); ann.push(<text key="itxt" x={(xA+xB)/2} y={yDim-4} textAnchor="middle" className="fill-sky-700 text-[11px] font-medium">{`i = ${fmtInFrac(joistOCIn)} o.c.`}</text>);} else { const yA=PAD+inToFt(joistOCIn)*0*scale, yB=PAD+inToFt(joistOCIn)*1*scale; const xDim=PAD+40; ann.push(<line key="i1" x1={xDim} y1={yA} x2={xDim} y2={yB} className="stroke-sky-700" strokeWidth={1} markerStart="url(#arrow)" markerEnd="url(#arrow)"/>); ann.push(<text key="itxt" x={xDim+4} y={(yA+yB)/2} dominantBaseline="middle" className="fill-sky-700 text-[11px] font-medium">{`i = ${fmtInFrac(joistOCIn)} o.c.`}</text>);} }

    return (
      <svg viewBox={`0 0 ${maxW} ${maxH}`} className="w-full h-[280px] md:h-[420px]">
        {defs}
        <path d={pathD} className="fill-white stroke-black" strokeWidth={2} />
        <g clipPath="url(#deckClip)">{stripes}{joists}{ann}</g>
        <text x={PAD + (bounds.w*scale)/2} y={PAD - 8} textAnchor="middle" className="fill-black text-[12px]">B = {fmtFt(B)}</text>
        <text x={PAD - 8} y={PAD + (bounds.h*scale)/2} textAnchor="end" dominantBaseline="middle" className="fill-black text-[12px]">H = {fmtFt(H)}</text>
      </svg>
    );
  }, [useSketch, sketchPts, B, H, boardWidthIn, gapIn, moduleIn, boardsAcross, joistOCIn, joistCount, joistsRotate90, boardsParallelToB]);

  // Tests once
  useEffect(()=>{ try{ runTests(); }catch(e){ console.warn('Tests failed:', e); } },[]);

  return (
    <div className="min-h-screen w-full bg-white text-neutral-900">
      <TopBar />
      <main className="max-w-6xl mx-auto px-4 pb-24 space-y-10">
        <Section title="0. DRAW YOUR DECK (Sketch Tool)">
          <div className="mb-3 flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={useSketch} onChange={(e)=>setUseSketch(e.target.checked)} /> Use sketch</label>
            <span className="text-xs text-neutral-500">Snap to 6/12/24/36/48 in intersections. Click to add • hold to drag • right‑click delete • click a line to insert a midpoint • click a length label to edit.</span>
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

        <Section title="1. SHAPE & JOISTS">
          <div className="grid md:grid-cols-4 gap-4">
            <NumInput label={'Board width L [in]'} value={boardWidthIn} setValue={setBoardWidthIn} step={0.01} />
            <NumInput label={'Board gap f [in]'} value={gapIn} setValue={setGapIn} step={0.01} />
            <NumInput label={'Joist spacing i (o.c.) [in]'} value={joistOCIn} setValue={setJoistOCIn} step={1} />
            <label className="block"><span className="text-xs text-neutral-600">Joists: rotate 90°</span><div className="mt-1"><input type="checkbox" checked={joistsRotate90} onChange={(e)=>setJoistsRotate90(e.target.checked)} /></div></label>
          </div>
          <div className="text-xs text-neutral-500 mt-2">Boards always run perpendicular to joists. Notation: <b>L</b> = board width, <b>f</b> = board gap, <b>i</b> = joist spacing (o.c.).</div>
          <div className="mt-4">{SketchAndGraphic}</div>
        </Section>

        <Section title="2. TERRALOCK — FASTENER TAKEOFF">
          <div className="grid md:grid-cols-4 gap-4">
            <Readout label="Board rows (across)" value={boardsAcross} />
            <Readout label="Joists (count)" value={joistCount} />
            <Readout label="Clips (no waste)" value={clipsNoWaste} />
            <div>
              <span className="text-xs text-neutral-600">Waste factor</span>
              <input type="number" step={0.01} value={waste} onChange={(e)=>setWaste(e.target.valueAsNumber)} className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid md:grid-cols-3 gap-4 mt-4">
            <Readout label="TERRALOCK clips (with waste)" value={clipsWithWaste} />
            <Readout label="Deck board span (ft)" value={fmtFt(boardsRunLengthFt)} />
            <Readout label="Area (sq ft)" value={round(areaSqft,1)} />
          </div>
        </Section>
      </main>
      <footer className="py-10 text-center text-xs text-neutral-500">© Rothoblaas — TERRALOCK Takeoff Tool</footer>
    </div>
  );
}

// ---------------------- UI primitives ----------------------
function Section({title,children}){ return (<section className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-5 md:p-6"><h2 className="text-lg md:text-xl font-extrabold tracking-tight mb-4">{title}</h2>{children}</section>); }
function Readout({label,value}){ return (<div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4"><div className="text-xs text-neutral-500">{label}</div><div className="text-lg font-semibold tabular-nums">{value}</div></div>); }
function NumInput({label,value,setValue,step=1}){ return (<label className="block"><span className="text-xs text-neutral-600">{label}</span><input type="number" value={value} step={step} onChange={(e)=>setValue(e.target.valueAsNumber)} className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"/></label>); }

// ---------------------- Tests ----------------------
function runTests(){
  const sq=[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}], s=polyAreaPerimeter(sq);
  console.assert(Math.abs(s.area-100)<1e-6,'Area 10x10'); console.assert(Math.abs(s.perim-40)<1e-6,'Perim 10x10');
  const tri=[{x:0,y:0},{x:4,y:0},{x:0,y:3}], t=polyAreaPerimeter(tri);
  console.assert(Math.abs(t.area-6)<1e-6,'Area tri'); console.assert(Math.abs(t.perim-(3+4+5))<1e-6,'Perim tri');
  const snapped1=snapPointToGrid({x:5.1,y:7.9},12); console.assert(Math.abs(snapped1.x-5)<1e-6 && Math.abs(snapped1.y-8)<1e-6,'Snap 1ft');
  const A={x:0,y:0}, Bp={x:3,y:0}; const B2=adjustSegmentLength(A,Bp,5); console.assert(Math.abs(B2.x-5)<1e-6,'Adjust seg');
  console.assert(fmtInFrac(5.5)==='5 1/2"','fmt 5.5'); console.assert(fmtInFrac(0.25)==='1/4"','fmt 0.25'); console.assert(fmtInFrac(16)==='16"','fmt 16');
}

// Mounting (UMD): expose globally
window.DeckCalculator = DeckCalculator;
