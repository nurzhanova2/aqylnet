import path from 'path';
import { Worker } from 'worker_threads';
import { MAX_DOCUMENT_TEXT_CHARS } from '../config/limits';
import { env } from '../config/env';
import { BadRequestError } from '../utils/errors';
import { inspectDocx } from '../utils/docxArchive';
import { kindForExtension, verifySignature } from '../utils/documentSignature';
import type { ParseRequest, ParseResult } from '../workers/parseDocument.worker';

// Orchestrates everything that happens between "multer wrote a file" and "we
// have text": signature check, archive screening, then the parse itself in an
// isolated worker under a wall-clock and heap limit.
//
// Nothing here deletes the uploaded file. That is deliberate — the file is
// removed through the single path in utils/uploadFiles.ts, which the controller
// calls in a `finally` on every exit, success or failure. Adding a second
// delete site here is exactly how one branch ends up leaking files.

export interface ParsedDocument {
  text: string | null;
  /** Characters produced before MAX_DOCUMENT_TEXT_CHARS was applied. */
  originalLength: number;
  truncated: boolean;
  /** Real page count of a PDF; null for other formats. */
  pages: number | null;
}

// Under tsx the running file is .ts and the worker must be .ts; after `tsc` both
// are .js in dist/. Deriving the extension from __filename covers both without
// a build step that copies files around or an env flag to get wrong. Verified
// in both modes.
function workerPath(): string {
  const ext = path.extname(__filename);
  return path.join(__dirname, '..', 'workers', `parseDocument.worker${ext}`);
}

function runInWorker(req: ParseRequest): Promise<ParseResult> {
  return new Promise<ParseResult>((resolve, reject) => {
    const worker = new Worker(workerPath(), {
      workerData: req,
      resourceLimits: { maxOldGenerationSizeMb: env.documentParseMaxHeapMb },
    });

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Fire and forget: the worker is already done with us either way, and
      // awaiting terminate() would make a timeout wait on the very thread that
      // is not responding.
      void worker.terminate();
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new BadRequestError(
        'Не удалось обработать документ: превышено время разбора ' +
        `(${(env.documentParseTimeoutMs / 1000).toFixed(1)} с). ` +
        'Попробуйте файл меньшего размера или вставьте текст вручную.',
      )));
    }, env.documentParseTimeoutMs);

    worker.on('message', (msg: ParseResult) => finish(() => resolve(msg)));

    worker.on('error', (err) => {
      // Covers both a thrown parser error and hitting the heap ceiling, which
      // arrives here as ERR_WORKER_OUT_OF_MEMORY.
      console.error('[documentParser] worker failed:', err);
      finish(() => reject(new BadRequestError(
        'Не удалось обработать документ: файл слишком сложный или повреждён. ' +
        'Попробуйте другой файл или вставьте текст вручную.',
      )));
    });

    worker.on('exit', (code) => {
      // A worker that exits without a message and without an error has died in
      // a way neither handler saw; failing closed beats hanging the request.
      finish(() => reject(new BadRequestError(
        `Не удалось обработать документ: разбор прерван (код ${code}).`,
      )));
    });
  });
}

/**
 * Validates the stored file and extracts its text.
 *
 * Throws BadRequestError (→ 400) when the content does not match the extension,
 * when a .docx looks like a zip bomb, or when the parse exceeds its time or
 * memory budget. Returns `text: null` for formats with no extractor (legacy
 * .doc) — that is not an error and never was.
 */
export async function parseDocument(
  filePath: string,
  originalName: string,
): Promise<ParsedDocument> {
  const ext = path.extname(originalName).toLowerCase();
  const kind = kindForExtension(ext);

  // config/multer.ts already refused anything outside ALLOWED_EXT, so reaching
  // here with an unknown extension would mean the two lists have drifted apart.
  if (!kind) {
    throw new BadRequestError(`Формат ${ext || 'без расширения'} не поддерживается.`);
  }

  const signature = await verifySignature(filePath, kind);
  if (!signature.ok) throw new BadRequestError(signature.reason);

  if (kind === 'docx') {
    const archive = await inspectDocx(filePath);
    if (!archive.ok) throw new BadRequestError(archive.reason);
  }

  // maxChars travels in workerData rather than being imported by the worker:
  // the worker is loaded as ESM and cannot resolve the project's extensionless
  // relative imports. See the note at the top of the worker.
  const result = await runInWorker({ filePath, kind, maxChars: MAX_DOCUMENT_TEXT_CHARS });
  return {
    text: result.text,
    originalLength: result.originalLength,
    truncated: result.truncated,
    pages: result.pages ?? null,
  };
}
