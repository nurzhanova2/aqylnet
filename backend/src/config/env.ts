import path from 'path';
import dotenv from 'dotenv';
import {
  COMPLETION_TOKENS_AUDIT_ALIGNMENT,
  COMPLETION_TOKENS_AUDIT_CHECKLIST,
  COMPLETION_TOKENS_AUDIT_CONTRADICTIONS,
  COMPLETION_TOKENS_PERSONA_SCORE,
  COMPLETION_TOKENS_DECISION_REFERENCE,
  COMPLETION_TOKENS_DECISION_VERDICTS,
  COMPLETION_TOKENS_MISSING_EXPLANATIONS,
  COMPLETION_TOKENS_REWRITE_BLUF,
  COMPLETION_TOKENS_REWRITE_BRIEF,
  COMPLETION_TOKENS_REWRITE_CARD,
  COMPLETION_TOKENS_REWRITE_SECTION,
  PERSONA_SCORE_TIMEOUT_MS,
  COMPLETION_TOKENS_AUDIT_SECTION,
  COMPLETION_TOKENS_DISCUSSION_REPORT,
  COMPLETION_TOKENS_MODERATOR_MESSAGE,
  COMPLETION_TOKENS_PERSONA_POSITIONS,
  COMPLETION_TOKENS_PERSONA_RESPONSE,
  COMPLETION_TOKENS_SUGGEST_PERSONAS,
  DOCUMENT_PARSE_MAX_HEAP_MB,
  DOCUMENT_PARSE_TIMEOUT_MS,
  LLM_DAILY_SUGGEST_CALLS,
  LLM_DAILY_TOKEN_BUDGET,
  MAX_CONCURRENT_ROUNDS,
  MODEL_CONTEXT_TOKENS,
} from './limits';

// Two files, one source of truth per value (SECURITY.md item 24).
//
// `backend/.env` is for running the backend directly on the host; the
// repo-root `.env` is what docker-compose interpolates `${…}` from. The live
// LLM key used to sit in **both**, which makes rotation two edits, and a
// missed one leaves the old key working in whichever path you forgot — the
// kind of defect that is invisible until the old key is the one that leaked.
//
// So the root file is now the only place secrets live, and this fills the gaps
// from it. dotenv never overwrites an already-set variable, so the order is
// the precedence: a host-specific value in `backend/.env` still wins, and
// anything it does not define comes from the root.
//
// Anchored on __dirname rather than cwd: `node dist/server.js` from the repo
// root and `npm run dev` from backend/ have different working directories, and
// a path relative to cwd silently loads nothing in one of them. In the
// container neither file exists and the values come from compose — dotenv
// reports a missing file without throwing, which is the intended no-op.
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env variable: ${key}`);
  return value;
}

// A malformed numeric env var must not silently become NaN: a NaN limit makes
// every comparison in the rate limiter false, which reads as "no limit".
function parseIntEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Env variable ${key} must be a non-negative integer, got: ${raw}`);
  }
  return n;
}

// Express accepts a hop count, a boolean, or a list of trusted addresses for
// "trust proxy". `true` is deliberately not reachable from here: it tells
// Express to believe the leftmost X-Forwarded-For entry from anyone, which
// hands every client a free choice of req.ip.
function parseTrustProxy(raw: string): number | false | string[] {
  const value = raw.trim();
  if (value === 'false' || value === '') return false;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  const list = value.split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return false;
  return list;
}

export const env = {
  port: parseInt(process.env.PORT ?? '3001', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  // Comma-separated list so one deployment can serve the local dev server and
  // the LAN host at the same time (the thin frontend is same-origin behind
  // nginx and needs no entry, but direct :3001 access from another machine
  // does).
  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:5174')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  databaseUrl: requireEnv('DATABASE_URL'),
  uploadDir: process.env.UPLOAD_DIR ?? './uploads',
  maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB ?? '20', 10),
  llmApiKey: process.env.LLM_API_KEY ?? '',
  llmApiBase: process.env.LLM_API_BASE ?? 'https://prod-litellm.nationalbank.kz',
  // A *capability alias*, not a model: it names the role ("a balanced
  // assistant") and the proxy decides which engine serves it. New tokens are
  // authorised for aliases only; concrete names like
  // Qwen/Qwen3.5-35B-A3B-FP8 still work as a migration courtesy and will be
  // switched off on an announced date — which is why the default is the alias.
  // A default pointing at a name with a shutdown date is a dated trap.
  //
  // Consequence worth knowing: the engine behind an alias can change without
  // notice, so anything tuned to one model's behaviour must degrade safely.
  // That is why the per-scenario token budgets are env-overridable, why
  // trimReply bounds reply length independently of max_tokens, and why the
  // vLLM thinking passthrough has an off switch.
  llmModel: process.env.LLM_MODEL ?? 'assistant-balanced',

  // How many reverse-proxy hops to trust when deriving req.ip. The thin
  // frontend puts exactly one (nginx) in front of the backend, and without
  // this every request would arrive from the nginx container's address and
  // the per-IP limiters would collapse into one shared bucket.
  //
  // Accepts a hop count, 'false', or a comma-separated list of trusted
  // addresses/subnets — see the Express "trust proxy" documentation. Caveat
  // worth knowing: port 3001 is also published directly, and a client
  // reaching it without going through nginx can set X-Forwarded-For itself,
  // so a hop count alone makes the per-IP limit evadable. That is why the LLM
  // routes additionally carry a global ceiling that is not keyed on IP at all.
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY ?? '1'),

  // Rate limits, all tunable so a live demo can be widened without a code
  // change. Counts are per *request*, not per LLM call or per second of
  // generation: one run-iteration is a single request whether it drives two
  // personas or eight.
  rateLimit: {
    // Everything under /api, per IP. Generous — the discussion page refetches
    // the timeline while a round is revealed.
    generalWindowMs: parseIntEnv('RATE_LIMIT_WINDOW_MS', 60_000),
    generalMax: parseIntEnv('RATE_LIMIT_MAX', 300),

    // Routes that spend LLM tokens: POST /projects, run-iteration,
    // generate-report, persona-scores, audience-analysis, rewrites,
    // suggest/personas.
    //
    // Sized against the heaviest honest session rather than round numbers. One
    // full discussion is 1 create + up to 10 rounds + 1 report = 12 requests,
    // 13 with persona auto-suggest. 20 would therefore cut somebody off in the
    // middle of a *second* discussion started within five minutes, which is
    // ordinary use, not abuse; 40 leaves room for two back-to-back runs.
    llmWindowMs: parseIntEnv('RATE_LIMIT_LLM_WINDOW_MS', 5 * 60_000),
    llmMax: parseIntEnv('RATE_LIMIT_LLM_MAX', 40),
    // Shared ceiling across all callers, protecting the common NBK quota from
    // a single client that spoofs X-Forwarded-For to get a fresh per-IP bucket
    // on every request. Well above a group demo (a round occupies a minute or
    // more of wall clock, so even a roomful of people generates single-digit
    // requests per minute) and well below anything that could drain the quota.
    llmGlobalMax: parseIntEnv('RATE_LIMIT_LLM_GLOBAL_MAX', 150),

    // Upload and text-extraction routes. Parsing now happens in an isolated
    // worker (config/limits.ts, services/documentParser.ts), but it is still
    // untrusted input and still costs CPU.
    uploadWindowMs: parseIntEnv('RATE_LIMIT_UPLOAD_WINDOW_MS', 5 * 60_000),
    uploadMax: parseIntEnv('RATE_LIMIT_UPLOAD_MAX', 30),
  },

  // Parser budgets. The defaults are the measured values in config/limits.ts;
  // they are overridable for the same reason the rate limits are — a test run
  // needs to drive the mechanism (a 1 ms timeout proves the wall-clock path
  // fires) without weakening the shipped number, and an operator facing an
  // unusually heavy corpus should not need a rebuild.
  documentParseTimeoutMs: parseIntEnv('DOCUMENT_PARSE_TIMEOUT_MS', DOCUMENT_PARSE_TIMEOUT_MS),
  documentParseMaxHeapMb: parseIntEnv('DOCUMENT_PARSE_MAX_HEAP_MB', DOCUMENT_PARSE_MAX_HEAP_MB),

  llm: {
    // Daily spend ceilings — the reasoning behind the numbers is in
    // config/limits.ts. Overridable because the right ceiling depends on the
    // quota the deployment actually has, which code cannot know.
    dailyTokenBudget: parseIntEnv('LLM_DAILY_TOKEN_BUDGET', LLM_DAILY_TOKEN_BUDGET),
    dailySuggestCalls: parseIntEnv('LLM_DAILY_SUGGEST_CALLS', LLM_DAILY_SUGGEST_CALLS),

    // Per-request timeout for one completion, in milliseconds.
    //
    // The OpenAI SDK defaults to 10 minutes per attempt with 2 retries, so a
    // proxy that accepts a connection and then stalls could hold a round — and
    // the pooled database connection the round's transaction owns — for half an
    // hour. Measured latencies on this proxy: 0.4s for persona suggestion,
    // ~0.8s per persona reply, 1.9s for the per-document positions.
    //
    // 45s is ~24x the slowest measured call. Paired with one retry instead of
    // two (see llm.service.ts), the worst case for a single completion is 90s,
    // which fits inside the round transaction's 120s budget — so one stalled
    // call costs a retry rather than aborting the whole round. Those two numbers
    // are a pair: raising this without raising the transaction timeout trades a
    // slow round for a failed one.
    requestTimeoutMs: parseIntEnv('LLM_REQUEST_TIMEOUT_MS', 45_000),

    // How many rounds may hold a pooled connection at once — see
    // config/limits.ts for the measurement. Overridable mainly so the refusal
    // path can be exercised with two concurrent rounds instead of seven.
    maxConcurrentRounds: parseIntEnv('MAX_CONCURRENT_ROUNDS', MAX_CONCURRENT_ROUNDS),

    // Whether to send the vLLM `chat_template_kwargs: { enable_thinking: false }`
    // passthrough with every completion.
    //
    // It exists for Qwen3.x on this proxy, which otherwise spends max_tokens on
    // chain-of-thought before reaching the answer. It is a *model-specific*
    // field, and a proxy route that does not recognise it may answer 400 — which
    // would fail every LLM call at once. That is the one risk in switching
    // models that cannot be tested in advance, because the current key is scoped
    // to Qwen and returns 403 for any other model name.
    //
    // Hence a switch rather than a constant: if the new model rejects the field,
    // set LLM_DISABLE_THINKING=false and `docker compose up -d backend` — no
    // rebuild, no code change. The token budgets in config/limits.ts carry
    // reasoning headroom either way, so the product works with thinking on.
    disableThinking: (process.env.LLM_DISABLE_THINKING ?? 'true').toLowerCase() !== 'false',

    // Contradictions between sections (A1 stage 0a), off unless set to "true"
    // (decision of 03.11.2026): in acceptance the planted pairs were never
    // found and every reported pair was false, NBK reports included. Off means
    // no claims are asked of the section audit and no confirmation call is
    // made; on, they are shown as "possible" and never cap the score.
    auditContradictions: (process.env.AUDIT_CONTRADICTIONS ?? 'false').toLowerCase() === 'true',

    // Per-scenario max_tokens. Overridable so a model that spends the budget on
    // reasoning can be accommodated with an env change and a restart instead of
    // a rebuild — the free-text two are the ones to watch, see config/limits.ts.
    maxTokens: {
      suggestPersonas:   parseIntEnv('LLM_MAX_TOKENS_SUGGEST',   COMPLETION_TOKENS_SUGGEST_PERSONAS),
      personaPositions:  parseIntEnv('LLM_MAX_TOKENS_POSITIONS', COMPLETION_TOKENS_PERSONA_POSITIONS),
      personaResponse:   parseIntEnv('LLM_MAX_TOKENS_PERSONA',   COMPLETION_TOKENS_PERSONA_RESPONSE),
      moderatorMessage:  parseIntEnv('LLM_MAX_TOKENS_MODERATOR', COMPLETION_TOKENS_MODERATOR_MESSAGE),
      discussionReport:  parseIntEnv('LLM_MAX_TOKENS_REPORT',    COMPLETION_TOKENS_DISCUSSION_REPORT),
      // The audit runs per section since A1 stage 0, so the audit budget is a
      // section's budget. Same variable as before: an override that used to
      // widen the whole-document call now widens each section call.
      auditSection:      parseIntEnv('LLM_MAX_TOKENS_AUDIT',     COMPLETION_TOKENS_AUDIT_SECTION),
      auditAlignment:    parseIntEnv('LLM_MAX_TOKENS_ALIGNMENT', COMPLETION_TOKENS_AUDIT_ALIGNMENT),
      auditChecklist:    parseIntEnv('LLM_MAX_TOKENS_CHECKLIST', COMPLETION_TOKENS_AUDIT_CHECKLIST),
      auditContradictions: parseIntEnv('LLM_MAX_TOKENS_CONTRADICTIONS', COMPLETION_TOKENS_AUDIT_CONTRADICTIONS),
      personaScore:      parseIntEnv('LLM_MAX_TOKENS_PERSONA_SCORE', COMPLETION_TOKENS_PERSONA_SCORE),
      // A1 stage 2, audience analysis.
      decisionReference: parseIntEnv('LLM_MAX_TOKENS_DECISION_REFERENCE', COMPLETION_TOKENS_DECISION_REFERENCE),
      decisionVerdicts:  parseIntEnv('LLM_MAX_TOKENS_DECISION_VERDICTS', COMPLETION_TOKENS_DECISION_VERDICTS),
      missingExplanations: parseIntEnv('LLM_MAX_TOKENS_MISSING', COMPLETION_TOKENS_MISSING_EXPLANATIONS),
      // A1 stage 3, three versions of the text.
      rewriteCard:    parseIntEnv('LLM_MAX_TOKENS_REWRITE_CARD', COMPLETION_TOKENS_REWRITE_CARD),
      rewriteBrief:   parseIntEnv('LLM_MAX_TOKENS_REWRITE_BRIEF', COMPLETION_TOKENS_REWRITE_BRIEF),
      rewriteBluf:    parseIntEnv('LLM_MAX_TOKENS_REWRITE_BLUF', COMPLETION_TOKENS_REWRITE_BLUF),
      rewriteSection: parseIntEnv('LLM_MAX_TOKENS_REWRITE_SECTION', COMPLETION_TOKENS_REWRITE_SECTION),
    },

    // persona_score runs outside any transaction and answers at length; see
    // PERSONA_SCORE_TIMEOUT_MS in config/limits.ts.
    personaScoreTimeoutMs: parseIntEnv('LLM_PERSONA_SCORE_TIMEOUT_MS', PERSONA_SCORE_TIMEOUT_MS),

    // Context window of the served model, prompt plus completion. Measured on
    // Qwen3.5-35B-A3B-FP8 — re-measure when the alias moves (config/limits.ts).
    // An env var because it belongs to the deployment, not to the code: a
    // different model behind assistant-balanced may have a different window.
    contextTokens: parseIntEnv('LLM_CONTEXT_TOKENS', MODEL_CONTEXT_TOKENS),
  },
} as const;
