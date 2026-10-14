import { Moon, Sun } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ApiFailure, createJob, FALLBACK_CONFIG, getConfig, JobOptions, PublicConfig } from './api';
import { Dottie, Logo } from './components/Brand';
import { donateLinks } from './components/Donate';
import { JobScreen } from './components/JobScreen';
import { Setup } from './components/Setup';
import { Picked, Upload } from './components/Upload';
import { errorText, useI18n } from './i18n';

const REPO = 'https://github.com/Dezzpil/dotdot';

/** "#/job/<id>" keeps a result reachable after reload and shareable by link. */
function useJobHash(): [string | null, (id: string | null) => void] {
  const read = () => /^#\/job\/([0-9a-f-]{36})$/.exec(window.location.hash)?.[1] ?? null;
  const [id, setId] = useState(read);
  useEffect(() => {
    const on = () => setId(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = useCallback((next: string | null) => {
    window.location.hash = next ? `/job/${next}` : '';
    setId(next);
  }, []);
  return [id, go];
}

function useTheme() {
  const [dark, setDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);
  return [dark, () => setDark((d) => !d)] as const;
}

function Steps() {
  const { t } = useI18n();
  return (
    <ol className="steps" aria-label="DotDot">
      {[t.stepUpload, t.stepLevel, t.stepPrint].map((s, i) => (
        <li key={s}>
          <span className={`step-dot${i === 0 ? ' is-first' : ''}`}>{i + 1}</span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  );
}

export function App() {
  const { t, lang, setLang } = useI18n();
  const [dark, toggleTheme] = useTheme();
  const [config, setConfig] = useState<PublicConfig>(FALLBACK_CONFIG);
  const [jobId, goJob] = useJobHash();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [options, setOptions] = useState<JobOptions>({ mode: 'auto', numbering: 'jumps', level: 'kid', labels: 'numbers', lang });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getConfig().then(setConfig, () => undefined);
  }, []);

  // the sheet language follows the interface until the user picks it explicitly
  const [pdfLangTouched, setPdfLangTouched] = useState(false);
  useEffect(() => {
    if (!pdfLangTouched) setOptions((o) => ({ ...o, lang }));
  }, [lang, pdfLangTouched]);

  const showError = (code: string, retryAfterSec?: number) =>
    setError(errorText(t, code, { maxUploadMb: config.limits.maxUploadMb, retryAfterSec }));

  const submit = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const job = await createJob(picked.blob, options, picked.name);
      goJob(job.id);
    } catch (e) {
      const f = e instanceof ApiFailure ? e : new ApiFailure('INTERNAL', 0);
      showError(f.code, f.retryAfterSec);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setPicked(null);
    setError(null);
    goJob(null);
  };
  const firstDonate = donateLinks(config.donate, lang)[0];

  return (
    <>
      <a href="#main" className="skip-link" onClick={(e) => (e.preventDefault(), document.getElementById('main')?.focus())}>
        {t.skip}
      </a>
      <header className="site-header">
        <button type="button" className="brand" onClick={reset} aria-label="DotDot" data-testid="link-home">
          <Logo />
          <span className="wordmark">DotDot</span>
        </button>
        <div className="header-tools">
          <div className="lang-switch" role="group" aria-label={t.langLabel}>
            {(['ru', 'en'] as const).map((l) => (
              <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)} data-testid={`button-lang-${l}`}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={toggleTheme}
            aria-label={dark ? t.themeToLight : t.themeToDark}
            title={dark ? t.themeToLight : t.themeToDark}
            data-testid="button-theme"
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="main">
        {jobId ? (
          <JobScreen
            key={jobId}
            id={jobId}
            config={config}
            onAgain={picked ? () => goJob(null) : undefined}
            onRetry={picked ? submit : undefined}
            onNew={reset}
          />
        ) : picked ? (
          <Setup
            picked={picked}
            options={options}
            onOptions={(o) => {
              if (o.lang !== options.lang) setPdfLangTouched(true);
              setOptions(o);
            }}
            onReplace={() => {
              setPicked(null);
              setError(null);
            }}
            onSubmit={submit}
            busy={busy}
            error={error}
          />
        ) : (
          <div className="start">
            <section className="hero">
              <Dottie size={72} className="hero-dottie" />
              <h1 className="h1">{t.heroTitle}</h1>
              <p className="lead">{t.heroLead}</p>
              <Steps />
            </section>
            <section className="start-upload">
              <Upload
                maxMb={config.limits.maxUploadMb}
                onPick={(p) => {
                  setError(null);
                  setPicked(p);
                }}
                onReject={(code) => showError(code)}
              />
              {error && (
                <p className="form-error" role="alert" data-testid="text-error">
                  {error}
                </p>
              )}
              <div className="tips">
                <h2 className="h3">{t.tipsTitle}</h2>
                <ul>
                  {t.tips.map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
              </div>
            </section>
          </div>
        )}
      </main>

      <footer className="site-footer">
        <span>
          DotDot · {t.footerNote} ·{' '}
          <a href={REPO} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
        </span>
        {firstDonate && (
          <a href={firstDonate[1]} target="_blank" rel="noopener noreferrer" data-testid="link-footer-donate">
            {t.donateFooter}
          </a>
        )}
      </footer>
    </>
  );
}
