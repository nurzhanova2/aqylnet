import { z } from 'zod';

// Three versions of the text (A1 stage 3).
//
// POST /projects/:id/rewrites takes no body; POST /projects/:id/rewrites/:layer
// takes the layer in the path. What is stored is checked here: the model's
// text after normalisation, and every verdict of the code's checks. Nothing
// reaches the table without Zod; nothing of it is accepted from a request.

export const REWRITE_LAYERS = ['card', 'brief', 'full'] as const;
export type RewriteLayer = typeof REWRITE_LAYERS[number];

export const RunRewritesSchema = z.object({}).passthrough();
export const RewriteLayerParamSchema = z.enum(REWRITE_LAYERS);

const ItemChecksSchema = z.object({
  numbers:   z.array(z.string()),
  terms:     z.array(z.string()).nullable(),
  longest:   z.number().int().min(0),
  long:      z.boolean(),
  unsourced: z.boolean(),
  // Support by a verbatim basis (04.11.2026); null for a placeholder.
  support:   z.object({
    ok:            z.boolean(),
    reason:        z.string(),
    basis:         z.string(),
    basisVerified: z.boolean(),
    coverage:      z.number().min(0).max(1).nullable(),
    missingWords:  z.array(z.string()),
    basisCoverage: z.number().min(0).max(1).nullable().default(null),
    // «Проверить автору»: backed, but weakly by the basis alone.
    authorCheck:   z.boolean().default(false),
  }).nullable().default(null),
  mustBePlaceholder: z.boolean().default(false),
});

export const RewriteItemSchema = z.object({
  text:           z.string(),
  basis:          z.string().default(''),
  sourceSections: z.array(z.number().int().positive()),
  placeholder:    z.boolean(),
  checks:         ItemChecksSchema,
});

const DecisionCheckSchema = z.object({ ok: z.boolean(), reason: z.string() }).nullable();

const SummarySchema = z.object({
  chars:           z.number().int().min(0),
  withinVolume:    z.boolean().nullable(),
  minutes:         z.number().min(0),
  placeholders:    z.array(z.string()),
  marks:           z.number().int().min(0),
  numbersNotFound: z.number().int().min(0),
  unsupported:     z.number().int().min(0).default(0),
  mustBePlaceholder: z.number().int().min(0).default(0),
  authorChecks:    z.number().int().min(0).default(0),
  longShare:       z.number().min(0).max(1).nullable(),
});

// Every layer: which prompt, on which audience analysis, when — and whether
// the call produced anything. A failed layer keeps only this.
const LayerMeta = {
  status:      z.enum(['ok', 'failed']),
  failReason:  z.string(),
  version:     z.string(),
  basedOn:     z.string(),
  generatedAt: z.string(),
};

export const CardLayerSchema = z.object({
  ...LayerMeta,
  decision:      z.array(RewriteItemSchema).default([]),
  why:           z.array(RewriteItemSchema).default([]),
  forYou:        z.array(RewriteItemSchema).default([]),
  next:          z.array(RewriteItemSchema).default([]),
  decisionCheck: DecisionCheckSchema.default(null),
  summary:       SummarySchema.nullable().default(null),
});

export const BriefLayerSchema = z.object({
  ...LayerMeta,
  main:          z.array(RewriteItemSchema).default([]),
  why:           z.array(RewriteItemSchema).default([]),
  forBusiness:   z.array(RewriteItemSchema).default([]),
  next:          z.array(RewriteItemSchema).default([]),
  figures:       z.array(z.object({
    indicator: z.string(),
    value:     z.string(),
    section:   z.number().int().positive().nullable(),
    // Numbers of the value not found in the document.
    numbers:   z.array(z.string()),
  })).default([]),
  decisionCheck: DecisionCheckSchema.default(null),
  summary:       SummarySchema.nullable().default(null),
});

const FullParagraphSchema = z.object({
  id:        z.string(),
  order:     z.number().int().min(0),
  status:    z.enum(['same', 'changed', 'added']),
  text:      z.string(),
  before:    z.string().nullable(),
  reason:    z.string(),
  issueId:   z.string().nullable(),
  missingId: z.string().nullable(),
  kind:      z.enum(['placeholder', 'from_document', 'term_definition']).nullable().default(null),
  checks:    z.object({
    numbers:           z.array(z.string()),
    placeholders:      z.array(z.string()),
    mustBePlaceholder: z.boolean().default(false),
    // term_definition: «проверить автору».
    authorCheck:       z.boolean().default(false),
    coverage:          z.number().min(0).max(1).nullable().default(null),
    bases:             z.array(z.string()).default([]),
    // replace: numbers of the source paragraph the replacement dropped.
    removedNumbers:    z.array(z.string()).default([]),
  }).nullable(),
});

export const FullLayerSchema = z.object({
  ...LayerMeta,
  bluf:          z.array(RewriteItemSchema).default([]),
  // The decision in the first sentence of «Главное».
  blufDecision:  DecisionCheckSchema.default(null),
  paragraphs:    z.array(FullParagraphSchema).default([]),
  issues:        z.array(z.object({
    id:       z.string(),
    severity: z.string(),
    title:    z.string(),
    section:  z.string(),
    // Code (04.11.2026, «исправлено» is gone): where its edits landed.
    status:   z.enum(['in_quote_paragraph', 'wrong_paragraph', 'no_edit']),
  })).default([]),
  edits:         z.object({
    applied: z.number().int().min(0),
    dropped: z.object({ unknownParagraph: z.number().int().min(0), noLink: z.number().int().min(0), duplicate: z.number().int().min(0), newContent: z.number().int().min(0).default(0) }),
  }).default({ applied: 0, dropped: { unknownParagraph: 0, noLink: 0, duplicate: 0, newContent: 0 } }),
  sectionsFailed: z.array(z.object({ order: z.number().int().min(0), title: z.string(), reason: z.string() })).default([]),
  // Unchanged paragraphs equal to the source byte for byte, out of all unchanged.
  integrity:     z.object({ same: z.number().int().min(0), matching: z.number().int().min(0) }).default({ same: 0, matching: 0 }),
  summary:       z.object({
    chars:           z.number().int().min(0),
    placeholders:    z.array(z.string()),
    numbersNotFound: z.number().int().min(0),
    unsupported:     z.number().int().min(0).default(0),
    mustBePlaceholder: z.number().int().min(0).default(0),
    authorChecks:    z.number().int().min(0).default(0),
    changed:         z.number().int().min(0),
    added:           z.number().int().min(0),
  }).nullable().default(null),
});

export type RewriteItemRow = z.infer<typeof RewriteItemSchema>;
export type CardLayer = z.infer<typeof CardLayerSchema>;
export type BriefLayer = z.infer<typeof BriefLayerSchema>;
export type FullLayer = z.infer<typeof FullLayerSchema>;
export type RewriteLayers = { card: CardLayer | null; brief: BriefLayer | null; full: FullLayer | null };
