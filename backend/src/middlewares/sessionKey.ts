import { Request, Response, NextFunction } from 'express';

export const SESSION_KEY_HEADER = 'x-session-key';

// A browser-generated UUID v4 (crypto.randomUUID). Anything else is ignored
// rather than rejected: health checks, the test suite and any pre-existing
// client call the API without the header at all, and those requests must keep
// working against legacy (ownerKey = null) projects.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /**
       * Opaque per-device workspace key from X-Session-Key, or undefined when
       * the client sent none / sent something malformed.
       *
       * This is workspace isolation, NOT authentication. The header is
       * client-supplied and trivially forgeable, so it may scope *which*
       * projects a browser sees — it must never be treated as proof of
       * identity or used to protect data that actually matters.
       */
      sessionKey?: string;
    }
  }
}

export function sessionKey(req: Request, _res: Response, next: NextFunction): void {
  const raw = req.header(SESSION_KEY_HEADER);
  req.sessionKey = raw && UUID_RE.test(raw) ? raw.toLowerCase() : undefined;
  next();
}
