import styles from './PersonaDrawer.module.css';
import ChibiBadge from '../ChibiAvatar/ChibiBadge';
import { GROUP_HINTS, groupLabel } from '../../utils/personaGroups';

export default function PersonaDrawer({ persona, onClose }) {
  if (!persona) return null;

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />

      <aside className={styles.drawer}>
        <div className={styles.header}>
          <ChibiBadge persona={persona} size={74} />
          <div className={styles.headerInfo}>
            <div className={styles.headerName}>
              <span className={styles.nameDot} style={{ background: persona.dot }} />
              <span className={styles.name}>{persona.name}</span>
            </div>
            <div className={styles.headerMeta}>
              {persona.role} · {persona.gender} · {persona.age}
            </div>
            <div className={styles.headerMeta} title={persona.group ? GROUP_HINTS[persona.group] : undefined}>
              Группа: {groupLabel(persona.group)}
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div className={styles.body}>
          <div className={styles.infoGrid}>
            <div className={styles.infoCell}>
              <div className={styles.cellLabel}>СТИЛЬ ПОВЕДЕНИЯ</div>
              <div className={styles.cellValue}>{persona.style}</div>
            </div>
            <div className={styles.infoCell}>
              <div className={styles.cellLabel}>УРОВЕНЬ КРИТИЧНОСТИ</div>
              <div className={styles.cellValue}>{persona.criticality}</div>
            </div>
            <div className={`${styles.infoCell} ${styles.spanFull}`}>
              <div className={styles.cellLabel}>МОДЕЛЬ ПОВЕДЕНИЯ</div>
              <div className={styles.cellValue}>{persona.model}</div>
            </div>
          </div>

          <div className={styles.sectionLabel}>ИНТЕРЕСЫ</div>
          <div className={styles.tags}>
            {(persona.interests || []).map((it) => (
              <span key={it} className={styles.tag}>{it}</span>
            ))}
          </div>

          <div className={styles.sectionLabel}>ПОЛНОЕ РАССУЖДЕНИЕ</div>
          <div className={styles.reasoning}>{persona.reasoning}</div>

          <div className={styles.sectionLabel}>ИСПОЛЬЗОВАННЫЙ КОНТЕКСТ</div>
          <div className={styles.contextList}>
            {(persona.context || []).map((c, i) => (
              <div
                key={i}
                className={styles.contextItem}
                style={{ borderLeftColor: persona.dot }}
              >
                <div className={styles.contextSrc}>{c.src}</div>
                <div className={styles.contextQuote}>«{c.quote}»</div>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </>
  );
}
