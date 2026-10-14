/** Logo mark: three numbered dots, the first in Dottie orange, joined by a pencil line. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" className="logo-mark">
      <path d="M7 23 L16 8 L25 23" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M25 23 L7 23" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="0.1 4.2" />
      <circle cx="16" cy="8" r="4" fill="var(--color-dot)" />
      <circle cx="7" cy="23" r="3.2" fill="currentColor" />
      <circle cx="25" cy="23" r="3.2" fill="currentColor" />
    </svg>
  );
}

export type Mood = 'happy' | 'think' | 'oops';

/** Dottie, the friendly orange dot. Same character as on the PDF. */
export function Dottie({ size = 64, mood = 'happy', className = '' }: { size?: number; mood?: Mood; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" className={`dottie dottie-${mood} ${className}`}>
      <circle cx="50" cy="52" r="40" fill="var(--color-dot)" />
      <ellipse cx="38" cy="38" rx="9" ry="6" fill="#fff" opacity="0.28" />
      <g className="dottie-eyes" fill="var(--color-ink-on-dot)">
        {mood === 'think' ? (
          <>
            <circle cx="38" cy="45" r="5" />
            <circle cx="62" cy="45" r="5" />
          </>
        ) : (
          <>
            <ellipse cx="38" cy="48" rx="5" ry="6" />
            <ellipse cx="62" cy="48" rx="5" ry="6" />
          </>
        )}
      </g>
      {mood === 'happy' && (
        <path d="M37 62 Q50 74 63 62" stroke="var(--color-ink-on-dot)" strokeWidth="4.5" strokeLinecap="round" fill="none" />
      )}
      {mood === 'think' && <path d="M43 66 Q50 63 57 66" stroke="var(--color-ink-on-dot)" strokeWidth="4" strokeLinecap="round" fill="none" />}
      {mood === 'oops' && (
        <>
          <path d="M31 39 L43 35 M69 39 L57 35" stroke="var(--color-ink-on-dot)" strokeWidth="3.5" strokeLinecap="round" />
          <ellipse cx="50" cy="66" rx="6" ry="7" fill="var(--color-ink-on-dot)" />
        </>
      )}
      <circle cx="27" cy="60" r="4.5" fill="#fff" opacity="0.22" />
      <circle cx="73" cy="60" r="4.5" fill="#fff" opacity="0.22" />
    </svg>
  );
}

/** A tiny connect-the-dots star that draws itself while the worker is busy. */
export function DrawingDots() {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 46 : 20;
    return [60 + r * Math.cos(a), 58 + r * Math.sin(a)] as const;
  });
  const d = `M${pts.map((p) => p.join(' ')).join(' L')} Z`;
  return (
    <svg viewBox="0 0 120 116" className="drawing-dots" aria-hidden="true">
      <path d={d} pathLength={100} className="drawing-dots-line" />
      {pts.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={i === 0 ? 3.6 : 2.6} className={i === 0 ? 'dd-first' : 'dd-dot'} />
          <text
            x={60 + (x - 60) * (1 + 11 / Math.hypot(x - 60, y - 58))}
            y={58 + (y - 58) * (1 + 11 / Math.hypot(x - 60, y - 58)) + 3}
            textAnchor="middle"
            className="dd-num"
          >
            {i + 1}
          </text>
        </g>
      ))}
    </svg>
  );
}
