import styles from './SchemaScene.module.css';
import ChibiBadge from '../ChibiAvatar/ChibiBadge';

export default function SchemaScene({ personas, allPersonas, onSelectPersona, personaStatus }) {
  return (
    <div className={styles.scene}>
      <div className={styles.heading}>КАРТА МНЕНИЙ · {personas.length} участников</div>
      <div className={styles.grid}>
        {personas.map((p) => {
          const globalIdx = allPersonas ? allPersonas.findIndex((gp) => gp.id === p.id) : -1;
          // personaStatus is optional so this scene still renders sensibly
          // wherever it might be reused without a live discussion behind it.
          const status = personaStatus ? personaStatus(p) : { kind: 'message', text: p.thinking };
          return (
          <button key={p.id} className={styles.card} style={{ borderLeftColor: p.dot }} onClick={() => onSelectPersona(globalIdx)}>
            <div className={styles.cardHeader}>
              <ChibiBadge persona={p} size={36} />
              <div>
                <div className={styles.cardName}>{p.name}</div>
                <div className={styles.cardRole}>{p.role}</div>
              </div>
            </div>
            <div className={`${styles.thinking} ${status.kind !== 'message' ? styles.thinkingMuted : ''}`}>
              {status.text}
            </div>
            <div className={styles.tags}>
              <span className={styles.tag}>{p.style}</span>
              <span className={styles.tag}>крит. {p.criticality}</span>
            </div>
          </button>
          );
        })}
      </div>
    </div>
  );
}
