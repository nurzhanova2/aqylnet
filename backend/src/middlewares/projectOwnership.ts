import type { Request, Response, NextFunction } from 'express';
import { projectRepository } from '../repositories/project.repository';
import { BadRequestError, NotFoundError } from '../utils/errors';
import { discardUpload } from '../utils/uploadFiles';

// The single definition of "may this request touch this project". It used to
// live inline in routes/projects.ts, where it covered every /projects/:id route
// and nothing else — so /documents/upload and /documents/text, which both take
// a projectId of their own, wrote into any project whose id you guessed. Project
// ids are sequential integers, so guessing is counting.
//
// This is workspace isolation, not authentication: X-Session-Key comes from the
// client and is trivially forged. It stops two browsers from stepping on each
// other's simulations; it is not a control over data that actually matters.

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /**
       * The :id of a /projects/:id route, parsed and authorised by
       * projectIdParam. Read it through projectIdOf(), not req.params.id.
       */
      projectId?: number;
    }
  }
}

/**
 * Throws unless the project exists and belongs to this workspace key.
 *
 * A project owned by someone else is reported as **404, never 403**: a 403
 * would confirm that the id exists and merely belongs to another workspace,
 * which is exactly the fact an id-guessing caller is trying to learn.
 */
export async function assertProjectAccess(
  projectId: number,
  sessionKey: string | undefined,
): Promise<void> {
  const row = await projectRepository.findOwnerKey(projectId);
  if (!row) throw new NotFoundError(`Project with id ${projectId} not found`);

  // ownerKey === null means the project predates the column (or was created by
  // a client that sends no key) — legacy/demo data, visible to everyone. Do not
  // turn this into "forbidden": an existing database has to keep working.
  if (row.ownerKey !== null && row.ownerKey !== sessionKey) {
    throw new NotFoundError(`Project with id ${projectId} not found`);
  }
}

/**
 * router.param handler for ':id'. Fires once for every route below that
 * declares :id — the CRUD handlers and all of the sub-resources (personas,
 * timeline, summary, analytics, run-iteration, generate-report, persona-scores,
 * audience-analysis, rewrites). Centralising it is what keeps the check from
 * having to be threaded through discussion/analytics/report/iteration services
 * one signature at a time, where a single missed route silently exposes
 * another browser's simulation. The parsed id is left on req.projectId.
 */
export async function projectIdParam(
  req: Request,
  _res: Response,
  next: NextFunction,
  raw: string,
): Promise<void> {
  try {
    const id = parseInt(String(raw), 10);
    if (isNaN(id) || id <= 0) throw new BadRequestError('id must be a positive integer');
    await assertProjectAccess(id, req.sessionKey);
    req.projectId = id;
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * The project id of a /projects/:id request — already a positive integer, and
 * the project already exists and belongs to this workspace (projectIdParam).
 * Controllers used to parse req.params.id again, re-checking what the guard
 * had decided. Missing means the handler was mounted outside the guard: a
 * programming error, reported as one rather than as a client mistake.
 */
export function projectIdOf(req: Request): number {
  if (req.projectId === undefined) {
    throw new Error('projectIdOf: the :id guard (projectIdParam) did not run for this route');
  }
  return req.projectId;
}

/**
 * Guard for routes that carry the project id in the body rather than the path
 * — /documents/text (JSON) and /documents/upload (a multipart form field).
 *
 * On the upload route this has to be mounted *after* multer, because the form
 * field does not exist until multipart is parsed, which means the file is
 * already on disk by the time ownership is rejected. Hence the discard: a
 * request that is refused must not leave its upload behind.
 *
 * `projectId` is optional on both routes (a document can be saved before any
 * project exists), and absent means there is nothing to authorise.
 */
export function requireProjectAccessFromBody(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const raw = (req.body as Record<string, unknown> | undefined)?.['projectId'];
  if (raw === undefined || raw === null || raw === '') {
    next();
    return;
  }

  const id = parseInt(String(raw), 10);
  const check = isNaN(id) || id <= 0
    ? Promise.reject(new BadRequestError('projectId must be a positive integer'))
    : assertProjectAccess(id, req.sessionKey);

  check
    .then(() => next())
    .catch(async (err) => {
      await discardUpload(req.file?.path);
      next(err);
    });
}
