import styles from './panels.module.css';

export default function SummaryPanel({ topics, risks, improves, mood, moodEmoji, conclusion, generating, error, notice, onGenerateReport, onGoAnalytics }) {
  const hasMood = Boolean(mood);
  const hasConclusion = Boolean(conclusion);

  return (
    <div className={`${styles.panel} ${styles.panelFlex}`}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>ИТОГИ ДИСКУССИИ</span>
        <div className={styles.summaryActions}>
          <button className={styles.btnReport} onClick={onGenerateReport} disabled={generating}>
            {generating ? 'Отчёт формируется…' : 'Сформировать отчёт'}
          </button>
          <button className={styles.btnDownload} onClick={onGoAnalytics}>⬇</button>
        </div>
      </div>
      {error && <div className={styles.summaryError}>{error}</div>}
      {generating && <div className={styles.summaryStatus}>Отчёт формируется…</div>}
      {notice && !generating && <div className={styles.summaryStatus}>{notice}</div>}
      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}>
          <div className={styles.summaryCardLabel}>ОБЩЕЕ НАСТРОЕНИЕ</div>
          {hasMood ? (
            <div className={styles.moodRow}>
              <div className={styles.moodText}>{mood}</div>
              <div className={styles.moodEmoji}>{moodEmoji}</div>
            </div>
          ) : (
            <div className={styles.summaryCardSub}>Появится после формирования отчёта.</div>
          )}
        </div>

        <div className={styles.summaryCard}>
          <div className={styles.summaryCardLabel}>КЛЮЧЕВЫЕ РИСКИ</div>
          {risks.map((r, i) => (
            <div key={i} className={styles.bulletRow}>
              <span className={styles.bulletDot} style={{ background: '#f472b6' }} />
              <span className={styles.bulletText}>{r}</span>
            </div>
          ))}
        </div>

        <div className={styles.summaryCard}>
          <div className={styles.summaryCardLabel}>НАИБОЛЕЕ ОБСУЖДАЕМЫЕ ТЕМЫ</div>
          <div className={styles.topicTags}>
            {topics.map((t) => (
              <span key={t} className={styles.topicTag}>{t}</span>
            ))}
          </div>
        </div>

        <div className={styles.summaryCard}>
          <div className={styles.summaryCardLabel}>ПРЕДЛОЖЕНИЯ ПО УЛУЧШЕНИЮ</div>
          {improves.map((imp, i) => (
            <div key={i} className={styles.bulletRow}>
              <span className={styles.bulletDot} style={{ background: '#36C988' }} />
              <span className={styles.bulletText}>{imp}</span>
            </div>
          ))}
        </div>

        <div className={`${styles.summaryCard} ${styles.spanFull}`}>
          <div className={styles.summaryCardLabelRow}>
            <span className={styles.summaryCardLabel}>ОБЩИЙ ВЫВОД</span>
            <span>📋</span>
          </div>
          <div className={styles.conclusionText}>
            {hasConclusion ? conclusion : 'Появится после формирования отчёта.'}
          </div>
        </div>
      </div>
    </div>
  );
}
