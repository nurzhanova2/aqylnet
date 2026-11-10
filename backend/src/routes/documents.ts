import { Router }             from 'express';
import { upload }              from '../config/multer';
import { documentController } from '../controllers/document.controller';
import { uploadLimiter }       from '../middlewares/rateLimit';
import { requireProjectAccessFromBody } from '../middlewares/projectOwnership';

const router = Router();

// Both routes accept an optional projectId and used to write into it with no
// ownership check at all, while sitting outside the router.param guard that
// protects /projects/:id.
//
// The limiter runs before multer on purpose: a throttled upload should be
// rejected before its body is written to disk and parsed, not after. The
// ownership guard, by contrast, has to run *after* multer — `projectId` is a
// multipart form field and does not exist until the body is parsed — so it
// discards the stored file when it rejects.
// multer middleware runs before the controller — it parses multipart and populates req.file
router.post(
  '/upload',
  uploadLimiter,
  upload.single('file'),
  requireProjectAccessFromBody,
  documentController.uploadFile,
);
router.post('/text', uploadLimiter, requireProjectAccessFromBody, documentController.saveText);

export default router;
