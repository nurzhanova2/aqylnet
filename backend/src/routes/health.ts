import { Router, Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { ok, fail } from '../types/api';

const router = Router();

// Health used to answer `{ status: 'ok' }` unconditionally, which made it worse
// than having no health check: it reported green with an unreachable database
// and with LLM_API_KEY empty, so the two failures that actually take the product
// down were the two it could not see. env.ts still tolerates an empty key by
// design (the service must start so the rest can be configured), which is
// exactly why the check belongs here.
//
// A degraded service answers 503, not 200 — a monitor that has to parse the body
// to discover a problem is a monitor that will not notice it. Consequence worth
// knowing: with no LLM_API_KEY set this endpoint is red, so a CI environment
// without a key will see 503 here. That is the intended reading, not a bug.
//
// The general rate limiter deliberately skips this path (middlewares/rateLimit.ts):
// health is polled often and throttling it would make a working service look
// down.

interface Check {
  ok: boolean;
  detail: string;
}

async function checkDatabase(): Promise<Check> {
  const started = Date.now();
  try {
    // Cheapest possible round-trip that still proves a connection can be taken
    // from the pool and a statement executed.
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, detail: `${Date.now() - started}ms` };
  } catch (err) {
    // The message can carry connection strings and internal detail, so it goes
    // to the log; the response says only which check failed.
    console.error('[health] database check failed:', err);
    return { ok: false, detail: 'unreachable' };
  }
}

function checkLlmKey(): Check {
  return env.llmApiKey
    ? { ok: true, detail: 'configured' }
    : { ok: false, detail: 'LLM_API_KEY is empty' };
}

router.get('/', async (_req: Request, res: Response) => {
  const [database, llm] = [await checkDatabase(), checkLlmKey()];
  const healthy = database.ok && llm.ok;

  const body = {
    status: healthy ? 'ok' : 'degraded',
    service: 'aqylnet-backend',
    timestamp: new Date().toISOString(),
    checks: { database, llm },
  };

  if (healthy) {
    res.json(ok(body));
    return;
  }

  const failing = Object.entries(body.checks)
    .filter(([, c]) => !c.ok)
    .map(([name]) => name)
    .join(', ');
  res.status(503).json({ ...fail(`Service degraded: ${failing}`), data: body });
});

export default router;
