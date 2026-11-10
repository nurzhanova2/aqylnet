import { useState } from 'react';
import { GROUP_HINTS, GROUP_LABELS, PERSONA_GROUPS, groupLabel } from '../../utils/personaGroups';
import styles from './LibraryPage.module.css';
import ChibiAvatar from '../../components/ChibiAvatar/ChibiAvatar';
import ChibiBadge from '../../components/ChibiAvatar/ChibiBadge';
import { fallbackLook, LOOK_STYLES } from '../../utils/personaLook';
import { createPersona, updatePersona, deletePersona } from '../../api';

// ─── Константы опций ──────────────────────────────────────────
const DOT_COLORS = ['#E6C77F','#36C988','#f472b6','#60a5fa','#C59A3D','#2dd4bf','#fb923c','#818cf8'];

/* Палитры кастомизации внешности (гамма Heritage) */
const SKIN_SWATCHES = ['#F8DCC6','#F6D2B8','#F1CFB4','#EBC29E','#E4B892','#B9835C'];
const HAIR_SWATCHES = ['#1C1412','#1E1A18','#2A1C17','#3A2620','#4A2C22','#6B645E','#C9C4BE','#E2B867'];
const OUTFIT_SWATCHES = ['#174B34','#1F6347','#2E7D68','#3D7F86','#2F5D8C','#3E6FB0','#7C5CC4','#7A4E6B','#B07F2A','#B4563A'];
const STYLE_LABELS = { short: 'Короткие', long: 'Длинные', bob: 'Каре', bun: 'Пучок', spiky: 'Ёжик' };

const OPTIONS = {
  style:         ['Эмоциональный','Аналитический','Прагматичный','Критический','Осторожный'],
  criticality:   ['Низкий','Средний','Высокий'],
  behaviorModel: ['Наблюдатель','Скептик','Защитник интересов','Эксперт','Провокатор','Сторонник'],
  education:     ['Среднее','Высшее','MBA','Научная степень'],
  industry:      ['Финансы','Образование','IT','Здравоохранение','Госслужба','МСБ','Другое'],
  employerType:  ['Госслужащий','Частный бизнес','Самозанятый','Пенсионер','Студент'],
  income:        ['Низкий','Средний','Высокий'],
  openness:      ['Консервативный','Нейтральный','Прогрессивный'],
  decisionMaking:['Интуитивный','Аналитический','Эмоциональный','Консервативный'],
  stance:        ['Поддерживает','Против','Нейтральный','Неопределившийся'],
  speechTone:    ['Официальный','Разговорный','Эмоциональный','Академический'],
  argumentation: ['Факты и цифры','Личный опыт','Эмоции','Ссылки на авторитеты'],
  responseLength:['Краткий','Средний','Развёрнутый'],
};

const INIT = {
  name:'', role:'', gender:'Мужской', age:'',
  city:'', education:'',
  industry:'', employerType:'', income:'', group:'',
  style:'', criticality:'', behaviorModel:'',
  openness:'', decisionMaking:'',
  stance:'', priority:'', fears:'', personalSituation:'',
  speechTone:'', argumentation:'', responseLength:'Средний', typicalPhrases:'',
  thinking:'', reasoning:'', interests:'',
  avatarIdx: 0, dot: DOT_COLORS[0],
  look: fallbackLook({ gender: 'Мужской', avatarIdx: 0, dot: DOT_COLORS[0] }),
};

// ─── Вспомогательные компоненты ───────────────────────────────
function SectionLabel({ children }) {
  return <div className={styles.sectionLabel}>{children}</div>;
}

function FieldLabel({ children }) {
  return <div className={styles.fieldLabel}>{children}</div>;
}

function TextInput({ value, onChange, placeholder }) {
  return (
    <input
      className={styles.formInput}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

function TextArea({ value, onChange, placeholder, rows = 3 }) {
  return (
    <textarea
      className={styles.formTextarea}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      // The global `box-sizing: border-box` makes the browser's own `rows`
      // sizing subtract padding and border from the text area instead of
      // adding them, so a rows={2} box renders barely over one line tall and
      // its content spills onto the next field's label. --rows feeds the real
      // line count to the stylesheet, which adds the chrome back on.
      style={{ '--rows': rows }}
    />
  );
}

function Select({ value, onChange, options, placeholder }) {
  return (
    <select className={styles.formSelect} value={value} onChange={e => onChange(e.target.value)}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function GenderToggle({ value, onChange }) {
  return (
    <div className={styles.genderRow}>
      {['Мужской','Женский'].map(g => (
        <button
          key={g}
          type="button"
          className={`${styles.genderOpt} ${value === g ? styles.genderActive : ''}`}
          onClick={() => onChange(g)}
        >
          {g}
        </button>
      ))}
    </div>
  );
}

function SwatchRow({ colors, value, onChange, label }) {
  return (
    <div className={styles.swatchBlock}>
      <FieldLabel>{label}</FieldLabel>
      <div className={styles.swatchRow} role="radiogroup" aria-label={label}>
        {colors.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={value === c}
            className={`${styles.swatch} ${value === c ? styles.swatchActive : ''}`}
            style={{ background: c }}
            onClick={() => onChange(c)}
            title={c}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Главный компонент ────────────────────────────────────────
export default function LibraryPage({
  personas, onSelectPersona, onPersonaCreated,
  hasActiveProject, addingPersonaId, addPersonaError, onAddToProject,
}) {
  const [form, setForm]       = useState(INIT);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null); // null = creating a new persona, else id being edited
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState(null);
  const [success, setSuccess] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');

  const filterOptions = [
    { id: 'all', label: 'Все' },
    { id: 'analytical', label: 'Аналитический', terms: ['аналит'] },
    { id: 'critical', label: 'Критический', terms: ['крит'] },
    { id: 'practical', label: 'Практичный', terms: ['прагмат', 'практ'] },
    { id: 'observer', label: 'Наблюдатель', terms: ['наблюд'] },
    { id: 'skeptic', label: 'Скептик', terms: ['скепт'] },
    { id: 'neutral', label: 'Нейтральный', terms: ['нейтр'] },
  ];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const selectedFilter = filterOptions.find((item) => item.id === activeFilter);
  const visiblePersonas = personas
    .map((persona, originalIndex) => ({ persona, originalIndex }))
    .filter(({ persona }) => {
      const searchable = [persona.name, persona.role, persona.thinking, persona.style, persona.criticality, persona.model, persona.stance, persona.group && groupLabel(persona.group)]
        .filter(Boolean).join(' ').toLocaleLowerCase();
      const matchesQuery = !normalizedQuery || searchable.includes(normalizedQuery);
      const matchesFilter = activeFilter === 'all' || selectedFilter?.terms?.some((term) => searchable.includes(term));
      return matchesQuery && matchesFilter;
    });

  function set(key) {
    return (val) => setForm(f => ({ ...f, [key]: val }));
  }

  function setLook(key) {
    return (val) => setForm(f => ({ ...f, look: { ...f.look, [key]: val } }));
  }

  function handleCreateNew() {
    setEditingId(null);
    setForm(INIT);
    setError(null);
    setSuccess(false);
    setFormOpen(true);
  }

  function handleEdit(p) {
    setEditingId(p.id);
    setForm({
      // `?? ''` везде: null из API ломал controlled-инпуты (React warning +
      // «залипание» значения), а age может прийти числом — приводим к строке,
      // иначе .trim() в валидации падает с TypeError.
      name: p.name ?? '', role: p.role ?? '', gender: p.gender || 'Мужской',
      age: p.age == null ? '' : String(p.age),
      city: p.city ?? '', education: p.education ?? '',
      industry: p.industry ?? '', employerType: p.employerType ?? '', income: p.income ?? '',
      group: p.group ?? '',
      style: p.style ?? '', criticality: p.criticality ?? '', behaviorModel: p.model ?? '',
      openness: p.openness ?? '', decisionMaking: p.decisionMaking ?? '',
      stance: p.stance ?? '', priority: p.priority ?? '', fears: p.fears ?? '', personalSituation: p.personalSituation ?? '',
      speechTone: p.speechTone ?? '', argumentation: p.argumentation ?? '',
      responseLength: p.responseLength || 'Средний', typicalPhrases: p.typicalPhrases ?? '',
      thinking: p.thinking ?? '', reasoning: p.reasoning ?? '', interests: (p.interests || []).join(', '),
      avatarIdx: p.avatarIdx ?? 0, dot: p.dot || DOT_COLORS[0],
      // Для старых персон без look — детерминированный fallback
      look: p.look && p.look.skin ? { glasses: false, ...p.look } : fallbackLook(p),
    });
    setError(null);
    setSuccess(false);
    setMenuOpenId(null);
    setFormOpen(true);
  }

  function handleCancelEdit() {
    setEditingId(null);
    setForm(INIT);
    setError(null);
    setFormOpen(false);
  }

  async function handleSave() {
    // Обязательные поля backend-валидатора: name, role, gender, age, dot,
    // style, criticality, behaviorModel (иначе 400). age приводим к строке —
    // защита от TypeError при редактировании персоны с числовым age.
    const required = {
      name: form.name, role: form.role, age: String(form.age ?? ''),
      style: form.style, criticality: form.criticality, behaviorModel: form.behaviorModel,
    };
    if (Object.values(required).some((v) => !String(v).trim()) || !form.gender || !form.dot) {
      setError('Заполните обязательные поля: имя, роль, возраст, стиль, критичность, модель поведения.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...form,
        age: String(form.age).trim(),
        look: { ...form.look, glasses: Boolean(form.look?.glasses) },
        // '' in the form is "не задана" — the API takes null for that.
        group: form.group || null,
        interests: form.interests
          ? form.interests.split(',').map(s => s.trim()).filter(Boolean)
          : [],
      };
      if (editingId) {
        await updatePersona(editingId, payload);
      } else {
        await createPersona({ ...payload, contexts: [] });
      }
      setSuccess(true);
      setForm(INIT);
      setEditingId(null);
      setFormOpen(false);
      onPersonaCreated?.();
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(e, id) {
    e.stopPropagation();
    setMenuOpenId(null);
    if (!window.confirm('Удалить персону без возможности восстановления?')) return;
    setDeletingId(id);
    setError(null);
    try {
      await deletePersona(id);
      if (editingId === id) handleCancelEdit();
      onPersonaCreated?.();
    } catch (err) {
      setError(`Не удалось удалить: ${err.message}`);
    } finally {
      setDeletingId(null);
    }
  }

  const previewPersona = { name: form.name || 'Персона', dot: form.dot, look: form.look };

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        {/* ── Шапка ── */}
        <div className={styles.header}>
          <div className={styles.headerTitles}>
            <span className={styles.kicker}>БИБЛИОТЕКА · {personas.length} ПЕРСОН</span>
            <h1 className={styles.title}>Персоны</h1>
          </div>
          <span className={styles.headSpacer} />
          <label className={styles.search}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <span className="sr-only">Поиск</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Имя, роль или описание"
            />
          </label>
          <button className={styles.btnPrimary} onClick={handleCreateNew}>Создать персону</button>
        </div>

        {/* ── Фильтры ── */}
        <div className={styles.filters} role="tablist" aria-label="Тип мышления">
          {filterOptions.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={activeFilter === item.id}
              className={`${styles.filterTab} ${activeFilter === item.id ? styles.filterActive : ''}`}
              onClick={() => setActiveFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {(addPersonaError || (error && !formOpen)) && (
          <div className={styles.errorMsg}>{addPersonaError || error}</div>
        )}
        {success && <div className={styles.successMsg}>Сохранено!</div>}

        {/* ── Грид карточек ── */}
        <div className={styles.grid}>
          {visiblePersonas.map(({ persona: p, originalIndex: i }) => (
            <article key={p.id} className={styles.card}>
              <div className={styles.cardHead}>
                <button className={styles.cardAvatarBtn} onClick={() => onSelectPersona(i)} title="Профиль">
                  <ChibiBadge persona={p} size={56} />
                </button>
                <div className={styles.cardTitles}>
                  <span className={styles.cardName}>{p.name}</span>
                  <span className={styles.cardMeta}>{p.role}{p.age ? ` · ${p.age}` : ''}</span>
                </div>
              </div>
              <p className={styles.cardQuote}>«{p.thinking}»</p>
              <div className={styles.cardFoot}>
                <div className={styles.cardChips}>
                  {p.group && <span className={styles.chip} title={GROUP_HINTS[p.group]}>{groupLabel(p.group)}</span>}
                  {p.style && <span className={styles.chip}>{p.style}</span>}
                  {p.stance && <span className={styles.chip}>{p.stance}</span>}
                </div>
                <div className={styles.cardActions}>
                  <button
                    className={styles.btnAdd}
                    onClick={() => onAddToProject(p.id)}
                    disabled={addingPersonaId === p.id}
                    title={hasActiveProject ? 'Добавить в текущий проект' : 'Нет активного проекта — откроется настройка новой симуляции'}
                  >
                    {addingPersonaId === p.id ? '…' : '+ В группу'}
                  </button>
                  <div className={styles.kebabWrap}>
                    <button
                      className={styles.kebab}
                      aria-label="Ещё действия"
                      aria-expanded={menuOpenId === p.id}
                      onClick={() => setMenuOpenId(menuOpenId === p.id ? null : p.id)}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>
                    </button>
                    {menuOpenId === p.id && (
                      <div className={styles.menu} role="menu">
                        <button role="menuitem" onClick={() => { setMenuOpenId(null); onSelectPersona(i); }}>Профиль</button>
                        <button role="menuitem" onClick={() => handleEdit(p)}>Редактировать</button>
                        <button
                          role="menuitem"
                          className={styles.menuDanger}
                          onClick={(e) => handleDelete(e, p.id)}
                          disabled={deletingId === p.id}
                        >
                          {deletingId === p.id ? 'Удаление…' : 'Удалить'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
        {visiblePersonas.length === 0 && (
          <div className={styles.empty}>Персоны по заданным условиям не найдены.</div>
        )}
      </div>

      {/* ── Панель создания/редактирования ── */}
      {formOpen && (
        <>
          <div className={styles.formBackdrop} onClick={handleCancelEdit} />
          <aside className={styles.formPanel}>
            <div className={styles.formHead}>
              <span className={styles.kicker}>{editingId ? 'РЕДАКТИРОВАНИЕ ПЕРСОНЫ' : 'СОЗДАНИЕ ПЕРСОНЫ'}</span>
              <span className={styles.headSpacer} />
              <button className={styles.kebab} onClick={handleCancelEdit} aria-label="Закрыть">✕</button>
            </div>

            <div className={styles.formBody}>
              {/* ── Внешность ── */}
              <SectionLabel>ВНЕШНОСТЬ</SectionLabel>
              <div className={styles.lookRow}>
                <div className={styles.lookPreview}>
                  <ChibiBadge persona={previewPersona} size={104} />
                </div>
                <div className={styles.lookControls}>
                  <FieldLabel>ПРИЧЁСКА</FieldLabel>
                  <div className={styles.styleRow} role="radiogroup" aria-label="Причёска">
                    {LOOK_STYLES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        role="radio"
                        aria-checked={form.look.style === s}
                        className={`${styles.styleOpt} ${form.look.style === s ? styles.styleOptActive : ''}`}
                        onClick={() => setLook('style')(s)}
                        title={STYLE_LABELS[s]}
                      >
                        <ChibiAvatar look={{ ...form.look, style: s }} size={34} label={STYLE_LABELS[s]} />
                      </button>
                    ))}
                  </div>
                  <label className={styles.glassesRow}>
                    <input
                      type="checkbox"
                      checked={Boolean(form.look.glasses)}
                      onChange={(e) => setLook('glasses')(e.target.checked)}
                    />
                    <span>Очки</span>
                  </label>
                </div>
              </div>
              <SwatchRow label="ЦВЕТ КОЖИ" colors={SKIN_SWATCHES} value={form.look.skin} onChange={setLook('skin')} />
              <SwatchRow label="ЦВЕТ ВОЛОС" colors={HAIR_SWATCHES} value={form.look.hair} onChange={setLook('hair')} />
              <SwatchRow label="ОДЕЖДА" colors={OUTFIT_SWATCHES} value={form.look.outfit} onChange={setLook('outfit')} />
              <SwatchRow label="ЦВЕТ МЕТКИ" colors={DOT_COLORS} value={form.dot} onChange={set('dot')} />

              {/* ── 1. Демография ── */}
              <SectionLabel>1 · ДЕМОГРАФИЯ</SectionLabel>

              <FieldLabel>ИМЯ *</FieldLabel>
              <TextInput value={form.name} onChange={set('name')} placeholder="Айгерим" />

              <FieldLabel>ПОЛ *</FieldLabel>
              <GenderToggle value={form.gender} onChange={set('gender')} />

              <FieldLabel>ВОЗРАСТ *</FieldLabel>
              <TextInput value={form.age} onChange={set('age')} placeholder="34 года" />

              <FieldLabel>ГОРОД</FieldLabel>
              <TextInput value={form.city} onChange={set('city')} placeholder="Алматы" />

              <FieldLabel>ОБРАЗОВАНИЕ</FieldLabel>
              <Select value={form.education} onChange={set('education')} options={OPTIONS.education} placeholder="Выберите…" />

              {/* ── 2. Профессия ── */}
              <SectionLabel>2 · ПРОФЕССИЯ</SectionLabel>

              <FieldLabel>РОЛЬ / ПРОФЕССИЯ *</FieldLabel>
              <TextInput value={form.role} onChange={set('role')} placeholder="Врач, предприниматель…" />

              <FieldLabel>ОТРАСЛЬ</FieldLabel>
              <Select value={form.industry} onChange={set('industry')} options={OPTIONS.industry} placeholder="Выберите…" />

              <FieldLabel>ТИП ЗАНЯТОСТИ</FieldLabel>
              <Select value={form.employerType} onChange={set('employerType')} options={OPTIONS.employerType} placeholder="Выберите…" />

              <FieldLabel>ГРУППА</FieldLabel>
              <select className={styles.formSelect} value={form.group} onChange={(e) => set('group')(e.target.value)}>
                <option value="">Не задана</option>
                {PERSONA_GROUPS.map((g) => <option key={g} value={g}>{GROUP_LABELS[g]} — {GROUP_HINTS[g]}</option>)}
              </select>

              <FieldLabel>УРОВЕНЬ ДОХОДА</FieldLabel>
              <Select value={form.income} onChange={set('income')} options={OPTIONS.income} placeholder="Выберите…" />

              {/* ── 3. Психологический профиль ── */}
              <SectionLabel>3 · ПСИХОЛОГИЧЕСКИЙ ПРОФИЛЬ</SectionLabel>

              <FieldLabel>СТИЛЬ ПОВЕДЕНИЯ *</FieldLabel>
              <Select value={form.style} onChange={set('style')} options={OPTIONS.style} placeholder="Выберите…" />

              <FieldLabel>УРОВЕНЬ КРИТИЧНОСТИ *</FieldLabel>
              <Select value={form.criticality} onChange={set('criticality')} options={OPTIONS.criticality} placeholder="Выберите…" />

              <FieldLabel>МОДЕЛЬ ПОВЕДЕНИЯ *</FieldLabel>
              <Select value={form.behaviorModel} onChange={set('behaviorModel')} options={OPTIONS.behaviorModel} placeholder="Выберите…" />

              <FieldLabel>ОТКРЫТОСТЬ К ИЗМЕНЕНИЯМ</FieldLabel>
              <Select value={form.openness} onChange={set('openness')} options={OPTIONS.openness} placeholder="Выберите…" />

              <FieldLabel>ПРИНЯТИЕ РЕШЕНИЙ</FieldLabel>
              <Select value={form.decisionMaking} onChange={set('decisionMaking')} options={OPTIONS.decisionMaking} placeholder="Выберите…" />

              {/* ── 4. Позиция по теме ── */}
              <SectionLabel>4 · ПОЗИЦИЯ ПО ТЕМЕ</SectionLabel>

              <FieldLabel>ПОЗИЦИЯ</FieldLabel>
              <Select value={form.stance} onChange={set('stance')} options={OPTIONS.stance} placeholder="Выберите…" />

              <FieldLabel>ГЛАВНЫЙ ПРИОРИТЕТ</FieldLabel>
              <TextArea value={form.priority} onChange={set('priority')} placeholder="Что важнее всего для этой персоны в контексте темы…" rows={2} />

              <FieldLabel>ОПАСЕНИЯ / СТРАХИ</FieldLabel>
              <TextArea value={form.fears} onChange={set('fears')} placeholder="Чего боится в связи с темой…" rows={2} />

              <FieldLabel>ЛИЧНАЯ СИТУАЦИЯ</FieldLabel>
              <TextArea value={form.personalSituation} onChange={set('personalSituation')} placeholder="1–2 предложения о жизненном контексте: берёт ипотеку, владеет МСБ…" rows={2} />

              {/* ── 5. Стиль речи ── */}
              <SectionLabel>5 · СТИЛЬ РЕЧИ</SectionLabel>

              <FieldLabel>ТОН РЕЧИ</FieldLabel>
              <Select value={form.speechTone} onChange={set('speechTone')} options={OPTIONS.speechTone} placeholder="Выберите…" />

              <FieldLabel>СТИЛЬ АРГУМЕНТАЦИИ</FieldLabel>
              <Select value={form.argumentation} onChange={set('argumentation')} options={OPTIONS.argumentation} placeholder="Выберите…" />

              <FieldLabel>ДЛИНА ОТВЕТОВ</FieldLabel>
              <Select value={form.responseLength} onChange={set('responseLength')} options={OPTIONS.responseLength} />

              <FieldLabel>ХАРАКТЕРНЫЕ ФРАЗЫ</FieldLabel>
              <TextInput value={form.typicalPhrases} onChange={set('typicalPhrases')} placeholder="«Покажите мне цифры»" />

              {/* ── 6. AI-контент ── */}
              <SectionLabel>6 · AI-КОНТЕНТ</SectionLabel>

              <FieldLabel>КРАТКАЯ МЫСЛЬ (цитата на карточке)</FieldLabel>
              <TextInput value={form.thinking} onChange={set('thinking')} placeholder="Меня беспокоит влияние на комиссии…" />

              <FieldLabel>РАССУЖДЕНИЕ (профиль)</FieldLabel>
              <TextArea value={form.reasoning} onChange={set('reasoning')} placeholder="Полное рассуждение от лица персоны…" rows={4} />

              <FieldLabel>ИНТЕРЕСЫ (через запятую)</FieldLabel>
              <TextInput value={form.interests} onChange={set('interests')} placeholder="МСБ, Ипотека, Образование" />

              {error && <div className={styles.errorMsg}>{error}</div>}
            </div>

            <div className={styles.formFoot}>
              <button
                className={styles.btnPrimary}
                onClick={handleSave}
                disabled={saving}
                style={{ flex: 1, opacity: saving ? 0.6 : 1 }}
              >
                {saving ? 'Сохранение…' : editingId ? 'Сохранить изменения' : 'Создать персону'}
              </button>
              <button className={styles.btnGhost} onClick={handleCancelEdit}>Отмена</button>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
