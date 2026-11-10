import { useEffect, useMemo, useState } from 'react';
import styles from './ProjectsPage.module.css';
import ChibiBadge from '../../components/ChibiAvatar/ChibiBadge';
import { deleteProject, fetchProjects } from '../../api';

// Три статуса, не четыре: 'finished' никогда не существовал в коде — его никто
// не записывал, ни одна строка его не держит, и ярлык для него был ярлыком для
// недостижимого состояния.
const STATUS_LABELS = {
  setup: 'Настройка',
  running: 'В процессе',
  completed: 'Завершён',
};

const GOAL_LABELS = {
  risk_search: 'Поиск рисков',
  consensus: 'Консенсус',
};

const FILTERS = [
  ['all', 'Все'],
  ['running', 'В процессе'],
  ['completed', 'Завершённые'],
];

const PROJECTS_CACHE_KEY = 'aqylnet:projectsCache';

function loadCachedProjects() {
  try {
    const value = JSON.parse(sessionStorage.getItem(PROJECTS_CACHE_KEY) || 'null');
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' '
    + date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function isCompleted(status) {
  // Only 'completed' exists: nothing in the backend ever wrote 'finished' and
  // no row holds it. The DTO also reports a counter-complete project as
  // completed regardless of the stored string, so this needs no fallback.
  return status === 'completed';
}

function projectMatchesFilter(project, filter) {
  if (filter === 'all') return true;
  if (filter === 'completed') return isCompleted(project.status);
  // 'running' — всё, что ещё не завершено (включая проекты в настройке)
  return !isCompleted(project.status);
}

export default function ProjectsPage({ currentProjectId, onSelectProject, onGoSetup }) {
  const [projects, setProjects] = useState(loadCachedProjects);
  const [error, setError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');

  function load() {
    setError(null);
    fetchProjects().then((incoming) => {
      setProjects((current) => {
        const activeCached = current?.find((item) => item.id === currentProjectId);
        const activeReturned = incoming.some((item) => item.id === currentProjectId);
        const next = activeCached && !activeReturned
          ? [activeCached, ...incoming]
          : incoming;
        sessionStorage.setItem(PROJECTS_CACHE_KEY, JSON.stringify(next));
        return next;
      });
    }).catch((err) => setError(err.message));
  }

  useEffect(load, [currentProjectId]);

  const visibleProjects = useMemo(() => {
    if (!projects) return [];
    const normalizedQuery = query.trim().toLocaleLowerCase('ru-RU');
    return projects
      .slice()
      .filter((project) => projectMatchesFilter(project, filter))
      .filter((project) => !normalizedQuery
        || project.title?.toLocaleLowerCase('ru-RU').includes(normalizedQuery)
        || project.subtitle?.toLocaleLowerCase('ru-RU').includes(normalizedQuery))
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  }, [filter, projects, query]);

  async function handleDelete(event, id) {
    event.stopPropagation();
    event.preventDefault();
    if (!window.confirm('Удалить проект без возможности восстановления?')) return;
    setDeletingId(id);
    setError(null);
    try {
      await deleteProject(id);
      setProjects((current) => {
        const next = current.filter((project) => project.id !== id);
        sessionStorage.setItem(PROJECTS_CACHE_KEY, JSON.stringify(next));
        return next;
      });
    } catch (err) {
      setError('Не удалось удалить проект: ' + err.message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        {/* ── Шапка ── */}
        <header className={styles.header}>
          <div className={styles.headerTitles}>
            <span className={styles.kicker}>
              ПРОЕКТЫ{projects ? ` · ${projects.length}` : ''}
            </span>
            <h1 className={styles.title}>Мои симуляции</h1>
          </div>
          <span className={styles.spacer} />
          <button className={styles.btnNew} onClick={onGoSetup}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            Новая симуляция
          </button>
        </header>

        {/* ── Поиск и фильтры ── */}
        <section className={styles.toolbar} aria-label="Фильтры проектов">
          <label className={styles.search}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <span className="sr-only">Поиск</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск по названию"
            />
          </label>
          <div className={styles.filters} role="tablist">
            {FILTERS.map(([value, label]) => (
              <button
                key={value}
                role="tab"
                aria-selected={filter === value}
                className={`${styles.filterTab} ${filter === value ? styles.filterActive : ''}`}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        {error && <div className={styles.errorBox}>{error}<button onClick={load}>Повторить</button></div>}

        {projects === null && !error && (
          <div className={styles.loading}>Загрузка проектов…</div>
        )}

        {/* ── Таблица ── */}
        {projects && (
          <div className={styles.tableWrap}>
            <div className={styles.tableMin}>
              <div className={styles.tableHead}>
                <span>ПРОЕКТ</span><span>СТАТУС</span><span>УЧАСТНИКИ</span><span>РАУНДЫ</span><span>СОЗДАН</span><span />
              </div>
              {visibleProjects.map((project) => {
                const completed = isCompleted(project.status);
                const iterations = Math.max(Number(project.iterations) || 0, 0);
                const currentIteration = Math.max(Number(project.currentIteration) || 0, 0);
                const pct = iterations > 0 ? Math.min(100, Math.round((currentIteration / iterations) * 100)) : 0;
                const faces = Array.isArray(project.personas) ? project.personas.slice(0, 4) : [];
                const extra = (project.personaCount || 0) - faces.length;
                return (
                  <div
                    key={project.id}
                    className={`${styles.row} ${project.id === currentProjectId ? styles.rowActive : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectProject(project.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') onSelectProject(project.id);
                    }}
                  >
                    <span className={styles.cellProject}>
                      <span className={styles.projectName}>{project.title}</span>
                      <span className={styles.projectGoal}>{GOAL_LABELS[project.goal] || project.goal}</span>
                    </span>
                    {/* Три состояния — три формы метки: завершён и идёт дают
                        залитый круг, настройка — пустой круг с пунктиром. */}
                    <span className={`${styles.statusPill} ${completed ? styles.statusDone : project.status === 'setup' ? styles.statusWait : styles.statusRun}`}>
                      <span className={styles.statusDot} />
                      {STATUS_LABELS[project.status] || project.status}
                    </span>
                    <span className={styles.cellFaces}>
                      {faces.length > 0 ? (
                        <>
                          {faces.map((p) => (
                            <span key={p.id} className={styles.face}>
                              <ChibiBadge persona={p} size={30} color="#0A1A13" border={2} />
                            </span>
                          ))}
                          {extra > 0 && <span className={styles.facesExtra}>+{extra}</span>}
                        </>
                      ) : (
                        <span className={styles.facesExtra}>{project.personaCount || 0} персон</span>
                      )}
                    </span>
                    <span className={styles.cellRounds}>
                      <span className={styles.progressTrack}>
                        <span className={styles.progressFill} style={{ width: `${pct}%` }} />
                      </span>
                      <span className={styles.roundsText}>{currentIteration} / {iterations}</span>
                    </span>
                    <span className={styles.cellDate}>{formatDate(project.updatedAt)}</span>
                    <button
                      className={styles.rowDelete}
                      onClick={(event) => handleDelete(event, project.id)}
                      disabled={deletingId === project.id}
                      title="Удалить проект"
                      aria-label="Удалить проект"
                    >
                      {deletingId === project.id ? '…' : '✕'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {projects && visibleProjects.length === 0 && (
          <div className={styles.empty}>
            <strong>Проекты не найдены</strong>
            <span>Измените запрос или выберите другой фильтр.</span>
          </div>
        )}
      </div>
    </div>
  );
}
