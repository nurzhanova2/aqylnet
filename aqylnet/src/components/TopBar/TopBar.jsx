import styles from './TopBar.module.css';
import NbkLogo from '../NbkLogo/NbkLogo';

export function playLabel({ isGenerating, isRevealing, iterCur, iterMax, isCompleted }) {
  if (isCompleted || iterCur >= iterMax) return 'Завершено';
  if (isGenerating) return 'Генерация…';
  if (isRevealing) return 'Показ ответов…';
  if (iterCur >= iterMax) return 'Завершено';
  if (iterCur <= 0) return 'Запустить';
  return 'Продолжить';
}

/**
 * Full LiteLLM ids ("Qwen/Qwen3.5-35B-A3B-FP8") crowd out the breadcrumb and
 * say nothing a reader needs: the vendor prefix repeats the model name and the
 * quantisation suffix is a deployment detail. Keep the family and size.
 */
export function shortModel(model) {
  if (!model || model === '—') return null;
  const tail = model.split('/').pop();
  return tail.replace(/-(?:FP|INT|AWQ|GPTQ|Q)\d*(?:_\w+)?$/i, '').toLowerCase();
}

/** Хлебные крошки для текущего экрана (state-навигация). */
function crumbsFor(screen, title) {
  switch (screen) {
    case 'projects': return [{ label: 'Проекты' }];
    case 'library': return [{ label: 'Библиотека персон' }];
    case 'setup': return [{ label: 'Проекты', screen: 'projects' }, { label: 'Новая симуляция' }];
    case 'analytics': return [{ label: 'Проекты', screen: 'projects' }, { label: title, screen: 'discussion' }, { label: 'Отчёт' }];
    default: return [{ label: 'Проекты', screen: 'projects' }, { label: title }];
  }
}

export default function TopBar({
  screen, onNavigate,
  title, model,
  iterCur, iterMax, playDisabled,
  isGenerating, isRevealing,
  isCompleted,
  onRunIteration, onFinish,
  isFullscreen, onToggleFullscreen,
}) {
  const crumbs = crumbsFor(screen, title);
  const showRunControls = screen === 'discussion';
  const done = isCompleted || iterCur >= iterMax;

  return (
    <header className={styles.topbar}>
      <button className={styles.brand} onClick={() => onNavigate?.('projects')} title="Проекты">
        <span className={styles.logoTile}><NbkLogo size={22} /></span>
        <span className={styles.logoText}>AqylNet</span>
      </button>
      <span className={styles.divider} />

      <nav aria-label="Путь" className={styles.crumbs}>
        {crumbs.map((c, i) => (
          <span key={i} className={styles.crumbWrap}>
            {i > 0 && <span className={styles.crumbSep}>/</span>}
            {c.screen ? (
              <button className={styles.crumbLink} onClick={() => onNavigate?.(c.screen)}>{c.label}</button>
            ) : (
              <span className={styles.crumbCurrent}>{c.label}</span>
            )}
          </span>
        ))}
      </nav>

      <div className={styles.spacer} />

      <div className={styles.controls}>
        {showRunControls && (
          <span className={`${styles.statusPill} ${isCompleted ? styles.statusDone : styles.statusRun}`}>
            <span className={styles.statusDot} />
            {isCompleted ? 'Завершена' : `Раунд ${iterCur} / ${iterMax}`}
          </span>
        )}
        {shortModel(model) && <span className={styles.model}>{shortModel(model)}</span>}
        {/* Finished run: the only thing left to do with it is read or export
            the report, so the run controls collapse into one action. */}
        {showRunControls && done && (
          <button className={styles.btnFinish} onClick={onFinish}>
            Экспорт
          </button>
        )}
        {showRunControls && !done && (
          <>
            <button className={styles.btnPlay} onClick={onRunIteration} disabled={playDisabled}>
              {playLabel({ isGenerating, isRevealing, iterCur, iterMax, isCompleted })}
            </button>
            <button className={styles.btnFinish} onClick={onFinish}>
              Отчёт
            </button>
          </>
        )}
        {!done && (
          <button className={styles.btnIcon} onClick={onToggleFullscreen} title={isFullscreen ? 'Выйти из полноэкранного режима' : 'На весь экран'}>
            {isFullscreen ? '⤢' : '⛶'}
          </button>
        )}
      </div>
    </header>
  );
}
