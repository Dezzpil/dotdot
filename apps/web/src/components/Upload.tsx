import { ImagePlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';

export interface Picked {
  blob: Blob;
  name: string;
}

const OK_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/bmp', 'image/gif'];

/** Quick client-side checks; the server re-checks by magic bytes. */
export function checkFile(f: Blob, maxMb: number): string | null {
  if (f.type && !OK_TYPES.includes(f.type)) return 'UNSUPPORTED_TYPE';
  if (f.size > maxMb * 1024 * 1024) return 'FILE_TOO_LARGE';
  if (f.size === 0) return 'NO_FILE';
  return null;
}

/** Load the bundled sample through an <img> + canvas, which works inside sandboxed previews too. */
async function loadSample(): Promise<Blob> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = new URL('sample-fish.png', document.baseURI).toString();
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext('2d')!.drawImage(img, 0, 0);
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('toBlob'))), 'image/png'));
}

export function Upload({ maxMb, onPick, onReject }: { maxMb: number; onPick: (p: Picked) => void; onReject: (code: string) => void }) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);

  const take = (blob: Blob | null | undefined, name: string) => {
    if (!blob) return;
    const bad = checkFile(blob, maxMb);
    if (bad) onReject(bad);
    else onPick({ blob, name });
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.kind === 'file');
      const f = item?.getAsFile();
      if (f) {
        e.preventDefault();
        take(f, f.name || 'pasted.png');
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  return (
    <div className="upload">
      <label
        className={`dropzone${over ? ' is-over' : ''}`}
        data-testid="dropzone"
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          take(f, f?.name ?? 'drawing.png');
        }}
      >
        <input
          ref={input}
          type="file"
          accept={OK_TYPES.join(',')}
          className="visually-hidden"
          data-testid="input-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            take(f, f?.name ?? 'drawing.png');
            e.target.value = '';
          }}
        />
        <ImagePlus className="dropzone-icon" size={36} strokeWidth={1.6} aria-hidden="true" />
        <span className="dropzone-title">{over ? t.dropActive : t.dropTitle}</span>
        <span className="dropzone-sub">
          {t.dropOr} <span className="link-like">{t.dropPick}</span>
        </span>
        <span className="dropzone-hint">{t.dropHint(maxMb)}</span>
      </label>
      <button
        type="button"
        className="btn-text"
        data-testid="button-sample"
        disabled={loadingSample}
        onClick={async () => {
          setLoadingSample(true);
          try {
            take(await loadSample(), t.sampleName);
          } catch {
            onReject('NETWORK');
          } finally {
            setLoadingSample(false);
          }
        }}
      >
        {t.trySample}
      </button>
    </div>
  );
}
