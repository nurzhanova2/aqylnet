import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import styles from './AnalyticsPage.module.css';
import ChibiBadge from '../../components/ChibiAvatar/ChibiBadge';
import { fetchAnalytics, generateReport, REPORT_IN_PROGRESS, isReportInProgress, fetchPersonaScores, runPersonaScores, fetchAudienceAnalysis, runAudienceAnalysis, updateProject, fetchRewrites, runRewrites, runRewriteLayer } from '../../api';
import PersonaScoresBlock from '../../components/PersonaScores/PersonaScoresBlock';
import AudienceBlock from '../../components/AudienceBlock/AudienceBlock';
import RewritesBlock from '../../components/RewritesBlock/RewritesBlock';
import { documentMetaLine, metaPayload } from '../../utils/documentMeta';
import { Bar, toneOf100 } from '../../components/ReportAtoms/ReportAtoms';
import { GROUP_LABELS } from '../../utils/personaGroups';
import { fmtScore } from '../../utils/personaScoresModel';
import { SEVERITY_LABELS, categoryLabel, issuePeople } from '../../utils/issueLabels';
import { exportReportToPdf, exportReportToDocx, exportRewriteToPdf, exportRewriteToDocx } from '../../utils/exportReport';
import {
  ALT_DISCLAIMER, ALT_UNVERIFIED, QUOTE_UNVERIFIED,
  TRUST_NOT_CHECKED, DIRECTIVES_TITLE, DIRECTIVES_NOTE, SECTION_NOT_ANALYZED,
  ABSENCE_NOTE, CONTRADICTION_LABEL, UNVERIFIED_DO_NOT_CAP, issueHeading,
} from '../../utils/reportTrust';

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Форма метки состояния — часть различия, а не украшение: «хорошо» круг,
// «средне» квадрат, «слабо» черта, «ожидает» пустой круг с пунктиром. Так
// состояние читается и без цвета (Graphite Green).
const DOT_ROUND  = { width: 7, height: 7, borderRadius: '50%' };
const DOT_SQUARE = { width: 7, height: 7, borderRadius: '2px' };
const DOT_DASH   = { width: 10, height: 2, borderRadius: '1px' };

// One scale for every 0-100 value on the page — the overall score, an axis, a
// block's clarity, a message's alignment. Kept in JS rather than CSS because
// the colour has to reach inline styles on bars and numerals, but the values
// are tokens so the theme stays in one file: accent is good, amber is a
// warning, coral is a failure.
const TONE_GOOD = {
  color: 'var(--accent)', fg: 'var(--accent-hover)', bg: 'var(--accent-bg)',
  border: 'var(--accent-border)', dot: DOT_ROUND, status: 'хорошо', word: 'хорошо',
};
const TONE_MID = {
  color: 'var(--warn)', fg: 'var(--warn-title)', bg: 'var(--warn-bg)',
  border: 'var(--warn-border)', dot: DOT_SQUARE, status: 'средне', word: 'средне',
};
const TONE_LOW = {
  color: 'var(--danger)', fg: 'var(--danger-title)', bg: 'var(--danger-bg)',
  border: 'var(--danger-border)', dot: DOT_DASH, status: 'слабо', word: 'слабо',
};

// A document section the audit could not analyse. Neutral, not coral: it is an
// absence of data, not a poor result, and colouring it red would read as one.
const TONE_NONE = {
  color: 'var(--neutral)', fg: 'var(--neutral-title)', bg: 'var(--neutral-bg)',
  border: 'var(--neutral-border)', dot: { ...DOT_ROUND, background: 'transparent', border: '1.5px dashed var(--neutral)' },
  status: SECTION_NOT_ANALYZED, word: SECTION_NOT_ANALYZED,
};

function tone(value) {
  if (value >= 75) return TONE_GOOD;
  if (value >= 50) return TONE_MID;
  return TONE_LOW;
}

// Severity — смысловые наборы из одной палитры. Critical и High различаются не
// только оттенком: у них квадратная метка, у Medium — пунктирный круг, у Low —
// черта. Красный зарезервирован за настоящими сбоями, поэтому Medium и Low
// нейтральные, а не «слабо-красные».
const SEVERITY_META = {
  Critical: {
    label: SEVERITY_LABELS.Critical, fg: 'var(--danger-title)', bg: 'var(--danger-bg)',
    border: 'var(--danger-border)', card: 'var(--danger-border)', dot: DOT_SQUARE,
    dotColor: 'var(--danger)',
  },
  High: {
    label: SEVERITY_LABELS.High, fg: 'var(--warn-title)', bg: 'var(--warn-bg)',
    border: 'var(--warn-border)', card: 'var(--line-card)', dot: DOT_SQUARE,
    dotColor: 'var(--warn)',
  },
  Medium: {
    label: SEVERITY_LABELS.Medium, fg: 'var(--neutral-title)', bg: 'var(--neutral-bg)',
    border: 'var(--neutral-border)', card: 'var(--line-card)',
    dot: { ...DOT_ROUND, background: 'transparent', border: '1.5px dashed var(--neutral)' },
    dotColor: 'transparent',
  },
  Low: {
    label: SEVERITY_LABELS.Low, fg: 'var(--neutral-text)', bg: 'var(--neutral-bg)',
    border: 'var(--neutral-border)', card: 'var(--line-card)', dot: DOT_DASH,
    dotColor: 'var(--neutral)',
  },
};

const SEVERITY_ORDER = ['Critical', 'High', 'Medium', 'Low'];

// The header's mini bars are narrow: the experts' full label wraps there.
const GROUP_SHORT = { population: 'Население', business: 'Бизнес', experts: 'Эксперты' };

// "Напряжённый, скептический, эмоциональный" -> three chips. The model returns
// the discussion's tone as a comma-separated phrase, and as a single line it
// read as a subtitle rather than as a set of traits.
function moodChips(raw) {
  return String(raw || '')
    .split(/[,;]/)
    .map((w) => w.trim())
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
}

/** «Резюме / 1. Решение по базовой ставке / 2. …» → the first heading, for the card's meta line. */
function shortSection(section) {
  const first = String(section || '').split(' / ')[0].trim();
  return first.length > 40 ? `${first.slice(0, 38)}…` : first;
}

/** Метка состояния заданной формы. */
function Dot({ shape, color }) {
  return (
    <span
      className={styles.dot}
      style={{ ...shape, background: shape.background ?? color, border: shape.border }}
    />
  );
}

/** Бейдж статуса: таблетка с меткой слева, цвета из смыслового набора. */
function StatusPill({ t, children }) {
  return (
    <span className={styles.pill} style={{ background: t.bg, borderColor: t.border, color: t.fg }}>
      <Dot shape={t.dot} color={t.color ?? t.dotColor} />
      {children}
    </span>
  );
}

/** Десять ячеек — шкала 0–100, заполненные окрашены по состоянию. */
function Cells({ value, color, height = 6 }) {
  const filled = Math.round(value / 10);
  return (
    <div className={styles.cells}>
      {Array.from({ length: 10 }, (_, i) => (
        <span
          key={i}
          className={styles.cell}
          style={{ height, background: i < filled ? color : 'var(--line-card)' }}
        />
      ))}
    </div>
  );
}

export default function AnalyticsPage({ projectId, projectStatus, onGoDiscussion }) {
  const [analytics, setAnalytics]   = useState(null);
  const [loadError, setLoadError]   = useState(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError]     = useState(null);
  const [genInProgress, setGenInProgress] = useState(false);
  const [exporting, setExporting]   = useState(null); // 'pdf' | 'docx' | null
  const [copied, setCopied]         = useState(false);
  const [sevFilter, setSevFilter]   = useState('all');
  const [leadOpen, setLeadOpen]     = useState(false);
  const [leadClamped, setLeadClamped] = useState(false);
  // Persona scores (A1 stage 1) — loaded and run apart from the report: they
  // do not depend on the discussion and exist before any report does.
  const [personaScores, setPersonaScores] = useState(null);
  const [scoring, setScoring]             = useState(false);
  const [scoreError, setScoreError]       = useState(null);
  // «Кому понятен текст» (A1 stage 2) — built on the persona scores; its
  // GET is recomputed by the server after scores change.
  const [audience, setAudience]           = useState(null);
  const [auditing, setAuditing]           = useState(false);
  const [audienceError, setAudienceError] = useState(null);
  // «Три версии текста» (A1 stage 3) — built on the audience analysis.
  const [rewrites, setRewrites]           = useState(null);
  const [rewriting, setRewriting]         = useState(false);
  const [rewriteError, setRewriteError]   = useState(null);
  const [rewriteExporting, setRewriteExporting] = useState(null);

  // The lead is clamped to three lines. Whether it actually overflows depends
  // on the text and the viewport, so measure instead of guessing at a length:
  // offering "Показать полностью" on a two-line summary looks broken.
  const leadRef = useRef(null);
  const measureLead = useCallback((node) => {
    leadRef.current = node;
    if (node) setLeadClamped(node.scrollHeight - node.clientHeight > 2);
  }, []);

  useEffect(() => {
    if (!projectId) return;
    setAnalytics(null);
    setLoadError(null);
    setGenError(null);
    setGenInProgress(false);
    setSevFilter('all');
    setLeadOpen(false);
    fetchAnalytics(projectId)
      .then(setAnalytics)
      .catch((err) => {
        console.error(err);
        setLoadError(err.message || 'Не удалось загрузить отчёт.');
      });
    setPersonaScores(null);
    setScoreError(null);
    fetchPersonaScores(projectId)
      .then(setPersonaScores)
      .catch((err) => setScoreError(`Не удалось загрузить оценки участников: ${err.message}`));
    setAudience(null);
    setAudienceError(null);
    fetchAudienceAnalysis(projectId)
      .then(setAudience)
      .catch((err) => setAudienceError(`Не удалось загрузить анализ аудитории: ${err.message}`));
    setRewrites(null);
    setRewriteError(null);
    fetchRewrites(projectId)
      .then(setRewrites)
      .catch((err) => setRewriteError(`Не удалось загрузить версии текста: ${err.message}`));
  }, [projectId]);

  async function handleRunScores() {
    setScoring(true);
    setScoreError(null);
    try {
      setPersonaScores(await runPersonaScores(projectId));
      // New scores make a stored analysis stale; the server says so on read.
      fetchAudienceAnalysis(projectId).then(setAudience).catch(() => {});
    } catch (err) {
      setScoreError(`Не удалось получить оценки участников: ${err.message}`);
    } finally {
      setScoring(false);
    }
  }

  async function handleRunAudience() {
    setAuditing(true);
    setAudienceError(null);
    try {
      setAudience(await runAudienceAnalysis(projectId));
      // A new analysis makes the versions stale; the server says so on read.
      fetchRewrites(projectId).then(setRewrites).catch(() => {});
    } catch (err) {
      setAudienceError(`Не удалось проверить понимание: ${err.message}`);
    } finally {
      setAuditing(false);
    }
  }

  async function handleRunRewrites(layer) {
    setRewriting(true);
    setRewriteError(null);
    try {
      setRewrites(await (layer ? runRewriteLayer(projectId, layer) : runRewrites(projectId)));
    } catch (err) {
      setRewriteError(`Не удалось сделать версии текста: ${err.message}`);
    } finally {
      setRewriting(false);
    }
  }

  async function handleExportRewrite(layer, format) {
    setRewriteExporting(`${layer}-${format}`);
    try {
      if (format === 'pdf') await exportRewriteToPdf(rewrites, layer);
      else await exportRewriteToDocx(rewrites, layer);
    } catch (err) {
      setRewriteError(`Не удалось экспортировать: ${err.message}`);
    } finally {
      setRewriteExporting(null);
    }
  }

  async function handleSaveMeta(meta) {
    await updateProject(projectId, metaPayload(meta));
    setAudience(await fetchAudienceAnalysis(projectId));
  }

  useEffect(() => {
    const node = leadRef.current;
    if (!node) return undefined;
    const check = () => setLeadClamped(node.scrollHeight - node.clientHeight > 2);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(node);
    return () => observer.disconnect();
  }, [analytics, leadOpen]);

  // Personas keyed by name so an issue's "raisedBy" string can be drawn as faces.
  const personaByName = useMemo(() => {
    const map = new Map();
    for (const p of analytics?.personas ?? []) map.set(p.name, p);
    return map;
  }, [analytics]);

  async function handleGenerate() {
    setGenerating(true);
    setGenError(null);
    setGenInProgress(false);
    try {
      const report = await generateReport(projectId);
      setAnalytics(report);
    } catch (err) {
      if (isReportInProgress(err)) setGenInProgress(true);
      else setGenError(`Не удалось сформировать отчёт: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  }

  async function handleExportPdf() {
    setExporting('pdf');
    try {
      await exportReportToPdf(analytics, personaScores, audience);
    } catch (err) {
      setGenError(`Не удалось экспортировать PDF: ${err.message}`);
    } finally {
      setExporting(null);
    }
  }

  async function handleExportDocx() {
    setExporting('docx');
    try {
      await exportReportToDocx(analytics, personaScores, audience);
    } catch (err) {
      setGenError(`Не удалось экспортировать Word: ${err.message}`);
    } finally {
      setExporting(null);
    }
  }

  if (!analytics && !loadError) {
    return (
      <div className={styles.page}>
        <div className={styles.centered}>Загрузка отчёта…</div>
      </div>
    );
  }

  async function handleCopyAlt() {
    // Tags travel with the text. Copying the paragraphs bare produced a clean
    // block of prose with nothing to say which lines are the model's additions
    // and which it claims are already in the document — the shape in which
    // generated text is most likely to be pasted into a real document and
    // mistaken for the source.
    const text = altParagraphs
      .map((a) => {
        const mark = a.verified === false ? ' (нет в документе)' : '';
        return `[${a.tag}${mark}] ${a.text}`;
      })
      .join('\n\n') + ALT_DISCLAIMER;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      setGenError(`Не удалось скопировать текст: ${err.message}`);
    }
  }

  if (loadError) {
    return (
      <div className={styles.page}>
        <div className={styles.centered}>
          <div className={styles.errorText}>Ошибка загрузки отчёта: {loadError}</div>
          <button className={styles.btnSecondary} onClick={onGoDiscussion}>← К дискуссии</button>
        </div>
      </div>
    );
  }

  const { projectTitle, projectSubtitle, personaCount, iterations, mode,
          mood, moodDescription, personas,
          conclusions, topicBars, risks, positives, recommendations, altParagraphs,
          overallScore, scores, sections, issues, alignment,
          directives, trustChecked } = analytics;

  const hasReport = analytics.hasReport;

  // Older reports predate the audit pass and carry no extras — each block hides
  // itself rather than showing an empty frame.
  const hasScores    = overallScore != null || (scores?.length ?? 0) > 0;
  const hasSections  = (sections?.length ?? 0) > 0;
  const hasIssues    = (issues?.length ?? 0) > 0;
  const hasAlignment = (alignment?.length ?? 0) > 0;

  const severityCounts = SEVERITY_ORDER.reduce((acc, key) => {
    acc[key] = (issues ?? []).filter((i) => i.severity === key).length;
    return acc;
  }, {});

  const visibleIssues = (issues ?? []).filter((i) => sevFilter === 'all' || i.severity === sevFilter);

  const scoreTone = overallScore == null ? null : tone(overallScore);
  const verdict = overallScore == null ? '—'
    : overallScore >= 75 ? 'Готов к публикации'
    : overallScore >= 50 ? 'Требует доработки'
    : 'Требует переработки';

  // The overall score is the mean of the axes, capped when serious issues
  // exist. Saying so keeps a score that repeats across runs from reading as a
  // hardcoded number.
  const axesMean = (scores?.length ?? 0) > 0
    ? Math.round(scores.reduce((sum, s) => sum + s.value, 0) / scores.length)
    : null;
  const capApplied = overallScore != null && axesMean != null && axesMean > overallScore;

  const tones = moodChips(mood);

  const SEVERITY_WORDS = {
    Critical: 'критичных', High: 'высоких', Medium: 'средних', Low: 'низких',
  };

  const severityTally = SEVERITY_ORDER
    .filter((key) => severityCounts[key] > 0)
    .map((key) => ({ key, count: severityCounts[key], label: SEVERITY_WORDS[key] }));

  // What the server could not confirm. `verified === false` only: null means
  // the tag makes no claim about the document, or the report predates the
  // check — neither is a failure, and marking it as one would make the mark
  // worthless (see backend/src/services/reportTrust.ts).
  const unverifiedAlt    = altParagraphs.filter((a) => a.verified === false);
  const unverifiedQuotes = (issues ?? []).filter((i) =>
    (i.quote && i.quoteVerified === false) || (i.quote2 && i.quote2Verified === false));
  const directiveHits    = directives ?? [];
  // An old report shows nothing about verification rather than an empty "all
  // clear": it was never checked, and saying nothing is the honest version.
  const showTrustGap = hasReport && trustChecked === false;

  // Риски и сильные стороны — один список: это две стороны одного наблюдения,
  // и в отчёте они читаются подряд, а не в двух колонках.
  const findingsList = [
    ...risks.map((text, i) => ({ id: `Р-${pad2(i + 1)}`, text, by: '', t: TONE_LOW })),
    ...positives.map((p, i) => ({
      id: `С-${pad2(i + 1)}`, text: p.text, by: p.by ? `Отметили: ${p.by}` : '', t: TONE_GOOD,
    })),
  ];

  // The sections in render order. Numerals are assigned to the visible ones
  // only, so a hidden block leaves no gap, and the same list drives the
  // contents chips in the header — a chip never points at a missing section.
  const visibleSections = [
    ['quality', 'Качество', (hasScores && (scores?.length ?? 0) > 0) || hasSections],
    ['issues', 'Замечания', hasIssues],
    ['alignment', 'Задумано и понято', hasAlignment],
    ['scores', 'Оценки участников', true],
    ['audience', 'Кому понятен', true],
    ['rewrites', 'Три версии', true],
    ['topics', 'Темы', true],
    ['risks', 'Риски', true],
    ['recs', 'Рекомендации', true],
    ['alt', 'Редакция', true],
  ].filter(([, , show]) => show);
  const numOf = Object.fromEntries(visibleSections.map(([key], i) => [key, pad2(i + 1)]));
  const anchor = (key) => `report-${key}`;
  // The page scrolls inside its own container; scrollIntoView finds it, and
  // the location hash stays untouched (navigation is state-based, App.jsx).
  const goTo = (key) => (e) => {
    e.preventDefault();
    document.getElementById(anchor(key))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const audienceGroups = audience?.groups ?? [];

  return (
    <div className={styles.page}>
      <div className={styles.inner}>

        {/* ── Шапка ── */}
        <section className={styles.hero} aria-label="Итоги">
          <div className={styles.heroHead}>
            <span className={styles.eyebrow}>
              ОТЧЁТ{projectTitle ? ` · ${projectTitle}` : ''}{documentMetaLine(audience?.document) ? ` · ${documentMetaLine(audience.document)}` : ''}
            </span>
            <h1 className={styles.title}>Итоги фокус-группы</h1>
            {tones.length > 0 && (
              <div className={styles.tones}>
                <span className={styles.eyebrow}>Тон дискуссии</span>
                {tones.map((t) => (
                  <span key={t} className={styles.chipPlain}>{t}</span>
                ))}
              </div>
            )}
          </div>

          <div className={styles.heroGrid}>
            <div className={styles.heroMain}>
              {moodDescription && (
                <div className={styles.leadBlock}>
                  <p
                    ref={measureLead}
                    className={`${styles.lead} ${leadOpen ? '' : styles.leadClamped}`}
                  >
                    {moodDescription}
                  </p>
                  {(leadClamped || leadOpen) && (
                    <button type="button" className={styles.linkBtn} onClick={() => setLeadOpen((o) => !o)}>
                      {leadOpen ? 'Свернуть' : 'Показать полностью'}
                    </button>
                  )}
                </div>
              )}

              {conclusions.length > 0 && (
                <div className={styles.findings}>
                  <span className={`${styles.eyebrow} ${styles.findingsLabel}`}>Главное</span>
                  {conclusions.map((c) => (
                    <div key={c.n} className={styles.finding}>
                      <span className={styles.findingNum}>{pad2(c.n)}</span>
                      <span className={styles.findingText}>{c.text}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className={styles.heroActions}>
                <button className={styles.btnPrimary} onClick={handleExportPdf} disabled={exporting !== null || !hasReport}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
                  {exporting === 'pdf' ? 'Экспорт…' : 'Скачать PDF'}
                </button>
                <button className={styles.btnSecondary} onClick={handleExportDocx} disabled={exporting !== null || !hasReport}>
                  {exporting === 'docx' ? 'Экспорт…' : 'DOCX'}
                </button>
                <button
                  className={styles.btnIcon}
                  onClick={handleGenerate}
                  disabled={generating}
                  title={hasReport ? 'Обновить отчёт' : 'Сформировать отчёт'}
                  aria-label={hasReport ? 'Обновить отчёт' : 'Сформировать отчёт'}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" /></svg>
                </button>
              </div>
            </div>

            <aside className={styles.summary} aria-label="Сводка">
              <div className={styles.summaryTop}>
                <span className={styles.eyebrow}>Качество документа</span>
                <div className={styles.scoreRow}>
                  <span className={styles.scoreValue} style={{ color: scoreTone?.fg ?? 'var(--text-4)' }}>
                    {overallScore == null ? '—' : overallScore}
                  </span>
                  <span className={styles.scoreUnit}>/ 100</span>
                  <span className={styles.spacer} />
                  {scoreTone && <StatusPill t={scoreTone}>{verdict}</StatusPill>}
                </div>
                {overallScore != null && <Cells value={overallScore} color={scoreTone.color} height={8} />}
                {capApplied && (
                  <span className={styles.summaryNote}>
                    Среднее по осям — {axesMean}; итог снижен из-за серьёзных замечаний.
                  </span>
                )}
              </div>

              {hasIssues && severityTally.length > 0 && (
                <div className={styles.tally}>
                  <div className={styles.tallyCell}>
                    <span className={styles.tallyNum}>{issues.length}</span>
                    <span className={styles.tallyLabel}>замечаний</span>
                  </div>
                  {severityTally.map(({ key, count, label }) => {
                    const sev = SEVERITY_META[key];
                    return (
                      <div key={key} className={styles.tallyCell}>
                        <span className={styles.tallyNum}>{count}</span>
                        <span className={styles.tallyLabel}>
                          <Dot shape={sev.dot} color={sev.dotColor} />
                          {label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {(personas?.length ?? 0) > 0 && (
                <div className={styles.summaryPanel}>
                  <div className={styles.facesRow}>
                    <div className={styles.faces}>
                      {personas.slice(0, 8).map((p) => (
                        <span key={p.id} className={styles.face}>
                          <ChibiBadge persona={p} size={26} color="var(--surface-inset)" border={2} />
                        </span>
                      ))}
                      {personaCount > 8 && <span className={styles.facesMore}>+{personaCount - 8}</span>}
                    </div>
                    <span className={styles.facesNames}>
                      {personaCount} {personaCount === 1 ? 'участник' : personaCount < 5 ? 'участника' : 'участников'}
                    </span>
                  </div>
                  {/* «Кому понятен текст» в двух словах: индекс понимания каждой
                      группы. Цифры считает сервер (audienceStats.ts). */}
                  {audienceGroups.some((g) => g.index != null) && (
                    <div className={styles.groupsMini}>
                      {audienceGroups.map((g) => (
                        <div key={g.group} className={styles.groupMini}>
                          <span className={styles.groupMiniName}>
                            {GROUP_SHORT[g.group] ?? GROUP_LABELS[g.group]} <span className={styles.mono5}>· {g.personas}</span>
                          </span>
                          <Bar pct={(g.index ?? 0) * 10} tone={toneOf100(g.index == null ? null : g.index * 10)} />
                          <span className={`${styles.mono2} ${styles.alignRight}`}>{fmtScore(g.index)}</span>
                        </div>
                      ))}
                      <span className={styles.groupsMiniNote}>индекс понимания по группам, из 10</span>
                    </div>
                  )}
                </div>
              )}

              <dl className={styles.summaryList}>
                <dt>Режим</dt>
                <dd>
                  {mode} · <span className={styles.mono}>{iterations}</span>{' '}
                  {iterations === 1 ? 'раунд' : iterations < 5 ? 'раунда' : 'раундов'}
                </dd>
                {projectSubtitle && (<><dt>Вопрос</dt><dd className={styles.summaryQuestion}>{projectSubtitle}</dd></>)}
              </dl>
            </aside>
          </div>

          <nav className={styles.toc} aria-label="Содержание отчёта">
            {visibleSections.map(([key, label]) => (
              <a key={key} className={styles.tocChip} href={`#${anchor(key)}`} onClick={goTo(key)}>
                <span className={styles.tocNum}>{numOf[key]}</span>{label}
              </a>
            ))}
          </nav>
        </section>

        {/* Что сервер нашёл во входных данных и чего не смог подтвердить в
            выводе модели. Не нумерованный раздел, а пометка: она меняет то, как
            читается весь отчёт, поэтому стоит до его разделов. */}
        {directiveHits.length > 0 && (
          <div className={`${styles.notice} ${styles.noticeWarn}`} role="note">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--warn)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l9.5 17h-19z" /><path d="M12 10v4M12 17.2v.1" /></svg>
            <div className={styles.noticeBody}>
              <span className={styles.noticeTitle}>{DIRECTIVES_TITLE}</span>
              <span className={styles.noticeText}>{DIRECTIVES_NOTE}</span>
              <ul className={styles.trustList}>
                {directiveHits.map((d, i) => (
                  <li key={i} className={styles.trustItem}>
                    <span className={styles.trustSource}>{d.source} · {d.kind}</span>
                    <span className={styles.trustExcerpt}>«{d.excerpt}»</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {showTrustGap && (
          <div className={`${styles.notice} ${styles.noticeNeutral}`} role="note">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--neutral)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.8v.1" /></svg>
            <div className={styles.noticeBody}>
              <span className={styles.noticeTitle}>Проверка не выполнялась</span>
              <span className={styles.noticeText}>{TRUST_NOT_CHECKED}</span>
            </div>
          </div>
        )}

        {genError && <div className={`${styles.notice} ${styles.noticeDanger}`} role="alert">{genError}</div>}
        {generating && <div className={`${styles.notice} ${styles.noticeNeutral}`} role="status">Отчёт формируется…</div>}
        {genInProgress && !generating && <div className={`${styles.notice} ${styles.noticeNeutral}`} role="status">{REPORT_IN_PROGRESS}</div>}
        {!hasReport && !generating && (
          <div className={`${styles.notice} ${styles.noticeNeutral}`}>
            {projectStatus === 'completed'
              ? 'Отчёт ещё не создан. Нажмите «Обновить отчёт», чтобы проанализировать полную стенограмму.'
              : 'Отчёт ещё не создан. Его можно сформировать по доступной стенограмме или завершить все раунды и сформировать итоговый отчёт.'}
          </div>
        )}

        {/* ── Качество документа ── */}
        {numOf.quality && (
          <section className={styles.section} id={anchor('quality')}>
            <div className={styles.sectionHead}>
              <span className={styles.monoAccent}>{numOf.quality}</span>
              <h2 className={styles.sectionTitle}>Качество документа</h2>
              <span className={styles.sectionNote}>— четыре оси оценки</span>
              <span className={styles.spacer} />
              <span className={styles.legend}>
                <span className={styles.legendItem}><Dot shape={TONE_GOOD.dot} color={TONE_GOOD.color} />75+ хорошо</span>
                <span className={styles.legendItem}><Dot shape={TONE_MID.dot} color={TONE_MID.color} />50–74 средне</span>
                <span className={styles.legendItem}><Dot shape={TONE_LOW.dot} color={TONE_LOW.color} />до 50 слабо</span>
              </span>
            </div>
            {(scores?.length ?? 0) > 0 && (
              <div className={`${styles.sectionBody} ${styles.metrics}`}>
                {scores.map((sc) => {
                  const t = tone(sc.value);
                  return (
                    <div key={sc.key} className={styles.metric}>
                      <div className={styles.metricTop}>
                        <span className={styles.metricName}>{sc.label}</span>
                        <span className={styles.spacer} />
                        <span className={styles.metricValue} title={t.status}>{sc.value}</span>
                      </div>
                      <Cells value={sc.value} color={t.color} />
                      {sc.note && <p className={styles.metricNote}>{sc.note}</p>}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Карта документа — строками внутри раздела качества: понятность
                каждого блока по оси «Ясность» его аудита. */}
            {hasSections && (
              <div className={styles.docMap}>
                {sections.map((sec, i) => {
                  const analyzed = sec.analyzed !== false && sec.clarity != null;
                  const t = analyzed ? tone(sec.clarity) : TONE_NONE;
                  return (
                    <div key={i} className={styles.docMapRow}>
                      <span className={styles.docMapHead}>
                        {i === 0 && <span className={styles.eyebrow}>Карта документа</span>}
                        <span className={styles.docMapTitle} title={sec.title}>{sec.title}</span>
                      </span>
                      <span className={styles.rowNote}>{analyzed ? (sec.note || '') : SECTION_NOT_ANALYZED}</span>
                      <span className={styles.track}>
                        {analyzed && <span className={styles.fill} style={{ width: `${sec.clarity}%`, background: t.color }} />}
                      </span>
                      <span className={`${styles.mono2} ${styles.alignRight}`} title={t.word}>{analyzed ? sec.clarity : '—'}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* ── Замечания ── */}
        {hasIssues && (
          <section className={styles.section} id={anchor('issues')}>
            <div className={styles.sectionHead}>
              <span className={styles.monoAccent}>{numOf.issues}</span>
              <h2 className={styles.sectionTitle}>Замечания к документу</h2>
              <span className={styles.sectionNote}>— что вызвало вопросы у группы</span>
              <span className={styles.spacer} />
              <div className={styles.chips} role="group" aria-label="Фильтр по серьёзности">
                {[['all', 'Все', issues.length], ...SEVERITY_ORDER
                  .filter((key) => severityCounts[key] > 0)
                  .map((key) => [key, SEVERITY_META[key].label, severityCounts[key]])]
                  .map(([key, label, count]) => (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={sevFilter === key}
                      className={`${styles.chip} ${sevFilter === key ? styles.chipOn : ''}`}
                      onClick={() => setSevFilter(key)}
                    >
                      {label}
                      <span className={styles.chipCount}>{count}</span>
                    </button>
                  ))}
              </div>
            </div>
            <div className={styles.sectionBody}>
              {unverifiedQuotes.length > 0 && (
                <div className={`${styles.notice} ${styles.noticeWarn}`} role="note">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--warn)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l9.5 17h-19z" /><path d="M12 10v4M12 17.2v.1" /></svg>
                  <div className={styles.noticeBody}>
                    <span className={styles.noticeTitle}>Цитаты не сверены с документом</span>
                    <span className={styles.noticeText}>
                      {unverifiedQuotes.length} из {issues.length}: сервер не нашёл приведённую цитату в документе дословно.
                      Само замечание при этом остаётся — не найдена цитата, а не замечание. {UNVERIFIED_DO_NOT_CAP}
                    </span>
                  </div>
                </div>
              )}
              <div className={styles.issues}>
                {visibleIssues.map((iss) => {
                  const sev = SEVERITY_META[iss.severity] ?? SEVERITY_META.Medium;
                  const { raised, agreed, disputed } = issuePeople(iss);
                  return (
                    <article key={iss.code} className={styles.issue} style={{ borderColor: sev.card }}>
                      <div className={styles.issueTop}>
                        <span className={styles.mono4}>{iss.code}</span>
                        <StatusPill t={sev}>{sev.label}</StatusPill>
                        <span className={styles.spacer} />
                        <span className={styles.issueCat}>
                          {iss.kind === 'contradiction' ? CONTRADICTION_LABEL : categoryLabel(iss.category)}
                          {iss.kind === 'absence' ? ' · весь документ' : iss.section ? ` · ${shortSection(iss.section)}` : ''}
                        </span>
                      </div>
                      <h3 className={styles.issueTitle}>{issueHeading(iss)}</h3>
                      {iss.kind === 'absence' && <p className={styles.absenceNote}>{ABSENCE_NOTE}</p>}
                      {iss.quote && (
                        <figure className={styles.quoteFigure} style={iss.quoteVerified === false ? { borderColor: 'var(--warn-border)' } : undefined}>
                          {iss.kind === 'contradiction' && iss.section && <span className={styles.quoteWhere}>{iss.section}</span>}
                          <blockquote className={styles.quote}>«{iss.quote}»</blockquote>
                          {/* Печатать цитату в кавычках под значком severity —
                              это форма проверенного утверждения. Если сервер её
                              в документе не нашёл, об этом надо сказать здесь, а
                              не прятать замечание. */}
                          {iss.quoteVerified === false && (
                            <figcaption className={styles.quoteWarn}><Dot shape={DOT_SQUARE} color="var(--warn)" />{QUOTE_UNVERIFIED} — само замечание остаётся</figcaption>
                          )}
                        </figure>
                      )}
                      {/* Противоречие — два места документа; второе со своим разделом. */}
                      {iss.kind === 'contradiction' && iss.quote2 && (
                        <figure className={styles.quoteFigure} style={iss.quote2Verified === false ? { borderColor: 'var(--warn-border)' } : undefined}>
                          {iss.section2 && <span className={styles.quoteWhere}>{iss.section2}</span>}
                          <blockquote className={styles.quote}>«{iss.quote2}»</blockquote>
                          {iss.quote2Verified === false && (
                            <figcaption className={styles.quoteWarn}><Dot shape={DOT_SQUARE} color="var(--warn)" />{QUOTE_UNVERIFIED} — само замечание остаётся</figcaption>
                          )}
                        </figure>
                      )}
                      <div className={styles.issueFoot}>
                        {raised.length > 0 && (
                          <div className={styles.issueFootRow}>
                            <span className={styles.issueFootLabel}>Подняли</span>
                            <div className={styles.faces}>
                              {raised.slice(0, 6).map((name) => {
                                const p = personaByName.get(name);
                                return p
                                  ? <span key={name} className={styles.faceSm}><ChibiBadge persona={p} size={22} color="var(--surface-inset)" border={2} /></span>
                                  : null;
                              })}
                            </div>
                            <span className={styles.issueNames} title={raised.join(', ')}>
                              {raised.length > 3 ? `${raised.slice(0, 2).join(', ')} и ещё ${raised.length - 2}` : raised.join(', ')}
                            </span>
                          </div>
                        )}
                        {/* Empty lists say nothing about consensus: an absence
                            found by the checklist was never discussed at all, so
                            «Консенсус не достигнут» there was a claim with no basis. */}
                        {agreed.length > 0 && (
                          <div className={styles.issueFootRow}>
                            <span className={styles.issueFootLabel}>Согласны</span>
                            <span className={styles.issueAgree}>{agreed.join(', ')}</span>
                          </div>
                        )}
                        {disputed.length > 0 && (
                          <div className={styles.issueFootRow}>
                            <span className={styles.issueFootLabel}>Спорят</span>
                            <span className={styles.issueDispute}>{disputed.join(', ')}</span>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* ── Задумано и понято ── */}
        {hasAlignment && (
          <section className={styles.section} id={anchor('alignment')}>
            <div className={styles.sectionHead}>
              <span className={styles.monoAccent}>{numOf.alignment}</span>
              <h2 className={styles.sectionTitle}>Задумано и понято</h2>
              <span className={styles.sectionNote}>— что хотел сказать автор и что услышала группа</span>
            </div>
            <div className={`${styles.sectionBody} ${styles.gaps}`}>
              {alignment.map((a, i) => {
                const t = tone(a.score);
                return (
                  <div key={i} className={styles.gap}>
                    <div className={styles.gapCell}>
                      <span className={styles.eyebrow}>Задумано</span>
                      <span className={styles.gapIntent}>{a.message}</span>
                    </div>
                    <div className={`${styles.gapCell} ${styles.gapBordered}`}>
                      <span className={styles.eyebrow}>Понято</span>
                      <span className={styles.gapText}>{a.perceived || '—'}</span>
                    </div>
                    <div className={`${styles.gapCell} ${styles.gapBordered} ${styles.gapScore}`}>
                      <div className={styles.gapScoreTop}>
                        <span className={styles.gapPct}>{a.score}%</span>
                        <span className={styles.gapPctLabel}>совпадение</span>
                        <span className={styles.spacer} />
                        {a.verdict && <StatusPill t={t}>{a.verdict}</StatusPill>}
                      </div>
                      <span className={styles.track}>
                        <span className={styles.fill} style={{ width: `${a.score}%`, background: t.color }} />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Оценки участников (A1, этап 1) ── */}
        <PersonaScoresBlock
          scores={personaScores}
          number={numOf.scores}
          anchor={anchor('scores')}
          frame={styles}
          running={scoring}
          error={scoreError}
          onRun={handleRunScores}
          hasDocument={(personaScores?.sections?.length ?? 0) > 0}
          noDecision={audience?.analysis?.comparable === false}
        />

        {/* ── Кому понятен текст (A1, этап 2) ── */}
        <AudienceBlock
          audience={audience}
          number={numOf.audience}
          anchor={anchor('audience')}
          frame={styles}
          running={auditing}
          error={audienceError}
          onRun={handleRunAudience}
          onSaveMeta={handleSaveMeta}
          hasScores={!!personaScores?.hasScores}
        />

        {/* ── Три версии текста (A1, этап 3) ── */}
        <RewritesBlock
          rewrites={rewrites}
          number={numOf.rewrites}
          anchor={anchor('rewrites')}
          frame={styles}
          running={rewriting}
          error={rewriteError}
          onRun={() => handleRunRewrites(null)}
          onRunLayer={(layer) => handleRunRewrites(layer)}
          onExport={handleExportRewrite}
          exporting={rewriteExporting}
        />

        {/* ── Темы и находки: две колонки ── */}
        <div className={styles.twoCols}>
          <section className={styles.section} id={anchor('topics')}>
            <div className={styles.sectionHead}>
              <span className={styles.monoAccent}>{numOf.topics}</span>
              <h2 className={styles.sectionTitle}>Наиболее обсуждаемые темы</h2>
            </div>
            <div className={styles.listBody}>
              {topicBars.length === 0 && <div className={styles.emptyNote}>Темы появятся после формирования отчёта.</div>}
              {topicBars.map((t, i) => (
                <div key={t.name} className={styles.topicRow}>
                  <div className={styles.topicTop}>
                    <span className={styles.mono5}>{pad2(i + 1)}</span>
                    <span className={styles.topicName}>{t.name}</span>
                    <span className={styles.mono2}>{t.pct}%</span>
                  </div>
                  <span className={`${styles.track} ${styles.trackThin}`}>
                    <span className={styles.fill} style={{ width: `${t.pct}%`, background: 'var(--accent)' }} />
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.section} id={anchor('risks')}>
            <div className={styles.sectionHead}>
              <span className={styles.monoAccent}>{numOf.risks}</span>
              <h2 className={styles.sectionTitle}>Риски и сильные стороны</h2>
            </div>
            <div className={styles.listBody}>
              {findingsList.length === 0 && <div className={styles.emptyNote}>Нет данных.</div>}
              {findingsList.map((f) => (
                <div key={f.id} className={styles.findingRow}>
                  <span className={styles.findingId} style={{ color: f.t.fg }}>
                    <Dot shape={f.t.dot} color={f.t.color} />
                    {f.id}
                  </span>
                  <div className={styles.cellStack}>
                    <span className={styles.rowTitleText}>{f.text}</span>
                    {f.by && <span className={styles.rowNote}>{f.by}</span>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* ── Рекомендации ── */}
        <section className={styles.section} id={anchor('recs')}>
          <div className={styles.sectionHead}>
            <span className={styles.monoAccent}>{numOf.recs}</span>
            <h2 className={styles.sectionTitle}>Рекомендации</h2>
            <span className={styles.sectionNote}>— что изменить в документе</span>
          </div>
          <div className={`${styles.sectionBody} ${styles.recs}`}>
            {recommendations.length === 0 && <div className={styles.emptyNote}>Рекомендации появятся после формирования отчёта.</div>}
            {recommendations.map((r, i) => (
              <div key={i} className={styles.rec}>
                <span className={styles.recNum}>{pad2(i + 1)}</span>
                <span className={styles.recText}>{r}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Альтернативная редакция ── */}
        <section className={styles.section} id={anchor('alt')}>
          <div className={styles.sectionHead}>
            <span className={styles.monoAccent}>{numOf.alt}</span>
            <h2 className={styles.sectionTitle}>Альтернативная редакция</h2>
            {/* Оговорка — в заголовке, над текстом: блок уезжает в PDF/DOCX и в
                буфер обмена, а там оговорка дописывается к тексту (ALT_DISCLAIMER). */}
            <span className={styles.sectionNote}>— предложение модели, не проверенный юридический текст</span>
            <span className={styles.spacer} />
            {unverifiedAlt.length > 0 && (
              <span className={styles.legendItem}>
                <Dot shape={DOT_DASH} color="var(--danger)" />{ALT_UNVERIFIED} · {unverifiedAlt.length}
              </span>
            )}
            <button
              className={styles.btnOutline}
              onClick={handleCopyAlt}
              disabled={altParagraphs.length === 0}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" /></svg>
              {copied ? 'Скопировано' : 'Копировать текст'}
            </button>
          </div>
          <div className={styles.sectionBody}>
            {altParagraphs.length === 0 ? (
              <div className={styles.emptyNote}>Альтернативная редакция появится после формирования отчёта.</div>
            ) : (
              <div className={styles.redline}>
                {altParagraphs.map((a, i) => {
                  const kind = /измен/i.test(a.tag) ? 'edit' : /добав/i.test(a.tag) ? 'add' : 'keep';
                  const t = kind === 'keep'
                    ? { bg: 'var(--neutral-bg)', border: 'var(--neutral-border)', fg: 'var(--neutral-title)', dot: DOT_DASH, color: 'var(--neutral)' }
                    : { bg: 'var(--accent-bg)', border: 'var(--accent-border)', fg: 'var(--accent-hover)', dot: kind === 'add' ? DOT_SQUARE : DOT_ROUND, color: 'var(--accent)' };
                  return (
                    <div key={i} className={styles.redlineRow}>
                      <span className={styles.redlineTag}>
                        <StatusPill t={t}>{a.tag}</StatusPill>
                        {a.verified === false && (
                          <span className={styles.redlineWarn}>{ALT_UNVERIFIED}</span>
                        )}
                      </span>
                      <p className={`${styles.redlineText} ${styles[`redline_${kind}`]}`}>{a.text}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      <footer className={styles.footer}>
        {analytics.llmModel && <span>Модель <span className={styles.mono2}>{analytics.llmModel}</span></span>}
        <span>через <span className={styles.mono2}>LiteLLM НБК</span></span>
        <span className={styles.spacer} />
        <span className={styles.legendItem}>
          {hasReport
            ? <><Dot shape={DOT_ROUND} color="var(--accent)" />отчёт готов</>
            : <><Dot shape={TONE_NONE.dot} color="var(--neutral)" />отчёт не сформирован</>}
        </span>
      </footer>
    </div>
  );
}
