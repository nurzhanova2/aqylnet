import { useState } from 'react';
import styles from './AudienceBlock.module.css';
import DocumentMetaFields from '../DocumentMetaFields/DocumentMetaFields';
import { Banner, Cells, Chevron, Eyebrow, Pill, toneOf100 } from '../ReportAtoms/ReportAtoms';
import {
  AUDIENCE_HINT, NO_DECISION_NOTE, REFERENCE_MISSING, STALE_NOTE, buildAudienceModel, droppedLine, personasLabel,
  showReason, verdictLabel,
} from '../../utils/audienceModel';
import { QUOTE_UNVERIFIED } from '../../utils/reportTrust';
import { countOf } from '../../utils/plural';

// «Кому понятен текст» (A1 stage 2), laid out after «Отчёт — Graphite Green».
// Group levels, the gap and the terms are the server's code; the reference,
// the extracted decision fields and the missing explanations are the model's,
// checked by the server; every verdict is code. Nothing is computed here.

const VERDICT_TONE = { correct: 'good', partial: 'mid', wrong: 'low', not_understood: 'low' };

/** The headline's tone: on target — good; missed or partly — a warning; no audience — neutral. */
function headlineTone(dto) {
  if (!dto?.gap) return 'none';
  return dto.gap.verdict === 'on_target' ? 'good' : 'mid';
}

// The three criteria are scores on 1–10, the rows below them are counts. A bare
// «Термины 10» next to «Вопросов без ответа 0» read as «ten terms» when it means
// that every term was clear — so the scores say their scale.
const outOfTen = (v) => (v === '—' ? v : `${v} / 10`);

function GroupCard({ g }) {
  const warnBorder = g.target && g.level !== 'clear';
  const rows = [
    ['Верно поняли решение', g.share, false],
    ['Понятность', outOfTen(g.criteria.clarity), false],
    ['Что делать мне', outOfTen(g.criteria.myAction), g.criteria.myAction !== '—' && parseFloat(String(g.criteria.myAction).replace(',', '.')) < 5],
    ['Понятность терминов', outOfTen(g.criteria.terms), false],
    ['Вопросов без ответа', String(g.unanswered), false],
    ['Участников', g.few ? `${g.personas} · мало` : String(g.personas), !!g.few],
  ];
  return (
    <div className={styles.groupCard} style={warnBorder ? { borderColor: 'var(--warn-border)' } : undefined}>
      <div className={styles.groupHead}>
        <span className={styles.groupName}>{g.label}</span>
        {g.target && <span className={styles.target}>целевая</span>}
        <span className={styles.spacer} />
        <Pill tone={g.tone}>{g.levelLabel}</Pill>
      </div>
      <div className={styles.indexRow}>
        <span className={styles.indexValue}>{g.index}</span>
        <span className={styles.indexNote}>индекс понимания{g.indexBasis ? ` · ${g.indexBasis.replace('индекс ', '')}` : ''}</span>
      </div>
      <div className={styles.indexCells}>
        <Cells value={g.indexValue == null ? null : g.indexValue * 10} tone={toneOf100(g.indexValue == null ? null : g.indexValue * 10)} />
      </div>
      <dl className={styles.groupStats}>
        {rows.map(([k, v, warn]) => (
          <div key={k} className={styles.statRow}>
            <dt>{k}</dt>
            <dd style={warn ? { color: 'var(--warn-title)' } : v === '—' ? { color: 'var(--text-5)' } : undefined}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function AudienceBlock({ audience, number, frame, anchor, running, error, onRun, onSaveMeta, hasScores }) {
  const m = buildAudienceModel(audience);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const a = m?.analysis;

  function openEditor() {
    setDraft({ ...(audience?.document ?? {}), intendedAudience: audience?.document?.intendedAudience ?? [] });
    setSaveError(null);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      await onSaveMeta(draft);
      setEditing(false);
    } catch (err) {
      setSaveError(`Не удалось сохранить: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  const [lead, ...rest] = m?.headline ?? [];
  const sub = [...rest.filter((h) => h !== AUDIENCE_HINT), ...(m?.extraPhrase ? [m.extraPhrase] : [])].join(' ');

  return (
    <section className={frame.section} id={anchor}>
      <div className={frame.sectionHead}>
        <span className={frame.monoAccent}>{number}</span>
        <h2 className={frame.sectionTitle}>Кому понятен текст</h2>
        <span className={frame.sectionNote}>— для кого писался и кто его понял</span>
        <span className={frame.spacer} />
        <button type="button" className={styles.ghostBtn} onClick={editing ? () => setEditing(false) : openEditor}>
          {editing ? 'Отмена' : 'О документе'}
        </button>
        {hasScores && (
          <button type="button" className={styles.runBtn} onClick={onRun} disabled={running}>
            {running ? 'Сверяем ответы…' : a ? 'Проверить заново' : 'Проверить понимание'}
          </button>
        )}
      </div>

      <div className={styles.body}>
        {error && <p className={styles.error}>{error}</p>}

        {editing && draft && (
          <div className={styles.editor}>
            <DocumentMetaFields value={draft} onChange={setDraft} idPrefix="report-meta" />
            <div className={styles.editorActions}>
              {saveError && <span className={styles.error}>{saveError}</span>}
              <span className={styles.spacer} />
              <button type="button" className={styles.runBtn} onClick={save} disabled={saving}>
                {saving ? 'Сохраняем…' : 'Сохранить'}
              </button>
            </div>
          </div>
        )}

        {!hasScores && (
          <p className={styles.muted}>Блок строится на оценках участников — сначала запустите их в разделе выше.</p>
        )}

        {hasScores && m && (
          <>
            {a?.stale && <Banner tone="mid" icon="warn" title="Анализ устарел">{STALE_NOTE}</Banner>}

            {lead && (
              <Banner tone={headlineTone(audience)} icon={m.hasAudience ? 'target' : 'info'} title={lead}>
                {m.hasAudience ? (sub || null) : AUDIENCE_HINT}
              </Banner>
            )}

            <div className={styles.groups}>
              {m.groups.map((g) => <GroupCard key={g.key} g={g} />)}
            </div>

            {!a && (
              <p className={styles.muted}>
                Доля верно понявших решение появится после проверки: модель найдёт решение в документе,
                извлечёт из ответов участников, что они назвали, а вердикт посчитает система.
                До этого уровень считается только по индексу.
              </p>
            )}

            {a && (
              <div className={styles.stack}>
                <Eyebrow>Как поняли решение</Eyebrow>
                <div className={styles.panel}>
                  {a.referenceOk && !a.comparable ? (
                    <div className={styles.referenceMissing}>
                      {NO_DECISION_NOTE}
                      <span className={styles.refNone}> Ближайшая к решению фраза документа: «{a.reference.quote}»</span>
                    </div>
                  ) : a.referenceOk ? (
                    <div className={styles.reference}>
                      <div className={styles.referenceMain}>
                        <span className={styles.refLabel}>
                          Решение по документу{a.reference.section ? <> · <span className={styles.mono}>{a.reference.section}</span></> : ''}
                        </span>
                        <span className={styles.refQuote}>«{a.reference.quote}»</span>
                      </div>
                      {a.referenceFields.map((f) => (
                        <span key={f.key} className={styles.refField} title={f.quote ? `«${f.quote}»` : f.note}>
                          {f.label} {f.value ? <span className={styles.refValue}>{f.value}</span> : <span className={styles.refNone}>{f.note}</span>}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.referenceMissing}>
                      {REFERENCE_MISSING}{a.reference.reason ? ` — ${a.reference.reason}` : ''}. Ответы участников не сверялись.
                      {a.reference.quote && <span className={styles.quoteWarn}> Модель предложила: «{a.reference.quote}» — {QUOTE_UNVERIFIED}.</span>}
                    </div>
                  )}
                  {/* Without a comparable decision each row would only repeat «не проверялось». */}
                  {a.comparable && a.verdicts.map((v) => (
                    <div key={v.personaId} className={styles.verdict}>
                      <span className={styles.who}>
                        <span className={styles.whoName}>{v.name}</span>
                        <span className={styles.whoGroup}>{v.groupLabel}</span>
                      </span>
                      <span className={styles.answer}>
                        <span className={styles.answerText}>{v.decision ? `«${v.decision}»` : '—'}</span>
                        {v.extractedLine && <span className={styles.extracted}>В ответе: {v.extractedLine}</span>}
                        {showReason(v) && <span className={styles.reason}>{v.reason}</span>}
                      </span>
                      <Pill tone={v.verdict ? VERDICT_TONE[v.verdict] : 'none'}>{verdictLabel(v.verdict)}</Pill>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {a && (
              <div className={styles.stack}>
                <Eyebrow>Чего не хватает — по группам</Eyebrow>
                {a.missing.map((g, gi) => {
                  const termCount = g.terms.terms.length + g.terms.extra.length;
                  return (
                    <details key={g.key} className={styles.gapGroup} open={gi === 0}>
                      <summary className={styles.gapSum}>
                        <Chevron />
                        <span className={styles.gapName}>{g.label}</span>
                        <span className={styles.gapCount}>{g.status === 'ok' ? countOf(g.items.length, 'пункт', 'пункта', 'пунктов') : 'нет данных'}</span>
                        <span className={styles.spacer} />
                        <span className={styles.gapTerms}>непонятных терминов <span className={styles.mono}>{termCount}</span></span>
                      </summary>
                      <div className={styles.gapBody}>
                        {g.status !== 'ok' && <p className={styles.gapNote}>{g.reason}</p>}
                        {g.status === 'ok' && g.items.length === 0 && <p className={styles.gapNote}>Пунктов нет.</p>}
                        {g.items.map((it, i) => (
                          <div key={it.missing} className={styles.item}>
                            <span className={styles.itemNum}>{i + 1}</span>
                            <div className={styles.itemBody}>
                              <span className={styles.itemTitle}>{it.missing}</span>
                              {it.suggestion && <span className={styles.itemAdd}><span className={styles.addLabel}>Что добавить:</span> {it.suggestion}</span>}
                              {it.question && <span className={styles.itemQ}>Вопрос участника: «{it.question}»</span>}
                              {it.sections.length > 0 && <span className={styles.itemSections}>{it.sections.join('; ')}</span>}
                            </div>
                            <span className={`${styles.who2} ${it.personas === 1 ? styles.who2One : ''}`}>{personasLabel(it.personas)}</span>
                          </div>
                        ))}
                        {termCount > 0 && (
                          <div className={styles.termsRow}>
                            <span className={styles.termsLabel}>Непонятные термины</span>
                            {g.terms.terms.map((t) => <span key={t.term} className={styles.termChip}>{t.term}<span className={styles.termCount}>{t.personas}</span></span>)}
                            {g.terms.extra.map((t) => <span key={t.word} className={`${styles.termChip} ${styles.termExtra}`} title="вне словаря">{t.word}<span className={styles.termCount}>{t.personas}</span></span>)}
                          </div>
                        )}
                        {g.dropped > 0 && <p className={styles.dropped}>{droppedLine(g)}</p>}
                      </div>
                    </details>
                  );
                })}
              </div>
            )}

            {!a && m.terms.some((t) => t.terms.length > 0 || t.extra.length > 0) && (
              <div className={styles.stack}>
                <Eyebrow>Непонятные термины по группам</Eyebrow>
                {m.terms.filter((t) => t.terms.length > 0 || t.extra.length > 0).map((t) => (
                  <div key={t.key} className={styles.termsRow}>
                    <span className={styles.termsLabel}>{t.label}</span>
                    {t.terms.map((x) => <span key={x.term} className={styles.termChip}>{x.term}<span className={styles.termCount}>{x.personas}</span></span>)}
                    {t.extra.map((x) => <span key={x.word} className={`${styles.termChip} ${styles.termExtra}`} title="вне словаря">{x.word}<span className={styles.termCount}>{x.personas}</span></span>)}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
