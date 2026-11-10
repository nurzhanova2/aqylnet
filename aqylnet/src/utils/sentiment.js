const POSITIVE_PATTERNS = [
  [/\u043f\u043e\u0434\u0434\u0435\u0440\u0436/giu, 4],
  [/\u0441\u043e\u0433\u043b\u0430\u0441(?:\u0435\u043d|\u043d\u0430|\u043d\u044b)/giu, 4],
  [/\u043e\u0434\u043e\u0431\u0440/giu, 4],
  [/\u0443\u0432\u0435\u0440\u0435\u043d/giu, 3],
  [/\u043f\u043e\u043b\u043e\u0436\u0438\u0442\u0435\u043b/giu, 3],
  [/\u0443\u043b\u0443\u0447\u0448/giu, 2],
  [/\u0441\u0442\u0430\u0431\u0438\u043b/giu, 2],
  [/\u0431\u0435\u0437\u043e\u043f\u0430\u0441/giu, 2],
  [/\u044d\u0444\u0444\u0435\u043a\u0442\u0438\u0432/giu, 2],
  [/\u0432\u044b\u0433\u043e\u0434/giu, 2],
  [/\u043d\u0430\u0434\u0451\u0436|\u043d\u0430\u0434\u0435\u0436/giu, 2],
  [/\u0432\u043e\u0437\u043c\u043e\u0436\u043d\u043e\u0441\u0442/giu, 1],
  [/\u0440\u043e\u0441\u0442/giu, 1],
  [/\u0433\u043e\u0442\u043e\u0432(?:\u0430|\u044b)?/giu, 1],
];

const NEGATIVE_PATTERNS = [
  [/\u043d\u0435\s+\u0441\u043e\u0433\u043b\u0430\u0441/giu, -5],
  [/\u043f\u0440\u043e\u0442\u0438\u0432/giu, -4],
  [/\u043e\u043f\u0430\u0441/giu, -3],
  [/\u043e\u0431\u0435\u0441\u043f\u043e\u043a\u043e/giu, -3],
  [/\u0443\u0433\u0440\u043e\u0437/giu, -3],
  [/\u043f\u0430\u0434\u0435\u043d/giu, -3],
  [/\u0443\u0445\u0443\u0434\u0448/giu, -3],
  [/\u0431\u043e\u044e\u0441\u044c|\u0441\u0442\u0440\u0430\u0445/giu, -3],
  [/\u0441\u043e\u043c\u043d\u0435\u043d/giu, -2],
  [/\u043f\u0440\u043e\u0431\u043b\u0435\u043c/giu, -2],
  [/\u043d\u0435\u0434\u043e\u0441\u0442\u0430\u0442/giu, -2],
  [/\u043a\u0440\u0438\u0442\u0438\u0447/giu, -2],
  [/\u0441\u043d\u0438\u0436/giu, -2],
  [/\u043d\u0435\u0432\u043e\u0437\u043c\u043e\u0436/giu, -2],
  [/\u0440\u0438\u0441\u043a/giu, -1],
];

function patternScore(text, entries) {
  return entries.reduce((total, [pattern, weight]) => {
    const matches = text.match(pattern);
    return total + (matches ? Math.min(matches.length, 2) * weight : 0);
  }, 0);
}

export function scoreSentiment(value) {
  const text = String(value || '').toLocaleLowerCase('ru-RU');
  if (!text.trim()) return 0;

  let score = patternScore(text, POSITIVE_PATTERNS) + patternScore(text, NEGATIVE_PATTERNS);
  if (/\u043d\u0435\s+(?:\u0432\u0438\u0436\u0443|\u043d\u0430\u0445\u043e\u0436\u0443)\s+(?:\u0441\u0435\u0440\u044c\u0451\u0437\u043d\w*\s+)?\u0440\u0438\u0441\u043a/iu.test(text)) score += 3;
  if (/\u043d\u0435\u0439\u0442\u0440\u0430\u043b|\u0432\u043e\u0437\u0434\u0435\u0440\u0436/iu.test(text)) score = Math.round(score * 0.25);
  if (Math.abs(score) < 2) return 0;
  return Math.max(-10, Math.min(10, score));
}

export function buildSentimentSeries(messages, personas, iterationCount) {
  const safeIterationCount = Math.max(1, Number(iterationCount) || 1);
  const buckets = new Map();

  for (const message of messages || []) {
    if (message.speakerType === 'moderator' || message.personaId == null) continue;
    const iteration = Number(message.iteration);
    if (!Number.isInteger(iteration) || iteration < 1 || iteration > safeIterationCount) continue;
    const key = `${message.personaId}:${iteration}`;
    const scores = buckets.get(key) || [];
    scores.push(scoreSentiment(message.text));
    buckets.set(key, scores);
  }

  const series = (personas || []).map((persona) => ({
    id: persona.id,
    name: persona.name,
    color: persona.dot || '#36C988',
    points: Array.from({ length: safeIterationCount }, (_, index) => {
      const scores = buckets.get(`${persona.id}:${index + 1}`);
      if (!scores?.length) return null;
      return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
    }),
  }));

  const average = Array.from({ length: safeIterationCount }, (_, index) => {
    const scores = series.map((item) => item.points[index]).filter((score) => score != null);
    if (!scores.length) return null;
    return Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10;
  });

  return { series, average, iterationCount: safeIterationCount };
}

export function formatSentimentScore(score) {
  if (score == null) return '\u2014';
  if (score === 0) return '0';
  return `${score > 0 ? '+' : ''}${score}/10`;
}
