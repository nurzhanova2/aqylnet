import styles from './LoungeScene.module.css';
import ChibiBadge from '../ChibiAvatar/ChibiBadge';

// Восемь мест по кругу стола, в процентах от сцены.
const RING_POSITIONS = [
  { l: '50%', t: '2%' },
  { l: '78%', t: '14%' },
  { l: '92%', t: '48%' },
  { l: '78%', t: '82%' },
  { l: '50%', t: '94%' },
  { l: '22%', t: '82%' },
  { l: '8%',  t: '48%' },
  { l: '22%', t: '14%' },
];

export default function LoungeScene({ personas, allPersonas, selectedIdx, onSelectPersona }) {
  return (
    <div className={styles.scene}>
      <div className={styles.ring}>
        <div className={styles.table} />
        <div className={styles.tableInner} />

        {personas.map((p, i) => {
          const pos = RING_POSITIONS[i] || { l: '50%', t: '50%' };
          const globalIdx = allPersonas ? allPersonas.findIndex((gp) => gp.id === p.id) : i;
          const isSelected = selectedIdx === globalIdx;
          return (
            <button
              key={p.id}
              className={styles.seatBtn}
              style={{
                left: pos.l,
                top: pos.t,
                filter: isSelected ? `drop-shadow(0 0 14px ${p.dot})` : 'none',
              }}
              onClick={() => onSelectPersona(globalIdx)}
            >
              <ChibiBadge persona={p} size={44} />
              <div className={styles.seatName}>{p.name}</div>
              <div className={styles.seatRole}>{p.role}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
