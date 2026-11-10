import { prisma }            from '../config/prisma';
import { assertProjectAccess } from '../middlewares/projectOwnership';
import { discardUpload }       from '../utils/uploadFiles';
import { parseDocument }       from './documentParser';
import { replaceSections }     from './documentSection.service';
import { assertDocumentFitsWindow } from './promptBudget';

// ─── DTOs ────────────────────────────────────────────────────

export interface FileDocumentDTO {
  fileName:    string;    // original name uploaded by user
  storedName:  string;    // name on disk (unique)
  // Kept for the document chip in the UI, which uses it as "a file was
  // uploaded" plus a source for the displayed name. It is no longer a
  // fetchable URL: /uploads is not served any more and the file itself is
  // deleted once its text has been extracted.
  fileUrl:     string;
  fileSize:    number;    // bytes
  mimeType:    string;
  projectId:   number | null;
  // Text extracted from the file so the discussion pipeline (and auto-suggest)
  // has something to work with even if the user only uploads a file and never
  // pastes text. Null when the format isn't supported (legacy .doc) — a
  // document whose content does not match its extension, or which cannot be
  // parsed within the time and memory budget, is now a 400 instead of a silent
  // null (see services/documentParser.ts).
  extractedText: string | null;
  // Set when the document produced more than MAX_DOCUMENT_TEXT_CHARS and was
  // cut. Reported rather than hidden: the chosen behaviour is "truncate and say
  // so", and a report built from part of a document must not look like a report
  // built from all of it. extractedLength is the length before cutting.
  truncated:      boolean;
  extractedLength: number;
}

// busboy/multer decode multipart headers as latin1 regardless of the actual
// charset (the multipart spec doesn't mandate UTF-8), so non-ASCII original
// filenames (e.g. Cyrillic) arrive mis-decoded — re-interpret the bytes as UTF-8.
function fixOriginalName(name: string): string {
  return Buffer.from(name, 'latin1').toString('utf8');
}

export interface TextDocumentDTO {
  textLength:  number;
  preview:     string;   // first 200 chars
  projectId:   number | null;
  // Always false here: pasted text is bounded by SaveTextSchema's .max(), so it
  // is rejected at the validator rather than cut. Present so the frontend can
  // read one field regardless of which route produced the document.
  truncated:   boolean;
}

// ─── Helpers ─────────────────────────────────────────────────

// Was `findById` with no ownership filter, so any guessed project id could be
// overwritten with somebody else's document. Now the same rule the
// /projects/:id routes use — and the routes carry requireProjectAccessFromBody
// as well, so this is the second of two checks rather than the only one.
async function assertProject(
  projectId: number,
  sessionKey: string | undefined,
): Promise<void> {
  await assertProjectAccess(projectId, sessionKey);
}

// ─── Service ─────────────────────────────────────────────────

export const documentService = {
  async uploadFile(
    file: Express.Multer.File,
    projectId?: number,
    sessionKey?: string,
  ): Promise<FileDocumentDTO> {
    const fileUrl  = `/uploads/${file.filename}`;
    const fileName = fixOriginalName(file.originalname);

    // Signature check, zip-bomb screening and the parse itself, the last of
    // those in a worker under a hard time and heap limit. Throws BadRequestError
    // for content that does not match its extension or cannot be parsed within
    // budget; the controller's `finally` removes the file either way.
    const parsed = await parseDocument(file.path, file.originalname);
    const extractedText = parsed.text;

    // The extracted text is what the discussion, the prompts and the report all
    // read; nothing ever reads the file again. Deleting it here is what keeps
    // uploads from accumulating forever. The controller discards it too, on
    // every exit path including failure — discardUpload is idempotent.
    await discardUpload(file.path);

    if (projectId !== undefined) {
      await assertProject(projectId, sessionKey);
      // Same bound as project creation and PATCH: a document is attached only
      // if a persona can read it whole (A1 stage 0).
      assertDocumentFitsWindow(extractedText, parsed.pages);
      await prisma.$transaction(async (tx) => {
        await tx.project.update({
          where: { id: projectId },
          data:  {
            documentFile:     fileUrl,
            documentFileName: fileName,
            ...(extractedText && { documentText: extractedText }),
          },
        });
        if (extractedText) await replaceSections(tx, projectId, extractedText);
      });
    }

    return {
      fileName,
      storedName: file.filename,
      fileUrl,
      fileSize:   file.size,
      mimeType:   file.mimetype,
      projectId:  projectId ?? null,
      extractedText,
      truncated:       parsed.truncated,
      extractedLength: parsed.originalLength,
    };
  },

  async saveText(
    text: string,
    projectId?: number,
    sessionKey?: string,
  ): Promise<TextDocumentDTO> {
    if (projectId !== undefined) {
      await assertProject(projectId, sessionKey);
      assertDocumentFitsWindow(text);
      await prisma.$transaction(async (tx) => {
        await tx.project.update({
          where: { id: projectId },
          data:  { documentText: text },
        });
        await replaceSections(tx, projectId, text);
      });
    }

    return {
      textLength: text.length,
      preview:    text.slice(0, 200),
      projectId:  projectId ?? null,
      truncated:  false,
    };
  },
};
