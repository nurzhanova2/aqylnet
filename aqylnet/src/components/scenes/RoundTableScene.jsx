import styles from './RoundTableScene.module.css';
import ChibiBadge from '../ChibiAvatar/ChibiBadge';

/**
 * RoundTableScene — сцена «круглый стол».
 * Стол с документом в центре, по одному месту (салфетке) на участника,
 * участники по кругу снаружи. Говорящий получает зелёное кольцо, реплику
 * в облачке и пунктирную связь с документом.
 *
 * Координаты мест — проценты от сцены; салфетки идут тем же индексом, что и
 * места, поэтому участник всегда сидит напротив своей салфетки.
 */
const SEAT_POSITIONS = [
  { x: 50,   y: 10 },
  { x: 24,   y: 17 },
  { x: 76,   y: 17 },
  { x: 10,   y: 47 },
  { x: 90,   y: 47 },
  { x: 24,   y: 77 },
  { x: 76,   y: 77 },
  { x: 50,   y: 83 },
];

const MAT_POSITIONS = [
  { x: 50,   y: 28 },
  { x: 34.5, y: 32 },
  { x: 65.5, y: 32 },
  { x: 26,   y: 50 },
  { x: 74,   y: 50 },
  { x: 34.5, y: 68 },
  { x: 65.5, y: 68 },
  { x: 50,   y: 72 },
];

export default function RoundTableScene({
  personas, allPersonas, onSelectPersona,
  activeSpeaker, speakingText, docLabel,
  iterCur, iterMax, messageCount,
  onRemovePersona, removingPersonaId,
}) {
  const speakingIdx = activeSpeaker
    ? personas.findIndex((p) => p.id === activeSpeaker.id)
    : -1;
  const speakingMat = speakingIdx >= 0
    ? MAT_POSITIONS[speakingIdx % MAT_POSITIONS.length]
    : null;

  return (
    <div className={styles.scene}>
      <div className={styles.sceneHead}>
        <span className={styles.roundLabel}>РАУНД {iterCur} / {iterMax}</span>
        <span className={styles.replyCount}>{messageCount} реплик</span>
      </div>

      <div className={styles.table} />
      <div className={styles.tableRing} />

      {personas.map((_, i) => {
        const mat = MAT_POSITIONS[i % MAT_POSITIONS.length];
        return (
          <span
            key={`mat-${i}`}
            className={styles.mat}
            style={{ left: `${mat.x}%`, top: `${mat.y}%` }}
            aria-hidden="true"
          />
        );
      })}

      {/* Связь документа с говорящим. preserveAspectRatio="none" делает
          координаты процентами сцены, а non-scaling-stroke не даёт
          растянуть пунктир вместе с вьюбоксом. */}
      {speakingMat && (
        <svg className={styles.link} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <line
            x1="50" y1="50" x2={speakingMat.x} y2={speakingMat.y}
            stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 3"
            strokeOpacity="0.5" vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}

      <div className={styles.doc}>
        {docLabel && <span className={styles.docLabel}>{docLabel}</span>}
        <span className={styles.docRule} />
        <span className={styles.docLine} style={{ width: '82%' }} />
        <span className={styles.docLine} style={{ width: '94%' }} />
        <span className={styles.docLine} style={{ width: '70%' }} />
        <span className={styles.docLine} style={{ width: '88%' }} />
      </div>

      {personas.map((p, i) => {
        const seat = SEAT_POSITIONS[i % SEAT_POSITIONS.length];
        const speaking = activeSpeaker?.id === p.id;
        const globalIdx = allPersonas ? allPersonas.findIndex((gp) => gp.id === p.id) : i;
        return (
          <div key={p.id} className={styles.seat} style={{ left: `${seat.x}%`, top: `${seat.y}%` }}>
            <button
              className={styles.seatBtn}
              onClick={() => onSelectPersona?.(globalIdx)}
              title={`${p.name} — профиль`}
            >
              <ChibiBadge persona={p} size={64} speaking={speaking} />
              <span className={styles.seatName}>
                <span className={styles.seatDot} style={{ background: p.dot }} />
                {p.name}
              </span>
              <span className={styles.seatRole}>{p.role}</span>
            </button>
            {onRemovePersona && personas.length > 1 && (
              <button
                className={styles.seatRemove}
                onClick={(e) => onRemovePersona(e, p.id)}
                disabled={removingPersonaId === p.id}
                title="Убрать из группы"
                aria-label={`Убрать ${p.name} из группы`}
              >
                {removingPersonaId === p.id ? '…' : '✕'}
              </button>
            )}
            {speaking && speakingText && (
              // Облачко уходит внутрь сцены: от мест левой половины — вправо,
              // от правой — влево, иначе оно вылезает за край стола.
              <div className={`${styles.bubble} ${seat.x > 50 ? styles.bubbleLeft : styles.bubbleRight}`}>
                <span className={styles.bubbleKicker}>ГОВОРИТ · {p.name.toUpperCase()}</span>
                <p className={styles.bubbleText}>{speakingText}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
