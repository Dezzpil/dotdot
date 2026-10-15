import { ArrowLeft, Eraser, Flag, Hand, Minus, Plus, Redo2, RotateCcw, Trash2, Undo2 } from 'lucide-react';
import { PointerEvent as ReactPointerEvent, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ApiFailure, apiUrl, editJob, getJob, getPlan, JobView, Numbering, PublicConfig } from '../api';
import { Dottie } from '../components/Brand';
import { errorText, useI18n } from '../i18n';
import {
  canStartAt,
  clampToPage,
  deleteDot,
  dotLabels,
  Draft,
  history,
  insertDot,
  moveDot,
  nearestDot,
  nearestSegment,
  PlanDoc,
  Pt,
  startAt,
  starts,
} from './model';

type Tool = 'move' | 'add' | 'delete';
const HIT_PX = 16; // finger-friendly hit radius in screen pixels
const ZOOMS = [1, 1.5, 2, 3, 4];

/** Loads the finished job and its plan.json, then shows the editor. */
export function EditorScreen(props: { id: string; config: PublicConfig; onBack: () => void; onSaved: (id: string) => void }) {
  const { t } = useI18n();
  const [state, setState] = useState<{ view: JobView; plan: PlanDoc } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const view = await getJob(props.id);
      if (view.status !== 'done' || !view.result) throw new ApiFailure('NOT_FOUND', 404);
      if (!view.result.plan) throw new ApiFailure('NO_PLAN', 409);
      const plan = await getPlan(view.result.plan);
      if (live) setState({ view, plan });
    })().catch((e) => live && setFailure(e instanceof ApiFailure ? e.code : 'INTERNAL'));
    return () => {
      live = false;
    };
  }, [props.id]);

  if (failure) {
    return (
      <section className="failed card" role="alert" data-testid="status-editor-failed">
        <Dottie size={72} mood="oops" />
        <h1 className="h1">{t.editTitle}</h1>
        <p className="lead">{failure === 'NO_PLAN' ? t.editUnavailable : errorText(t, failure, { maxUploadMb: props.config.limits.maxUploadMb })}</p>
        <button type="button" className="btn-primary" onClick={props.onBack} data-testid="button-editor-back">
          {t.editBack}
        </button>
      </section>
    );
  }
  if (!state) {
    return (
      <section className="waiting card" aria-live="polite" data-testid="status-editor-loading">
        <Dottie size={64} mood="think" />
        <p className="lead">{t.editLoading}</p>
      </section>
    );
  }
  const numbering = (state.view.result?.stats.options?.numbering ?? 'jumps') as Numbering;
  return (
    <Editor
      jobId={props.id}
      plan={state.plan}
      source={state.view.result?.source}
      numbering={numbering}
      config={props.config}
      onBack={props.onBack}
      onSaved={props.onSaved}
    />
  );
}

type Drag = { kind: 'dot'; i: number; moved: boolean } | { kind: 'pan'; x: number; y: number; left: number; top: number };

export function Editor(props: {
  jobId: string;
  plan: PlanDoc;
  source?: string;
  numbering: Numbering;
  config: PublicConfig;
  onBack: () => void;
  onSaved: (id: string) => void;
}) {
  const { t } = useI18n();
  const { plan } = props;
  const { w, h } = plan.page;
  const initial = useMemo<Draft>(() => ({ dots: plan.dots, paths: plan.paths }), [plan]);
  const [hist, dispatch] = useReducer(history, { past: [], present: initial, future: [] });
  const d = hist.present;
  const latest = useRef(d);
  latest.current = d;

  const [tool, setTool] = useState<Tool>('move');
  const [sel, setSel] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [showSource, setShowSource] = useState(true);
  // dense sheets on a phone turn into a cloud of digits: start without numbers there
  const [showNumbers, setShowNumbers] = useState(() => plan.dots.length <= 60 || (window.innerWidth || 1024) >= 640);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [pxPerPt, setPxPerPt] = useState(1);

  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => setPxPerPt(svg.getBoundingClientRect().width / w || 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(svg);
    return () => ro.disconnect();
  }, [w, zoom]);

  // the selection may point past the end after undo or delete
  const selected = sel !== null && sel < d.dots.length ? sel : null;
  const labels = useMemo(() => dotLabels(d, props.numbering), [d, props.numbering]);
  const ringed = useMemo(() => starts(d), [d]);

  const toPage = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / (r.width || 1)) * w, ((e.clientY - r.top) / (r.height || 1)) * h];
  };
  const tolerance = () => HIT_PX / (svgRef.current ? svgRef.current.getBoundingClientRect().width / w || 1 : 1);

  const flash = useCallback((text: string) => {
    setNote(text);
    window.setTimeout(() => setNote((n) => (n === text ? null : n)), 2200);
  }, []);

  const apply = (next: Draft) => dispatch({ type: 'apply', draft: next });

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const p = toPage(e);
    const tol = tolerance();
    const hit = nearestDot(d, p, tol);
    setError(null);
    if (tool === 'delete') {
      if (hit !== null) {
        apply(deleteDot(d, hit));
        setSel(null);
      }
      return;
    }
    if (tool === 'add') {
      const seg = nearestSegment(d, p, tol);
      if (seg) {
        apply(insertDot(d, seg.path, seg.seg, clampToPage(seg.point, plan.page)));
        setSel(d.dots.length);
      } else if (hit === null) {
        flash(t.missTap);
      }
      return;
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (hit !== null) {
      setSel(hit);
      drag.current = { kind: 'dot', i: hit, moved: false };
    } else {
      setSel(null);
      const wrap = wrapRef.current;
      drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, left: wrap?.scrollLeft ?? 0, top: wrap?.scrollTop ?? 0 };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const g = drag.current;
    if (!g) return;
    if (g.kind === 'pan') {
      const wrap = wrapRef.current;
      if (wrap) {
        wrap.scrollLeft = g.left - (e.clientX - g.x);
        wrap.scrollTop = g.top - (e.clientY - g.y);
      }
      return;
    }
    if (!g.moved) {
      g.moved = true;
      dispatch({ type: 'begin' }); // the whole drag is one undo step
    }
    dispatch({ type: 'live', draft: moveDot(latest.current, g.i, clampToPage(toPage(e), plan.page)) });
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  // keyboard: Delete, arrows, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        dispatch({ type: 'redo' });
        return;
      }
      const cur = latest.current;
      if (selected === null) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        dispatch({ type: 'apply', draft: deleteDot(cur, selected) });
        setSel(null);
        return;
      }
      const step = e.shiftKey ? 5 : 1;
      const delta: Record<string, Pt> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const dv = delta[e.key];
      if (dv) {
        e.preventDefault();
        const [x, y] = cur.dots[selected];
        dispatch({ type: 'apply', draft: moveDot(cur, selected, clampToPage([x + dv[0], y + dv[1]], plan.page)) });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, plan.page]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const job = await editJob(props.jobId, d);
      props.onSaved(job.id);
    } catch (e) {
      const f = e instanceof ApiFailure ? e : new ApiFailure('INTERNAL', 0);
      setError(errorText(t, f.code, { maxUploadMb: props.config.limits.maxUploadMb, retryAfterSec: f.retryAfterSec }));
      setSaving(false);
    }
  };

  const zoomBy = (dir: 1 | -1) => {
    const i = ZOOMS.indexOf(zoom);
    setZoom(ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, i + dir))]);
  };

  const scale = pxPerPt || 1;
  const dotR = plan.dotR;
  const fontSize = Math.max(dotR * 2.6, Math.min(10, 2 + 6 * zoom) / scale);
  const hitR = Math.max(dotR * 1.5, HIT_PX / scale);
  const img = plan.image;
  const hint = tool === 'move' ? t.hintMove : tool === 'add' ? t.hintAdd : t.hintDelete;
  const toolDefs: Array<[Tool, string, typeof Hand]> = [
    ['move', t.toolMove, Hand],
    ['add', t.toolAdd, Plus],
    ['delete', t.toolDelete, Eraser],
  ];

  return (
    <div className="editor">
      <div className="ed-head">
        <div>
          <h1 className="h2">{t.editTitle}</h1>
          <p className="muted">{t.editLead}</p>
        </div>
        <button type="button" className="btn-ghost ed-back" onClick={props.onBack} aria-label={t.editBack} data-testid="button-editor-back">
          <ArrowLeft size={16} aria-hidden="true" /> <span className="ed-back-label">{t.editBack}</span>
        </button>
      </div>

      <div className="ed-toolbar" role="toolbar" aria-label={t.tools}>
        <div className="ed-tools" role="radiogroup" aria-label={t.tools}>
          {toolDefs.map(([k, label, Icon]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={tool === k}
              className={tool === k ? 'is-on' : ''}
              onClick={() => setTool(k)}
              data-testid={`tool-${k}`}
            >
              <Icon size={16} aria-hidden="true" /> {label}
            </button>
          ))}
        </div>
        <div className="ed-group">
          <button type="button" className="icon-btn" onClick={() => dispatch({ type: 'undo' })} disabled={!hist.past.length} aria-label={t.undo} title={t.undo} data-testid="button-undo">
            <Undo2 size={18} />
          </button>
          <button type="button" className="icon-btn" onClick={() => dispatch({ type: 'redo' })} disabled={!hist.future.length} aria-label={t.redo} title={t.redo} data-testid="button-redo">
            <Redo2 size={18} />
          </button>
          <button type="button" className="icon-btn" onClick={() => zoomBy(-1)} disabled={zoom === ZOOMS[0]} aria-label={t.zoomOut} title={t.zoomOut} data-testid="button-zoom-out">
            <Minus size={18} />
          </button>
          <span className="ed-zoom" aria-live="polite">{Math.round(zoom * 100)}%</span>
          <button type="button" className="icon-btn" onClick={() => zoomBy(1)} disabled={zoom === ZOOMS[ZOOMS.length - 1]} aria-label={t.zoomIn} title={t.zoomIn} data-testid="button-zoom-in">
            <Plus size={18} />
          </button>
        </div>
        <div className="ed-group">
          {props.source && img && (
            <label className="chip">
              <input type="checkbox" checked={showSource} onChange={(e) => setShowSource(e.target.checked)} data-testid="toggle-source" />
              {t.showSource}
            </label>
          )}
          <label className="chip">
            <input type="checkbox" checked={showNumbers} onChange={(e) => setShowNumbers(e.target.checked)} data-testid="toggle-numbers" />
            {t.showNumbers}
          </label>
        </div>
      </div>

      <p className="ed-hint" aria-live="polite" data-testid="text-editor-hint">
        {note ?? hint} <span className="ed-keys">{t.hintKeys}</span>
      </p>

      <div className="ed-canvas" ref={wrapRef}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${w} ${h}`}
          style={{ width: `${zoom * 100}%`, aspectRatio: `${w} / ${h}` }}
          className={`ed-svg tool-${tool}`}
          role="img"
          aria-label={t.editCanvas}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          data-testid="editor-canvas"
        >
          <rect width={w} height={h} className="ed-paper" />
          {showSource && props.source && img && (
            <image
              href={apiUrl(props.source)}
              x={img.ox}
              y={img.oy}
              width={img.w * img.s}
              height={img.h * img.s}
              preserveAspectRatio="none"
              className="ed-source"
            />
          )}
          <g className="ed-plain">
            {plan.lines.map((ln, i) => (
              <polyline key={i} points={ln.map((p) => p.join(',')).join(' ')} />
            ))}
          </g>
          <g className="ed-paths">
            {d.paths.map((p, i) => (
              <polyline key={i} points={p.map((k) => d.dots[k].join(',')).join(' ')} />
            ))}
          </g>
          <g className="ed-dots">
            {d.dots.map(([x, y], i) => (
              <g key={i} className={i === selected ? 'is-sel' : undefined} data-testid={`dot-${i}`}>
                {i === selected && <circle cx={x} cy={y} r={dotR + Math.max(3, 6 / scale)} className="ed-sel" />}
                {ringed.has(i) && d.paths.length > 1 && <circle cx={x} cy={y} r={dotR + 2} className="ed-ring" />}
                <circle cx={x} cy={y} r={dotR} className="ed-dot" />
                <circle cx={x} cy={y} r={hitR} className="ed-hit" />
              </g>
            ))}
          </g>
          {showNumbers && (
            <g className="ed-labels" style={{ fontSize }}>
              {d.dots.map(([x, y], i) => (
                <text key={i} x={x + dotR + 1.2} y={y - dotR - 1}>
                  {labels[i]}
                </text>
              ))}
            </g>
          )}
        </svg>
      </div>

      <div className="ed-footer">
        {selected !== null ? (
          <div className="ed-selected" data-testid="panel-selected">
            <strong>{t.selectedDot(labels[selected] || String(selected + 1))}</strong>
            <button
              type="button"
              className="btn-ghost btn-small"
              onClick={() => {
                apply(deleteDot(d, selected));
                setSel(null);
              }}
              data-testid="button-delete-dot"
            >
              <Trash2 size={15} aria-hidden="true" /> {t.deleteDot}
            </button>
            {canStartAt(d, selected) && (
              <button type="button" className="btn-ghost btn-small" onClick={() => apply(startAt(d, selected))} data-testid="button-start-here">
                <Flag size={15} aria-hidden="true" /> {t.startHere}
              </button>
            )}
          </div>
        ) : (
          <p className="muted" data-testid="text-editor-stats">
            {t.editStats(d.dots.length, d.paths.length)}
          </p>
        )}
        <div className="row">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              dispatch({ type: 'apply', draft: initial });
              setSel(null);
            }}
            disabled={d === initial}
            data-testid="button-reset"
          >
            <RotateCcw size={16} aria-hidden="true" /> {t.resetAll}
          </button>
          <button type="button" className="btn-primary" onClick={save} disabled={saving} data-testid="button-save">
            {saving ? t.editSaving : t.editSave}
          </button>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert" data-testid="text-editor-error">
          {error}
        </p>
      )}
    </div>
  );
}
