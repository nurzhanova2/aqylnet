import { useState } from 'react';
import styles from './RewritesBlock.module.css';
import { Banner, Dot, Eyebrow, Pill } from '../ReportAtoms/ReportAtoms';
import { LAYERS, STALE_NOTE, buildFullModel, buildLayerModel, copyText } from '../../utils/rewriteModel';

// «Три версии текста» (A1 stage 3), laid out after «Отчёт — Graphite Green».
// The text and every mark come from the server; nothing is checked here. A
// marked phrase carries a footnote and, when the author has to compare it,
// its basis right under it — not on hover. The limitation of the checks
// stays above the versions (decision of 04.11.2026).

const PLACEHOLDER_SPLIT = /(\[Дописать:[^\]]*\])/g;
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
// Marks about the facts get numbers; marks about the wording (a term, a long
// sentence) get letters — as in the mockup.
const FACT_MARKS = new Set(['проверить автору', 'не подтверждено документом', 'число не найдено в документе', 'должно быть заглушкой', 'из абзаца убраны данные']);
const MARK_FG = { low: 'var(--danger-title)', mid: 'var(--warn-title)', none: 'var(--text-3)', good: 'var(--accent-hover)' };

function WithPlaceholders({ text }) {
  return String(text ?? '').split(PLACEHOLDER_SPLIT).map((part, i) =>
    (part.startsWith('[Дописать:') ? <mark key={i} className={styles.placeholder}>{part}</mark> : <span key={i}>{part}</span>));
}

const onlyPlaceholder = (text) => !String(text ?? '').replace(PLACEHOLDER_SPLIT, '').replace(/[\s.,;:—–\-()«»"]+/g, '');

/** Footnotes for a list of marked pieces: numbers for facts, letters for wording. */
function footnotes(pieces) {
  let n = 0;
  let l = 0;
  const notes = [];
  const withSups = pieces.map((p) => ({
    ...p,
    sups: p.marks.map((m) => {
      const key = FACT_MARKS.has(m.label) ? String(++n) : LETTERS[l++ % LETTERS.length];
      notes.push({ key, ...m });
      return { key, tone: m.tone };
    }),
  }));
  // Numbers first, then letters — as the footnotes read in the mockup.
  const isNum = (k) => /^d+$/.test(k);
  notes.sort((x, y) => (isNum(x.key) === isNum(y.key) ? 0 : isNum(x.key) ? -1 : 1));
  return { pieces: withSups, notes };
}

function Line({ item }) {
  if (item.placeholder && onlyPlaceholder(item.text)) {
    return <p className={styles.todo}>{item.text}</p>;
  }
  const strong = item.marks.some((m) => m.label === 'не подтверждено документом');
  return (
    <div className={styles.line}>
      <p className={styles.lineText}>
        <span className={item.basis ? (strong ? styles.hlLow : styles.hl) : undefined}><WithPlaceholders text={item.text} /></span>
        {item.sups.map((s) => <sup key={s.key} className={styles.sup} style={{ color: MARK_FG[s.tone] }}>{s.key}</sup>)}
      </p>
      {item.basis && <p className={styles.basis}><span className={styles.basisLabel}>Опора</span> «{item.basis}»</p>}
    </div>
  );
}

function Notes({ notes }) {
  if (!notes.length) return null;
  return (
    <div className={styles.side}>
      <span className={styles.sideTitle}>Пометки</span>
      {notes.map((m) => (
        <div key={m.key} className={styles.note}>
          <span className={styles.noteKey} style={{ color: MARK_FG[m.tone] }}>{m.key}</span>
          <span className={styles.noteText}><span style={{ color: MARK_FG[m.tone] }}>{m.label}{m.detail ? ':' : ''}</span> {m.detail}</span>
        </div>
      ))}
    </div>
  );
}

function Check({ rows, norm }) {
  return (
    <div className={styles.side}>
      <span className={styles.sideTitle}>Проверка</span>
      {rows.map(([k, v, tone]) => (
        <div key={k} className={styles.checkRow}>
          <Dot tone={tone} />
          <span className={styles.checkKey}>{k}</span>
          <span className={styles.checkValue} style={{ color: tone === 'mid' ? 'var(--warn-title)' : tone === 'low' ? 'var(--danger-title)' : undefined }}>{v}</span>
        </div>
      ))}
      {norm && <span className={styles.norm}>{norm}</span>}
    </div>
  );
}

function shortChecks(layer, bounds) {
  const s = layer?.summary;
  if (!s) return [];
  const rows = [
    ['Длина', `${s.chars} симв.`, s.withinVolume === false ? 'mid' : 'good'],
    ['Время чтения', `~${String(s.minutes).replace('.', ',')} мин`, 'none'],
    ['Заглушек', String(s.placeholders.length), s.placeholders.length ? 'mid' : 'none'],
    ['Пометок', String(s.marks), 'none'],
    ['«Проверить автору»', String(s.authorChecks ?? 0), (s.authorChecks ?? 0) ? 'mid' : 'none'],
  ];
  if (s.unsupported) rows.push(['Не подтверждено', String(s.unsupported), 'low']);
  if (s.numbersNotFound) rows.push(['Чисел не из документа', String(s.numbersNotFound), 'low']);
  return { rows, norm: bounds ? `Норма длины — ${bounds.min}–${bounds.max} символов.` : '' };
}

function ShortLayer({ model, layer, bounds, onRunLayer, running }) {
  const pieces = model.parts.flatMap((part) => part.items.map((it) => ({ ...it, part: part.key })));
  const { pieces: marked, notes } = footnotes(pieces);
  const check = shortChecks(layer, bounds);
  return (
    <div className={styles.split}>
      <article className={styles.text}>
        {model.decision && !model.decision.ok && <p className={styles.warnLine}>{model.decision.reason}</p>}
        {model.parts.map((part) => {
          const lines = marked.filter((p) => p.part === part.key);
          if (!lines.length) return null;
          return (
            <div key={part.key} className={styles.block}>
              <Eyebrow>{part.heading}</Eyebrow>
              {lines.map((it, i) => <Line key={i} item={it} />)}
            </div>
          );
        })}
        {model.figures?.length > 0 && (
          <div className={styles.block}>
            <Eyebrow>Ключевые цифры</Eyebrow>
            <div className={styles.figures}>
              {model.figures.map((f, i) => (
                <div key={i} className={styles.figure}>
                  <span className={styles.figureName}>{f.indicator}</span>
                  <span className={styles.figureValue}>{f.value}{f.marks.length > 0 && <span className={styles.figureWarn}> · {f.marks[0].label}</span>}</span>
                  <span className={styles.figureSec}>{f.section ? `разд. ${f.section}` : '—'}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </article>
      <aside className={styles.aside} aria-label="Проверка версии">
        <Check rows={check.rows} norm={check.norm} />
        <Notes notes={notes} />
        <button type="button" className={styles.ghostWide} onClick={() => onRunLayer(model.key)} disabled={running}>Заново эту версию</button>
      </aside>
    </div>
  );
}

function FullLayer({ model, layer, onRunLayer, running }) {
  const [onlyEdits, setOnlyEdits] = useState(true);
  const { pieces: bluf, notes: blufNotes } = footnotes(model.bluf);
  const { pieces: paras, notes: paraNotes } = footnotes(model.paragraphs.map((p) => ({ ...p, marks: p.marks })));
  // One numbering for the version: the paragraph notes continue the summary's.
  const offset = blufNotes.filter((n) => /^\d+$/.test(n.key)).length;
  const renum = (k) => (/^\d+$/.test(k) ? String(Number(k) + offset) : k);
  const isNum = (k) => /^d+$/.test(k);
  const notes = [...blufNotes, ...paraNotes.map((n) => ({ ...n, key: renum(n.key) }))]
    .sort((x, y) => (isNum(x.key) === isNum(y.key) ? 0 : isNum(x.key) ? -1 : 1));
  const shown = (onlyEdits ? paras.filter((p) => p.status !== 'same') : paras);
  const s = layer?.summary;
  const dropped = Object.values(layer?.edits?.dropped ?? {}).reduce((a, b) => a + b, 0);
  const rows = s ? [
    ['Длина', `${s.chars} симв.`, 'none'],
    ['Изменено абзацев', String(s.changed), s.changed ? 'mid' : 'none'],
    ['Добавлено', String(s.added), 'none'],
    ['Заглушек', String(s.placeholders.length), s.placeholders.length ? 'mid' : 'none'],
    ['«Проверить автору»', String(s.authorChecks ?? 0), (s.authorChecks ?? 0) ? 'mid' : 'none'],
    ['Без изм. байт в байт', `${layer.integrity.matching}/${layer.integrity.same}`, layer.integrity.matching === layer.integrity.same ? 'good' : 'low'],
    ['Отброшено правок', `${dropped} (новое содержание — ${layer.edits.dropped.newContent ?? 0})`, 'none'],
  ] : [];
  return (
    <>
      <div className={styles.split}>
        <article className={styles.text}>
          {model.blufDecision && !model.blufDecision.ok && <p className={styles.warnLine}>«Главное»: {model.blufDecision.reason}</p>}
          {model.failNote && <p className={styles.warnLine}>{model.failNote}</p>}
          <div className={styles.block}>
            <span className={styles.blockHead}><Eyebrow>Главное</Eyebrow><Pill tone="good">добавлено</Pill></span>
            {bluf.map((it, i) => <Line key={i} item={it} />)}
          </div>
          <div className={styles.block}>
            <div className={styles.segment} role="tablist" aria-label="Что показывать">
              {[[true, 'Только правки'], [false, 'Весь текст']].map(([v, label]) => (
                <button key={label} type="button" role="tab" aria-selected={onlyEdits === v}
                  className={`${styles.segmentBtn} ${onlyEdits === v ? styles.segmentOn : ''}`} onClick={() => setOnlyEdits(v)}>{label}</button>
              ))}
            </div>
            {shown.length === 0 && <p className={styles.muted}>Правок нет.</p>}
            {shown.map((p) => (
              <div key={p.id} className={`${styles.para} ${styles[`para_${p.status}`]}`}>
                {p.status !== 'same' && (
                  <div className={styles.paraHead}>
                    <Pill tone={p.status === 'changed' ? 'good' : 'good'} shape={p.status === 'added' ? 'square' : 'round'}>{p.tag}{p.kind ? ` · ${p.kind}` : ''}</Pill>
                    <span className={styles.mono}>{p.id}</span>
                    {p.link && <span className={styles.mono}>{p.link}</span>}
                    {p.sups.map((x) => <sup key={x.key} className={styles.sup} style={{ color: MARK_FG[x.tone] }}>{renum(x.key)}</sup>)}
                  </div>
                )}
                <p className={styles.paraText}><WithPlaceholders text={p.text.trim()} /></p>
                {p.basis && <p className={styles.basis}><span className={styles.basisLabel}>Опора</span> «{p.basis}»</p>}
                {p.before && <p className={styles.before}><span className={styles.basisLabel}>Было</span> {p.before.trim()}</p>}
                {p.reason && <p className={styles.reason}>Причина: {p.reason}</p>}
              </div>
            ))}
          </div>
        </article>
        <aside className={styles.aside} aria-label="Проверка версии">
          <Check rows={rows} />
          <Notes notes={notes} />
          <button type="button" className={styles.ghostWide} onClick={() => onRunLayer('full')} disabled={running}>Заново эту версию</button>
        </aside>
      </div>
      {model.issues.length > 0 && (
        <div className={styles.issues}>
          <Eyebrow>Замечания аудита High и Critical</Eyebrow>
          <p className={styles.muted}>
            Правка в абзаце с цитатой — {model.statusCounts.in_quote_paragraph}, не в том абзаце — {model.statusCounts.wrong_paragraph}, нет правки — {model.statusCounts.no_edit}.
            Статус говорит, где правка, а не что замечание исправлено.
          </p>
          <div className={styles.issueTable}>
            {model.issues.map((i) => (
              <div key={i.id} className={styles.issueRow}>
                <span className={styles.mono}>{i.id}</span>
                <span className={styles.issueSev}>{i.severity}</span>
                <span className={styles.issueTitle}>{i.title}</span>
                <Pill tone={i.status === 'in_quote_paragraph' ? 'good' : i.status === 'wrong_paragraph' ? 'mid' : 'none'}>{i.statusLabel}</Pill>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export default function RewritesBlock({ rewrites, number, frame, anchor, running, error, onRun, onRunLayer, onExport, exporting }) {
  const [tab, setTab] = useState('card');
  const [copied, setCopied] = useState(false);
  const has = rewrites?.hasAnalysis;
  const any = rewrites && (rewrites.card || rewrites.brief || rewrites.full);
  const model = tab === 'full' ? buildFullModel(rewrites) : buildLayerModel(rewrites, tab);
  const layer = rewrites?.[tab];
  const label = LAYERS.find((l) => l.key === tab)?.label;

  async function copy() {
    try {
      await navigator.clipboard.writeText(copyText(model));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { /* copying is best effort; the export path reports its own errors */ }
  }

  return (
    <section className={frame.section} id={anchor}>
      <div className={frame.sectionHead}>
        <span className={frame.monoAccent}>{number}</span>
        <h2 className={frame.sectionTitle}>Три версии текста</h2>
        <span className={frame.sectionNote}>— карточка, справка, полный текст</span>
        <span className={frame.spacer} />
        {has && (
          <button type="button" className={styles.runBtn} onClick={onRun} disabled={running}>
            {running ? 'Пишем версии…' : any ? 'Все три заново' : 'Сделать три версии'}
          </button>
        )}
      </div>
      <div className={styles.body}>
        {error && <p className={styles.error}>{error}</p>}
        {!has && <p className={styles.muted}>Версии строятся на анализе «Кому понятен текст» — сначала запустите его.</p>}
        {has && (
          <>
            <div className={styles.tabsRow}>
              <div className={styles.tabs} role="tablist" aria-label="Версия текста">
                {LAYERS.map((l) => (
                  <button key={l.key} type="button" role="tab" aria-selected={tab === l.key}
                    className={`${styles.tab} ${tab === l.key ? styles.tabOn : ''}`} onClick={() => setTab(l.key)}>
                    {l.label}<span className={styles.tabAud}>{l.key === 'brief' ? 'бизнес и СМИ' : l.audience}</span>
                  </button>
                ))}
              </div>
              <span className={styles.spacer} />
              {model.has && (
                <>
                  <button type="button" className={styles.ghostBtn} onClick={copy}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" /></svg>
                    {copied ? 'Скопировано' : 'Копировать'}
                  </button>
                  <button type="button" className={styles.ghostBtn} onClick={() => onExport(model.key, 'pdf')} disabled={!!exporting}>{exporting === `${model.key}-pdf` ? 'PDF…' : 'PDF'}</button>
                  <button type="button" className={styles.ghostBtn} onClick={() => onExport(model.key, 'docx')} disabled={!!exporting}>{exporting === `${model.key}-docx` ? 'Word…' : 'Word'}</button>
                </>
              )}
            </div>

            {/* The limitation of the checks — above the versions, as decided;
                the same text heads every exported file. */}
            <Banner tone="mid" icon="warn" title="Черновик: связь между фактами не проверена">
              Проверено: числа и опорные цитаты есть в документе. Сверьте фразы с пометкой «проверить автору» — верно ли передана связь.
            </Banner>

            {model.has && model.stale && <Banner tone="mid" icon="info" title="Версия устарела">{STALE_NOTE}</Banner>}

            {!model.has && (
              <div className={styles.empty}>
                <span className={styles.emptyIcon}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-4)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>
                </span>
                <span className={styles.emptyText}>{model.failed ? `Версия «${label}» не получилась: ${model.failed}` : `Версия «${label}» ещё не сформирована`}</span>
                <button type="button" className={styles.runBtn} onClick={() => onRunLayer(tab)} disabled={running}>Сформировать</button>
              </div>
            )}

            {model.has && (tab === 'full'
              ? <FullLayer model={model} layer={layer} onRunLayer={onRunLayer} running={running} />
              : <ShortLayer model={model} layer={layer} bounds={rewrites.bounds?.[tab]} onRunLayer={onRunLayer} running={running} />)}
          </>
        )}
      </div>
    </section>
  );
}
