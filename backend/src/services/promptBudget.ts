import { env } from '../config/env';
import {
  CHARS_PER_PAGE_ESTIMATE,
  CHARS_PER_TOKEN_ESTIMATE,
  INPUT_SAFETY_TOKENS,
  PERSONA_PROMPT_RESERVE_TOKENS,
} from '../config/limits';
import { BadRequestError } from '../utils/errors';

// ─── Input budget (A1, stage 0) ──────────────────────────────
//
// Prompts used to be bounded by cutting the document to a fixed number of
// characters — 2000 for a persona, 2500 for the report, 6000 for the audit.
// Since the persona reads the whole document that is no longer possible, so the
// bound moved to the one quantity that is actually fixed: the model's context
// window. Every scenario sizes its prompt here, with one rule for what gives way
// when it does not fit: the transcript shrinks first, the document never.
//
// Counting is an estimate from characters, deliberately pessimistic — see
// CHARS_PER_TOKEN_ESTIMATE. An exact count would need the Qwen tokenizer, which
// neither the proxy (its token counter uses an OpenAI tokenizer) nor this
// process has.

/** Estimated tokens for one or more prompt parts. */
export function estimateTokens(parts: string | string[]): number {
  const chars = (Array.isArray(parts) ? parts : [parts]).reduce((sum, p) => sum + (p?.length ?? 0), 0);
  return Math.ceil(chars / CHARS_PER_TOKEN_ESTIMATE);
}

/** Tokens a prompt may take when the completion may take `maxTokens`. */
export function inputBudget(maxTokens: number): number {
  return env.llm.contextTokens - maxTokens - INPUT_SAFETY_TOKENS;
}

/**
 * Characters left for a transcript once the parts that are never trimmed — the
 * document above all — are in. Capped at `capChars`, never negative.
 *
 * Zero means the fixed parts alone fill the budget. The caller then sends no
 * transcript rather than failing: the document check at attach time
 * (assertDocumentFitsWindow) is what keeps that from happening in practice.
 */
export function transcriptRoomChars(maxTokens: number, fixedParts: string[], capChars: number): number {
  const left = inputBudget(maxTokens) - estimateTokens(fixedParts);
  if (left <= 0) return 0;
  return Math.min(capChars, Math.floor(left * CHARS_PER_TOKEN_ESTIMATE));
}

/**
 * Longest document, in characters, that a persona can read whole and still hear
 * a full round of the discussion.
 */
export function maxDocumentChars(): number {
  const tokens = inputBudget(env.llm.maxTokens.personaResponse) - PERSONA_PROMPT_RESERVE_TOKENS;
  return Math.max(0, Math.floor(tokens * CHARS_PER_TOKEN_ESTIMATE));
}

export function estimatePages(chars: number): number {
  return Math.max(1, Math.ceil(chars / CHARS_PER_PAGE_ESTIMATE));
}

/**
 * Refuses a document no persona could read whole.
 *
 * Applied wherever a document is attached to a project — creation, PATCH and
 * both /documents routes — so the limit is one number on every route rather than
 * a check on the first door only. Storing a document is bounded separately and
 * much more loosely (MAX_DOCUMENT_TEXT_CHARS); this is the bound on analysing it.
 */
export function assertDocumentFitsWindow(text: string | null | undefined, pages?: number | null): void {
  if (!text) return;
  const limit = maxDocumentChars();
  if (text.length <= limit) return;
  throw new BadRequestError(documentTooLongMessage(text.length, limit, pages ?? null));
}

/**
 * The refusal, in words a person can check against their document.
 *
 * The limit is characters, because characters are what fill the window. Pages
 * are named only to help: the real count when the file was a PDF, otherwise an
 * estimate that says it is one — a page of an NBK report holds ~2 600
 * characters and a page of plain prose ~4 000, so an estimate that pretended to
 * be a count called a 30-page report "~17 pages".
 */
export function documentTooLongMessage(chars: number, limit: number, pages: number | null): string {
  const size = pages
    ? `${pages} стр., ${chars.toLocaleString('ru-RU')} символов`
    : `${chars.toLocaleString('ru-RU')} символов, около ${estimatePages(chars)} стр. сплошного текста`;
  return `Документ слишком длинный: ${size}. Предел — ${limit.toLocaleString('ru-RU')} символов ` +
    `(около ${Math.floor(limit / CHARS_PER_PAGE_ESTIMATE)} стр. сплошного текста; у документов с графиками и таблицами страниц больше). ` +
    'Сократите документ или разделите его на части.';
}
