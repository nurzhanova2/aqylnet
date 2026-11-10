import fs from 'fs/promises';
import path from 'path';
import { env } from '../config/env';

// Uploaded files used to be kept forever: nothing in the codebase called
// unlink, so every document ever submitted accumulated in the volume (144 files
// at the time this was written). Combined with /uploads being served publicly,
// that was a growing pile of other people's documents behind a guessable URL.
//
// Now the file is a transient: it exists only long enough to extract text from,
// and the extracted text — not the file — is what the product actually uses.

/**
 * Removes an uploaded file, ignoring the case where it is already gone.
 *
 * Idempotent on purpose: the success path discards the file after extraction
 * and the error path discards it again on the way out, and neither should have
 * to know whether the other already ran. Failure to delete is logged, never
 * thrown — losing a temp file is not worth failing a request the user
 * otherwise completed.
 */
export async function discardUpload(filePath: string | null | undefined): Promise<void> {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    console.error(`[uploadFiles] could not remove ${filePath}:`, err);
  }
}

/**
 * Removes the file behind a stored `Project.documentFile` value.
 *
 * The column holds the public-style URL the upload returned ("/uploads/<name>"),
 * not a filesystem path, so the name is resolved against UPLOAD_DIR here.
 * basename() is applied before joining: the value is read back from the
 * database, and a stored "../../etc/something" must not be able to steer an
 * unlink outside the upload directory.
 */
export async function discardStoredDocument(
  documentFile: string | null | undefined,
): Promise<void> {
  if (!documentFile) return;
  const name = path.basename(documentFile);
  if (!name || name === '.' || name === '..') return;
  await discardUpload(path.join(path.resolve(env.uploadDir), name));
}
