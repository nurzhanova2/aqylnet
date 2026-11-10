import { env } from '../config/env';
import { AUDIT_SECTION_CONCURRENCY } from '../config/limits';
import { mapLimit } from '../utils/mapLimit';
import { contradictionCandidates, mergeAudit } from './auditMerge';
import { textForQuotes } from './auditQuoteRules';
import { sectionsFor } from './documentSection.service';
import {
  DocumentAuditRaw,
  NumberedClaim,
  confirmContradictions,
  generateAudienceAlignment,
  generateAuditChecklist,
  generateSectionAudit,
  sectionTitle,
} from './llm.service';

// ─── The document audit, section by section (A1, stages 0 and 0a) ──
//
// One call per section of the stored document, at most
// AUDIT_SECTION_CONCURRENCY in flight; alongside them the checklist of
// absences over the whole document and, when the author named key messages,
// the alignment call; when contradictions are on (AUDIT_CONTRADICTIONS, off by
// default), after the sections the claims they extracted are paired
// in code into contradiction candidates, and one short call confirms or rejects
// them (none when there are no candidates). Then a merge in code (auditMerge.ts).
// Every call records its own LlmUsage row inside the generators. The daily
// ceiling is checked once for the whole report request in report.service.ts —
// not per call.
//
// A section whose call fails is marked "not analysed" on the map and left out
// of the averages; a failed checklist is stored as "did not run"; neither costs
// the rest of the audit.

export interface DocumentAuditInput {
  projectId:        number;
  documentText:     string;
  discussionTask:   string | null;
  personas:         { name: string; role: string; stance: string }[];
  timeline:         { speaker: string; text: string }[];
  goal:             string;
  intendedMessages: string[];
}

export async function runDocumentAudit(input: DocumentAuditInput): Promise<DocumentAuditRaw> {
  const sections = await sectionsFor(input.projectId, input.documentText);
  const outline = sections.map((s) => sectionTitle(s.order, s.heading));

  const [results, alignment, checklist] = await Promise.all([
    mapLimit(sections, AUDIT_SECTION_CONCURRENCY, (s) => generateSectionAudit({
      order:          s.order,
      total:          sections.length,
      heading:        s.heading,
      text:           s.text,
      outline,
      documentText:   input.documentText,
      discussionTask: input.discussionTask,
      personas:       input.personas,
      timeline:       input.timeline,
      goal:           input.goal,
    })),
    generateAudienceAlignment(input.personas, input.timeline, input.intendedMessages),
    generateAuditChecklist(input.documentText, outline),
  ]);

  // Claims of every analysed section, numbered across the document, each with
  // the section it came from — the contradiction search needs both.
  const claims: NumberedClaim[] = [];
  results.forEach((r, i) => {
    if (!r?.ok) return;
    for (const c of r.claims) claims.push({ ...c, id: claims.length + 1, section: outline[i]! });
  });
  // The code pairs the candidates (one phenomenon, opposite directions, same
  // fact/forecast type, verbatim quotes); the model only confirms them. Off by
  // default (AUDIT_CONTRADICTIONS): then the sections return no claims, and
  // no call is made.
  const contradictions = env.llm.auditContradictions
    ? await confirmContradictions(contradictionCandidates(claims, textForQuotes(input.documentText)))
    : [];
  return mergeAudit(
    sections.map((s, i) => ({ order: s.order, heading: s.heading, length: s.text.length, result: results[i]! })),
    alignment,
    { documentText: input.documentText, firstSectionText: sections[0]?.text ?? '', checklist, claims, contradictions },
  );
}
