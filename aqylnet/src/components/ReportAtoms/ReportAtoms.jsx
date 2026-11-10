import styles from './ReportAtoms.module.css';

// Small pieces of the report page («Отчёт — Graphite Green»), shared by the
// page and its blocks so a pill, a ten-cell scale or a banner looks the same
// everywhere. Colour means state; the shape of the mark says it too, so the
// state reads without colour: good — a circle, middle — a square, weak — a
// dash, not checked — a dashed circle.

export const TONES = {
  good: { fg: 'var(--accent-hover)', bg: 'var(--accent-bg)', border: 'var(--accent-border)', dot: 'var(--accent)', bar: 'var(--accent)', shape: 'round' },
  mid: { fg: 'var(--warn-title)', bg: 'var(--warn-bg)', border: 'var(--warn-border)', dot: 'var(--warn)', bar: 'var(--warn)', shape: 'square' },
  low: { fg: 'var(--danger-title)', bg: 'var(--danger-bg)', border: 'var(--danger-border)', dot: 'var(--danger)', bar: 'var(--danger)', shape: 'dash' },
  none: { fg: 'var(--neutral-title)', bg: 'var(--neutral-bg)', border: 'var(--neutral-border)', dot: 'var(--neutral)', bar: 'var(--neutral)', shape: 'open' },
};

/** 0–100: ≥75 good, ≥50 middle, below weak — the page's one scale. */
export function toneOf100(v) {
  if (v === null || v === undefined) return 'none';
  return v >= 75 ? 'good' : v >= 50 ? 'mid' : 'low';
}

/** A 1–10 score for the heat tables: 8+ a strength, below 5 a problem, else plain. */
export function heatOf10(v) {
  if (typeof v !== 'number') return 'empty';
  return v >= 8 ? 'good' : v < 5 ? 'low' : 'plain';
}

export function Dot({ tone = 'none', shape }) {
  const t = TONES[tone] ?? TONES.none;
  return <span className={`${styles.dot} ${styles[`dot_${shape ?? t.shape}`]}`} style={{ '--dot': t.dot }} />;
}

export function Pill({ tone = 'none', children, shape, title }) {
  const t = TONES[tone] ?? TONES.none;
  return (
    <span className={styles.pill} style={{ background: t.bg, borderColor: t.border, color: t.fg }} title={title}>
      <Dot tone={tone} shape={shape} />
      {children}
    </span>
  );
}

/** Ten cells, filled by `value` of 0–100. */
export function Cells({ value, tone, height = 6 }) {
  const filled = value == null ? 0 : Math.round(value / 10);
  const color = (TONES[tone ?? toneOf100(value)] ?? TONES.none).bar;
  return (
    <div className={styles.cells} aria-hidden="true">
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} className={styles.cell} style={{ height, background: i < filled ? color : 'var(--line-card)' }} />
      ))}
    </div>
  );
}

/** A thin bar, `pct` of 0–100. */
export function Bar({ pct, tone = 'good', height = 4 }) {
  const color = (TONES[tone] ?? TONES.good).bar;
  return (
    <span className={styles.track} style={{ height }} aria-hidden="true">
      <span className={styles.fill} style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%`, background: color }} />
    </span>
  );
}

const ICONS = {
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /></>,
  warn: <><path d="M12 3l9.5 17h-19z" /><path d="M12 10v4M12 17.2v.1" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.8v.1" /></>,
};

/** A banner: icon, title, text. `tone` — mid (amber), good, low, none. */
export function Banner({ tone = 'mid', icon = 'warn', title, children, role = 'note' }) {
  const t = TONES[tone] ?? TONES.none;
  return (
    <div className={`${styles.banner} ${styles[`banner_${tone}`]}`} role={role}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={t.dot} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[icon]}</svg>
      <div className={styles.bannerBody}>
        {title && <span className={styles.bannerTitle}>{title}</span>}
        {children && <span className={styles.bannerText}>{children}</span>}
      </div>
    </div>
  );
}

export function Chevron() {
  return (
    <svg className={styles.chev} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-4)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
  );
}

/** Uppercase label above a block. */
export function Eyebrow({ children }) {
  return <span className={styles.eyebrow}>{children}</span>;
}
