import { describe, it, expect } from 'vitest';
import { DRAFT_NOTE, LIMITATION, buildFullModel, buildLayerModel, copyText, itemMarks, rewriteExportModel } from './rewriteModel';

// A1 stage 3. The marks were made on the server; this model only names them.
// What it must not lose anywhere the text goes: the limitation, the marks,
// the basis next to a phrase the author must compare, the placeholders.

const support = (ok, authorCheck, reason = '') => ({ ok, reason, basis: 'Опора.', basisVerified: true, coverage: 0.8, missingWords: [], basisCoverage: 0.5, authorCheck });
const checks = (extra = {}) => ({ numbers: [], terms: null, longest: 8, long: false, unsourced: false, support: support(true, false), mustBePlaceholder: false, ...extra });
const item = (text, extra = {}, basis = 'Опора в документе.') => ({ text, basis, sourceSections: [1], placeholder: false, checks: checks(extra) });
const meta = { status: 'ok', failReason: '', version: 'v', basedOn: 'a', generatedAt: 'g', stale: false };

const dto = {
  hasAnalysis: true,
  document: { title: 'Пресс-релиз', docType: 'press_release', publishedAt: '2026-09-04' },
  bounds: { card: { min: 600, max: 1000 }, brief: { min: 2500, max: 4000 } },
  card: {
    ...meta,
    decision: [item('Национальный Банк снизил ставку до 16,25%.')],
    why: [item('Доступность кредитов ограничена.', { support: support(true, true) }, 'Сдерживающее влияние окажет повышение резервных требований.')],
    forYou: [{ text: '[Дописать: что это значит для вкладов — в документе этого нет]', basis: '', sourceSections: [], placeholder: true, checks: checks({ support: null }) }],
    next: [item('Ставка снизится до 15%.', { numbers: ['15'], support: support(false, false, 'числа не в опоре: 15') })],
    decisionCheck: { ok: true, reason: '' },
    summary: { chars: 700, withinVolume: true, minutes: 0.5, placeholders: ['[Дописать: что это значит для вкладов — в документе этого нет]'], marks: 2, numbersNotFound: 1, unsupported: 1, mustBePlaceholder: 0, authorChecks: 1, longShare: 0 },
  },
  brief: null,
  full: {
    ...meta,
    bluf: [item('Комитет снизил ставку до 16,25%.')],
    blufDecision: { ok: true, reason: '' },
    paragraphs: [
      { id: 's1p1', order: 0, status: 'same', text: 'Исходный абзац.\n\n', before: null, reason: '', issueId: null, missingId: null, kind: null, checks: null },
      { id: 's1p2', order: 0, status: 'changed', text: 'Новый абзац.\n\n', before: 'Старый абзац.\n\n', reason: 'ясность', issueId: 'З-01', missingId: null, kind: null, checks: { numbers: [], placeholders: [], mustBePlaceholder: false, authorCheck: false, coverage: 1, bases: [] } },
      { id: 's1p2+1', order: 0, status: 'added', text: 'Нейтральная ставка — уровень ставки.\n\n', before: null, reason: 'термин', issueId: 'З-01', missingId: null, kind: 'term_definition', checks: { numbers: [], placeholders: [], mustBePlaceholder: false, authorCheck: true, coverage: null, bases: [] } },
    ],
    issues: [{ id: 'З-01', severity: 'High', title: 'термин', section: '1', status: 'in_quote_paragraph' }, { id: 'З-02', severity: 'High', title: 'единицы', section: '1', status: 'no_edit' }],
    edits: { applied: 2, dropped: { unknownParagraph: 0, noLink: 0, duplicate: 0, newContent: 3 } },
    sectionsFailed: [],
    integrity: { same: 1, matching: 1 },
    summary: { chars: 300, placeholders: [], numbersNotFound: 0, unsupported: 0, mustBePlaceholder: 0, authorChecks: 1, changed: 1, added: 1 },
  },
};

describe('marks of a sentence', () => {
  it('«проверить автору» and «не подтверждено» show the basis next to the phrase; a confirmed one does not', () => {
    expect(itemMarks(dto.card.why[0])).toMatchObject({ basis: 'Сдерживающее влияние окажет повышение резервных требований.' });
    expect(itemMarks(dto.card.why[0]).marks[0].label).toBe('проверить автору');
    expect(itemMarks(dto.card.next[0]).marks.map((m) => m.label)).toEqual(['не подтверждено документом', 'число не найдено в документе']);
    expect(itemMarks(dto.card.decision[0])).toEqual({ marks: [], basis: '' });
  });
});

describe('the card', () => {
  const m = buildLayerModel(dto, 'card');
  it('parts in their order, the summary with soft marks counted', () => {
    expect(m.parts.map((p) => p.heading)).toEqual(['Что решили', 'Почему', 'Что это значит для вас', 'Что дальше']);
    expect(m.summary).toContain('«проверить автору»: 1');
    expect(m.summary).toContain('заглушек: 1');
  });

  it('the clipboard starts with the limitation and keeps placeholders, marks and bases', () => {
    const t = copyText(m);
    expect(t.startsWith(LIMITATION)).toBe(true);
    expect(t).toContain('[Дописать: что это значит для вкладов — в документе этого нет]');
    expect(t).toContain('Доступность кредитов ограничена. [проверить автору: связь между фактами не проверена] (опора: «Сдерживающее влияние окажет повышение резервных требований.»)');
  });

  it('the exported document: its own title, the draft note and the limitation in the header, the marks in the text', () => {
    const e = rewriteExportModel(dto, 'card', 'Пресс-релиз · 04.09.2026');
    expect(e.title).toBe('Карточка — Пресс-релиз');
    expect(e.header).toEqual([DRAFT_NOTE, LIMITATION, 'Пресс-релиз · 04.09.2026']);
    expect(e.blocks.find((b) => b.heading === 'Что дальше').lines[0]).toContain('[не подтверждено документом: числа не в опоре: 15]');
    expect(e.blocks.at(-1).heading).toBe('Что дописать автору — 1');
  });

  it('a version not generated says so', () => {
    expect(buildLayerModel(dto, 'brief').has).toBe(false);
  });
});

describe('the full text', () => {
  const m = buildFullModel(dto);
  it('tags, kinds, «Было», a term definition for the author; issue statuses say where, not «fixed»', () => {
    expect(m.paragraphs.map((p) => p.tag)).toEqual(['без изм.', 'изменено', 'добавлено']);
    expect(m.paragraphs[2].kind).toBe('определение термина');
    expect(m.paragraphs[2].marks[0].detail).toBe('определение термина — не из документа');
    expect(m.issues.map((i) => i.statusLabel)).toEqual(['правка в абзаце с цитатой', 'нет правки']);
    expect(m.summary).toContain('новое содержание — 3');
  });

  it('the exported full text keeps every paragraph, the tags and «Было»', () => {
    const e = rewriteExportModel(dto, 'full');
    const text = e.blocks.find((b) => b.heading === 'Текст').lines;
    expect(text).toEqual([
      'Исходный абзац.',
      '[изменено · З-01] Новый абзац.',
      'Было: Старый абзац.',
      '[добавлено: определение термина · З-01] Нейтральная ставка — уровень ставки. [проверить автору: определение термина — не из документа]',
    ]);
    expect(e.blocks.find((b) => b.heading.startsWith('Замечания')).lines[0]).toBe('Статус говорит, где правка, а не что замечание исправлено.');
  });
});

describe('a replaced paragraph (04.11.2026)', () => {
  it('is marked for the author, and the numbers it lost are listed — on the page and in the export', () => {
    const changed = { id: 's1p16', order: 0, status: 'changed', text: 'Рост ВВП в 2027 году сложится в пределах 4,5% (ранее 3,5-4,5%).\n\n', before: 'Прогноз на 2026 год 4,5-5,5%. В 2028 году 4-5% (ранее 3,5-4,5%).\n\n', reason: 'З-03', issueId: 'З-03', missingId: null, kind: null,
      checks: { numbers: [], placeholders: [], mustBePlaceholder: false, authorCheck: true, coverage: 1, bases: [], removedNumbers: ['5,5', '2028', '4', '5'] } };
    const withChange = { ...dto, full: { ...dto.full, paragraphs: [changed] } };
    const p = buildFullModel(withChange).paragraphs[0];
    expect(p.marks.map((m) => `${m.label}: ${m.detail}`)).toEqual([
      'из абзаца убраны данные: 5,5, 2028, 4, 5',
      'проверить автору: абзац переписан — сверьте с прежним текстом',
    ]);
    expect(rewriteExportModel(withChange, 'full').blocks.find((b) => b.heading === 'Текст').lines[0])
      .toContain('[из абзаца убраны данные: 5,5, 2028, 4, 5] [проверить автору: абзац переписан — сверьте с прежним текстом]');
  });
});
