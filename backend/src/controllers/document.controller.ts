import { Request, Response, NextFunction } from 'express';
import { documentService }   from '../services/document.service';
import { UploadFileSchema, SaveTextSchema } from '../validators/document.validator';
import { BadRequestError }   from '../utils/errors';
import { discardUpload }     from '../utils/uploadFiles';
import { ok }                from '../types/api';

export const documentController = {
  /**
   * POST /api/documents/upload
   * Content-Type: multipart/form-data
   * Field: file (required), projectId (optional, form field)
   */
  async uploadFile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const file = req.file;
      if (!file) throw new BadRequestError('No file uploaded. Use field name "file".');

      // projectId may arrive as string from form-data → coerce
      const { projectId } = UploadFileSchema.parse(req.body);

      const result = await documentService.uploadFile(file, projectId, req.sessionKey);
      res.status(201).json(ok(result, 'File uploaded'));
    } catch (e) { next(e); }
    finally {
      // multer has already written the file by the time any handler runs, so
      // every exit path has to clean up after itself — a rejected Zod parse or
      // a failed project update must not leave the upload on disk. The service
      // deletes it on the success path too; discardUpload ignores a file that
      // is already gone.
      await discardUpload(req.file?.path);
    }
  },

  /**
   * POST /api/documents/text
   * Content-Type: application/json
   * Body: { text: string, projectId?: number }
   */
  async saveText(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { text, projectId } = SaveTextSchema.parse(req.body);
      const result = await documentService.saveText(text, projectId, req.sessionKey);
      res.status(201).json(ok(result, 'Text document saved'));
    } catch (e) { next(e); }
  },
};
