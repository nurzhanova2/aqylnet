// Wording for the marks that say how far the report has been checked.
//
// One module, because the same sentence has to appear in three places that are
// easy to let drift apart: the page, the PDF/DOCX export and the clipboard. The
// export is the copy that leaves the product and gets read by people who never
// saw the page, so it is the one that must not lose the mark.
//
// This is product wording, not a mechanism — it is meant to be edited. The
// mechanism is in backend/src/services/reportTrust.ts, which decides what is
// verified; nothing here makes that decision.

/** Appended wherever the alternative wording is reproduced in full. */
export const ALT_DISCLAIMER =
  '\n\n— Альтернативная редакция предложена моделью по итогам обсуждения. '
  + 'Это не вывод системы и не проверенный юридический текст: перед использованием сверьте с документом.';

/** Shown next to an audit issue whose quote is not in the document. */
export const QUOTE_UNVERIFIED = 'цитата не найдена в документе дословно';

/** Shown next to a «без изм.» paragraph that is not in the document. */
export const ALT_UNVERIFIED = 'нет в документе';

/**
 * A section of the document map whose audit call failed. The report says what
 * it did not look at instead of averaging over fewer sections without a word.
 */
export const SECTION_NOT_ANALYZED = 'не проанализирован';

/** `Раздел — понятность 72/100` or `Раздел — не проанализирован` for text output. */
export function sectionLine(s) {
  const head = s?.analyzed === false || s?.clarity == null
    ? `${s.title} — ${SECTION_NOT_ANALYZED}`
    : `${s.title} — понятность ${s.clarity}/100`;
  return s?.note && s?.analyzed !== false ? `${head}. ${s.note}` : head;
}

/**
 * A1 stage 0a — findings that are not "a quote with a problem".
 *
 * An absence comes from a checklist question answered "no": there is nothing to
 * quote, and the page must say so instead of leaving an empty quote block that
 * reads like a lost one. A contradiction carries two quotes from two sections.
 */
export const ABSENCE_PREFIX = 'В документе нет';
export const ABSENCE_NOTE = 'Найдено проверочным вопросом ко всему документу; цитата неприменима.';
// A contradiction is shown as possible and never lowers the score: in acceptance
// every reported pair was false (decision of 03.11.2026). Off by default on the
// server (AUDIT_CONTRADICTIONS).
export const CONTRADICTION_LABEL = 'Возможное противоречие между разделами';

/** The heading a finding is shown under, the same on the page and in the file. */
export function issueHeading(i) {
  return i?.kind === 'absence' ? `${ABSENCE_PREFIX}: ${i.title}` : (i?.title ?? '');
}

/** Shown under the unverified-quotes notice: such findings stay, but do not lower the score. */
export const UNVERIFIED_DO_NOT_CAP = 'Такие замечания показаны, но итоговый балл они не ограничивают.';

/** Shown on a report created before the verification pass existed. */
export const TRUST_NOT_CHECKED =
  'Отчёт сформирован до появления автоматической проверки: цитаты и фрагменты «без изм.» '
  + 'в нём с документом не сверялись. Проверка появится после повторного формирования отчёта.';

/** Heading and explanation for the directive block. */
export const DIRECTIVES_TITLE = 'Во входных данных есть указания, адресованные модели';
export const DIRECTIVES_NOTE =
  'Фрагменты ниже выглядят как попытка управлять анализом, а не как содержание документа или мнение участника. '
  + 'Ничего не удалялось и обсуждение не прерывалось — это пометка для чтения отчёта, а не блокировка.';

/** `[без изм. (нет в документе)]` — the tag as it appears in text output. */
export function altTagLabel(a) {
  return a?.verified === false ? `${a.tag} (${ALT_UNVERIFIED})` : (a?.tag ?? '');
}
