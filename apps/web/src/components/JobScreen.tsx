import { Download, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiFailure, apiUrl, JobView, PublicConfig, watchJob } from '../api';
import { errorText, useI18n } from '../i18n';
import { Dottie, DrawingDots } from './Brand';
import { Donate } from './Donate';

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

function Done({ view, config, onAgain, onNew }: { view: JobView; config: PublicConfig; onAgain?: () => void; onNew: () => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<'puzzle' | 'answer'>('puzzle');
  const r = view.result!;
  const dots = r.stats.dots ?? 0;
  const lines = r.stats.strokes ?? 1;
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
        <a
          className="sheet"
          href={apiUrl(tab === 'puzzle' ? r.puzzle : r.answer)}
          target="_blank"
          rel="noopener noreferrer"
          title={t.openFull}
          data-testid="link-sheet"
        >
          <img src={apiUrl(tab === 'puzzle' ? r.puzzle : r.answer)} alt={tab === 'puzzle' ? t.tabPuzzle : t.tabAnswer} data-testid={`img-${tab}`} />
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
        </dl>
        {lines > 1 && <p className="muted small">{t.statLinesHint}</p>}
        <a className="btn-primary btn-big" href={apiUrl(r.pdf)} download="dotdot.pdf" data-testid="link-download">
          <Download size={20} aria-hidden="true" /> {t.download}
        </a>
        <p className="muted small center">{t.downloadHint}</p>
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

export function JobScreen(props: { id: string; config: PublicConfig; onAgain?: () => void; onRetry?: () => void; onNew: () => void }) {
  const { view, failure } = useJob(props.id);
  if (failure) return <Failed code={failure.code} config={props.config} onNew={props.onNew} />;
  if (view?.status === 'failed') return <Failed code={view.error?.code ?? 'INTERNAL'} config={props.config} onRetry={props.onRetry} onNew={props.onNew} />;
  if (view?.status === 'done' && view.result) return <Done view={view} config={props.config} onAgain={props.onAgain} onNew={props.onNew} />;
  return <Waiting view={view} />;
}
