import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import apiRouter from './routes/index';
import { errorHandler } from './middlewares/errorHandler';
import { sessionKey } from './middlewares/sessionKey';
import { notFound } from './middlewares/notFound';
import { apiLimiter } from './middlewares/rateLimit';

const app = express();

// ─── Proxy awareness ─────────────────────────────────────────
// Must be set before any per-IP limiter runs: behind nginx every request
// otherwise arrives from the proxy container's address and the per-IP buckets
// collapse into one. See env.trustProxy for the direct-:3001 caveat.
app.set('trust proxy', env.trustProxy);

// ─── Middleware ───────────────────────────────────────────────
// helmet first, so its headers are present on error and throttled responses
// too, not just on the ones that reach a controller.
app.use(helmet());

app.use(
  cors({
    origin: env.corsOrigin,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    // X-Session-Key carries the per-device workspace key. Without it listed
    // here the browser strips the header during the CORS preflight and every
    // request silently arrives unscoped.
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Key'],
  }),
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(sessionKey);

// ─── Uploads are not served ──────────────────────────────────
// There used to be an express.static mount here, proxied by nginx as well, so
// every document ever uploaded was readable by anyone who knew or guessed a
// filename — no ownership check, no session key, nothing. Nothing in the
// frontend ever fetched these URLs: `documentFile` is used only as a flag that
// a file was uploaded and as a source for the chip's label (checked across
// aqylnet/src — no href, src or window.open points at /uploads). The file is
// now also deleted once its text has been extracted, so there is nothing left
// to serve. If direct links are ever needed, add a route behind
// requireProjectAccessFromBody / projectIdParam rather than a static mount.

// ─── Routes ──────────────────────────────────────────────────
app.use('/api', apiLimiter, apiRouter);

// ─── 404 & Error ────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

export default app;
