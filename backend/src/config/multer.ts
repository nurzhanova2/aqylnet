import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { env } from './env';
import { BadRequestError } from '../utils/errors';

const ALLOWED_EXT = new Set(['.pdf', '.docx', '.doc', '.txt', '.md']);

if (!fs.existsSync(env.uploadDir)) {
  fs.mkdirSync(env.uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, env.uploadDir),
  filename:    (_req, file, cb) => {
    // Was Date.now() + Math.round(Math.random() * 1e9). Math.random is not a
    // CSPRNG and the timestamp half is guessable outright, which mattered while
    // /uploads was served publicly — the name was the only thing standing
    // between a stranger and somebody's document. /uploads is closed now and
    // the file is deleted after extraction, so this is no longer the last line
    // of defence; it is also no longer a weak one.
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `doc-${randomUUID()}${ext}`);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: env.maxFileSizeMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    // Extension only — the multipart Content-Type is whatever the client chose
    // to send and is no security boundary (the real controls are this
    // whitelist, the size limit, and the fact that extractText never executes
    // the file). Requiring an exact mime match on top of it rejected perfectly
    // valid uploads: browsers derive a file's type from the OS, so a .txt
    // commonly arrives as application/octet-stream and was refused, while PDFs
    // — which reliably report application/pdf — always went through. That read
    // to users as "only PDF is accepted".
    if (ALLOWED_EXT.has(ext)) {
      cb(null, true);
    } else {
      // A plain Error here is not `instanceof multer.MulterError`, so it fell
      // through errorHandler's generic Error branch as a raw 500 (BUG-6).
      // BadRequestError is an AppError, which errorHandler already maps to 400.
      cb(new BadRequestError(
        `File type not allowed. Accepted: ${[...ALLOWED_EXT].join(', ')}`,
      ));
    }
  },
});
