import { ArrowRight, Download, LayoutGrid, PencilLine, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { ApiFailure, apiUrl, findSetId, JobView, PublicConfig, Strategy, VariantView, watchJob } from '../api';
import { errorText, useI18n } from '../i18n';
import { Dottie, DrawingDots } from './Brand';
import { Donate } from './Donate';

type Sheet = 'puzzle' | 'answer';
const STRATEGIES: Strategy[] = ['auto', 'subject', 'classes', 'components'];

export function useJob(id: string) {
  const [view, setView] = useState<JobView | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  useEffect(() => {
    setView(null);
    setFailure(null);
    return watchJob(id, setView, setFailure);
  }, [id]);
  return { view, failure };
}

function Waiting({ view }: { view: JobView | null }) {
  const { t } = useI18n();
  const [fact, setFact] = useState(0);
  const processing = view?.status === 'processing';
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => setFact((f) => (f + 1) % t.funFacts.length), 2600);
    return () => clearInterval(timer);
  }, [processing, t.funFacts.length]);

  const pct = processing ? Math.max(12, view?.progress ?? 0) : 4;
  return (
    <section className="waiting card" aria-live="polite" data-testid="status-waiting">
      <DrawingDots />
      <h1 className="h1">{processing ? t.processingTitle : t.queuedTitle}</h1>
      <p className="lead" data-testid="text-wait">
        {processing ? t.funFacts[fact] : view?.position ? t.queuedPos(view.position) : t.queuedWait}
      </p>
      <div className="bar" role="progressbar" aria-label={t.progressLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <span style={{ width: `${pct}%` }} className={processing ? '' : 'is-idle'} />
      </div>
    </section>
  );
}

/** One dot count on the shelf: the sheet itself once it is ready, its place in line until then. */
function VariantCard({ v, badge, config, index, sheet, onOpen, onRatio }: { v: VariantView; badge?: string; config: PublicConfig; index: number; sheet: Sheet; onOpen: (id: string) => void; onRatio: (r: number) => void }) {
  const { t } = useI18n();
  const shot = sheet === 'answer' ? v.result?.answer : v.result?.puzzle;
  const ready = v.status === 'done' && !!shot;
  const state = ready ? 'ready' : v.status === 'processing' ? 'working' : v.status === 'queued' ? 'queued' : 'failed';
  const dots = v.result?.stats.dots ?? v.target;
  const label = state === 'ready' ? t.variantReady : state === 'failed' ? t.variantFailed : state === 'working' ? t.variantWorking : t.variantQueued;

  const body = (
    <>
      <span className={`variant-shot is-${state}`}>
        {ready ? (
          <img
            src={apiUrl(shot!)}
            alt=""
            loading="lazy"
            onLoad={(e) => e.currentTarget.naturalWidth && onRatio(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
            data-testid={`variant-img-${v.target}`}
          />
        ) : (
          <span className="variant-wait">
            {state === 'failed' ? <Dottie size={56} mood="oops" /> : <DrawingDots />}
          </span>
        )}
        {state === 'working' && (
          <span className="bar variant-bar">
            <span style={{ width: `${Math.max(10, v.progress)}%` }} />
          </span>
        )}
      </span>
      <span className="variant-meta">
        <span className="variant-count">
          <span className="variant-n" data-testid={`variant-dots-${v.target}`}>
            {ready ? dots : `≈${v.target}`}
          </span>
          <span className="variant-unit">{t.statDots}</span>
        </span>
        {badge && <span className="variant-badge">{badge}</span>}
        <span className={`variant-state is-${state}`} data-testid={`variant-state-${v.target}`}>
          {label}
        </span>
        {ready && dots !== v.target && <span className="muted small">{t.variantAim(v.target)}</span>}
        {state === 'failed' && (
          <span className="small variant-error">{errorText(t, v.error?.code ?? 'INTERNAL', { maxUploadMb: config.limits.maxUploadMb })}</span>
        )}
        {ready && (
          <span className="variant-cta">
            {t.variantPick} <ArrowRight size={15} aria-hidden="true" />
          </span>
        )}
      </span>
    </>
  );

  const style = { '--i': index } as CSSProperties;
  return ready ? (
    <button
      type="button"
      className="variant-card card is-ready"
      style={style}
      onClick={() => onOpen(v.id)}
      aria-label={`${t.variantPick}: ${dots} ${t.statDots}`}
      data-testid={`variant-${v.target}`}
    >
      {body}
    </button>
  ) : (
    <div className={`variant-card card is-${state}`} style={style} data-testid={`variant-${v.target}`}>
      {body}
    </div>
  );
}

/** The shelf of dot counts for one drawing: cards fill in as the worker finishes them. */
function Picker({ view, config, busy, onStrategy, onAgain, onNew, onOpen }: { view: JobView; config: PublicConfig; busy?: boolean; onStrategy?: (s: Strategy) => void; onAgain?: () => void; onNew: () => void; onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const r = view.result!;
  // every sheet of a set has the same page: the first preview tells the placeholders how tall to be
  const [ratio, setRatio] = useState<number | null>(null);
  const [sheet, setSheet] = useState<Sheet>('puzzle');
  const variants = [...(r.variants ?? [])].sort((a, b) => a.target - b.target);
  const total = variants.length;
  const settled = variants.filter((v) => v.status === 'done' || v.status === 'failed').length;
  const contours = r.stats.contours ?? 1;
  const lo = r.stats.dots_min;
  const hi = r.stats.dots_max;
  const custom = r.stats.options?.target;
  const marked = custom ?? variants[0]?.target;
  const asked = r.stats.options?.strategy ?? 'auto';
  const chosen = r.stats.strategy;

  return (
    <div className="picker" data-testid="screen-picker">
      <section className="picker-head">
        <Dottie size={64} className="pop" />
        <div className="picker-title">
          <h1 className="h1">{total > 1 ? t.pickTitle : t.doneTitle}</h1>
          <p className="lead" data-testid="text-pick-lead">
            {t.pickLead(total)}
          </p>
        </div>
        {r.source && <img className="picker-source" src={apiUrl(r.source)} alt={t.yourDrawing} data-testid="img-picker-source" />}
      </section>

      <div className="picker-meta">
        {settled < total && (
          <div className="picker-progress" aria-live="polite" data-testid="picker-progress">
            <span className="muted small">{t.pickProgress(settled, total)}</span>
            <span className="bar">
              <span style={{ width: `${Math.max(6, (settled / total) * 100)}%` }} />
            </span>
          </div>
        )}
        {lo != null && hi != null && (
          <p className="muted small" data-testid="text-range">
            {t.pickRange(lo, hi)}
          </p>
        )}
        {contours > 1 && (
          <p className="muted small" data-testid="text-picker-contours">
            {contours} {t.statContours(contours)} · {t.statContoursHint}
          </p>
        )}
        {(chosen || onStrategy) && (
          <div className="strategy-row" data-testid="picker-strategy">
            <span className="muted small">{t.strategyLabel}</span>
            {onStrategy ? (
              <span className="chips">
                {STRATEGIES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`chip${asked === s ? ' is-on' : ''}`}
                    aria-pressed={asked === s}
                    disabled={busy}
                    onClick={() => onStrategy(s)}
                    data-testid={`strategy-${s}`}
                  >
                    {t.strategies[s]}
                  </button>
                ))}
              </span>
            ) : (
              <span className="chip is-on" data-testid="strategy-badge">
                {t.strategies[asked]}
              </span>
            )}
            {asked === 'auto' && chosen && (
              <span className="muted small" data-testid="text-strategy-chosen">
                {t.strategyChosen(t.strategies[chosen])}
              </span>
            )}
          </div>
        )}
        <div className="tabs" role="tablist">
          {(['puzzle', 'answer'] as const).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={sheet === k}
              className={sheet === k ? 'is-on' : ''}
              onClick={() => setSheet(k)}
              data-testid={`picker-tab-${k}`}
            >
              {k === 'puzzle' ? t.tabPuzzle : t.tabAnswer}
            </button>
          ))}
        </div>
      </div>

      <div className="variants-grid" style={ratio ? ({ '--shot-ratio': ratio } as CSSProperties) : undefined}>
        {variants.map((v, i) => (
          <VariantCard
            key={v.id}
            v={v}
            index={i}
            config={config}
            sheet={sheet}
            badge={v.target === marked ? (custom != null ? t.variantYours : t.variantDefault) : undefined}
            onOpen={onOpen}
            onRatio={setRatio}
          />
        ))}
      </div>

      <div className="picker-side">
        <div className="row">
          {onAgain && (
            <button type="button" className="btn-ghost" onClick={onAgain} data-testid="button-again">
              <SlidersHorizontal size={16} aria-hidden="true" /> {t.again}
            </button>
          )}
          <button type="button" className="btn-ghost" onClick={onNew} data-testid="button-new">
            <RotateCcw size={16} aria-hidden="true" /> {t.newDrawing}
          </button>
        </div>
        <p className="muted small">{t.pickCustomHint}</p>
        <Donate config={config} />
        <p className="muted small">{t.keptFor(config.limits.resultTtlHours)}</p>
      </div>
    </div>
  );
}

function Done({
  view,
  config,
  onAgain,
  onEdit,
  onNew,
  onOpen,
}: {
  view: JobView;
  config: PublicConfig;
  onAgain?: () => void;
  onEdit?: () => void;
  onNew: () => void;
  onOpen: (id: string) => void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<'puzzle' | 'answer'>('puzzle');
  const [setId, setSetId] = useState<string | null>(null);
  useEffect(() => {
    if (!view.parent) return;
    let alive = true;
    findSetId(view.parent).then(
      (id) => alive && setSetId(id),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [view.parent]);
  const r = view.result!;
  const dots = r.stats.dots ?? 0;
  const lines = r.stats.strokes ?? 1;
  const contours = r.stats.contours ?? 1;
  const sheet = (tab === 'puzzle' ? r.puzzle : r.answer) ?? '';
  return (
    <div className="done">
      <section className="done-preview card">
        <div className="tabs" role="tablist">
          {(['puzzle', 'answer'] as const).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              className={tab === k ? 'is-on' : ''}
              onClick={() => setTab(k)}
              data-testid={`tab-${k}`}
            >
              {k === 'puzzle' ? t.tabPuzzle : t.tabAnswer}
            </button>
          ))}
        </div>
        <a className="sheet" href={apiUrl(sheet)} target="_blank" rel="noopener noreferrer" title={t.openFull} data-testid="link-sheet">
          <img src={apiUrl(sheet)} alt={tab === 'puzzle' ? t.tabPuzzle : t.tabAnswer} data-testid={`img-${tab}`} />
        </a>
      </section>

      <section className="done-side">
        <div className="done-head">
          <Dottie size={64} className="pop" />
          <div>
            <h1 className="h1">{t.doneTitle}</h1>
            <p className="lead" data-testid="text-done">
              {t.doneLead(dots)}
            </p>
            {r.stats.edited && (
              <span className="edited-note" data-testid="text-edited">
                <PencilLine size={13} aria-hidden="true" /> {t.editedNote}
              </span>
            )}
          </div>
        </div>
        <dl className="stats">
          <div>
            <dt>{t.statDots}</dt>
            <dd data-testid="text-dots">{dots}</dd>
          </div>
          <div>
            <dt>{t.statLines(lines)}</dt>
            <dd data-testid="text-lines">{lines}</dd>
          </div>
          {contours > 1 && (
            <div>
              <dt>{t.statContours(contours)}</dt>
              <dd data-testid="text-contours">{contours}</dd>
            </div>
          )}
        </dl>
        {contours > 1 && <p className="muted small">{t.statContoursHint}</p>}
        {lines > 1 && <p className="muted small">{t.statLinesHint}</p>}
        <a className="btn-primary btn-big" href={apiUrl(r.pdf ?? '')} download="dotdot.pdf" data-testid="link-download">
          <Download size={20} aria-hidden="true" /> {t.download}
        </a>
        <p className="muted small center">{t.downloadHint}</p>
        <div className="row">
          {setId && (
            <button type="button" className="btn-ghost" onClick={() => onOpen(setId)} data-testid="button-variants">
              <LayoutGrid size={16} aria-hidden="true" /> {t.otherVariant}
            </button>
          )}
          {onEdit && r.plan && (
            <button type="button" className="btn-ghost" onClick={onEdit} data-testid="button-edit">
              <PencilLine size={16} aria-hidden="true" /> {t.edit}
            </button>
          )}
          {onAgain && (
            <button type="button" className="btn-ghost" onClick={onAgain} data-testid="button-again">
              <SlidersHorizontal size={16} aria-hidden="true" /> {t.again}
            </button>
          )}
          <button type="button" className="btn-ghost" onClick={onNew} data-testid="button-new">
            <RotateCcw size={16} aria-hidden="true" /> {t.newDrawing}
          </button>
        </div>
        <Donate config={config} />
        <p className="muted small">{t.keptFor(config.limits.resultTtlHours)}</p>
      </section>
    </div>
  );
}

function Failed({ code, config, onRetry, onNew }: { code: string; config: PublicConfig; onRetry?: () => void; onNew: () => void }) {
  const { t } = useI18n();
  const imageProblem = code === 'BAD_IMAGE' || code === 'TIMEOUT' || code === 'NOT_FOUND';
  return (
    <section className="failed card" role="alert" data-testid="status-failed">
      <Dottie size={72} mood="oops" />
      <h1 className="h1">{t.failTitle}</h1>
      <p className="lead">{errorText(t, code, { maxUploadMb: config.limits.maxUploadMb })}</p>
      <div className="row">
        {onRetry && !imageProblem && (
          <button type="button" className="btn-primary" onClick={onRetry} data-testid="button-retry">
            {t.tryAgain}
          </button>
        )}
        <button type="button" className={onRetry && !imageProblem ? 'btn-ghost' : 'btn-primary'} onClick={onNew} data-testid="button-pick-another">
          {code === 'NOT_FOUND' ? t.backHome : t.pickAnother}
        </button>
      </div>
    </section>
  );
}

export function JobScreen(props: {
  id: string;
  config: PublicConfig;
  busy?: boolean;
  onStrategy?: (s: Strategy) => void;
  onAgain?: () => void;
  onRetry?: () => void;
  onEdit?: () => void;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const { view, failure } = useJob(props.id);
  if (failure) return <Failed code={failure.code} config={props.config} onNew={props.onNew} />;
  if (view?.status === 'failed') return <Failed code={view.error?.code ?? 'INTERNAL'} config={props.config} onRetry={props.onRetry} onNew={props.onNew} />;
  if (view?.status === 'done' && view.result) {
    const variants = view.result.variants;
    if (variants?.length) {
      // every variant failed: there is nothing to choose, so explain it like any other failure
      if (variants.every((v) => v.status === 'failed'))
        return <Failed code={variants[0].error?.code ?? 'INTERNAL'} config={props.config} onRetry={props.onRetry} onNew={props.onNew} />;
      return <Picker view={view} config={props.config} busy={props.busy} onStrategy={props.onStrategy} onAgain={props.onAgain} onNew={props.onNew} onOpen={props.onOpen} />;
    }
    return <Done view={view} config={props.config} onAgain={props.onAgain} onEdit={props.onEdit} onNew={props.onNew} onOpen={props.onOpen} />;
  }
  return <Waiting view={view} />;
}