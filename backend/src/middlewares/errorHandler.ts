import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import multer from 'multer';
import { AppError } from '../utils/errors';
import { fail } from '../types/api';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    // `err.issues`, not `err.errors`: zod 4 removed the alias. The assembled
    // shape — "field: reason; field: reason" — is unchanged, and the response
    // bodies it produces are asserted by the live API suites.
    const message = err.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
    res.status(400).json(fail(message));
    return;
  }

  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    res.status(status).json(fail(err.message));
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json(fail(err.message));
    return;
  }

  if (err instanceof Error) {
    // Anything reaching this branch is an unexpected failure (Prisma
    // internals, the LLM SDK's upstream error text, etc.) — err.message can
    // contain raw DB query text, container file paths, table/column names,
    // or (observed live during the BUG-5 LLM-outage repro) a partial API key
    // and token hash. None of that is safe to hand to an unauthenticated
    // client (BUG-8); only the AppError/ZodError/MulterError branches above
    // are known to already produce a safe, intentional message. Full detail
    // still goes to the server log for debugging.
    console.error('[Error]', err.message, err.stack);
    res.status(500).json(fail('An unexpected server error occurred.'));
    return;
  }

  console.error('[Unknown error]', err);
  res.status(500).json(fail('Internal server error'));
}
