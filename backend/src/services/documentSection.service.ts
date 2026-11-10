import { DocumentSection, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { splitDocument, DocumentSectionDraft } from './documentSections';

// ─── Persisting sections ─────────────────────────────────────
//
// Sections are derived from Project.documentText and must never disagree with
// it, so they are rewritten in the same transaction as every write of the text:
// project creation, PATCH /projects/:id, and both /documents routes. There is no
// other way into the column.

type Tx = Prisma.TransactionClient;

/** Rows for a nested `sections: { create }` on project creation. */
export function sectionRows(text: string | null | undefined): DocumentSectionDraft[] {
  return text ? splitDocument(text).sections : [];
}

/** Replaces a project's sections to match `text` (null clears them). */
export async function replaceSections(tx: Tx, projectId: number, text: string | null | undefined): Promise<void> {
  await tx.documentSection.deleteMany({ where: { projectId } });
  const rows = sectionRows(text);
  if (rows.length === 0) return;
  await tx.documentSection.createMany({ data: rows.map((r) => ({ ...r, projectId })) });
}

/** True when the rows are exactly the document, in order, without gaps. */
export function sectionsMatch(text: string, rows: Pick<DocumentSection, 'text' | 'startOffset' | 'endOffset'>[]): boolean {
  if (rows.length === 0) return text.length === 0;
  if (rows[0].startOffset !== 0 || rows[rows.length - 1].endOffset !== text.length) return false;
  return rows.every((r, i) =>
    text.slice(r.startOffset, r.endOffset) === r.text &&
    (i === 0 || rows[i - 1].endOffset === r.startOffset));
}

/**
 * The project's sections, building them when they are missing or stale.
 *
 * Missing: a project created before sections existed and not yet backfilled.
 * Stale: a write of documentText that did not go through replaceSections — a
 * bug, but the audit should run on the real document rather than on old cuts,
 * so it is repaired here and logged.
 */
export async function sectionsFor(projectId: number, documentText: string): Promise<DocumentSection[]> {
  const rows = await prisma.documentSection.findMany({ where: { projectId }, orderBy: { order: 'asc' } });
  if (rows.length > 0 && sectionsMatch(documentText, rows)) return rows;
  if (rows.length > 0) {
    console.error(`[sections] project ${projectId}: stored sections do not match the document — rebuilding`);
  }
  await prisma.$transaction((tx) => replaceSections(tx, projectId, documentText));
  return prisma.documentSection.findMany({ where: { projectId }, orderBy: { order: 'asc' } });
}
