<div align="center">

# AqylNet — Multi-Agent Feedback Engine

### A virtual focus group of AI personas that reads a document, discusses it and shows who understood it

**Language:** [English](README.md) · [Русский](README_ru.md)

[![Frontend — React 19 · Vite 8](https://img.shields.io/badge/frontend-React%2019%20·%20Vite%208-1565c0)](aqylnet/package.json)
[![Backend — Node 22 · Express · Prisma](https://img.shields.io/badge/backend-Node%2022%20·%20Express%20·%20Prisma-2e7d32)](backend/package.json)
[![Database — PostgreSQL 16](https://img.shields.io/badge/database-PostgreSQL%2016-455a64)](backend/prisma/schema.prisma)
[![LLM — OpenAI-compatible via LiteLLM](https://img.shields.io/badge/LLM-OpenAI--compatible%20via%20LiteLLM-6a1b9a)](backend/src/config/env.ts)
[![Tests — 308 unit · 74 UI · 136 live](https://img.shields.io/badge/tests-308%20unit%20·%2074%20UI%20·%20136%20live-f9a825)](#3-run-the-checks)

</div>

> [!IMPORTANT]
> AqylNet is an internal analytical tool: the interface and the prompts are in Russian, and the LLM is reached through a corporate LiteLLM proxy. Projects are separated by an `X-Session-Key` header that the browser generates — this is **workspace isolation, not authentication**. Do not expose the service outside a trusted network.

## About

A user uploads a document (PDF, DOCX, DOC, TXT, MD) or pastes text, picks 1–8 personas from a library of 34 — population, business, experts and intermediaries — and runs a discussion round by round. Each persona answers from its social, professional and psychological position, reads the whole document and reacts to the others.

```text
document → sections → cast and positions → discussion rounds → report and section audit → persona scores → who understood the text → three versions of the text
```

Everything the model claims is checked by code: an audit quote must appear in the document verbatim, the overall score and every verdict are computed rather than asked for, and untrusted input (the document, the transcript, persona fields) is fenced off in every prompt.

> [!WARNING]
> Personas are a simulation, not a survey. Reports and rewritten texts are drafts for the author: the code checks numbers, quotes and the decision against the document, but not the links between facts. Every rewritten version carries placeholders `[Дописать: …]` where the document is silent.

## What it produces

| Block | Content | Who decides |
|---|---|---|
| Discussion | rounds in three modes — Round Table, Debate, Interview; a moderator question per round | model |
| Report | mood, risks, recommendations, topics with weights, an alternative wording with «unchanged / changed / added» tags | model, validated by Zod |
| Document audit | four axes, issues with severity and a verbatim quote, a checklist of what the text must contain, a section map, intended vs perceived messages | model brings evidence, code merges and caps the score |
| Persona scores | every persona scores every section on a 1–10 scale before and without the discussion | model per persona; means, spread and group gaps — code |
| Who understood the text | understanding level per group, gap against the intended audience, how the decision was understood, missing explanations | code, model only extracts |
| Three versions | a card for the population, a brief for business and journalists, the full text with targeted edits for experts | model drafts, code applies edits and marks |

The report and each version are exported to PDF and DOCX; verification marks travel with the export and the clipboard.

## Quick start

### 1. Run

```bash
cp .env.example .env               # set POSTGRES_PASSWORD and LLM_API_KEY
docker compose up -d --build       # postgres + backend (production image)
RUN_SEED=true docker compose up -d backend   # once, on an empty database: 34 personas
docker compose up -d backend                 # switch the seed off again

cd aqylnet && npm install && npm run dev     # dev UI → http://localhost:5174
# or the thin frontend for the network:
cd aqylnet && npm run build && docker compose up -d web   # → http://<host>:8080
```

- Address the backend as **`127.0.0.1`**, not `localhost`: on this machine `localhost` resolves to `::1`, while Docker publishes on IPv4.
- A change in `backend/src` needs `docker compose up -d --build backend`; `restart` keeps the old compiled `dist/`.
- The schema changes only through migrations (`prisma migrate deploy` runs at start).

### 2. Configure

Secrets live in the **root `.env`** and nowhere else. Every optional setting — rate limits and their windows, `max_tokens` of each of the 17 LLM scenarios, the model window, timeouts, the daily token ceiling, the contradiction search switch — is listed with its default in [`.env.example`](.env.example). Compose passes all of them to the container; an empty value means the default from [`limits.ts`](backend/src/config/limits.ts). Change them in `.env` and run `docker compose up -d backend` — no rebuild.

The token and the model change together. Check a pair before trusting it:

```bash
docker compose cp scripts/check-llm-model.mjs backend:/tmp/check.mjs
docker compose exec backend node /tmp/check.mjs
```

### 3. Run the checks

```bash
cd backend && npm run build && npm run test:unit     # type-check incl. tests, build, 308 tests
cd aqylnet && npm run lint && npm test && npm run build   # 74 tests
```

The live suites need a running backend and PostgreSQL, and the variables **in the same terminal window**:

```powershell
$env:API_BASE_URL = 'http://127.0.0.1:3001/api'
$env:TEST_DATABASE_URL = 'postgresql://postgres:<password>@127.0.0.1:5432/aqylnet?schema=public'
cd tests; npm run test:api; npm run test:security       # 125 tests
$env:APP_URL = 'http://127.0.0.1:8080'; npm run test:e2e # 11 browser tests
```

In bash use `export`. `TEST_DATABASE_URL` has no default; for the run, widen the `RATE_LIMIT_*` values in the root `.env` and restore them afterwards — see [`.env.test.example`](.env.test.example).

## Limits

| Parameter | Value |
|---|---:|
| Personas per discussion | 1–8 |
| Rounds | 1–10, default 5 |
| Author's key messages | up to 3 |
| Upload | up to 20 MB |
| Stored document text | up to 500,000 characters, truncated with a notice |
| Document the personas can read | ~96,000 characters (~20 pages of prose, ~37 pages of a report with charts); longer → 400 |
| Product frame the measurements assume | ~15 pages |
| Concurrent rounds per server | 6 |
| Daily token ceiling | 10,000,000 |

A second concurrent run of a long LLM operation on the same project — a round, the report, persona scores, the audience analysis, the rewrites — is refused with **409**, not paid for twice.

<details>
<summary><b>API — 33 endpoints under <code>/api</code></b></summary>

```text
GET    /health                                 503 when the database or the key is missing
GET    /personas · GET /personas/:id · POST /personas · PATCH /personas/:id · DELETE /personas/:id
POST   /suggest/personas                       LLM picks a cast
POST   /documents/upload · POST /documents/text
GET    /projects · POST /projects              creating a project computes persona positions (LLM)
GET    /projects/:id · PATCH /projects/:id · DELETE /projects/:id
GET    /projects/:id/personas · POST /projects/:id/personas · DELETE /projects/:id/personas/:personaId
GET    /projects/:id/timeline · POST /projects/:id/timeline · PATCH /projects/:id/timeline/:messageId
GET    /projects/:id/summary · PUT /projects/:id/summary
GET    /projects/:id/analytics · PUT /projects/:id/analytics
POST   /projects/:id/run-iteration             one round (LLM)
POST   /projects/:id/generate-report           report and audit (LLM)
POST   /projects/:id/persona-scores · GET …    persona scores (LLM)
POST   /projects/:id/audience-analysis · GET … who understood the text (LLM); 409 without scores
POST   /projects/:id/rewrites · POST /projects/:id/rewrites/:layer · GET …   three versions (LLM)
```

Every response is `{ "success": …, "data": …, "message": … }`. A project from another workspace answers 404, not 403.

</details>

## Structure

```text
.
├── aqylnet/              # React frontend: pages, scenes, report blocks, PDF/DOCX export
├── backend/
│   ├── prisma/           # 13 models, migrations, seed (34 personas)
│   ├── certs/            # root certificate of the intercepting proxy (public)
│   └── src/
│       ├── config/       # env, limits.ts (every numeric bound with its measurement), scales, glossary
│       ├── routes/ controllers/ validators/ repositories/
│       ├── services/     # llm.service.ts (17 scenarios), rounds, audit, scores, audience, rewrites
│       ├── middlewares/  # rate limits, session key, project access
│       ├── workers/      # document parsing in worker_threads with a timeout and a heap cap
│       └── utils/        # file signature, DOCX screening, semaphore, single-flight
├── tests/                # live API, security and Playwright E2E suites
├── scripts/              # model check, measurements
├── deploy/nginx.conf     # thin frontend: static files + /api proxy
└── docker-compose.yml    # postgres + backend + web
```

Backend layers: `routes → controllers → services → repositories → Prisma`. The interface theme is Graphite Green; every colour token is in [`variables.css`](aqylnet/src/styles/variables.css).

## Documentation

- [`.env.example`](.env.example) — every environment variable with its default;
- [`.env.test.example`](.env.test.example) — environment of the live test suites, PowerShell and bash;
- [`backend/src/config/limits.ts`](backend/src/config/limits.ts) — every numeric bound, each with the measurement behind it;
- [`backend/certs/README.md`](backend/certs/README.md) — the proxy root certificate and how to renew it.

Local working notes live in `.ai/`, which is git-ignored.
