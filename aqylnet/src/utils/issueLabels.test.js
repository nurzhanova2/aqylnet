import { describe, expect, it } from 'vitest';
import { categoryLabel, issuePeople, severityLabel } from './issueLabels';
import { countOf, plural } from './plural';
import { documentMetaLine } from './documentMeta';
import { sectionName } from './audienceModel';

// Wording the report check of 10.11.2026 found odd: raw English keys, the same
// person in two lists, broken plurals, «Другое» and «1. Раздел 1» in headers.

describe('issue labels', () => {
  it('severity and category read in Russian; an unknown key is shown as it is', () => {
    expect(severityLabel('High')).toBe('Высокое');
    expect(severityLabel('Critical')).toBe('Критичное');
    expect(categoryLabel('evidence')).toBe('доказательность');
    expect(categoryLabel('something_new')).toBe('something_new');
  });

  it('each person once, under the first list; the moderator is not a member of the group', () => {
    const p = issuePeople({
      raisedBy: 'Даниэль Хартманн, Модератор',
      agreedBy: 'Даниэль Хартманн, Айгерим',
      disputedBy: 'Модератор, Светлана',
    });
    expect(p).toEqual({ raised: ['Даниэль Хартманн'], agreed: ['Айгерим'], disputed: ['Светлана'] });
    expect(issuePeople({})).toEqual({ raised: [], agreed: [], disputed: [] });
  });
});

describe('plural', () => {
  it('1, 2–4, 5–20, 21, 0 and 11–14', () => {
    const p = (n) => plural(n, 'участник', 'участника', 'участников');
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 0].map(p)).toEqual([
      'участник', 'участника', 'участника', 'участников', 'участников', 'участников', 'участников',
      'участник', 'участника', 'участников', 'участников',
    ]);
    expect(countOf(3, 'раунд', 'раунда', 'раундов')).toBe('3 раунда');
  });
});

describe('headers', () => {
  it('the doc type «другое» is not printed in the meta line; a real type is', () => {
    expect(documentMetaLine({ docType: 'other', publishedAt: '2026-11-04' })).toBe('04.11.2026');
    expect(documentMetaLine({ docType: 'other' })).toBe('');
    expect(documentMetaLine({ docType: 'press_release' })).toBe('Пресс-релиз');
  });

  it('«1. Раздел 1» copied by the model reads «Раздел 1»; a real heading is kept', () => {
    expect(sectionName('1. Раздел 1')).toBe('Раздел 1');
    expect(sectionName('2. Инфляция')).toBe('2. Инфляция');
    expect(sectionName('1. Раздел 2')).toBe('1. Раздел 2');
    expect(sectionName('')).toBe('');
  });
});
