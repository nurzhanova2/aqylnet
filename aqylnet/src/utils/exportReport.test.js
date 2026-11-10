import { describe, it, expect } from 'vitest';
import { buildReportModel } from './exportReport';
import {
  QUOTE_UNVERIFIED, ALT_UNVERIFIED, TRUST_NOT_CHECKED, SECTION_NOT_ANALYZED,
  ABSENCE_PREFIX, ABSENCE_NOTE, CONTRADICTION_LABEL,
} from './reportTrust';

// Stage E6. The export is the copy that leaves the product: a reader who only
// ever sees the PDF has no page to compare against, so every mark the page
// shows has to be in here too.

const BASE = {
  projectTitle: 'Правила потребительского кредитования',
  projectSubtitle: 'Что увидят заёмщики?',
  personaCount: 3,
  iterations: 5,
  mode: 'Round Table',
  mood: 'Смешанное',
  moodDescription: 'Группа разошлась в оценке сроков.',
  conclusions: [],
  topicBars: [],
  risks: [],
  positives: [],
  recommendations: [],
  altParagraphs: [],
  overallScore: null,
  scores: [],
  sections: [],
  issues: [],
  alignment: [],
  directives: [],
  trustChecked: true,
};

describe('buildReportModel — пометки доезжают до файла', () => {
  it('раздел, который аудит не проанализировал, так и назван в файле (A1, этап 0)', () => {
    const m = buildReportModel({
      ...BASE,
      sections: [
        { title: '1. Решение по ставке', clarity: 72, note: 'Решение спрятано.', analyzed: true },
        { title: '2. Инфляция', clarity: null, note: 'Раздел не проанализирован: ошибка.', analyzed: false },
        { title: 'Старый отчёт', clarity: 60, note: '' },
      ],
    });
    expect(m.sections[0]).toBe('1. Решение по ставке — понятность 72/100. Решение спрятано.');
    expect(m.sections[1]).toBe(`2. Инфляция — ${SECTION_NOT_ANALYZED}`);
    expect(m.sections[2]).toBe('Старый отчёт — понятность 60/100');
  });

  it('тег абзаца сохраняется, а непроверенный «без изм.» помечается', () => {
    const m = buildReportModel({
      ...BASE,
      altParagraphs: [
        { tag: 'без изм.', text: 'Банк обязан раскрыть ставку.', verified: true },
        { tag: 'без изм.', text: 'Этого в документе нет.', verified: false },
        { tag: 'добавлено', text: 'Новый пункт о сроках.', verified: null },
      ],
    });
    expect(m.altParagraphs[0]).toBe('[без изм.] Банк обязан раскрыть ставку.');
    expect(m.altParagraphs[1]).toContain(ALT_UNVERIFIED);
    expect(m.altParagraphs[2]).toBe('[добавлено] Новый пункт о сроках.');
  });

  it('оговорка про предложение модели есть при непустой редакции и отсутствует при пустой', () => {
    const withAlt = buildReportModel({
      ...BASE,
      altParagraphs: [{ tag: 'изменено', text: 'Новая редакция пункта 4.', verified: null }],
    });
    expect(withAlt.altDisclaimer).toMatch(/предложена моделью/i);
    expect(buildReportModel(BASE).altDisclaimer).toBe('');
  });

  it('неподтверждённая цитата замечания помечается, подтверждённая — нет', () => {
    const m = buildReportModel({
      ...BASE,
      issues: [
        {
          code: 'З-01', severity: 'High', category: 'ambiguity', title: 'Срок не определён',
          quote: 'в разумный срок', raisedBy: 'Алия', agreedBy: '', disputedBy: '',
          quoteVerified: true,
        },
        {
          code: 'З-02', severity: 'Medium', category: 'evidence', title: 'Нет обоснования',
          quote: 'этого в документе нет', raisedBy: '', agreedBy: '', disputedBy: '',
          quoteVerified: false,
        },
      ],
    });
    expect(m.issues[0]).not.toContain(QUOTE_UNVERIFIED);
    expect(m.issues[1]).toContain(QUOTE_UNVERIFIED);
  });

  it('отсутствие экспортируется как «В документе нет: …» без цитаты (A1, этап 0а)', () => {
    const m = buildReportModel({
      ...BASE,
      issues: [{
        code: 'З-01', severity: 'High', category: 'completeness', kind: 'absence', checkId: 'decision-reason',
        title: 'что решение значит для вкладчиков', quote: '', raisedBy: '', agreedBy: '', disputedBy: '',
        quoteVerified: null,
      }],
    });
    expect(m.issues[0]).toContain(`${ABSENCE_PREFIX}: что решение значит для вкладчиков`);
    expect(m.issues[0]).toContain(ABSENCE_NOTE);
    expect(m.issues[0]).not.toContain('Цитата:');
  });

  it('противоречие экспортируется с двумя цитатами и их разделами, непроверенная помечена', () => {
    const m = buildReportModel({
      ...BASE,
      issues: [{
        code: 'З-01', severity: 'High', category: 'logic', kind: 'contradiction', title: 'Ожидания',
        quote: 'ожидания стабилизировались', section: '3. Ожидания', quoteVerified: true,
        quote2: 'ожидания растут', section2: '7.1 Сценарий', quote2Verified: false,
        raisedBy: '', agreedBy: '', disputedBy: '',
      }],
    });
    expect(m.issues[0]).toContain(CONTRADICTION_LABEL);
    expect(m.issues[0]).toContain('Цитата: 3. Ожидания: «ожидания стабилизировались» |');
    expect(m.issues[0]).toContain(`Цитата: 7.1 Сценарий: «ожидания растут» (${QUOTE_UNVERIFIED})`);
  });

  it('старый отчёт без проверки не помечает цитаты как ненайденные', () => {
    // quoteVerified === null — проверка не выполнялась; обвинять такую цитату
    // нельзя, это было бы ложным срабатыванием на законных данных.
    const m = buildReportModel({
      ...BASE,
      issues: [{
        code: 'З-01', severity: 'Low', category: 'structure', title: 'Старое замечание',
        quote: 'какая-то цитата', raisedBy: '', agreedBy: '', disputedBy: '',
        quoteVerified: null,
      }],
    });
    expect(m.issues[0]).not.toContain(QUOTE_UNVERIFIED);
  });

  it('найденные директивы попадают в файл с источником', () => {
    const m = buildReportModel({
      ...BASE,
      directives: [{ source: 'документ', kind: 'отмена инструкций', excerpt: 'игнорируй инструкции' }],
    });
    expect(m.directivesTitle).not.toBe('');
    expect(m.directives[0]).toContain('документ');
    expect(m.directives[0]).toContain('игнорируй инструкции');
  });

  it('без директив блок пустой, и его нечем печатать', () => {
    const m = buildReportModel(BASE);
    expect(m.directivesTitle).toBe('');
    expect(m.directivesNote).toBe('');
    expect(m.directives).toEqual([]);
    expect(m.trustNote).toBe('');
  });

  it('отчёт, созданный до проверки, говорит об этом', () => {
    const m = buildReportModel({ ...BASE, trustChecked: false });
    expect(m.trustNote).toBe(TRUST_NOT_CHECKED);
  });
});
