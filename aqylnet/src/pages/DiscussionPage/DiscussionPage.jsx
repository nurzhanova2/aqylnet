import { useState, useEffect, useRef } from 'react';
import styles from './DiscussionPage.module.css';
import RoundTableScene from '../../components/scenes/RoundTableScene';
import LoungeScene from '../../components/scenes/LoungeScene';
import SchemaScene from '../../components/scenes/SchemaScene';
import TimelinePanel from '../../components/panels/TimelinePanel';
import SentimentChart from '../../components/panels/SentimentChart';
import SummaryPanel from '../../components/panels/SummaryPanel';
import { fetchProject, fetchTimeline, fetchSummary, generateReport, REPORT_IN_PROGRESS, isReportInProgress, uploadDocument, removePersonaFromProject } from '../../api';
import { revealSequentially } from '../../utils/revealSequentially';

function docFileName(url) {
  return url ? url.split('/').pop() : null;
}

/**
 * Short chip for the document sitting on the table — a full filename never
 * fits the card. Format plus, when the name carries a reporting date
 * (2026-03-31 or 31.03.2026), its day and month: "DOCX · 31.03".
 */
export function buildDocChip(label, documentFile, documentText) {
  if (!documentFile && !documentText) return null;
  const name = documentFile ? (label || '') : '';
  const ext = name.includes('.') ? name.split('.').pop().toUpperCase() : '';
  const format = ext && ext.length <= 4 ? ext : documentFile ? 'ФАЙЛ' : 'ТЕКСТ';

  const iso = name.match(/(\d{4})-(\d{2})-(\d{2})/);
  const dotted = name.match(/(\d{2})\.(\d{2})\.\d{4}/);
  const date = iso ? `${iso[3]}.${iso[2]}` : dotted ? `${dotted[1]}.${dotted[2]}` : null;

  return date ? `${format} · ${date}` : format;
}

const SCENES = ['table', 'lounge', 'schema'];
const SCENE_LABELS = { table: 'Круглый стол', lounge: 'Лаунж', schema: 'Схема' };

// Mirrors GOAL_LABELS in backend/src/services/report.service.ts
const GOAL_LABELS = {
  risk_search: 'поиск рисков',
  consensus: 'консенсус',
};

export function launchLabel({ isGenerating, isRevealing, iterCur, iterMax }) {
  if (isGenerating) return 'Генерация…';
  if (isRevealing) return 'Показ ответов…';
  if (iterCur >= iterMax) return 'Симуляция завершена';
  if (iterCur <= 0) return 'Запустить симуляцию';
  return `Запустить следующую итерацию (${iterCur + 1} из ${iterMax})`;
}

export default function DiscussionPage({
  personas,
  projectId,
  iterationKey,
  iterCur,
  iterMax,
  moderator,
  selectedIdx,
  onSelectPersona,
  onGoLibrary,
  onGoAnalytics,
  onToggleMod,
  onRunIteration,
  runDisabled,
  isGenerating,
  isRevealing,
  onRevealingChange,
  generationError,
  onPersonaRemoved,
  onModeratorDraftChange,
}) {
  const [scene, setScene]               = useState('table');
  const [rightTab, setRightTab]         = useState('timeline');
  const [projectPersonas, setProjectPersonas] = useState([]);
  const [projectGoal, setProjectGoal]   = useState('risk_search');
  const [removingPersonaId, setRemovingPersonaId] = useState(null);
  const [timeline, setTimeline]         = useState([]);
  const [moderatorDraft, setModeratorDraft] = useState('');
  const [moderatorOriginal, setModeratorOriginal] = useState('');
  const [moderatorMessageId, setModeratorMessageId] = useState(null);
  // discussionLoading/discussionError cover the initial fetch of the timeline
  // so the panel can tell "still loading" apart from "genuinely no messages
  // yet" apart from "failed to load".
  const [discussionLoading, setDiscussionLoading] = useState(true);
  const [discussionError, setDiscussionError]     = useState(null);
  // Tracks previously-seen (projectId, timeline length) so a fresh project
  // load shows its full history instantly, while a NEW batch of messages
  // from a just-finished run-iteration call reveals only the new tail one
  // message at a time (see the reveal effect below).
  const prevProjectIdRef = useRef(null);
  const prevTimelineLenRef = useRef(0);
  const cancelRevealRef = useRef(null);
  const autoReportProjectRef = useRef(null);
  const messagesRef = useRef(null);
  const [summaryTopics, setSummaryTopics]   = useState([]);
  const [summaryRisks, setSummaryRisks]     = useState([]);
  const [summaryImproves, setSummaryImproves] = useState([]);
  const [summaryMood, setSummaryMood]       = useState(null);
  const [summaryMoodEmoji, setSummaryMoodEmoji] = useState(null);
  const [summaryConclusion, setSummaryConclusion] = useState(null);
  const [reportGenerating, setReportGenerating] = useState(false);
  const [reportError, setReportError] = useState(null);
  const [reportNotice, setReportNotice] = useState(null);
  const [documentFile, setDocumentFile]     = useState(null);
  const [documentFileName, setDocumentFileName] = useState(null);
  const [documentText, setDocumentText]     = useState(null);
  const [docUploading, setDocUploading]     = useState(false);
  const [docError, setDocError]             = useState(null);
  const docInputRef = useRef(null);

  useEffect(() => {
    if (!projectId) return;
    setDiscussionLoading(true);
    setDiscussionError(null);
    Promise.all([
      fetchProject(projectId),
      fetchTimeline(projectId),
      fetchSummary(projectId),
    ]).then(([project, tl, summary]) => {
      setProjectPersonas(project.personas || []);
      setProjectGoal(project.goal);
      setDocumentFile(project.documentFile);
      setDocumentFileName(project.documentFileName);
      setDocumentText(project.documentText);
      setDocError(null);
      const latestModerator = [...tl].reverse().find((message) => message.speakerType === 'moderator');
      const nextModeratorText = latestModerator?.text ?? '';
      setModeratorDraft(nextModeratorText);
      setModeratorOriginal(nextModeratorText);
      setModeratorMessageId(latestModerator?.id ?? null);
      onModeratorDraftChange?.(latestModerator
        ? { id: latestModerator.id, text: nextModeratorText, dirty: false }
        : null);
      if (summary) applySummary(summary);

      const isCompleted = project.status === 'completed'
        || project.currentIteration >= project.iterations;
      if (!summary && isCompleted && tl.length > 0 && autoReportProjectRef.current !== projectId) {
        autoReportProjectRef.current = projectId;
        void handleGenerateReport();
      }

      // Reveal only the messages that are new since the last time this
      // effect ran for this same project — a fresh project navigation shows
      // its whole history immediately, but a bump from a just-finished
      // run-iteration call (same projectId, iterationKey changed) plays the
      // new tail back one message at a time instead of dumping every
      // persona's reply on screen at once.
      cancelRevealRef.current?.();
      const isFreshProject = prevProjectIdRef.current !== projectId;
      const priorLen = isFreshProject ? 0 : prevTimelineLenRef.current;
      const newMessages = tl.slice(priorLen);
      prevProjectIdRef.current = projectId;
      prevTimelineLenRef.current = tl.length;

      if (isFreshProject || newMessages.length === 0) {
        setTimeline(tl);
        onRevealingChange?.(false);
      } else {
        setTimeline(tl.slice(0, priorLen));
        onRevealingChange?.(true);
        cancelRevealRef.current = revealSequentially(newMessages, {
          onReveal: (msg) => setTimeline((prev) => [...prev, msg]),
          onComplete: () => onRevealingChange?.(false),
        });
      }
      setDiscussionLoading(false);
    }).catch((err) => {
      console.error(err);
      setDiscussionError(err.message || 'Не удалось загрузить дискуссию.');
      setDiscussionLoading(false);
    });

    return () => cancelRevealRef.current?.();
  }, [projectId, iterationKey]);

  // Autoscroll the message feed to the latest reply
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [timeline.length]);

  function applySummary(summary) {
    setSummaryTopics(summary.topics || []);
    setSummaryRisks(summary.risks || []);
    setSummaryImproves(summary.improves || []);
    setSummaryMood(summary.mood || null);
    setSummaryMoodEmoji(summary.moodEmoji || null);
    setSummaryConclusion(summary.conclusion || null);
  }

  function handleModeratorDraftChange(text) {
    setModeratorDraft(text);
    if (moderatorMessageId) {
      setTimeline((current) => current.map((message) =>
        message.id === moderatorMessageId ? { ...message, text } : message
      ));
      onModeratorDraftChange?.({
        id: moderatorMessageId,
        text,
        dirty: text !== moderatorOriginal,
      });
    }
  }

  async function handleGenerateReport() {
    if (!projectId || reportGenerating) return;
    setReportGenerating(true);
    setReportError(null);
    setReportNotice(null);
    try {
      await generateReport(projectId);
      const summary = await fetchSummary(projectId);
      if (summary) applySummary(summary);
    } catch (err) {
      if (isReportInProgress(err)) {
        setReportNotice(REPORT_IN_PROGRESS);
      } else {
        console.error('Failed to generate discussion report:', err);
        setReportError(err.message || 'Не удалось сформировать отчёт');
      }
    } finally {
      setReportGenerating(false);
    }
  }

  async function handleReplaceDocument(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !projectId) return;
    setDocUploading(true);
    setDocError(null);
    try {
      const result = await uploadDocument(file, projectId);
      setDocumentFile(result.fileUrl);
      setDocumentFileName(file.name); // client-side File.name — always correctly encoded
      if (result.extractedText) {
        setDocumentText(result.extractedText);
      } else {
        setDocError('Не удалось извлечь текст из файла — загрузите текстовый документ или .docx/.pdf.');
      }
    } catch (err) {
      setDocError(`Ошибка загрузки: ${err.message}`);
    } finally {
      setDocUploading(false);
    }
  }

  function cycleScene() {
    const i = SCENES.indexOf(scene);
    setScene(SCENES[(i + 1) % SCENES.length]);
  }

  // Each persona's own most recent message, keyed by the real Persona.id.
  const lastMessageByPersonaId = new Map();
  for (const m of timeline) {
    if (m.personaId != null) lastMessageByPersonaId.set(m.personaId, m);
  }
  const isRoundActive = isGenerating || isRevealing;
  function personaStatus(persona) {
    const last = lastMessageByPersonaId.get(persona.id);
    if (last) return { kind: last.text ? 'message' : 'error', text: last.text || 'Не удалось получить ответ' };
    if (isRoundActive) return { kind: 'active', text: 'Формирует ответ…' };
    return { kind: 'waiting', text: 'Ожидает ответа…' };
  }
  // The active speaker follows whoever most recently appeared in the
  // timeline (i.e. the last one revealed).
  const lastRevealed = timeline.length > 0 ? timeline[timeline.length - 1] : null;
  const activeSpeaker = lastRevealed?.personaId != null
    ? projectPersonas.find((p) => p.id === lastRevealed.personaId) || null
    : null;
  // Moderator turns close a round and carry no persona, so the table keeps
  // showing the last persona who actually spoke rather than emptying out.
  const lastPersonaMessage = [...timeline].reverse().find((m) => m.personaId != null) || null;
  const tableSpeaker = activeSpeaker
    || (lastPersonaMessage ? projectPersonas.find((p) => p.id === lastPersonaMessage.personaId) || null : null);
  const tableSpeech = activeSpeaker ? lastRevealed?.text : lastPersonaMessage?.text;

  async function handleRemovePersona(e, personaId) {
    e.stopPropagation();
    if (!projectId || projectPersonas.length <= 1) return;
    setRemovingPersonaId(personaId);
    try {
      const updated = await removePersonaFromProject(projectId, personaId);
      setProjectPersonas(updated);
      onPersonaRemoved?.();
    } catch (err) {
      console.error('Failed to remove persona from project:', err);
    } finally {
      setRemovingPersonaId(null);
    }
  }

  const completed = iterCur >= iterMax;
  const moderatorRound = Math.min(iterCur + (completed ? 0 : 1), iterMax);
  const docLabel = documentFile
    ? (documentFileName || docFileName(documentFile))
    : documentText ? 'Вставленный текст' : 'Документ не загружен';
  const docChip = buildDocChip(docLabel, documentFile, documentText);

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        {/* ── I · Круглый стол ── */}
        <section className={styles.tableSection} aria-label="Круглый стол">
          <div className={styles.sectionHead}>
            <span className={styles.kicker}>I · КРУГЛЫЙ СТОЛ</span>
            <span className={styles.sectionMeta}>
              {projectPersonas.length} участников · цель: {GOAL_LABELS[projectGoal] || projectGoal} · модератор {moderator ? 'включён' : 'выключен'}
            </span>
            <span className={styles.headSpacer} />
            {/* A finished simulation is a read-only record: nothing here can
                still change its outcome, so the whole control strip goes away
                and the header reads as the report it has become. Export lives
                in the TopBar. */}
            {!completed && (
              <>
                <input
                  ref={docInputRef}
                  type="file"
                  accept=".pdf,.docx,.doc,.txt"
                  style={{ display: 'none' }}
                  onChange={handleReplaceDocument}
                />
                <button
                  className={styles.btnGhost}
                  onClick={() => docInputRef.current?.click()}
                  disabled={docUploading}
                  title={`Документ: ${docLabel}`}
                >
                  {docUploading ? 'Загрузка…' : '📄 Заменить документ'}
                </button>
                <button className={styles.btnGhost} onClick={onGoLibrary} title="Добавить участника из библиотеки">
                  + Участник
                </button>
                <button className={styles.btnGhost} onClick={cycleScene} title="Переключить вид сцены">
                  Вид: {SCENE_LABELS[scene]}
                </button>
                <button className={styles.btnLaunch} onClick={onRunIteration} disabled={runDisabled}>
                  ▶ {launchLabel({ isGenerating, isRevealing, iterCur, iterMax })}
                </button>
              </>
            )}
          </div>
          {(docError || generationError) && (
            <div className={styles.errorBox}>{docError || generationError}</div>
          )}

          <div className={styles.stage}>
            {scene === 'table' && (
              <RoundTableScene
                personas={projectPersonas}
                allPersonas={personas}
                onSelectPersona={onSelectPersona}
                activeSpeaker={tableSpeaker}
                speakingText={tableSpeech}
                docLabel={docChip}
                iterCur={iterCur}
                iterMax={iterMax}
                messageCount={timeline.length}
                onRemovePersona={handleRemovePersona}
                removingPersonaId={removingPersonaId}
              />
            )}
            {scene === 'lounge' && (
              <LoungeScene personas={projectPersonas} allPersonas={personas} selectedIdx={selectedIdx} onSelectPersona={onSelectPersona} />
            )}
            {scene === 'schema' && (
              <SchemaScene personas={projectPersonas} allPersonas={personas} onSelectPersona={onSelectPersona} personaStatus={personaStatus} />
            )}
          </div>

          <div className={styles.moderatorCard}>
            <div className={styles.moderatorHead}>
              <span className={styles.kicker}>ВОПРОС МОДЕРАТОРА · РАУНД {moderatorRound}</span>
              <span className={styles.headSpacer} />
              {!completed && (
                <button
                  className={`${styles.toggle} ${moderator ? styles.toggleOn : ''}`}
                  onClick={onToggleMod}
                  role="switch"
                  aria-checked={moderator}
                  aria-label="Модератор"
                  title={moderator ? 'Выключить модератора' : 'Включить модератора'}
                >
                  <span className={styles.toggleKnob} />
                </button>
              )}
            </div>
            <textarea
              className={styles.moderatorInput}
              value={moderatorDraft}
              onChange={(event) => handleModeratorDraftChange(event.target.value)}
              readOnly={!moderator || !moderatorMessageId || isGenerating || isRevealing || iterCur >= iterMax}
              placeholder={moderator
                ? 'Вопрос модератора появится после итерации…'
                : 'Модератор выключен'}
              aria-label="Вопрос модератора"
            />
          </div>
        </section>

        {/* ── Правая панель ── */}
        <aside className={styles.rail} aria-label="Ход дискуссии">
          <div className={styles.railTabs} role="tablist">
            {[
              ['timeline', 'Ход дискуссии'],
              ['sentiment', 'Настроение'],
              ['report', 'Отчёт'],
            ].map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={rightTab === key}
                className={`${styles.railTab} ${rightTab === key ? styles.railTabActive : ''}`}
                onClick={() => setRightTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className={styles.roundDivider}>
            <span />
            <span className={styles.roundDividerLabel}>РАУНД {Math.max(iterCur, 1)}</span>
            <span />
          </div>
          <div className={styles.railContent} ref={messagesRef}>
            {rightTab === 'timeline' && (
              discussionLoading
                ? <div className={styles.railStatus}>Загрузка стенограммы…</div>
                : discussionError
                  ? <div className={styles.errorBox}>{discussionError}</div>
                  : <TimelinePanel timeline={timeline} personas={projectPersonas} onSelectPersona={onSelectPersona} />
            )}
            {rightTab === 'sentiment' && (
              <SentimentChart messages={timeline} personas={projectPersonas} iterationCount={iterMax} loading={discussionLoading} error={discussionError} />
            )}
            {rightTab === 'report' && (
              <SummaryPanel
                topics={summaryTopics}
                risks={summaryRisks}
                improves={summaryImproves}
                mood={summaryMood}
                moodEmoji={summaryMoodEmoji}
                conclusion={summaryConclusion}
                generating={reportGenerating}
                error={reportError}
                notice={reportNotice}
                onGenerateReport={handleGenerateReport}
                onGoAnalytics={onGoAnalytics}
              />
            )}
          </div>
          {rightTab !== 'report' && (
            <div className={styles.reportCard}>
              <div className={styles.reportCardTitle}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                {summaryConclusion ? 'Итоговый отчёт готов' : 'Итоговый отчёт'}
              </div>
              <p className={styles.reportCardText}>
                {summaryConclusion || (reportGenerating ? 'Отчёт формируется…' : 'Отчёт ещё не создан')}
              </p>
              <button
                className={styles.reportCardBtn}
                onClick={summaryConclusion ? onGoAnalytics : handleGenerateReport}
                disabled={reportGenerating}
              >
                {summaryConclusion ? 'Открыть отчёт' : 'Сформировать отчёт'}
              </button>
            </div>
          )}
        </aside>
      </main>

      {/* ── Футер-статусбар ── */}
      <footer className={styles.statusBar}>
        <span>{isGenerating ? 'Генерация…' : isRevealing ? 'Показ ответов…' : completed ? 'Готово' : 'Активна'}</span>
        <span>раундов {iterCur}/{iterMax}</span>
        <span>реплик {timeline.length}</span>
        <span className={styles.headSpacer} />
        <span className={styles.statusLlm}>● LiteLLM НБК</span>
      </footer>
    </div>
  );
}
