import styles from './Sidebar.module.css';

/* SVG-иконки рейла — из макетов redesign */
function IconPlay() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 5l11 7-11 7z" />
    </svg>
  );
}

function IconFolder() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

function IconPeople() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" />
      <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.2 2.5 3.6 5.2" />
    </svg>
  );
}

function IconBars() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M4 20V11M10 20V5M16 20v-6M21 20H3" />
    </svg>
  );
}

const NAV_ITEMS = [
  { Icon: IconPlay, label: 'Симуляция', screen: 'discussion' },
  { Icon: IconFolder, label: 'Проекты', screen: 'projects' },
  { Icon: IconPeople, label: 'Персоны', screen: 'library' },
  { Icon: IconBars, label: 'Отчёты', screen: 'analytics' },
];

export default function Sidebar({ screen, onNavigate }) {
  return (
    <nav aria-label="Разделы" className={styles.sidebar}>
      {NAV_ITEMS.map(({ Icon, label, screen: target }) => {
        const active = screen === target || (target === 'discussion' && screen === 'setup');
        return (
          <button
            key={target}
            className={`${styles.navBtn} ${active ? styles.active : ''}`}
            aria-current={active ? 'page' : undefined}
            onClick={() => onNavigate(target)}
          >
            <span className={styles.navIcon}><Icon /></span>
            <span className={styles.navLabel}>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
