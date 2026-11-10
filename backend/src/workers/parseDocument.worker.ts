import fs from 'fs/promises';
import { parentPort, workerData } from 'worker_threads';
// Not 'pdf-parse': its package entry runs a debug block when module.parent is
// unset, which is exactly the case under the ESM loader this worker is started
// with. See src/types/pdf-parse-lib.d.ts.
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';
import type { DocumentKind } from '../utils/documentSignature';

// This file deliberately imports nothing from the project at runtime.
//
// The main process runs as CommonJS (tsconfig module: CommonJS), but a Worker
// started from it loads this file through the ESM loader, where an extensionless
// relative specifier like '../config/limits' does not resolve — the first
// version imported the character cap directly and every parse died with
// ERR_MODULE_NOT_FOUND. Rather than duplicate the constant here (which would put
// a second copy of a limit outside config/limits.ts) the parent passes it in
// workerData. Package and builtin specifiers resolve under either loader, so
// fs / worker_threads / pdf-parse / mammoth are fine, and the DocumentKind
// import is type-only and erased at compile time.

// Runs pdf-parse / mammoth off the main thread.
//
// The point is not speed — real documents parse in under 140 ms. The point is
// containment: both parsers are synchronous-ish, CPU-bound and fed untrusted
// input, and in the main process a pathological file froze the whole API,
// /api/health included. Here the worst case is one dead worker.
//
// Two limits are imposed from the outside by the parent (see
// services/documentParser.ts): a wall-clock timeout enforced with terminate(),
// and resourceLimits.maxOldGenerationSizeMb. Neither can be bargained with from
// inside this file, which is the reason they live there and not here.

export interface ParseRequest {
  filePath: string;
  kind: DocumentKind;
  /** MAX_DOCUMENT_TEXT_CHARS, supplied by the parent — see the note above. */
  maxChars: number;
}

export interface ParseResult {
  /** Extracted text, already truncated to the requested maxChars. */
  text: string | null;
  /** Length before truncation, so the caller can tell the user what happened. */
  originalLength: number;
  truncated: boolean;
  /**
   * Pages of a PDF, null for every other format. Characters per page vary
   * too much to estimate pages from length — NBK reports run ~2 600 a page
   * (charts and tables), plain prose ~4 000 — so a message about a document's
   * size uses the real count when there is one.
   */
  pages: number | null;
}

async function extract(req: ParseRequest): Promise<{ text: string | null; pages: number | null }> {
  switch (req.kind) {
    case 'text': {
      return { text: (await fs.readFile(req.filePath, 'utf-8')).trim() || null, pages: null };
    }
    case 'pdf': {
      const buffer = await fs.readFile(req.filePath);
      const { text, numpages } = await pdfParse(buffer);
      return { text: text.trim() || null, pages: Number.isFinite(numpages) ? numpages : null };
    }
    case 'docx': {
      const { value } = await mammoth.extractRawText({ path: req.filePath });
      return { text: value.trim() || null, pages: null };
    }
    case 'doc':
      // Legacy binary .doc is not supported by mammoth. The upload still
      // succeeds and the user pastes the text manually — unchanged behaviour.
      return { text: null, pages: null };
    default:
      return { text: null, pages: null };
  }
}

async function run(): Promise<void> {
  const req = workerData as ParseRequest;
  const { text: raw, pages } = await extract(req);

  if (raw === null) {
    parentPort?.postMessage({ text: null, originalLength: 0, truncated: false, pages } satisfies ParseResult);
    return;
  }

  // Truncate here rather than in the parent: a 20 MB PDF yields ~19M
  // characters, and copying all of that across the thread boundary only to
  // discard 97% of it would make the structuredClone the most expensive step in
  // the request.
  const originalLength = raw.length;
  const truncated = originalLength > req.maxChars;
  const text = truncated ? raw.slice(0, req.maxChars) : raw;

  parentPort?.postMessage({ text, originalLength, truncated, pages } satisfies ParseResult);
}

run().catch((err: unknown) => {
  // Surface the reason to the parent as a normal worker 'error' event, which it
  // already handles, instead of an unhandled rejection that would just kill the
  // thread with no explanation.
  throw err instanceof Error ? err : new Error(String(err));
});
