import styles from './panels.module.css';
import ChibiBadge from '../ChibiAvatar/ChibiBadge';

/**
 * Лента сообщений дискуссии — по макету simulation.spec:
 * чиби 36px с бордером цвета персоны, имя · роль · время (mono), текст.
 * Реплика модератора — золотая метка вместо чиби.
 */
export default function TimelinePanel({ timeline, personas = [], onSelectPersona }) {
  const personaById = new Map(personas.map((p) => [p.id, p]));
  return (
    <div className={styles.messageList}>
      {timeline.length === 0 && (
        <div className={styles.messagesEmpty}>Запустите раунд, чтобы начать обсуждение…</div>
      )}
      {timeline.map((t) => {
        const isMod = t.speakerType === 'moderator';
        const persona = t.personaId != null
          ? personaById.get(t.personaId) || { name: t.name, dot: t.dot, avatarIdx: t.personaIdx }
          : null;
        return (
          <article key={t.n} className={styles.message}>
            {isMod ? (
              <div className={styles.messageModIcon} aria-hidden="true">⚖</div>
            ) : (
              <button
                className={styles.messageAvatarBtn}
                onClick={() => onSelectPersona?.(t.personaIdx)}
                title={`${t.name} — профиль`}
              >
                <ChibiBadge persona={persona} size={36} color={t.dot} border={1.5} />
              </button>
            )}
            <div className={styles.messageBody}>
              <div className={styles.messageTop}>
                <span className={isMod ? styles.messageNameMod : styles.messageName}>
                  {isMod ? 'Модератор' : t.name}
                </span>
                <span className={styles.messageRole}>{isMod ? 'вопрос группе' : (persona?.role || t.role || '')}</span>
                <span className={styles.messageSpacer} />
                <span className={styles.messageTime}>{t.time}</span>
              </div>
              <p className={styles.messageText}>{t.text}</p>
            </div>
          </article>
        );
      })}
    </div>
  );
}
