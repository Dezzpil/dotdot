import { ChevronDown, RefreshCw } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import type { JobOptions, Labels, Lang, Level, Mode, Numbering } from '../api';
import { useI18n } from '../i18n';
import type { Picked } from './Upload';

const LEVELS: Level[] = ['kid', 'school', 'adult'];
const DENSITY: Record<Level, number> = { kid: 7, school: 14, adult: 26 };

/** A ring of dots whose density hints at the level. */
function Density({ level }: { level: Level }) {
  const n = DENSITY[level];
  const r = level === 'kid' ? 3.4 : level === 'school' ? 2.5 : 1.8;
  return (
    <svg viewBox="0 0 48 48" className="density" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        return <circle key={i} cx={24 + 17 * Math.cos(a)} cy={24 + 17 * Math.sin(a)} r={i === 0 ? r + 1 : r} className={i === 0 ? 'dd-first' : 'dd-dot'} />;
      })}
    </svg>
  );
}

function Segmented<T extends string>(props: {
  name: string;
  legend: string;
  value: T;
  options: Array<[T, string]>;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="seg-field">
      <legend>{props.legend}</legend>
      <div className="segmented">
        {props.options.map(([v, label]) => (
          <label key={v} className={props.value === v ? 'is-on' : ''}>
            <input
              type="radio"
              name={props.name}
              value={v}
              checked={props.value === v}
              onChange={() => props.onChange(v)}
              data-testid={`radio-${props.name}-${v}`}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function Setup(props: {
  picked: Picked;
  options: JobOptions;
  onOptions: (o: JobOptions) => void;
  onReplace: () => void;
  onSubmit: () => void;
  busy: boolean;
  error: string | null;
}) {
  const { t } = useI18n();
  const { options: o, onOptions } = props;
  const url = useMemo(() => URL.createObjectURL(props.picked.blob), [props.picked.blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const set = <K extends keyof JobOptions>(k: K, v: JobOptions[K]) => onOptions({ ...o, [k]: v });

  return (
    <form
      className="setup"
      onSubmit={(e) => {
        e.preventDefault();
        props.onSubmit();
      }}
    >
      <section className="setup-preview card" aria-label={t.yourDrawing}>
        <div className="preview-frame">
          <img src={url} alt={t.yourDrawing} data-testid="img-preview" />
        </div>
        <div className="preview-meta">
          <span className="file-name" data-testid="text-filename">
            {props.picked.name}
          </span>
          <button type="button" className="btn-ghost" onClick={props.onReplace} data-testid="button-replace">
            <RefreshCw size={16} aria-hidden="true" /> {t.replace}
          </button>
        </div>
      </section>

      <section className="setup-options">
        <fieldset className="levels">
          <legend className="h2">{t.forWhom}</legend>
          {LEVELS.map((lv) => (
            <label key={lv} className={`level-card${o.level === lv ? ' is-on' : ''}`}>
              <input
                type="radio"
                name="level"
                value={lv}
                checked={o.level === lv}
                onChange={() => set('level', lv)}
                data-testid={`radio-level-${lv}`}
              />
              <Density level={lv} />
              <span className="level-text">
                <span className="level-name">
                  {t.levels[lv].name} <span className="level-age">{t.levels[lv].age}</span>
                </span>
                <span className="level-hint">{t.levels[lv].hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <details className="more">
          <summary data-testid="button-more">
            {t.more} <ChevronDown size={18} aria-hidden="true" className="more-chevron" />
          </summary>
          <div className="more-body">
            <Segmented<Mode>
              name="mode"
              legend={t.modeTitle}
              value={o.mode}
              onChange={(v) => set('mode', v)}
              options={(['auto', 'all', 'outline'] as Mode[]).map((m) => [m, t.modes[m]])}
            />
            <Segmented<Numbering>
              name="numbering"
              legend={t.numberingTitle}
              value={o.numbering}
              onChange={(v) => set('numbering', v)}
              options={(['jumps', 'series'] as Numbering[]).map((m) => [m, t.numberings[m]])}
            />
            <Segmented<Labels>
              name="labels"
              legend={t.labelsTitle}
              value={o.labels}
              onChange={(v) => set('labels', v)}
              options={(['numbers', 'math'] as Labels[]).map((m) => [m, t.labelsOpts[m]])}
            />
            <Segmented<Lang>
              name="lang"
              legend={t.pdfLangTitle}
              value={o.lang}
              onChange={(v) => set('lang', v)}
              options={(['ru', 'en'] as Lang[]).map((m) => [m, t.pdfLangs[m]])}
            />
          </div>
        </details>

        {props.error && (
          <p className="form-error" role="alert" data-testid="text-error">
            {props.error}
          </p>
        )}

        <button type="submit" className="btn-primary btn-big" disabled={props.busy} data-testid="button-submit">
          {props.busy ? t.sending : t.go}
        </button>
      </section>
    </form>
  );
}
