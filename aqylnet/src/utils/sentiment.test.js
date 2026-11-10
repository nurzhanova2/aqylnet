import { describe, expect, it } from 'vitest';
import { buildSentimentSeries, formatSentimentScore, scoreSentiment } from './sentiment';

describe('sentiment chart data', () => {
  it('scores support positively, concern negatively, and neutral text as zero', () => {
    expect(scoreSentiment('\u042f \u043f\u043e\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u044e \u044d\u0442\u043e \u0443\u043b\u0443\u0447\u0448\u0435\u043d\u0438\u0435')).toBeGreaterThan(0);
    expect(scoreSentiment('\u042f \u043f\u0440\u043e\u0442\u0438\u0432, \u044d\u0442\u043e \u043e\u043f\u0430\u0441\u043d\u044b\u0439 \u0440\u0438\u0441\u043a')).toBeLessThan(0);
    expect(scoreSentiment('\u041d\u0443\u0436\u043d\u043e \u0438\u0437\u0443\u0447\u0438\u0442\u044c \u0434\u0430\u043d\u043d\u044b\u0435')).toBe(0);
  });

  it('matches messages by personaId and calculates an average for every iteration', () => {
    const result = buildSentimentSeries([
      { personaId: 7, speakerType: 'persona', iteration: 1, text: '\u041f\u043e\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u044e \u0438 \u043e\u0434\u043e\u0431\u0440\u044f\u044e' },
      { personaId: 8, speakerType: 'persona', iteration: 1, text: '\u041f\u0440\u043e\u0442\u0438\u0432, \u0432\u0438\u0436\u0443 \u0443\u0433\u0440\u043e\u0437\u0443' },
      { personaId: null, speakerType: 'moderator', iteration: 1, text: '\u0412\u043e\u043f\u0440\u043e\u0441' },
    ], [
      { id: 7, name: 'A', dot: '#111111' },
      { id: 8, name: 'B', dot: '#222222' },
    ], 2);

    expect(result.series[0].points[0]).toBeGreaterThan(0);
    expect(result.series[1].points[0]).toBeLessThan(0);
    expect(result.series[0].points[1]).toBeNull();
    expect(result.average[0]).not.toBeNull();
    expect(result.average[1]).toBeNull();
    expect(formatSentimentScore(4)).toBe('+4/10');
  });
});
