import { apiFetchForm } from './client';

/**
 * POST /api/documents/upload
 * Uploads a file via multipart/form-data.
 * @param {File} file - the File object from an <input type="file">
 * @param {number} [projectId] - optional project to link to
 * Returns FileDocumentDTO: { fileName, storedName, fileUrl, fileSize, mimeType,
 *   projectId, extractedText, truncated, extractedLength }
 * extractedText is null for unsupported formats (legacy .doc). Content that does
 * not match its extension, a .docx that looks like a zip bomb, and a parse that
 * exceeds the server's time or memory budget are 400s, not a null.
 * truncated is true when the document produced more than the server's character
 * cap; extractedLength is the length before cutting.
 */
export function uploadDocument(file, projectId) {
  const form = new FormData();
  form.append('file', file);
  if (projectId != null) form.append('projectId', String(projectId));
  return apiFetchForm('/documents/upload', form);
}
