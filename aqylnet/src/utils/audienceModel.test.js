import { describe, it, expect } from 'vitest';
import { AUDIENCE_HINT, NOT_CHECKED, NO_DECISION_NOTE, STALE_NOTE, audienceExportLines, buildAudienceModel, levelTone, showReason } from './audienceModel';
import { audienceForType, documentMetaLine, fmtDate, metaPayload } from './documentMeta';
import { buildReportModel } from './exportReport';

// A1 stage 2. The server computes every level, share and phrase; these models
// only name and order them. What they must not lose: the shift phrase first,
// the hint without an audience, «не проверялось» for a null, the stale note.

const group = (g, level, extra = {}) => ({
  group: g, personas: 2, few: false, index: 6.4, share: 0.5, withVerdict: 2, level,
  criteria: { clarity: 7, myAction: 7, terms: 5.1 }, unanswered: 45, ...extra,
});
const empty = { terms: [], extra: [] };

const dto = {
  hasScores: true,
  document: { docType: 'press_release', publishedAt: '2026-09-04', intendedAudience: ['population'] },
  groups: [group('population', 'unclear', { personas: 1, few: true, share: null }), group('experts', 'clear')],
  phrase: 'Лучше всего текст поняли: эксперты и посредники. Хуже всего: население.',
  gap: { verdict: 'missed', shift: {}, phrases: ['Писали для населения, лучше всего поняли: эксперты и посредники.', 'Мимо адресата: …'] },
  terms: { population: { terms: [{ term: 'ДКП', personas: 1 }], extra: [] }, business: empty, experts: empty },
  analysis: {
    stale: true,
    reference: { quote: 'Ставка снижена до 16,25%.', section: '1. Раздел', verified: true, reason: '' },
    verdicts: [
      { personaId: 1, name: 'Бауыржан', group: 'population', decision: 'Банки снизили ставку', verdict: 'wrong', reason: 'банки вместо Национального банка', by: 'model' },
      { personaId: 2, name: 'Ерлан', group: 'experts', decision: '', verdict: null, reason: 'нет ответа о решении', by: 'code' },
    ],
    missing: {
      population: { status: 'ok', reason: '', items: [{ missing: 'что решение значит для вкладов', suggestion: 'добавить абзац', sourceIds: ['M1'], sections: ['1. Раздел'], personas: 1, question: 'что с вкладами?' }], returned: 2, dropped: 1, unknownIds: 1 },
      experts: { status: 'insufficient', reason: 'недостаточно данных', items: [], returned: 0, dropped: 0, unknownIds: 0 },
    },
    versions: {},
  },
};

describe('audience model', () => {
  it('the gap phrases lead, the shift first; targets marked; a single persona flagged', () => {
    const m = buildAudienceModel(dto);
    expect(m.headline[0]).toMatch(/^Писали для населения/);
    expect(m.groups[0]).toMatchObject({ key: 'population', target: true, levelLabel: 'непонятно', tone: 'low', share: '—', few: 'мало участников (1)' });
    expect(m.groups[1]).toMatchObject({ target: false, share: '50 %', tone: 'good' });
  });

  it('the groups phrase is not repeated when the gap already named the best group', () => {
    expect(buildAudienceModel(dto).extraPhrase).toBe(null);
    expect(audienceExportLines(dto).headline.filter((h) => /лучше всего/i.test(h))).toHaveLength(1);
    const noShift = buildAudienceModel({ ...dto, gap: { ...dto.gap, shift: null } });
    expect(noShift.extraPhrase).toBe(dto.phrase);
  });

  it('without an audience: the groups phrase and the hint, no gap', () => {
    const m = buildAudienceModel({ ...dto, document: { ...dto.document, intendedAudience: [] }, gap: null });
    expect(m.headline).toEqual([dto.phrase, AUDIENCE_HINT]);
  });

  it('a null verdict reads «не проверялось», a null level too', () => {
    const m = buildAudienceModel({ ...dto, groups: [group('business', null)] });
    expect(m.analysis.verdicts[1].verdictLabel).toBe(NOT_CHECKED);
    expect(m.groups[0].levelLabel).toBe(NOT_CHECKED);
    expect(levelTone(null)).toBe('none');
  });

  it('the export carries the stale note, the reference, the reason of a wrong verdict and the persona\'s question', () => {
    const e = audienceExportLines(dto);
    expect(e.stale).toBe(STALE_NOTE);
    expect(e.reference).toBe('Решение по документу (1. Раздел): «Ставка снижена до 16,25%.»');
    expect(e.verdicts[0]).toBe('Бауыржан (Население): неверно — «Банки снизили ставку». банки вместо Национального банка');
    expect(e.missing[0].lines[0]).toBe('Отброшено пунктов: 1');
    expect(e.missing[0].lines[1]).toMatch(/Вопрос участника: «что с вкладами\?»/);
    expect(e.missing[0].lines[2]).toBe('Непонятные термины: ДКП (1)');
    expect(e.missing[1].lines).toEqual(['недостаточно данных']);
  });

  it('a reference with nothing to compare: one note, no verdict rows', () => {
    const e = audienceExportLines({ ...dto, analysis: { ...dto.analysis, comparable: false } });
    expect(e.reference).toBe(NO_DECISION_NOTE);
    expect(e.verdicts).toEqual([]);
    expect(buildAudienceModel({ ...dto, analysis: { ...dto.analysis, comparable: false } }).analysis.comparable).toBe(false);
  });

  it('the reason «ответил «не понял»» is not repeated under the answer «не понял»', () => {
    expect(showReason({ verdict: 'not_understood', reason: 'ответил «не понял»' })).toBe(false);
    expect(showReason({ verdict: 'wrong', reason: 'величина 15 вместо 16,25' })).toBe(true);
    expect(showReason({ verdict: 'correct', reason: '' })).toBe(false);
  });

  it('criteria are written as scores out of 10, so a terms score of 10 does not read as ten terms', () => {
    const e = audienceExportLines(dto);
    expect(e.groups[0]).toMatch(/понятность 7\/10, что делать мне 7\/10, понятность терминов 5,1\/10; вопросов без ответа 45/);
  });

  it('an unverified reference is said, and the answers are not compared', () => {
    const e = audienceExportLines({ ...dto, analysis: { ...dto.analysis, reference: { quote: 'x', section: '', verified: false, reason: 'цитата не найдена в документе дословно' } } });
    expect(e.reference).toBe('Эталон решения не найден — цитата не найдена в документе дословно. Ответы участников не сверялись.');
  });
});

describe('document fields', () => {
  it('a type fills its default audience; a note keeps the current one', () => {
    expect(audienceForType('press_release', [])).toEqual(['population', 'business']);
    expect(audienceForType('mpr', [])).toEqual(['business', 'experts']);
    expect(audienceForType('fsr', ['population'])).toEqual(['experts']);
    expect(audienceForType('analytical_note', ['population'])).toEqual(['population']);
  });

  it('payload: empty audience and empty fields are null; the header line and the export meta carry type and date', () => {
    expect(metaPayload({ docType: '', publishedAt: '', intendedAudience: [] })).toEqual({ docType: null, publishedAt: null, intendedAudience: null });
    expect(fmtDate('2026-09-04')).toBe('04.09.2026');
    expect(documentMetaLine(dto.document)).toBe('Пресс-релиз · 04.09.2026');
    const r = buildReportModel({ projectTitle: 'x', personaCount: 8, iterations: 1, mode: 'Round Table', altParagraphs: [] }, dto.document);
    expect(r.meta.startsWith('Пресс-релиз · 04.09.2026 · ')).toBe(true);
  });
});

describe('decision fields (decision_verdict@4)', () => {
  const field = (value, quote, reason = '') => ({ value, proposed: value, quote, verified: value === null ? false : true, reason });
  const withFields = {
    ...dto,
    groups: [group('population', 'unclear', { indexCriteria: 2 }), group('experts', 'clear', { indexCriteria: 3 })],
    analysis: {
      ...dto.analysis,
      reference: {
        ...dto.analysis.reference,
        actor: field('central_bank', 'Национального Банка'),
        direction: field('lower', 'О снижении базовой ставки'),
        value: field(null, '', 'цитата этого не называет'),
      },
      verdicts: [{ ...dto.analysis.verdicts[0], by: 'code', extracted: { named: true, actor: 'banks', direction: 'lower', value: 16.25 } }],
      missing: { ...dto.analysis.missing, population: { ...dto.analysis.missing.population, dropped: 2, droppedBy: { noSource: 0, noWords: 1, onePersona: 1 } } },
    },
  };

  it('the extracted fields go next to the verdict; the reference says what is compared and what is not', () => {
    const e = audienceExportLines(withFields);
    expect(e.verdicts[0]).toContain('[кто: банки · направление: снижение · величина: 16,25]');
    expect(e.reference).toContain('Сверяется: кто принял — Национальный Банк; направление — снижение; величина — не сравнивается — цитата этого не называет');
  });

  it('the index basis is said when fewer than three criteria; the reasons for dropped items are listed', () => {
    const m = buildAudienceModel(withFields);
    expect(m.groups[0].indexBasis).toBe('индекс по 2 из 3 критериев');
    expect(m.groups[1].indexBasis).toBe(null);
    expect(audienceExportLines(withFields).missing[0].lines[0])
      .toBe('Отброшено пунктов: 2 (без слов участников (только вердикт или балл) — 1; на одном участнике — 1)');
  });
});

describe('an item on one persona', () => {
  it('is marked «1 участник» in the export', () => {
    const one = { ...dto, analysis: { ...dto.analysis, missing: { population: { ...dto.analysis.missing.population, dropped: 0 } } } };
    expect(audienceExportLines(one).missing[0].lines[0]).toMatch(/^1\. что решение значит для вкладов \(1 участник; 1\. Раздел\)/);
  });
});
