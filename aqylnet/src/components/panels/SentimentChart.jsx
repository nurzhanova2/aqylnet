import styles from './panels.module.css';
import { buildSentimentSeries, formatSentimentScore } from '../../utils/sentiment';

const WIDTH = 320;
const HEIGHT = 220;
const PLOT = { left: 34, right: 12, top: 16, bottom: 34 };
const AVERAGE_COLOR = '#D9F5E6';

function xFor(index, count) {
  const width = WIDTH - PLOT.left - PLOT.right;
  if (count <= 1) return PLOT.left + width / 2;
  return PLOT.left + (index / (count - 1)) * width;
}

function yFor(score) {
  const height = HEIGHT - PLOT.top - PLOT.bottom;
  return PLOT.top + ((10 - score) / 20) * height;
}

function lineSegments(points) {
  const segments = [];
  let current = [];
  points.forEach((score, index) => {
    if (score == null) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push({ score, index });
    }
  });
  if (current.length) segments.push(current);
  return segments;
}

function pathFor(segment, count) {
  return segment.map((point, index) => `${index ? 'L' : 'M'} ${xFor(point.index, count)} ${yFor(point.score)}`).join(' ');
}

function latestScore(points) {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (points[index] != null) return points[index];
  }
  return null;
}

export default function SentimentChart({ messages, personas, iterationCount, loading, error }) {
  const chart = buildSentimentSeries(messages, personas, iterationCount);
  const hasData = chart.series.some((item) => item.points.some((score) => score != null));

  return (
    <div className={`${styles.panel} ${styles.sentimentPanel}`}>
      <div className={styles.sentimentHeader}>
        <div>
          <strong>{'\u0414\u0438\u043d\u0430\u043c\u0438\u043a\u0430 \u043d\u0430\u0441\u0442\u0440\u043e\u0435\u043d\u0438\u044f'}</strong>
          <span>{'\u0428\u043a\u0430\u043b\u0430 \u043e\u0442 \u221210 \u0434\u043e +10 \u043f\u043e \u0440\u0435\u043f\u043b\u0438\u043a\u0430\u043c'}</span>
        </div>
      </div>

      {loading && <div className={styles.sentimentState}>{'\u0420\u0430\u0441\u0441\u0447\u0438\u0442\u044b\u0432\u0430\u0435\u043c \u0434\u0438\u043d\u0430\u043c\u0438\u043a\u0443\u2026'}</div>}
      {!loading && error && <div className={styles.sentimentError}>{error}</div>}
      {!loading && !error && !hasData && (
        <div className={styles.sentimentState}>
          <strong>{'\u041f\u043e\u043a\u0430 \u043d\u0435\u0442 \u0434\u0430\u043d\u043d\u044b\u0445'}</strong>
          <span>{'\u041b\u0438\u043d\u0438\u0438 \u043f\u043e\u044f\u0432\u044f\u0442\u0441\u044f \u043f\u043e\u0441\u043b\u0435 \u043f\u0435\u0440\u0432\u043e\u0439 \u0438\u0442\u0435\u0440\u0430\u0446\u0438\u0438.'}</span>
        </div>
      )}

      {!loading && !error && hasData && (
        <>
          <div className={styles.chartWrap}>
            <svg viewBox={'0 0 320 220'} role={'img'} aria-label={'\u0413\u0440\u0430\u0444\u0438\u043a \u043d\u0430\u0441\u0442\u0440\u043e\u0435\u043d\u0438\u044f \u043f\u0435\u0440\u0441\u043e\u043d \u043f\u043e \u0438\u0442\u0435\u0440\u0430\u0446\u0438\u044f\u043c'}>
              {[10, 5, 0, -5, -10].map((score) => (
                <g key={score}>
                  <line
                    x1={PLOT.left}
                    x2={WIDTH - PLOT.right}
                    y1={yFor(score)}
                    y2={yFor(score)}
                    className={score === 0 ? styles.zeroLine : styles.gridLine}
                  />
                  <text x={PLOT.left - 7} y={yFor(score) + 3} textAnchor={'end'} className={styles.axisText}>{score > 0 ? `+${score}` : score}</text>
                </g>
              ))}

              {Array.from({ length: chart.iterationCount }, (_, index) => (
                <g key={index}>
                  <line x1={xFor(index, chart.iterationCount)} x2={xFor(index, chart.iterationCount)} y1={PLOT.top} y2={HEIGHT - PLOT.bottom} className={styles.verticalGridLine} />
                  <text x={xFor(index, chart.iterationCount)} y={HEIGHT - 12} textAnchor={'middle'} className={styles.axisText}>{index + 1}</text>
                </g>
              ))}

              {chart.series.map((item) => (
                <g key={item.id}>
                  {lineSegments(item.points).map((segment, index) => (
                    <path key={index} d={pathFor(segment, chart.iterationCount)} fill={'none'} stroke={item.color} strokeWidth={2} strokeLinecap={'round'} strokeLinejoin={'round'} opacity={0.9} />
                  ))}
                  {item.points.map((score, index) => score == null ? null : (
                    <circle key={index} cx={xFor(index, chart.iterationCount)} cy={yFor(score)} r={3.3} fill={item.color} stroke={'#0D2219'} strokeWidth={1.5}>
                      <title>{`${item.name}: ${formatSentimentScore(score)}, \u0438\u0442\u0435\u0440\u0430\u0446\u0438\u044f ${index + 1}`}</title>
                    </circle>
                  ))}
                </g>
              ))}

              {lineSegments(chart.average).map((segment, index) => (
                <path key={index} d={pathFor(segment, chart.iterationCount)} fill={'none'} stroke={AVERAGE_COLOR} strokeWidth={2.5} strokeDasharray={'5 4'} strokeLinecap={'round'} />
              ))}
              {chart.average.map((score, index) => score == null ? null : (
                <circle key={index} cx={xFor(index, chart.iterationCount)} cy={yFor(score)} r={4} fill={AVERAGE_COLOR} stroke={'#36C988'} strokeWidth={1.5}>
                  <title>{`\u0421\u0440\u0435\u0434\u043d\u0435\u0435: ${formatSentimentScore(score)}, \u0438\u0442\u0435\u0440\u0430\u0446\u0438\u044f ${index + 1}`}</title>
                </circle>
              ))}
            </svg>
            <div className={styles.chartAxisLabel}>{'\u0418\u0442\u0435\u0440\u0430\u0446\u0438\u0438'}</div>
          </div>

          <div className={styles.sentimentLegend}>
            {chart.series.map((item) => (
              <div key={item.id} className={styles.legendItem}>
                <i style={{ background: item.color }} />
                <span title={item.name}>{item.name}</span>
                <b>{formatSentimentScore(latestScore(item.points))}</b>
              </div>
            ))}
            <div className={`${styles.legendItem} ${styles.legendAverage}`}>
              <i />
              <span>{'\u0421\u0440\u0435\u0434\u043d\u0435\u0435'}</span>
              <b>{formatSentimentScore(latestScore(chart.average))}</b>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
