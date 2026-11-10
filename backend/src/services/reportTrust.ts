import {
  MAX_DIRECTIVE_HITS_PER_SOURCE,
  MAX_DIRECTIVE_HITS_TOTAL,
  MAX_PERSONA_SCAN_CHARS,
} from '../config/limits';
import { detectDirectives, isVerbatimQuote } from './promptSafety';
import { checklistItem } from '../config/auditChecklist';

// ─── Trust in model output ───────────────────────────────────
//
// promptSafety.ts guards the way *in*: untrusted text is fenced and the system
// message says it is data. This module guards the way *out* — it answers two
// questions about a finished report, in code, before the report is stored:
//
//   1. Did anything in the inputs try to instruct the model?
//   2. Does every fragment the model presents as quoted from the document
//      actually appear in the document?
//
// Both answers are *marks*, never filters. Nothing is deleted on the strength
// of them: a quote that drifted is a failed quote, not a failed finding, and a
// document containing an injection attempt still deserves to be analysed. The
// goal of the stage is that the model's output stops looking like a certified
// output of the system — not that suspicious input stops being processed.

/** One directive-like fragment found in the inputs, with its origin. */
export interface TrustDirective {
  /** Where it was found, phrased for the report to show as-is. */
  source: string;
  /** Short label for the kind of attempt (from promptSafety). */
  kind: string;
  /** The matched fragment, so a person can judge it for themselves. */
  excerpt: string;
}

/** Persona text as the scan sees it: library fields that reach a prompt. */
export interface PersonaScanInput {
  name: string;
  values: (string | null | undefined)[];
}

/**
 * The one alt-paragraph tag that makes a claim about the document.
 *
 * «изменено» and «добавлено» announce new text, so there is nothing to verify
 * — only «без изм.» asserts that this wording is already in the document, and
 * that assertion is checkable.
 */
export const ALT_TAG_UNCHANGED = 'без изм.';

export interface DirectiveScanInput {
  documentText?: string | null;
  /** The transcript, in order, as it was replayed into the prompts. */
  messages?: { name: string; text: string }[];
  personas?: PersonaScanInput[];
}

/**
 * Collects directive-like fragments from everything untrusted that fed the
 * report: the document, the transcript, and the editable persona fields.
 *
 * The transcript is included because it is model output that becomes model
 * input: a directive planted in the document can be echoed by a persona and
 * reach the next round's prompt from a source that looks like our own. Persona
 * fields are included because the library is shared and editable by any client
 * (item 7 is an open product question), and those fields go into the system
 * message.
 */
export function collectDirectives(input: DirectiveScanInput): TrustDirective[] {
  const out: TrustDirective[] = [];

  const push = (source: string, hits: { kind: string; excerpt: string }[]) => {
    for (const h of hits) {
      if (out.length >= MAX_DIRECTIVE_HITS_TOTAL) return;
      out.push({ source, kind: h.kind, excerpt: h.excerpt });
    }
  };

  if (input.documentText) {
    push('документ', detectDirectives(input.documentText, MAX_DIRECTIVE_HITS_PER_SOURCE));
  }

  // The transcript is one source with one budget, but the label names the
  // reply, because "it is also in the discussion" is only useful if you can
  // find where. Deduplicated across messages by kind+excerpt: a directive
  // planted in the document tends to be repeated by several personas, and
  // eight copies of the same line would crowd out every other finding.
  const messages = input.messages ?? [];
  if (messages.length > 0) {
    const seen = new Set<string>();
    const transcriptHits: TrustDirective[] = [];
    for (let i = 0; i < messages.length; i += 1) {
      if (transcriptHits.length >= MAX_DIRECTIVE_HITS_PER_SOURCE) break;
      const m = messages[i];
      for (const h of detectDirectives(m.text ?? '', MAX_DIRECTIVE_HITS_PER_SOURCE)) {
        const key = `${h.kind}|${h.excerpt.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        transcriptHits.push({
          source: `стенограмма, реплика ${i + 1} (${m.name})`,
          kind: h.kind,
          excerpt: h.excerpt,
        });
        if (transcriptHits.length >= MAX_DIRECTIVE_HITS_PER_SOURCE) break;
      }
    }
    for (const h of transcriptHits) {
      if (out.length >= MAX_DIRECTIVE_HITS_TOTAL) break;
      out.push(h);
    }
  }

  // Each persona is its own source: knowing *whose* profile carries the line is
  // the whole point, since fixing it means editing that persona.
  let scanned = 0;
  for (const p of input.personas ?? []) {
    if (out.length >= MAX_DIRECTIVE_HITS_TOTAL) break;
    if (scanned >= MAX_PERSONA_SCAN_CHARS) break;
    const text = p.values.filter(Boolean).join('\n');
    scanned += text.length;
    if (text.length === 0) continue;
    push(`профиль персоны: ${p.name}`, detectDirectives(text, MAX_DIRECTIVE_HITS_PER_SOURCE));
  }

  return out;
}

/**
 * Marks each audit issue with whether its quote is really in the document.
 *
 * The audit prompt demands a verbatim quote and the page prints it as one, in
 * quotation marks, under a severity badge — which is exactly the shape of a
 * statement that has been checked. Until now nothing checked it. An issue with
 * no quote at all also comes back false: a finding nobody can trace to a line
 * of the document is not a verified finding either.
 */
export function verifyIssueQuotes<T extends { quote: string; severity?: string; kind?: string; checkId?: string; quote2?: string }>(
  issues: T[],
  documentText: string,
): (T & { quoteVerified: boolean | null; quote2Verified: boolean | null; quoteVerifiedReason: string })[] {
  return issues.map((i) => {
    // An absence has nothing to quote (A1 stage 0a). Its weight cannot come
    // from a verified quote, so it comes from the checklist config by id — and
    // is set here, on the server, whatever the request said. An absence whose
    // id the config does not know is treated as an ordinary finding, so a
    // request cannot make an unverifiable finding count by labelling it.
    if (i.kind === 'absence') {
      const item = checklistItem(i.checkId ?? '');
      if (item) {
        return { ...i, severity: item.severity, quoteVerified: null, quote2Verified: null, quoteVerifiedReason: 'цитата неприменима' };
      }
      return { ...i, kind: 'finding', quoteVerified: isVerbatimQuote(i.quote, documentText), quote2Verified: null, quoteVerifiedReason: '' };
    }
    // A contradiction is two claims; each quote is checked on its own.
    if (i.kind === 'contradiction') {
      return {
        ...i,
        quoteVerified: isVerbatimQuote(i.quote, documentText),
        quote2Verified: isVerbatimQuote(i.quote2 ?? '', documentText),
        quoteVerifiedReason: '',
      };
    }
    return { ...i, quoteVerified: isVerbatimQuote(i.quote, documentText), quote2Verified: null, quoteVerifiedReason: '' };
  });
}

/**
 * Marks each alternative-wording paragraph tagged «без изм.» with whether that
 * is true.
 *
 * This is the output that travels furthest: the page renders it as the new text
 * of the document on a sheet of paper, and the PDF/DOCX export carries it out
 * of the product entirely. A paragraph labelled "unchanged" that is not in the
 * document is the worst case in the whole report — invented text wearing the
 * label that says it came from the source.
 *
 * `null` means the tag makes no claim about the document («изменено»,
 * «добавлено»), not that the check passed.
 */
export function verifyAltParagraphs<T extends { tag: string; text: string }>(
  alt: T[],
  documentText: string,
): (T & { verified: boolean | null })[] {
  return alt.map((a) => ({
    ...a,
    verified: a.tag === ALT_TAG_UNCHANGED ? isVerbatimQuote(a.text, documentText) : null,
  }));
}
