import styles from './DocumentMetaFields.module.css';
import { DOC_TYPES, audienceForType } from '../../utils/documentMeta';
import { GROUP_HINTS, GROUP_LABELS, PERSONA_GROUPS } from '../../utils/personaGroups';

// The document's type, date and intended audience (A1 stage 2), shared by the
// Setup page and the report's «Кому понятен текст». Controlled: `value` is
// { docType, publishedAt, intendedAudience }. Choosing a type fills in its
// default audience; the author edits it afterwards.

export default function DocumentMetaFields({ value, onChange, idPrefix = 'doc-meta' }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const toggle = (g) => {
    const cur = value.intendedAudience ?? [];
    set({ intendedAudience: cur.includes(g) ? cur.filter((x) => x !== g) : PERSONA_GROUPS.filter((x) => x === g || cur.includes(x)) });
  };
  return (
    <div className={styles.grid}>
      <label className={styles.field} htmlFor={`${idPrefix}-type`}>
        <span className={styles.label}>Тип документа</span>
        <select
          id={`${idPrefix}-type`}
          className={styles.input}
          value={value.docType ?? ''}
          onChange={(e) => {
            const docType = e.target.value || null;
            set({ docType, intendedAudience: docType ? audienceForType(docType, value.intendedAudience ?? []) : value.intendedAudience });
          }}
        >
          <option value="">Не указан</option>
          {DOC_TYPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </label>
      <label className={styles.field} htmlFor={`${idPrefix}-date`}>
        <span className={styles.label}>Дата</span>
        <input
          id={`${idPrefix}-date`}
          type="date"
          className={styles.input}
          value={value.publishedAt ?? ''}
          onChange={(e) => set({ publishedAt: e.target.value || null })}
        />
      </label>
      <div className={styles.field}>
        <span className={styles.label}>Для кого писался</span>
        <div className={styles.chips} role="group" aria-label="Для кого писался документ">
          {PERSONA_GROUPS.map((g) => {
            const on = (value.intendedAudience ?? []).includes(g);
            return (
              <button
                key={g}
                type="button"
                aria-pressed={on}
                title={GROUP_HINTS[g]}
                className={`${styles.chip} ${on ? styles.chipOn : ''}`}
                onClick={() => toggle(g)}
              >
                {GROUP_LABELS[g]}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
