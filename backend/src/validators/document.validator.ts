import { z } from 'zod';
import { MAX_DOCUMENT_TEXT_CHARS } from '../config/limits';

// projectId comes as a string from multipart form-data → coerce to number
export const UploadFileSchema = z.object({
  projectId: z.coerce.number().int().positive().optional(),
});

export const SaveTextSchema = z.object({
  // Same bound as documentText on the project routes — this text ends up in
  // exactly the same column and the same prompts.
  text:      z.string().min(1, 'text is required').max(MAX_DOCUMENT_TEXT_CHARS),
  projectId: z.number().int().positive().optional(),
});

export type UploadFileInput = z.infer<typeof UploadFileSchema>;
export type SaveTextInput   = z.infer<typeof SaveTextSchema>;
