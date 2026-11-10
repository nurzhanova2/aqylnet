import { useState } from 'react';
import styles from './PersonaScoresBlock.module.css';
import ChibiBadge from '../ChibiAvatar/ChibiBadge';
import { Bar, Chevron, Dot, Eyebrow, heatOf10 } from '../ReportAtoms/ReportAtoms';
import { GROUP_LABELS, PERSONA_GROUPS, groupLabel } from '../../utils/personaGroups';
import { NOT_SCORED, fmtScore } from '../../utils/personaScoresModel';
import { QUOTE_UNVERIFIED } from '../../utils/reportTrust';

// «Оценки участников» (A1 stage 1), laid out after «Отчёт — Graphite Green».
// Every number was computed on the server from the stored per-section scores;
// nothing is averaged here. Tiles, then the slices as tabs; a heat cell is
// coloured only when it says something — 8+ a strength, below 5 a problem.

const NOTHING = /ничего,?\s*меня не касается/i;

function Heat({ value, title }) {
  const h = heatOf10(value);
  return <span className={`${styles.heat} ${styles[`heat_${h}`]}`} title={title}>{fmtScore(value)}</span>;
}

function Quote({ text, verified }) {
  if (!text) return null;
  return (
    <>
      «{text}»
      {verified === false && <span className={styles.quoteWarn}> — {QUOTE_UNVERIFIED}</span>}
    </>
  );
}

/** "уровень 4 · фраза" for one criterion; marks a score the server moved into the band. */
function LevelNote({ label, score, detail }) {
  if (!detail && (score === null || score === undefined)) return null;
  return (
    <p className={styles.levelNote}>
      <span className={styles.levelLabel}>{label}: {fmtScore(score)}</span>
      {detail?.level != null && <span className={styles.muted}> · уровень {detail.level}</span>}
      {detail?.why && <span> — {detail.why}</span>}
      {detail?.adjusted && <span className={styles.adjusted}> (балл приведён к уровню)</span>}
      {score === null && detail?.reason && <span className={styles.muted}> — {detail.reason}</span>}
    </p>
  );
}

function Face({ p, size = 24 }) {
  return <span className={styles.face}><ChibiBadge persona={p} size={size} color="var(--surface-raised)" border={0} /></span>;
}

function CritHead({ criteria, first, extra }) {
  return (
    <div className={styles.gridHead} style={{ '--cols': criteria.length + (extra ? 1 : 0) }}>
      <span>{first}</span>
      {criteria.map((c) => (
        <span key={c.key} className={styles.center} title={c.computed ? `${c.label} — считает система` : c.label}>
          <span className={styles.critNo}>{c.n}</span> {c.label}
        </span>
      ))}
      {extra && <span className={styles.center}><span className={styles.critNo}>?</span> {extra}</span>}
    </div>
  );
}

function Kpi({ value, of, label, tone }) {
  return (
    <div className={styles.kpi}>
      <span className={styles.kpiTop}>
        <span className={styles.kpiValue} style={tone === 'mid' ? { color: 'var(--warn-title)' } : undefined}>{value}</span>
        {of != null && <span className={styles.kpiOf}>/ {of}</span>}
      </span>
      <span className={styles.kpiLabel}><Dot tone={tone} />{label}</span>
    </div>
  );
}

const TABS = [['groups', 'Группы'], ['people', 'Участники'], ['sections', 'Разделы'], ['read', 'Что понял каждый']];

export default function PersonaScoresBlock({ scores, number, frame, anchor, running, error, onRun, hasDocument }) {
  const [tab, setTab] = useState('groups');
  const has = scores?.hasScores;
  const sectionTitle = (order) => scores?.sections.find((s) => s.order === order)?.title ?? `Раздел ${order + 1}`;
  const critLabel = (key) => scores?.criteria.find((c) => c.key === key)?.label ?? key;
  // Criterion 4 is scored once per document: it has no per-section column.
  const sectionCriteria = scores?.criteria.filter((c) => !c.documentLevel) ?? [];
  const shares = scores?.stats.shares;
  const quotes = scores?.stats.quotes;
  const all = scores?.personas.length ?? 0;

  return (
    <section className={frame.section} id={anchor}>
      <div className={frame.sectionHead}>
        <span className={frame.monoAccent}>{number}</span>
        <h2 className={frame.sectionTitle}>Оценки участников</h2>
        <span className={frame.sectionNote}>— каждый оценил документ сам, до обсуждения</span>
        <span className={frame.spacer} />
        {hasDocument && (
          <button type="button" className={styles.runBtn} onClick={onRun} disabled={running}>
            {running ? 'Участники читают документ…' : has ? 'Оценить заново' : 'Запустить оценку'}
          </button>
        )}
      </div>

      <div className={styles.body}>
        {error && <p className={styles.error}>{error}</p>}
        {!has && !running && (
          <p className={styles.muted}>
            {hasDocument
              ? 'Каждый участник прочитает документ целиком и оценит каждый раздел по шкале 1–10: понятность, причины, что делать мне, сигнал о ставке, доверие. Термины система посчитает сама. Стенограмму участники не видят.'
              : 'У проекта нет документа — оценивать нечего.'}
          </p>
        )}

        {has && (
          <>
            <div className={styles.kpis}>
              <Kpi value={shares.decisionCount} of={shares.scored} label="не поняли решение" tone={shares.decisionCount ? 'mid' : 'good'} />
              <Kpi value={shares.actionCount} of={shares.scored} label="не поняли, что делать" tone={shares.actionCount ? 'mid' : 'good'} />
              <Kpi value={shares.scored} of={all} label="оценили документ" tone={shares.scored === all ? 'good' : 'mid'} />
              <Kpi value={quotes.verified} of={quotes.total} label="цитат найдено дословно" tone={quotes.verified === quotes.total ? 'good' : 'mid'} />
              <Kpi value={scores.stats.unanswered} label="вопросов без ответа" tone={scores.stats.unanswered ? 'mid' : 'good'} />
            </div>

            <div className={styles.tabsRow}>
              <div role="tablist" aria-label="Срез оценок" className={styles.tabs}>
                {TABS.map(([k, label]) => (
                  <button key={k} type="button" role="tab" aria-selected={tab === k}
                    className={`${styles.tab} ${tab === k ? styles.tabOn : ''}`} onClick={() => setTab(k)}>{label}</button>
                ))}
              </div>
              <span className={styles.spacer} />
              <span className={styles.legend}>
                <span className={styles.legendItem}><span className={`${styles.swatch} ${styles.heat_good}`} />8+ сильная сторона</span>
                <span className={styles.legendItem}><span className={`${styles.swatch} ${styles.heat_low}`} />ниже 5 — проблема</span>
              </span>
            </div>

            {tab === 'groups' && (
              <>
                <div className={styles.scroll}>
                  <div className={styles.grid}>
                    <CritHead criteria={scores.criteria} first="Группа" />
                    {PERSONA_GROUPS.map((g) => (
                      <div key={g} className={styles.gridRow} style={{ '--cols': scores.criteria.length }}>
                        <span className={styles.rowName}>{GROUP_LABELS[g]}</span>
                        {scores.criteria.map((c) => <Heat key={c.key} value={scores.stats.document[c.key].byGroup[g]} />)}
                      </div>
                    ))}
                    {[['Разница групп', 'gap'], ['Разброс участников', 'sd']].map(([label, field]) => (
                      <div key={field} className={styles.gridRow} style={{ '--cols': scores.criteria.length }}>
                        <span className={`${styles.rowName} ${styles.rowMeta}`}>{label}</span>
                        {scores.criteria.map((c) => <span key={c.key} className={`${styles.heat} ${styles.heat_meta}`}>{fmtScore(scores.stats.document[c.key][field])}</span>)}
                      </div>
                    ))}
                  </div>
                </div>

                <div className={styles.stack}>
                  <Eyebrow>Главные расхождения групп</Eyebrow>
                  {/* A gap of 0 is no divergence: both sides are one group's mean. */}
                  {scores.stats.top.filter((t) => t.gap > 0).length === 0 && <p className={styles.muted}>Расхождений между группами нет или в проекте одна группа.</p>}
                  {scores.stats.top.filter((t) => t.gap > 0).map((t) => (
                    <details key={`${t.order}-${t.key}`} className={styles.div}>
                      <summary className={styles.divSum}>
                        <span className={styles.delta}>Δ {fmtScore(t.gap)}</span>
                        <span className={styles.divWhere}><b>{sectionTitle(t.order)}</b> <span className={styles.muted}>· {critLabel(t.key)}</span></span>
                        <span className={styles.sides}>
                          {[t.high, t.low].map((s) => (
                            <span key={s.group} className={styles.side}>
                              <span className={styles.sideName}>{GROUP_LABELS[s.group]}</span>
                              <Bar pct={s.mean * 10} />
                              <span className={styles.sideValue}>{fmtScore(s.mean)}</span>
                            </span>
                          ))}
                        </span>
                        <Chevron />
                      </summary>
                      <div className={styles.divBody}>
                        {[t.high, t.low].map((s) => (
                          <p key={s.group} className={styles.divQuote}>
                            <span className={styles.mono}>{GROUP_LABELS[s.group]} · {fmtScore(s.mean)}</span>
                            {s.quote ? <> — <Quote text={s.quote} verified={s.quoteVerified} /></> : <span className={styles.muted}> — цитаты нет</span>}
                          </p>
                        ))}
                      </div>
                    </details>
                  ))}
                  {/* Criterion 6 is computed by code and spans a wider range, so it
                      is ranked apart from the personas' own criteria. */}
                  {scores.stats.topTerms && (
                    <div className={styles.termsLine}>
                      <Dot tone="mid" />
                      <span>
                        <span className={styles.termsTitle}>Расхождение по терминам — Δ <span className={styles.mono}>{fmtScore(scores.stats.topTerms.gap)}</span>.</span>{' '}
                        {sectionTitle(scores.stats.topTerms.order)}: {GROUP_LABELS[scores.stats.topTerms.high.group].toLowerCase()} <span className={styles.mono}>{fmtScore(scores.stats.topTerms.high.mean)}</span>,{' '}
                        {GROUP_LABELS[scores.stats.topTerms.low.group].toLowerCase()} <span className={styles.mono}>{fmtScore(scores.stats.topTerms.low.mean)}</span>. Считает система.
                      </span>
                    </div>
                  )}
                </div>
              </>
            )}

            {tab === 'people' && (
              <div className={styles.scroll}>
                <div className={styles.grid}>
                  <CritHead criteria={scores.criteria} first="Участник" />
                  {scores.personas.map((p) => (
                    <div key={p.id} className={styles.gridRow} style={{ '--cols': scores.criteria.length }}>
                      <span className={styles.person}>
                        <Face p={p} />
                        <span className={styles.personText}>
                          <span className={styles.rowName}>{p.name}</span>
                          <span className={styles.personGroup}>{groupLabel(p.group)}</span>
                        </span>
                      </span>
                      {p.status === 'scored'
                        ? scores.criteria.map((c) => <Heat key={c.key} value={p.document[c.key]} />)
                        : <span className={`${styles.muted} ${styles.spanAll}`}>{NOT_SCORED}{p.failReason ? ` — ${p.failReason}` : ''}</span>}
                    </div>
                  ))}
                  <div className={styles.gridRow} style={{ '--cols': scores.criteria.length }}>
                    <span className={styles.person}>
                      <span className={styles.personText}>
                        <span className={`${styles.rowName} ${styles.rowMeta}`}>Среднее</span>
                        <span className={styles.personGroup}>по {shares.scored} участникам</span>
                      </span>
                    </span>
                    {scores.criteria.map((c) => <Heat key={c.key} value={scores.stats.document[c.key].mean} />)}
                  </div>
                </div>
              </div>
            )}

            {tab === 'sections' && (
              <>
                <p className={styles.muted}>Сигнал о будущей ставке оценивается один раз по документу — его нет в разделах. «Вопросов без ответа» — сколько пунктов «осталось непонятным» назвали участники; в баллы не входит.</p>
                <div className={styles.scroll}>
                  <div className={styles.grid}>
                    <CritHead criteria={sectionCriteria} first="Раздел" extra="Вопросов без ответа" />
                    {scores.stats.sections.map((s) => (
                      <div key={s.order} className={styles.gridRow} style={{ '--cols': sectionCriteria.length + 1 }}>
                        <span className={styles.rowName}>{sectionTitle(s.order)}</span>
                        {sectionCriteria.map((c) => (
                          <Heat key={c.key} value={s.cells[c.key].mean}
                            title={`разброс ${fmtScore(s.cells[c.key].sd)} · разница групп ${fmtScore(s.cells[c.key].gap)} · оценок ${s.cells[c.key].n}`} />
                        ))}
                        <span className={`${styles.heat} ${styles.heat_meta}`} title={`в среднем ${fmtScore(s.unanswered?.mean)} на участника`}>{s.unanswered?.total ?? '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {tab === 'read' && (
              <div className={styles.scroll}>
                <div className={styles.reads}>
                  <div className={styles.readHead}>
                    <span>Участник</span><span>Главное, что понял</span><span>Что сделает</span><span className={styles.right}>Сигнал</span>
                  </div>
                  {scores.personas.map((p) => (
                    <details key={p.id} className={styles.read}>
                      <summary className={styles.readRow}>
                        <span className={styles.person}>
                          <Face p={p} size={26} />
                          <span className={styles.personText}>
                            <span className={styles.readName}>{p.name}</span>
                            <span className={styles.personGroup}>{groupLabel(p.group)}</span>
                          </span>
                        </span>
                        {p.status === 'scored' ? (
                          <>
                            <span className={styles.readText}>
                              {p.mainTakeaway || '—'}
                              {p.decision && <span className={styles.readDecision}>Решение: {p.decision}</span>}
                            </span>
                            <span className={`${styles.readText} ${NOTHING.test(p.myAction) ? styles.readMuted : ''}`}>{p.myAction || '—'}</span>
                            <span className={styles.signal} style={typeof p.rateSignal === 'number' && p.rateSignal < 5 ? { color: 'var(--danger-title)' } : undefined}>
                              {fmtScore(p.rateSignal)}<span className={styles.signalOf}>/10</span>
                            </span>
                          </>
                        ) : (
                          <span className={`${styles.failed} ${styles.spanRest}`}>{NOT_SCORED}{p.failReason ? ` — ${p.failReason}` : ''}</span>
                        )}
                      </summary>
                      {p.status === 'scored' && (
                        <div className={styles.readBody}>
                          {scores.criteria.filter((c) => c.documentLevel).map((c) => (
                            <LevelNote key={c.key} label={c.label} score={p.rateSignal} detail={p.documentLevels?.[c.key]} />
                          ))}
                          <ol className={styles.sectionAnswers}>
                            {p.sections.map((s) => (
                              <li key={s.sectionId}>
                                <span className={styles.secTitle}>{sectionTitle(s.order)}</span>
                                {s.skipped ? <span className={styles.muted}> — раздел пропущен</span> : (
                                  <>
                                    <p className={styles.readLine}>{s.read}</p>
                                    {s.unclear.length > 0 && <p className={styles.unclear}>Непонятно: {s.unclear.join('; ')}</p>}
                                    {s.termsUnclear.length > 0 && <p className={styles.muted}>Непонятные термины: {s.termsUnclear.join(', ')}</p>}
                                    {sectionCriteria.filter((c) => !c.computed).map((c) => (
                                      <LevelNote key={c.key} label={c.label} score={s.scores[c.key]}
                                        detail={s.levels?.[c.key] ?? (s.nullReasons?.[c.key] ? { reason: s.nullReasons[c.key] } : null)} />
                                    ))}
                                    {s.quote && (
                                      <p className={styles.muted}>
                                        {s.quoteHelped === false ? 'Помешало: ' : s.quoteHelped === true ? 'Помогло: ' : ''}
                                        <Quote text={s.quote} verified={s.quoteVerified} />
                                      </p>
                                    )}
                                  </>
                                )}
                              </li>
                            ))}
                          </ol>
                          {p.extraUnclearWords?.length > 0 && (
                            <p className={styles.muted}>Непонятные слова вне словаря: {p.extraUnclearWords.join(', ')}</p>
                          )}
                        </div>
                      )}
                    </details>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
