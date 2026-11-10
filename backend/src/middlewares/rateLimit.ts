import type { Request, Response, NextFunction } from 'express';
import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';
import { env } from '../config/env';
import { TooManyRequestsError } from '../utils/errors';

// There is no authentication in this product by design (SECURITY.md §0), so
// there is no identity to bill a quota to. That shapes everything below: the
// first line is a best-effort per-client bucket built from values the client
// itself supplies, and anything that spends shared money carries a second,
// global ceiling that no client-supplied value can widen. Only the second one
// is a boundary; the first is fairness between well-behaved clients.

// Hand control back to errorHandler so a throttled response carries the same
// { success, data, message } envelope as every other error. express-rate-limit
// would otherwise write a plain-text body that the frontend's apiFetch cannot
// parse.
function rejectWith(message: string) {
  return (_req: Request, _res: Response, next: NextFunction) => {
    next(new TooManyRequestsError(message));
  };
}

const shared: Partial<Options> = {
  standardHeaders: 'draft-8',
  legacyHeaders: false,
};

// Measured, not assumed: on Docker Desktop every connection to a published
// port is NAT'd through the bridge gateway before it reaches a container, so
// nginx logs 172.25.0.1 as $remote_addr for *every* client — the host, another
// machine on the corporate network, all of them. X-Forwarded-For therefore
// carries that one gateway address and req.ip is identical for everybody. A
// limiter keyed on req.ip alone is not "per IP" in this deployment; it is a
// second global bucket, and a fourth colleague would be throttled by the first
// three.
//
// X-Session-Key is the per-browser workspace key the client already sends on
// every request. It is forgeable — but so is X-Forwarded-For, and neither is
// load-bearing here: this limiter exists for *fairness* (one runaway client
// must not starve the others), while the actual protection for the shared NBK
// quota is llmGlobalLimiter below, which cannot be widened by changing either
// value. Keeping the address in the key means clients that send no session key
// (health checks, the test suite, curl) still get bucketed by address.
function clientKey(req: Request): string {
  const ip = ipKeyGenerator(req.ip ?? '', 64);
  return req.sessionKey ? `${ip}:${req.sessionKey}` : ip;
}

// ─── General API limiter ─────────────────────────────────────
// Mounted on /api as a backstop against request floods. Sized for the
// discussion page, which refetches the timeline while a round is revealed, so
// it should never fire during normal use.
export const apiLimiter = rateLimit({
  ...shared,
  windowMs: env.rateLimit.generalWindowMs,
  limit: env.rateLimit.generalMax,
  keyGenerator: clientKey,
  // /health is a liveness probe for compose and whatever monitoring polls it.
  // Throttling it buys nothing and makes the service look down.
  skip: (req) => req.path === '/health',
  handler: rejectWith('Слишком много запросов. Попробуйте через минуту.'),
});

// ─── LLM routes ──────────────────────────────────────────────
// Counted per *request*, never per LLM call or per second of generation: one
// run-iteration is a single request whether it drives two personas or eight,
// and a round legitimately takes minutes (nginx proxy_read_timeout is 600s).
// Counting generation time instead would cut off exactly the requests that are
// working correctly.
export const llmPerClientLimiter = rateLimit({
  ...shared,
  windowMs: env.rateLimit.llmWindowMs,
  limit: env.rateLimit.llmMax,
  keyGenerator: clientKey,
  handler: rejectWith(
    'Слишком много обращений к модели из этой сессии. Подождите несколько минут.',
  ),
});

// The limiter above is only as trustworthy as its key, and both halves of that
// key come from the client: X-Forwarded-For (settable by anyone reaching port
// 3001 without going through nginx) and X-Session-Key. This one is keyed on a
// constant, so neither a fresh address nor a fresh session key buys a fresh
// budget — it is the actual protection for the shared NBK token quota.
export const llmGlobalLimiter = rateLimit({
  ...shared,
  windowMs: env.rateLimit.llmWindowMs,
  limit: env.rateLimit.llmGlobalMax,
  keyGenerator: () => 'llm-global',
  // The constant key is the point of this limiter, not an oversight: silence
  // the check that flags a keyGenerator for not distinguishing clients.
  validate: { keyGeneratorIpFallback: false },
  handler: rejectWith(
    'Общая квота обращений к модели исчерпана. Дискуссия продолжится через несколько минут.',
  ),
});

// Applied in route order, so a caller must pass both the personal and the
// shared budget.
export const llmLimiter = [llmPerClientLimiter, llmGlobalLimiter];

// ─── Upload / text-extraction routes ─────────────────────────
// No LLM spend, but PDF/DOCX parsing still happens in the main process without
// a timeout (SECURITY.md item 8, stage E3), so repeated uploads are a cheap way
// to occupy the event loop.
export const uploadLimiter = rateLimit({
  ...shared,
  windowMs: env.rateLimit.uploadWindowMs,
  limit: env.rateLimit.uploadMax,
  keyGenerator: clientKey,
  handler: rejectWith('Слишком много загрузок. Подождите несколько минут.'),
});
