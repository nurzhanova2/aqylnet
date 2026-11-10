import { z } from 'zod';

// ─── Sub-schemas (mirror frontend mock shapes exactly) ────────

const ConclusionSchema = z.object({
  n:    z.number().int().positive(),
  text: z.string().min(1),
});

const TopicBarSchema = z.object({
  name: z.string().min(1),
  pct:  z.number().min(0).max(100),
});

const PositiveSchema = z.object({
  text: z.string().min(1),
  by:   z.string(),
});

// Storage shape. `verified` is the server's answer to the claim the tag makes:
// true/false for «без изм.» (the only tag that asserts the wording is already
// in the document), null for «изменено»/«добавлено», which announce new text
// and have nothing to check. See services/reportTrust.ts.
const AltParagraphSchema = z.object({
  tag:      z.string().min(1),
  text:     z.string().min(1),
  color:    z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color must be a hex color'),
  verified: z.boolean().nullable().default(null),
});

const AltParagraphInputSchema = AltParagraphSchema.omit({ verified: true });

// ─── Document audit sub-schemas ───────────────────────────────
// Produced by generateDocumentAudit() and stored in AnalyticsReport.extras as
// one Json blob — the report page reads and renders the whole block together.

const AuditScoreSchema = z.object({
  key:   z.string().min(1),
  label: z.string().min(1),
  value: z.number().min(0).max(100),
  note:  z.string().default(''),
});

const AuditIssueSchema = z.object({
  code:       z.string().min(1),
  title:      z.string().min(1),
  category:   z.string().min(1),
  severity:   z.enum(['Critical', 'High', 'Medium', 'Low']),
  quote:      z.string().default(''),
  raisedBy:   z.string().default(''),
  agreedBy:   z.string().default(''),
  disputedBy: z.string().default(''),
  // Heading of the document section the finding came from (A1 stage 0). Empty
  // on reports written before the audit ran per section.
  section:    z.string().default(''),
  // A1 stage 0a — what sort of finding: a quoted finding, a checklist absence
  // (no quote possible), a checklist "partly", or a contradiction with a
  // second quote. Rows written before 0a are findings.
  kind:       z.enum(['finding', 'absence', 'partial', 'contradiction']).default('finding'),
  checkId:    z.string().default(''),
  // Which audience a finding about consequences is for; one such finding per
  // audience per document after the merge. Empty for every other finding.
  audience:   z.enum(['depositors', 'borrowers', 'business', '']).default(''),
  quote2:     z.string().default(''),
  section2:   z.string().default(''),
  // Server verdicts, never accepted from a request (see the input schema):
  // whether the contradiction's second quote is in the document, and why a
  // quote was not checked at all ("цитата неприменима" for an absence).
  quote2Verified:      z.boolean().nullable().default(null),
  quoteVerifiedReason: z.string().default(''),
  // Whether `quote` was actually found in the document. Computed server-side —
  // the prompt demands a verbatim quote and the page prints it as one, which
  // until now nobody checked.
  //
  // Three states, not two: null means the check never ran. Reports written
  // before this stage have no such key, and defaulting them to `false` would
  // accuse every old issue of an invented quote — a false flag is the one
  // outcome that would make the mark worthless.
  quoteVerified: z.boolean().nullable().default(null),
});

const AuditIssueInputSchema = AuditIssueSchema.omit({ quoteVerified: true, quote2Verified: true, quoteVerifiedReason: true });

// One answer of the absences checklist (config/auditChecklist.ts), kept in full.
// "есть"/"нет" is the verdict the code gives from the model's evidence;
// "да"/"частично" were the model's own verdicts in the first 0a acceptance and
// stay readable — the extras blob is read with safeParse, and one unknown value
// would empty the whole audit of those reports.
const ChecklistAnswerSchema = z.object({
  id:      z.string().min(1),
  answer:  z.enum(['есть', 'нет', 'да', 'частично']),
  section: z.string().default(''),
  quote:   z.string().default(''),
  reason:  z.string().default(''),
});

// Directive-like fragments found in the untrusted inputs that fed the report
// (document, transcript, persona profiles). A signal for the reader, not a
// filter: see services/reportTrust.ts.
const TrustDirectiveSchema = z.object({
  source:  z.string().min(1),
  kind:    z.string().min(1),
  excerpt: z.string().min(1),
});

// One row of the document map. Since A1 stage 0 the rows are the stored
// sections of the document (DocumentSection), not the model's guess at its
// structure, and a section whose audit call failed stays on the map with
// `analyzed: false` and no clarity — so the report says what it did not look
// at. Rows written before stage 0 have no `analyzed` key: they were analysed.
const AuditSectionSchema = z.object({
  title:    z.string().min(1),
  clarity:  z.number().min(0).max(100).nullable(),
  note:     z.string().default(''),
  analyzed: z.boolean().default(true),
});

const AuditAlignmentSchema = z.object({
  message:   z.string().min(1),
  score:     z.number().min(0).max(100),
  perceived: z.string().default(''),
  verdict:   z.string().default(''),
});

// Storage shape: what the extras column holds and what is read back out of it.
// overallScore belongs here because it is persisted — it just is not accepted
// from outside.
export const AnalyticsExtrasSchema = z.object({
  overallScore: z.number().min(0).max(100).nullable().default(null),
  scores:       z.array(AuditScoreSchema).default([]),
  issues:       z.array(AuditIssueSchema).default([]),
  sections:     z.array(AuditSectionSchema).default([]),
  alignment:    z.array(AuditAlignmentSchema).default([]),
  directives:   z.array(TrustDirectiveSchema).default([]),
  // The checklist answers in full (stage 0a); null = did not run, which is not
  // the same as "ran and found everything".
  checklist:    z.array(ChecklistAnswerSchema).nullable().default(null),
  // Whether the verification pass ran for this report at all.
  //
  // Without it an empty `directives` list would read as "scanned, nothing
  // found" on a report that was never scanned — the same false reassurance the
  // stage exists to remove, just moved one level up.
  trustChecked: z.boolean().default(false),
});

// Client-input shape: the same thing minus everything the server works out for
// itself — overallScore, the per-issue quote verdict, and the directive list.
//
// The project's rule is that aggregates are computed in code, never named by
// the model — because a number that does not move when its own
// breakdown moves is not a measurement. PUT /:id/analytics accepted the whole
// extras blob including overallScore, so one request could set a quality score
// of 100 on a document full of Critical issues and the rule was bypassed
// without touching the prompt at all.
//
// The stage E6 fields follow the same rule for the same reason. A verdict on
// whether a quote is really in the document is worth exactly as much as the
// care taken to check it; if it could arrive in the request body, it would be
// a decoration that says "checked" without anything having been checked.
//
// Zod strips unknown keys, so a client that still sends these is ignored
// rather than rejected, and the values are recomputed server-side from the
// document and the parts that *are* accepted. Structurally there is no path
// from the request body to them.
export const AnalyticsExtrasInputSchema = AnalyticsExtrasSchema
  .omit({ overallScore: true, directives: true, trustChecked: true, issues: true })
  .extend({ issues: z.array(AuditIssueInputSchema).default([]) });

export const EMPTY_EXTRAS: AnalyticsExtras = {
  overallScore: null, scores: [], issues: [], sections: [], alignment: [],
  directives: [], trustChecked: false, checklist: null,
};

// ─── Main schema ─────────────────────────────────────────────

export const UpsertAnalyticsSchema = z.object({
  conclusions:     z.array(ConclusionSchema).default([]),
  topicBars:       z.array(TopicBarSchema).default([]),
  risks:           z.array(z.string()).default([]),
  positives:       z.array(PositiveSchema).default([]),
  recommendations: z.array(z.string()).default([]),
  altParagraphs:   z.array(AltParagraphInputSchema).default([]),
  extras:          AnalyticsExtrasInputSchema.default({
    scores: [], issues: [], sections: [], alignment: [], checklist: null,
  }),
});

// ─── Types ───────────────────────────────────────────────────

export type AnalyticsExtras      = z.infer<typeof AnalyticsExtrasSchema>;
export type AnalyticsExtrasInput = z.infer<typeof AnalyticsExtrasInputSchema>;
export type AuditIssue          = z.infer<typeof AuditIssueSchema>;
export type AltParagraph        = z.infer<typeof AltParagraphSchema>;
export type UpsertAnalyticsInput = z.infer<typeof UpsertAnalyticsSchema>;
