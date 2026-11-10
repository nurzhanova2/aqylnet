// «Три версии текста» (A1 stage 3) as one model for the page, the clipboard
// and the three exported documents. Every check was made on the server
// (services/rewriteChecks.ts); this file only names the marks and orders the
// text. The marks travel everywhere the text goes: a draft that speaks for the
// National Bank is read by people who never saw the page.

import { severityLabel } from './issueLabels';

/** Over the three versions, in the export header too (decision of 04.11.2026). */
export const LIMITATION = 'Черновик. Проверено: числа и опорные цитаты есть в документе. Не проверено: верно ли передана связь между фактами — сверьте фразы с пометкой «проверить автору».';
export const DRAFT_NOTE = 'Черновик. Заглушки [Дописать: …] заполняет автор.';
export const STALE_NOTE = 'Версия устарела: анализ «Кому понятен текст» обновлён после неё. Сгенерируйте её заново.';

export const LAYERS = [
  { key: 'card', label: 'Карточка', audience: 'население', time: '~30 секунд' },
  { key: 'brief', label: 'Справка', audience: 'бизнес и журналисты', time: '~3 минуты' },
  { key: 'full', label: 'Полный текст', audience: 'эксперты', time: '' },
];

const PARTS = {
  card: [['decision', 'Что решили'], ['why', 'Почему'], ['forYou', 'Что это значит для вас'], ['next', 'Что дальше']],
  brief: [['main', 'Главное'], ['why', 'Почему так решили'], ['forBusiness', 'Что изменится для бизнеса'], ['next', 'Что дальше']],
};

export const STATUS_LABELS = { same: 'без изм.', changed: 'изменено', added: 'добавлено' };
export const KIND_LABELS = { placeholder: 'заглушка', from_document: 'из документа', term_definition: 'определение термина' };
export const ISSUE_STATUS_LABELS = {
  in_quote_paragraph: 'правка в абзаце с цитатой',
  wrong_paragraph: 'правка не в том абзаце',
  no_edit: 'нет правки',
};

/**
 * The marks of one sentence, strongest first. `basis` is set when the author
 * has to compare the phrase with its basis — shown next to it, not on hover.
 */
export function itemMarks(item) {
  const c = item.checks ?? {};
  const marks = [];
  if (c.support?.ok === false) marks.push({ tone: 'low', label: 'не подтверждено документом', detail: c.support.reason });
  else if (c.support?.authorCheck) marks.push({ tone: 'mid', label: 'проверить автору', detail: 'связь между фактами не проверена' });
  if (c.numbers?.length) marks.push({ tone: 'low', label: 'число не найдено в документе', detail: c.numbers.join(', ') });
  if (c.mustBePlaceholder) marks.push({ tone: 'mid', label: 'должно быть заглушкой', detail: '' });
  if (c.terms?.length) marks.push({ tone: 'mid', label: 'термин без пояснения', detail: c.terms.join(', ') });
  if (c.long) marks.push({ tone: 'none', label: `длинное предложение: ${c.longest} слов`, detail: '' });
  const showBasis = !!item.basis && (c.support?.ok === false || c.support?.authorCheck);
  return { marks, basis: showBasis ? item.basis : '' };
}

function paragraphMarks(p) {
  const c = p.checks;
  const marks = [];
  if (!c) return { marks, basis: '' };
  if (c.removedNumbers?.length) marks.push({ tone: 'low', label: 'из абзаца убраны данные', detail: c.removedNumbers.join(', ') });
  if (c.authorCheck) {
    const detail = p.kind === 'term_definition' ? 'определение термина — не из документа'
      : p.status === 'changed' ? 'абзац переписан — сверьте с прежним текстом' : 'связь между фактами не проверена';
    marks.push({ tone: 'mid', label: 'проверить автору', detail });
  }
  if (c.numbers?.length) marks.push({ tone: 'low', label: 'число не найдено в документе', detail: c.numbers.join(', ') });
  if (c.mustBePlaceholder) marks.push({ tone: 'mid', label: 'должно быть заглушкой', detail: '' });
  return { marks, basis: c.authorCheck && c.bases?.length ? c.bases.join(' ') : '' };
}

const markText = (m) => `[${m.label}${m.detail ? `: ${m.detail}` : ''}]`;

function summaryLine(summary, bounds) {
  if (!summary) return '';
  const vol = bounds ? ` (норма ${bounds.min}–${bounds.max}${summary.withinVolume ? '' : ', вне нормы'})` : '';
  return [
    `${summary.chars} символов${vol}`,
    summary.minutes != null ? `~${String(summary.minutes).replace('.', ',')} мин чтения` : '',
    `заглушек: ${summary.placeholders.length}`,
    summary.marks != null ? `фраз с пометками: ${summary.marks}` : '',
    `«проверить автору»: ${summary.authorChecks ?? 0}`,
    summary.unsupported ? `не подтверждено: ${summary.unsupported}` : '',
    summary.numbersNotFound ? `чисел не из документа: ${summary.numbersNotFound}` : '',
  ].filter(Boolean).join(' · ');
}

/** The card or the brief: parts of marked sentences, figures, the summary. */
export function buildLayerModel(dto, layerKey) {
  const l = dto?.[layerKey];
  const meta = LAYERS.find((x) => x.key === layerKey);
  if (!l) return { key: layerKey, label: meta.label, audience: meta.audience, has: false };
  if (l.status === 'failed') return { key: layerKey, label: meta.label, audience: meta.audience, has: false, failed: l.failReason };
  const parts = PARTS[layerKey].map(([k, heading]) => ({
    key: k,
    heading,
    items: (l[k] ?? []).map((i) => ({ text: i.text, placeholder: i.placeholder, ...itemMarks(i) })),
  }));
  return {
    key: layerKey,
    label: meta.label,
    audience: meta.audience,
    has: true,
    stale: l.stale,
    parts,
    figures: (l.figures ?? []).map((f) => ({ ...f, marks: f.numbers?.length ? [{ tone: 'low', label: 'число не найдено в документе', detail: f.numbers.join(', ') }] : [] })),
    decision: l.decisionCheck,
    summary: summaryLine(l.summary, dto.bounds?.[layerKey]),
    placeholders: l.summary?.placeholders ?? [],
  };
}

/** The full text: «Главное», every paragraph with its tag, the issues and their statuses. */
export function buildFullModel(dto) {
  const l = dto?.full;
  if (!l) return { key: 'full', label: 'Полный текст', has: false };
  if (l.status === 'failed') return { key: 'full', label: 'Полный текст', has: false, failed: l.failReason };
  const statusCounts = Object.fromEntries(Object.keys(ISSUE_STATUS_LABELS).map((k) => [k, l.issues.filter((i) => i.status === k).length]));
  return {
    key: 'full',
    label: 'Полный текст',
    audience: 'эксперты',
    has: true,
    stale: l.stale,
    failNote: l.failReason,
    bluf: l.bluf.map((i) => ({ text: i.text, placeholder: i.placeholder, ...itemMarks(i) })),
    blufDecision: l.blufDecision,
    paragraphs: l.paragraphs.map((p) => ({
      id: p.id, status: p.status, tag: STATUS_LABELS[p.status], kind: p.kind ? KIND_LABELS[p.kind] : '',
      text: p.text, before: p.before, reason: p.reason, link: p.issueId ?? p.missingId ?? '',
      placeholder: (p.checks?.placeholders?.length ?? 0) > 0, ...paragraphMarks(p),
    })),
    issues: l.issues.map((i) => ({ ...i, statusLabel: ISSUE_STATUS_LABELS[i.status] })),
    statusCounts,
    edits: l.edits,
    integrity: l.integrity,
    sectionsFailed: l.sectionsFailed,
    summary: [
      `${l.summary?.chars ?? 0} символов`,
      `изменено абзацев: ${l.summary?.changed ?? 0}`,
      `добавлено: ${l.summary?.added ?? 0}`,
      `заглушек: ${l.summary?.placeholders.length ?? 0}`,
      `«проверить автору»: ${l.summary?.authorChecks ?? 0}`,
      `неизменных абзацев байт в байт: ${l.integrity.matching} из ${l.integrity.same}`,
      `отброшено правок: ${Object.values(l.edits.dropped).reduce((a, b) => a + b, 0)} (новое содержание — ${l.edits.dropped.newContent ?? 0})`,
    ].join(' · '),
    placeholders: l.summary?.placeholders ?? [],
  };
}

/** A sentence with its marks, as plain text — for the clipboard and the export. */
export function itemLine(item) {
  return [item.text, ...item.marks.map(markText), item.basis ? `(опора: «${item.basis}»)` : ''].filter(Boolean).join(' ');
}

/** The clipboard: the limitation first, placeholders as they are, the marks in brackets. */
export function copyText(model) {
  const lines = [LIMITATION, ''];
  if (model.key === 'full') {
    lines.push('Главное', model.bluf.map(itemLine).join(' '), '');
    for (const p of model.paragraphs) {
      const marks = [...p.marks.map(markText), p.basis ? `(опора: «${p.basis}»)` : ''].filter(Boolean).join(' ');
      lines.push(p.status === 'same' ? p.text.trim() : `[${p.tag}${p.kind ? `: ${p.kind}` : ''}] ${p.text.trim()}${marks ? ` ${marks}` : ''}`, '');
    }
  } else {
    for (const part of model.parts) {
      if (!part.items.length) continue;
      lines.push(part.heading, part.items.map(itemLine).join(' '), '');
    }
    if (model.figures?.length) lines.push('Ключевые цифры', ...model.figures.map((f) => `${f.indicator} — ${f.value}${f.marks.map(markText).join(' ')}`), '');
  }
  return lines.join('\n').trim();
}

/**
 * One version as a separate document for PDF/DOCX: a header with the version
 * and the document, the draft note and the limitation, then the text with its
 * marks and bases, then what the author has to write. Plain strings only —
 * the exporters copy them again for pdfmake.
 */
export function rewriteExportModel(dto, layerKey, docLine = '') {
  const model = layerKey === 'full' ? buildFullModel(dto) : buildLayerModel(dto, layerKey);
  const title = `${model.label} — ${dto?.document?.title ?? 'документ'}`;
  const header = [DRAFT_NOTE, LIMITATION, docLine, model.stale ? STALE_NOTE : ''].filter(Boolean);
  const blocks = [];
  if (!model.has) return { title, header, blocks: [{ heading: 'Версии нет', lines: [model.failed ? `Не получилась: ${model.failed}` : 'Версия ещё не сгенерирована.'] }], fileKey: layerKey };
  if (layerKey === 'full') {
    blocks.push({ heading: 'Главное (добавлено)', lines: model.bluf.map(itemLine) });
    blocks.push({
      heading: 'Текст',
      lines: model.paragraphs.flatMap((p) => {
        if (p.status === 'same') return [p.text.trim()];
        const marks = [...p.marks.map(markText), p.basis ? `(опора: «${p.basis}»)` : ''].filter(Boolean).join(' ');
        return [
          `[${p.tag}${p.kind ? `: ${p.kind}` : ''}${p.link ? ` · ${p.link}` : ''}] ${p.text.trim()}${marks ? ` ${marks}` : ''}`,
          ...(p.before ? [`Было: ${p.before.trim()}`] : []),
        ];
      }),
    });
    if (model.issues.length) {
      blocks.push({ heading: 'Замечания аудита: высокие и критичные', lines: [
        'Статус говорит, где правка, а не что замечание исправлено.',
        ...model.issues.map((i) => `${i.id} (${severityLabel(i.severity).toLowerCase()}) ${i.title} — ${i.statusLabel}`),
      ] });
    }
  } else {
    for (const part of model.parts) if (part.items.length) blocks.push({ heading: part.heading, lines: part.items.map(itemLine) });
    if (model.figures?.length) blocks.push({ heading: 'Ключевые цифры', lines: model.figures.map((f) => `${f.indicator} — ${f.value}${f.section ? ` (разд. ${f.section})` : ''}${f.marks.length ? ` ${f.marks.map(markText).join(' ')}` : ''}`) });
  }
  if (model.placeholders.length) blocks.push({ heading: `Что дописать автору — ${model.placeholders.length}`, lines: [...model.placeholders] });
  return { title, header, blocks, summary: model.summary, fileKey: layerKey };
}
