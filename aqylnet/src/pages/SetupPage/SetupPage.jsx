import { useState, useRef } from 'react';
import styles from './SetupPage.module.css';
import ChibiBadge from '../../components/ChibiAvatar/ChibiBadge';
import { uploadDocument, createProject, suggestPersonas } from '../../api';
import DocumentMetaFields from '../../components/DocumentMetaFields/DocumentMetaFields';
import { metaPayload } from '../../utils/documentMeta';

const STANCE_OPTIONS = ['Поддерживает', 'Против', 'Нейтральный', 'Неопределившийся'];
// Each mode changes how the backend actually runs a round — speaking order and
// the instruction every persona gets — not just a stored label.
const MODE_OPTIONS = [
  ['Round Table', 'Свободное обсуждение: каждый говорит со всей группой'],
  ['Дебаты',      'Участники делятся на два лагеря по позиции и отвечают оппоненту'],
  ['Интервью',    'Модератор открывает раунд вопросом, каждый отвечает лично на него'],
];

const GOALS = [
  ['risk_search', 'Поиск рисков'],
  ['consensus', 'Достижение консенсуса'],
];

// Ready-made panels, matched against the library by role at click time rather
// than by hardcoded persona ids — the library is user-editable and seed ids
// aren't stable, so a panel must survive personas being added or renamed.
const PANELS = [
  ['Медиа',        /журналист|блогер|маркетолог|дизайнер/i],
  ['Госсектор',    /госчиновник|депутат|полицейск|офицер|мчс|адвокат/i],
  ['Финэксперты',  /экономик|экономист|банк|вкладчик|заёмщик/i],
  ['Общество',     /пенсион|таксист|рабочий|студент|учительниц|врач|заёмщик|вкладчик/i],
  ['Руководство',  /директор|топ-менеджер|предпринимател|владелец|прораб|госчиновник/i],
];

const MAX_INTENDED = 3;

export default function SetupPage({
  personas, iterMax,
  onGoLibrary, onProjectCreated, onGoDiscussion,
}) {
  const fileInputRef = useRef(null);

  const [srcTab, setSrcTab]               = useState('file');
  const [docFile, setDocFile]             = useState(null);
  const [docFileUrl, setDocFileUrl]       = useState(null);
  const [docText, setDocText]             = useState('');
  const [discussionTask, setDiscussionTask] = useState('');
  const [uploading, setUploading]         = useState(false);
  const [launching, setLaunching]         = useState(false);
  const [suggesting, setSuggesting]       = useState(false);
  const [error, setError]                 = useState(null);
  // Separate from `error` on purpose: a truncated document is a warning, not a
  // failure — the upload worked and the simulation can run. Styling it as an
  // error would tell the user something broke.
  const [notice, setNotice]               = useState(null);
  const [othersOpen, setOthersOpen]       = useState(false);

  // selected persona ids — default = all in library (up to 8)
  const [selectedIds, setSelectedIds]     = useState(() => personas.slice(0, 8).map((p) => p.id));

  // per-discussion stance override, keyed by personaId — only for THIS project,
  // doesn't touch the persona's own default stance in the library
  const [personaStances, setPersonaStances] = useState({});

  // Key messages the author wants the document to land. The report scores each
  // one against what the personas actually understood.
  const [intendedMessages, setIntendedMessages] = useState(['']);

  // A1 stage 2: type, date and intended audience. A type fills in its default
  // audience (utils/documentMeta.js); the server stores what is sent.
  const [docMeta, setDocMeta] = useState({ docType: null, publishedAt: null, intendedAudience: [] });
  const [goal, setGoal] = useState('risk_search');
  const [mode, setMode] = useState(MODE_OPTIONS[0][0]);

  // local to this form — independent of App.jsx's app-wide iterMax, which
  // reflects the currently *active* project, not the one being configured here
  const [iterations, setIterations] = useState(() => Math.min(Math.max(iterMax || 5, 1), 10));

  // moderator must be local to the project being configured here, not the
  // app-wide value that reflects the currently *active* project.
  const [moderator, setModerator] = useState(true);

  const selectedPersonas = personas.filter((p) => selectedIds.includes(p.id));
  const otherPersonas = personas.filter((p) => !selectedIds.includes(p.id));

  function togglePersona(id) {
    setSelectedIds((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length < 8 ? [...prev, id] : prev  // max 8
    );
  }

  function setPersonaStance(id, stance) {
    setPersonaStances((prev) => ({ ...prev, [id]: stance }));
  }

  function stanceFor(persona) {
    return personaStances[persona.id] ?? persona.stance ?? 'Нейтральный';
  }

  function applyPanel(pattern) {
    const ids = personas
      .filter((p) => pattern.test(`${p.role || ''} ${p.industry || ''}`))
      .slice(0, 8)
      .map((p) => p.id);
    if (ids.length === 0) {
      setError('В библиотеке нет персон, подходящих под эту панель.');
      return;
    }
    setError(null);
    setSelectedIds(ids);
  }

  function setIntendedMessage(idx, value) {
    setIntendedMessages((prev) => prev.map((m, i) => (i === idx ? value : m)));
  }

  function addIntendedMessage() {
    setIntendedMessages((prev) => (prev.length >= MAX_INTENDED ? prev : [...prev, '']));
  }

  function removeIntendedMessage(idx) {
    setIntendedMessages((prev) => (prev.length === 1 ? [''] : prev.filter((_, i) => i !== idx)));
  }

  async function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    setDocFile(file);
    setDocFileUrl(null);
    setError(null);
    setNotice(null);
    setUploading(true);
    try {
      const result = await uploadDocument(file);
      setDocFileUrl(result.fileUrl);
      // Auto-fill the text field from the file so auto-suggest / launch don't
      // require pasting the same text a second time — user can still edit it.
      if (result.extractedText) {
        setDocText(result.extractedText);
        // Said out loud rather than hidden: the backend caps extracted text, and
        // a report built from part of a document must not look like a report
        // built from all of it.
        if (result.truncated) {
          const kept = result.extractedText.length.toLocaleString('ru-RU');
          const total = (result.extractedLength || 0).toLocaleString('ru-RU');
          setNotice(
            `Документ длиннее допустимого: извлечено ${total} символов, в работу взяты первые ${kept}. ` +
            'Обсуждение и отчёт будут построены по этой части — при необходимости разделите документ.',
          );
        }
      } else {
        setError('Не удалось извлечь текст из файла (например, старый формат .doc) — вставьте текст документа вручную на вкладке «Текст».');
        setSrcTab('text');
      }
    } catch (err) {
      setError(`Ошибка загрузки: ${err.message}`);
    } finally {
      setUploading(false);
    }
  }

  async function handleAutoSuggest() {
    const text = docText.trim();
    if (text.length < 50) {
      setError('Вставьте текст документа (минимум 50 символов) для авто-подбора.');
      return;
    }
    setSuggesting(true);
    setError(null);
    try {
      const suggestionContext = discussionTask.trim()
        ? discussionTask.trim() + '\n\n' + text
        : text;
      const result = await suggestPersonas(suggestionContext, 8);
      const ids = result.personaIds.filter((id) => personas.find((p) => p.id === id));
      if (ids.length === 0) {
        setError('ИИ не смог подобрать персоны. Проверьте текст и попробуйте снова.');
        return;
      }
      setSelectedIds(ids);
    } catch (err) {
      setError(`Ошибка авто-подбора: ${err.message}`);
    } finally {
      setSuggesting(false);
    }
  }

  async function handleLaunch() {
    if (selectedPersonas.length === 0) {
      setError('Выберите хотя бы одну персону.');
      return;
    }
    setLaunching(true);
    setError(null);
    try {
      const title = docFile
        ? docFile.name.replace(/\.[^/.]+$/, '')
        : 'Новая симуляция';

      const project = await createProject({
        title,
        subtitle: discussionTask.trim(),
        personaIds: selectedPersonas.map((p) => p.id),
        // Only send an explicit stance for personas the user actually picked
        // from the dropdown — `personaStances` state only ever gets a key via
        // setPersonaStance(), so this already excludes untouched personas,
        // letting the backend fall through to the LLM-computed per-document
        // stance for the rest.
        personaStances: Object.fromEntries(
          Object.entries(personaStances).filter(([id]) => selectedIds.includes(Number(id)))
        ),
        iterations,
        moderator,
        goal,
        mode,
        intendedMessages: intendedMessages.map((m) => m.trim()).filter(Boolean),
        ...metaPayload(docMeta),
        ...(docFileUrl     && { documentFile: docFileUrl, documentFileName: docFile.name }),
        ...(docText.trim() && { documentText: docText.trim() }),
      });

      onProjectCreated(project.id);
      onGoDiscussion();
    } catch (err) {
      setError(`Ошибка запуска: ${err.message}`);
    } finally {
      setLaunching(false);
    }
  }

  const modeDescription = MODE_OPTIONS.find(([value]) => value === mode)?.[1] ?? '';

  const canAutoSuggest = docText.trim().length >= 50;
  const autoSuggestHint = uploading
    ? 'Дождитесь окончания загрузки файла'
    : canAutoSuggest
      ? 'Подобрать участников по документу'
      : 'Нужен текст документа: загрузите файл или вставьте текст на вкладке «Текст» (минимум 50 символов)';

  const estReplies = selectedPersonas.length * iterations + (moderator ? iterations : 0);

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        {/* ── Заголовок ── */}
        <div className={styles.hero}>
          <span className={styles.kicker}>НОВАЯ СИМУЛЯЦИЯ</span>
          <h1 className={styles.title}>Настройка фокус-группы</h1>
          <p className={styles.subtitle}>
            Загрузите документ, соберите участников и задайте параметры обсуждения.
          </p>
        </div>

        {/* ── I · Документ и вопрос ── */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.kicker}>I</span>
            <h2 className={styles.sectionTitle}>Документ и вопрос</h2>
          </div>
          <div className={styles.docGrid}>
            <div className={styles.docCol}>
              <div className={styles.segment} role="tablist">
                {[['file', 'Файл'], ['text', 'Текст']].map(([key, label]) => (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={srcTab === key}
                    className={`${styles.segmentBtn} ${srcTab === key ? styles.segmentActive : ''}`}
                    onClick={() => setSrcTab(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {srcTab === 'file' ? (
                <div className={styles.dropzone}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx,.doc,.txt,.md"
                    style={{ display: 'none' }}
                    onChange={handleFileChange}
                  />
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M12 18v-6M9 15l3-3 3 3" /></svg>
                  <span className={styles.dropTitle}>
                    {docFile ? docFile.name : 'Перетащите файл сюда'}
                  </span>
                  <span className={styles.dropMeta}>
                    {docFile
                      ? (uploading ? 'Загрузка…' : docFileUrl ? 'Загружен' : 'Ожидание')
                      : 'PDF · DOCX · DOC · TXT · MD — до 20 МБ'}
                  </span>
                  <button
                    className={styles.btnSecondary}
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                  >
                    {uploading ? 'Загрузка…' : docFile ? 'Заменить файл' : 'Выбрать файл'}
                  </button>
                </div>
              ) : (
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Текст документа</span>
                  <textarea
                    className={styles.textarea}
                    placeholder="Вставьте фрагмент документа или тезисы для обсуждения…"
                    value={docText}
                    onChange={(e) => setDocText(e.target.value)}
                  />
                </label>
              )}
            </div>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Вопрос для группы <span className={styles.fieldHint}>— необязательно</span></span>
              <textarea
                className={`${styles.textarea} ${styles.textareaTall}`}
                value={discussionTask}
                onChange={(event) => setDiscussionTask(event.target.value)}
                placeholder="Например: оцените риски для банков Казахстана и предложите улучшения"
              />
            </label>
          </div>

          <div className={styles.intended}>
            <div className={styles.intendedHead}>
              <span className={styles.fieldLabel}>
                Что документ должен донести
                <span className={styles.fieldHint}> — до {MAX_INTENDED} сообщений, необязательно</span>
              </span>
              <span className={styles.headSpacer} />
              {intendedMessages.length < MAX_INTENDED && (
                <button type="button" className={styles.btnSecondary} onClick={addIntendedMessage}>
                  + Сообщение
                </button>
              )}
            </div>
            <p className={styles.intendedNote}>
              Отчёт сравнит задуманное сообщение с тем, что реально поняли участники,
              и покажет расхождение.
            </p>
            {intendedMessages.map((msg, i) => (
              <div key={i} className={styles.intendedRow}>
                <span className={styles.intendedNum}>{i + 1}</span>
                <input
                  type="text"
                  className={styles.input}
                  value={msg}
                  onChange={(e) => setIntendedMessage(i, e.target.value)}
                  placeholder="Например: новые требования не ударят по малому бизнесу"
                />
                <button
                  type="button"
                  className={styles.intendedRemove}
                  aria-label={`Убрать сообщение ${i + 1}`}
                  onClick={() => removeIntendedMessage(i)}
                  disabled={intendedMessages.length === 1 && !msg}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </div>
            ))}
          </div>

          <div className={styles.intended}>
            <div className={styles.intendedHead}>
              <span className={styles.fieldLabel}>
                О документе
                <span className={styles.fieldHint}> — необязательно</span>
              </span>
            </div>
            <p className={styles.intendedNote}>
              Отчёт покажет, для кого текст оказался понятным и совпало ли это с тем, для кого он писался.
            </p>
            <DocumentMetaFields value={docMeta} onChange={setDocMeta} idPrefix="setup-meta" />
          </div>
        </section>

        {/* ── II · Участники ── */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.kicker}>II</span>
            <h2 className={styles.sectionTitle}>Участники</h2>
            <span className={styles.counter}>{selectedPersonas.length} / 8</span>
            <span className={styles.headSpacer} />
            <div className={styles.headActions}>
              <button
                className={styles.btnSecondary}
                onClick={handleAutoSuggest}
                disabled={suggesting || uploading || !canAutoSuggest}
                title={autoSuggestHint}
              >
                {suggesting ? 'Подбираю…' : 'Авто-подбор'}
              </button>
              <button className={styles.btnSecondary} onClick={onGoLibrary}>Из библиотеки</button>
            </div>
          </div>

          <div className={styles.panels}>
            <span className={styles.panelsLabel}>Готовые панели</span>
            {PANELS.map(([label, pattern]) => (
              <button
                key={label}
                type="button"
                className={styles.panelBtn}
                onClick={() => applyPanel(pattern)}
                title={`Собрать панель «${label}» из библиотеки`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className={styles.peopleGrid}>
            {selectedPersonas.map((p) => (
              <div key={p.id} className={styles.personCard}>
                <ChibiBadge persona={p} size={48} />
                <div className={styles.personInfo}>
                  <div className={styles.personTop}>
                    <span className={styles.personName}>{p.name}</span>
                    <span className={styles.personRole}>{p.role}</span>
                  </div>
                  <label className={styles.stanceLabel}>
                    <span className="sr-only">Позиция</span>
                    <select
                      className={styles.stanceSelect}
                      value={stanceFor(p)}
                      onChange={(e) => setPersonaStance(p.id, e.target.value)}
                      title="Позиция персоны в этой дискуссии (только для проекта)"
                    >
                      {STANCE_OPTIONS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <button
                  className={styles.personRemove}
                  aria-label={`Убрать ${p.name} из группы`}
                  onClick={() => togglePersona(p.id)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </div>
            ))}
          </div>

          {otherPersonas.length > 0 && (
            <div className={styles.others}>
              <button className={styles.othersToggle} onClick={() => setOthersOpen((o) => !o)}>
                {othersOpen ? '−' : '+'} Добавить из библиотеки ({otherPersonas.length})
              </button>
              {othersOpen && (
                <div className={styles.othersGrid}>
                  {otherPersonas.map((p) => (
                    <button
                      key={p.id}
                      className={styles.otherCard}
                      onClick={() => togglePersona(p.id)}
                      disabled={selectedPersonas.length >= 8}
                      title={selectedPersonas.length >= 8 ? 'В группе уже 8 участников' : 'Добавить в группу'}
                    >
                      <ChibiBadge persona={p} size={36} />
                      <span className={styles.otherInfo}>
                        <strong>{p.name}</strong>
                        <small>{p.role}</small>
                      </span>
                      <span className={styles.otherPlus}>+</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── III · Параметры обсуждения ── */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.kicker}>III</span>
            <h2 className={styles.sectionTitle}>Параметры обсуждения</h2>
          </div>
          <div className={styles.params}>
            <div className={styles.paramRow}>
              <div className={styles.paramInfo}>
                <span className={styles.paramName}>Цель</span>
                <span className={styles.paramDesc}>Что должна дать дискуссия</span>
              </div>
              <div className={styles.segment} role="radiogroup" aria-label="Цель">
                {GOALS.map(([value, label]) => (
                  <button
                    key={value}
                    role="radio"
                    aria-checked={goal === value}
                    className={`${styles.segmentBtn} ${goal === value ? styles.segmentActive : ''}`}
                    onClick={() => setGoal(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.paramRow}>
              <label className={styles.paramInfo} htmlFor="setup-mode">
                <span className={styles.paramName}>Режим</span>
                <span className={styles.paramDesc}>{modeDescription}</span>
              </label>
              <select
                id="setup-mode"
                className={styles.modeSelect}
                value={mode}
                onChange={(e) => setMode(e.target.value)}
              >
                {MODE_OPTIONS.map(([value]) => <option key={value} value={value}>{value}</option>)}
              </select>
            </div>
            <div className={styles.paramRow}>
              <label className={styles.paramInfo} htmlFor="setup-rounds">
                <span className={styles.paramName}>Раунды</span>
                <span className={styles.paramDesc}>От 1 до 10</span>
              </label>
              <div className={styles.roundsRow}>
                <input
                  id="setup-rounds"
                  type="range"
                  min="1"
                  max="10"
                  step="1"
                  value={iterations}
                  onChange={(e) => setIterations(Number(e.target.value))}
                  className={styles.range}
                />
                <span className={styles.roundsValue}>{iterations}</span>
              </div>
            </div>
            <div className={`${styles.paramRow} ${styles.paramRowLast}`}>
              <div className={styles.paramInfo}>
                <span className={styles.paramName}>Модератор</span>
                <span className={styles.paramDesc}>
                  {mode === 'Интервью'
                    ? 'В режиме «Интервью» модератор открывает раунд вопросом — без него участники говорят свободно'
                    : 'Задаёт уточняющий вопрос, чтобы участники не уходили от темы'}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={moderator}
                aria-label="Модератор"
                className={`${styles.toggle} ${moderator ? styles.toggleOn : ''}`}
                onClick={() => setModerator((m) => !m)}
              >
                <span className={styles.toggleKnob} />
              </button>
            </div>
          </div>
        </section>

        {error && <div className={styles.errorBox}>{error}</div>}
        {notice && <div className={styles.noticeBox}>{notice}</div>}

        {/* ── Итоговая строка ── */}
        <div className={styles.footerRow}>
          <span className={styles.footerMeta}>
            участников {selectedPersonas.length} · раундов {iterations} · ≈ {estReplies} реплик
          </span>
          <span className={styles.headSpacer} />
          <button
            className={styles.btnLaunch}
            onClick={handleLaunch}
            disabled={launching || uploading || selectedPersonas.length === 0}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5l11 7-11 7z" /></svg>
            {launching ? 'Создание симуляции…' : 'Запустить симуляцию'}
          </button>
        </div>
      </div>
    </div>
  );
}
