// Input bounds shared by the validators. Kept in one place because the same
// quantity is accepted through more than one route: document text arrives via
// POST /documents/text, POST /projects and PATCH /projects/:id, and a limit
// that differs between them is not a limit.

/**
 * Longest document text *stored*, in characters.
 *
 * A storage bound, not a model bound. It keeps the stored value and the JSON
 * body finite and sits an order of magnitude below express.json's 10mb limit,
 * so an oversized payload fails as a clean 400 from Zod rather than a 413 from
 * body-parser. Extracted PDF/DOCX text over it is **truncated and flagged**,
 * not rejected (stage E3): 100 pages of dense PDF prose
 * yield ~468 000 characters.
 *
 * What reaches the model is decided elsewhere now. Since stage 0 of A1 the
 * persona reads the whole document and the audit reads every section of it, so
 * the effective limit is the context window: a document is attached to a
 * project only if it fits a persona reply's input budget
 * (assertDocumentFitsWindow in services/promptBudget.ts) — about 96 000
 * characters at the pessimistic ratio, far below this cap. The two numbers
 * answer different questions and must not be merged: this one says what can be
 * kept, that one what can be analysed.
 */
export const MAX_DOCUMENT_TEXT_CHARS = 500_000;

/**
 * Longest single transcript message accepted, in characters.
 *
 * Matches the pre-existing cap on UpdateModeratorMessageSchema. Generated
 * replies run to about 1500 characters (max_tokens 300) and the longest
 * message in the live database is ~1800, so this bounds manually posted
 * messages without touching normal use. Transcript growth *across* messages
 * is a different problem — the whole history is resent every round — and is
 * stage E4.
 */
export const MAX_MESSAGE_CHARS = 4_000;

/**
 * Most personas one project may hold.
 *
 * The Setup UI has always enforced 8; the API did not, so a crafted request
 * could put all 32 library personas in one project and turn a single round
 * into 33 LLM calls instead of 9. Every project in the live database has 8 or
 * fewer, so applying it retroactively breaks nothing.
 */
export const MAX_PERSONAS_PER_PROJECT = 8;

/**
 * Most rounds one discussion may run, and the highest round number any row may
 * claim.
 *
 * Was the literal 10 in two places in project.validator.ts and nowhere else,
 * so the (since removed) moderator-message route — which took an `iteration`
 * from the request body — had nothing to check against and took any number.
 */
export const MAX_ITERATIONS = 10;

/**
 * Key messages an author may attach to one project.
 *
 * The Setup UI caps at 3 and the report is laid out for 3 columns; the
 * validators said 5. Two of five would never have appeared on the page.
 */
export const MAX_INTENDED_MESSAGES = 3;

// ─── Document parsing (stage E3) ─────────────────────────────
// Every threshold below was measured rather than picked. The reference set is
// the 14 real documents in the uploads volume (0.5–1.1 MB, 33–134 ms to parse,
// at most 16 738 characters of text) plus synthetic worst cases built at the
// 20 MB upload limit.

/**
 * Hard wall-clock limit for one parse, in milliseconds.
 *
 * Measured: the slowest input the upload limit actually admits takes about 4s
 * (PDF — 1386 ms at 10.3 MB and 9747 ms at 41.4 MB, interpolated to 20 MB),
 * and a DOCX carrying 21 MB of uncompressed XML takes 2239 ms. The largest
 * real document takes 134 ms. 20 000 ms is ~5x the worst admissible case and
 * ~150x the realistic one, so no honest document should ever reach it; it is a
 * backstop against a parser that hangs, not a performance budget. Kept at the
 * bottom of the 20–30s range the audit suggested, because a hung parse holds a
 * worker for exactly this long.
 */
export const DOCUMENT_PARSE_TIMEOUT_MS = 20_000;

/**
 * Old-generation heap ceiling for the parser worker, in MB.
 *
 * Measured heap growth: ~164 MB for a 10.3 MB PDF (9.5M characters), ~459 MB
 * for a 41.4 MB PDF, ~568 MB for a DOCX with 21 MB of XML. 512 MB is ~3x the
 * 10.3 MB case, which already yields 19x more text than MAX_DOCUMENT_TEXT_CHARS
 * keeps.
 *
 * Inputs needing more than this fail, and that is the intended behaviour rather
 * than a regression: their text is >95% discarded by the 500 000-character cap,
 * so spending a gigabyte to throw almost all of it away buys nothing. The
 * ceiling also catches an archive that *lies* about its entry sizes — the
 * declared-size guards below run before any decompression and can be forged,
 * this one cannot.
 */
export const DOCUMENT_PARSE_MAX_HEAP_MB = 512;

/**
 * Most entries a .docx archive may declare.
 *
 * Real documents carry 27–34. 1024 is far beyond anything legitimate while
 * still refusing an archive whose attack is simply "very many members".
 */
export const MAX_DOCX_ENTRIES = 1_024;

/**
 * Largest total uncompressed size a .docx may declare, in bytes.
 *
 * Deliberately loose, because this total is dominated by embedded media, which
 * costs nothing to extract text from — mammoth reads the XML parts, not the
 * images. A legitimate image-heavy document at the 20 MB upload limit expands
 * to roughly 40–60 MB (measured whole-file ratio 2.05–3.19 on the real files,
 * which all contain images), so 128 MB admits it. The 200 MB zip bomb built
 * for the test is refused here and by the ratio below.
 */
export const MAX_DOCX_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;

/**
 * Largest total uncompressed size of the XML parts of a .docx, in bytes.
 *
 * This is the tight one, because the XML is what actually gets parsed and what
 * drives both time and memory. Separating it from the total above is the whole
 * point: one absolute cap would conflate harmless image bulk with the bulk that
 * costs something, and would have to be set loose enough to be useless.
 *
 * 16 MB of document.xml is on the order of 5M characters of text — ten times
 * what MAX_DOCUMENT_TEXT_CHARS keeps — against 0.5–1 MB in the real documents.
 * The synthetic 21 MB text DOCX is refused here with a clear 400 instead of
 * being allowed through to exhaust the worker's heap.
 */
export const MAX_DOCX_XML_UNCOMPRESSED_BYTES = 16 * 1024 * 1024;

/**
 * Largest whole-archive expansion ratio a .docx may declare.
 *
 * The measurement that mattered most here. The real files sit at 2.05–3.19,
 * which is misleading: they contain images, which barely compress. A perfectly
 * legitimate text-only document reaches **74** (measured: 71.2 for 2 MB of
 * Russian prose, 73.8 at 21 MB), so any threshold in the "10x is suspicious"
 * range would have rejected ordinary text documents. The 200 MB zip bomb sits
 * at 1022. 150 is ~2x the legitimate worst case and ~7x below the bomb.
 */
export const MAX_DOCX_EXPANSION_RATIO = 150;

// ─── LLM prompt budgets (stage E4) ───────────────────────────
// Measured against the live database: the largest real discussion is 45
// messages / 26 593 characters (5 rounds of 8 personas plus the moderator), the
// average message is 523 characters and the longest 1808. The most the product
// can produce is 10 rounds x (8 personas + 1 moderator) = 90 messages, about
// 47 000 characters.

/**
 * Transcript window for one persona reply, in characters — an upper bound that
 * the input budget can only shrink.
 *
 * 16 000 characters is about three rounds at the measured average (523
 * characters a reply), so a persona always sees the whole round in progress
 * (~4 700 characters) plus the two before it. What it stops seeing is round 1
 * during round 10, and its own position does not depend on that: stance,
 * reasoning, priority and fears live in the system prompt in full every time.
 *
 * It is no longer where a reply's cost lives. Since the persona reads the whole
 * document, the part resent with every reply is the document — ~18 000 tokens
 * for 15 pages against ~4 000 for a full transcript window — so this number
 * now matters for what a persona remembers, not for what a discussion costs.
 * When document plus window would overflow the context, the window shrinks
 * (fitTranscript in services/promptBudget.ts); the document is never cut.
 */
export const MAX_PERSONA_TRANSCRIPT_CHARS = 16_000;

/**
 * Transcript bound for the final report and the audit, in characters — again an
 * upper bound that the input budget can shrink.
 *
 * Both read the discussion once and must summarise all of it. 60 000 is above
 * the ~47 000 the product can produce, so on its own it drops nothing; it stops
 * a transcript inflated by manually posted messages from growing the prompt.
 * When it does trigger, the middle goes and head plus tail stay: positions are
 * established early, conclusions arrive late.
 *
 * Measured against the window (MEASUREMENTS-15PAGES §5.6): the transcript is
 * light — 3.88 characters a token — so 60 000 characters cost ~15 500 tokens and
 * fit next to a 15-page Russian document. They do *not* fit next to a dense
 * Kazakh one (2.22 characters a token), which is why the call site sizes the
 * transcript to the remaining budget instead of trusting this constant.
 */
export const MAX_REPORT_TRANSCRIPT_CHARS = 60_000;

/**
 * Messages the moderator sees. Unchanged behaviour, moved here from a literal
 * `.slice(-5)` so all four prompt budgets are visible in one place.
 */
export const MODERATOR_CONTEXT_MESSAGES = 5;

// ─── Context window and input budget (A1, stage 0) ───────────
// Measured in .ai/MEASUREMENTS-15PAGES.md on Qwen/Qwen3.5-35B-A3B-FP8, the
// model behind assistant-balanced. Re-measure when the alias moves.

/**
 * Context window of the served model, in tokens — prompt and completion
 * together (vLLM max_model_len). Read from vLLM's /v1/models, then confirmed
 * end to end: three markers at the start, middle and end of 8k–44k-token
 * inputs all came back, so the proxy does not truncate silently. Overridable
 * through LLM_CONTEXT_TOKENS, because it is a property of the deployment.
 */
export const MODEL_CONTEXT_TOKENS = 49_152;

/**
 * Tokens held back from every input budget. Covers what a character-based
 * estimate cannot see: the chat template (12 tokens), the per-request fence tag
 * (±30 tokens between otherwise identical calls) and rounding.
 */
export const INPUT_SAFETY_TOKENS = 1_024;

/**
 * Characters per token assumed when estimating a prompt — deliberately the
 * densest text measured: Kazakh at 2.22. Russian prose runs 3.2–3.6, tables
 * 2.6, a transcript 3.9, so for Russian this overestimates by up to 60% and
 * the budget errs towards trimming the transcript, never towards an input the
 * model refuses. LiteLLM's /utils/token_counter is not a substitute: it counts
 * with an OpenAI tokenizer and was 56–70% off.
 */
export const CHARS_PER_TOKEN_ESTIMATE = 2.2;

/**
 * Characters on a page, for messages to people only ("~N pages"). Measured
 * 3 400–4 200 on the test PDFs; 4 700 is the round figure the product uses.
 */
export const CHARS_PER_PAGE_ESTIMATE = 4_700;

/**
 * Room a persona reply needs besides the document, in tokens: the system
 * prompt with profile and data rules (~3 000 characters) plus one full round of
 * transcript (8 x 523 characters), both at the pessimistic ratio. A document is
 * attached to a project only if it fits the persona budget *with* this left
 * over — otherwise the persona would read the document and not hear the round.
 */
export const PERSONA_PROMPT_RESERVE_TOKENS = 4_000;

// ─── Document sections (A1, stage 0) ─────────────────────────
// Section size is a measured range, not a preference: every section from 3 990
// to 9 953 characters produced a complete audit (stop, strict JSON) in 51
// calls, and the model returns ~6 findings per call whatever the input size —
// so sections much above 9 000 lose coverage the way the whole document does
// (6–7 findings for 13 pages).

export const SECTION_MIN_CHARS    = 4_000;
export const SECTION_TARGET_CHARS = 7_000;
export const SECTION_MAX_CHARS    = 9_000;

/**
 * Section audits in flight at once. Measured: vLLM batches, 4 parallel calls
 * ran in 1.35x the time of one, so this is about not taking the shared GPU for
 * a single report, not about the GPU keeping up.
 */
export const AUDIT_SECTION_CONCURRENCY = 4;

// ─── LLM spend caps (stage E4) ───────────────────────────────

/**
 * Daily ceiling on total tokens across every scenario and every client.
 *
 * What one discussion costs since the persona reads the whole document
 * (MEASUREMENTS-15PAGES §8, Qwen3.5-35B-A3B-FP8): 8 personas x 10 rounds of
 * replies at ~21 900 tokens each — the 15-page document (~18 200 tokens) plus
 * profile, rules and the transcript window — is ~1.75M, and with the moderator,
 * the report and the section audit **about 1.85M tokens for the heaviest
 * discussion the product can produce** (~2.3M for a document dense with
 * tables). Before stage 0 it was ~395k.
 *
 * 10M a day is the product's choice (03.11.2026): about **5 such discussions a
 * day** with 10% headroom — 10 would need ~20M. It is being agreed with the
 * proxy administrators, because the quota it spends is shared with every other
 * user of the proxy (.ai/NOTE-vllm-open.md). Set it through
 * LLM_DAILY_TOKEN_BUDGET; docker-compose.yml carries the same default and must
 * move with this one, or it silently overrides it.
 *
 * Two lessons from earlier versions of this comment, which carried a wrong
 * number twice: measure a multi-round discussion, because a reply's prompt
 * grows with the transcript until the window caps it; and remember that
 * reasoning tokens are counted inside `completion_tokens`, so they are already
 * in every figure here.
 */
export const LLM_DAILY_TOKEN_BUDGET = 10_000_000;

/**
 * Daily ceiling on persona auto-suggest calls specifically.
 *
 * This route has no project behind it and leaves no row anywhere, so the
 * frequency limiter is the only thing bounding it and a patient caller can hold
 * 40 requests per 5 minutes indefinitely. A counted daily quota closes that:
 * 200 suggestions is far beyond any plausible session (one per project setup)
 * and cheap to raise.
 */
export const LLM_DAILY_SUGGEST_CALLS = 200;

/**
 * How many discussion rounds may run at once.
 *
 * A round holds one pooled database connection for its whole duration, so this
 * is what stops rounds from exhausting the pool. Measured: the pool on this
 * container is 49 (Prisma's default of cpus*2+1, 24 CPUs), 10 concurrent long
 * transactions left ordinary queries answering in 1-8 ms, and at 49 an
 * unrelated query waits the full 10s pool_timeout before failing with P2024.
 *
 * Six leaves 43 connections for everything else and sits far above observed
 * use — the live database holds 12 projects in total, and a round is one Play
 * click per project. Over the limit the caller waits briefly and then gets a
 * clear 429; previously the seventh round did not fail, somebody else's
 * unrelated request did.
 */
export const MAX_CONCURRENT_ROUNDS = 6;

// ─── Completion budgets ──────────────────────────────────────
// `max_tokens` per scenario. Two different situations hide behind this one
// number, and they pull in opposite directions.
//
// The proxy documents that a reasoning model spends the budget on reasoning
// *and* the answer, so a limit sized for the answer alone can be exhausted
// before the answer starts — `finish_reason: 'length'` with empty content. That
// argues for raising every budget.
//
// Measured against the live model, which argues the other way: asked for "3–4
// sentences" with max_tokens 1536, it returned 5686 characters and was cut off
// by the limit. **This model fills whatever budget it is given, whatever the
// prompt says about length.** For free-text output that makes max_tokens the de
// facto length control — the average reply in the live database is 523
// characters at max_tokens 300, and raising the budget would quadruple
// transcripts and with them every prompt that replays a transcript.
//
// So the budgets split by output shape:
//
//   - Structured output (JSON with a fixed schema, validated and clamped
//     downstream by Zod) cannot get harmfully longer, so it gets full reasoning
//     headroom. For the report and the audit this is a double win: 1400 and
//     4000 already truncated often enough that parseTruncatedJson exists to
//     rescue the tail.
//   - Free text (a persona reply, a moderator question) keeps its current
//     budget, because raising it is a visible product change on the model that
//     is actually running.
//
// The risk left on the free-text side is real and deliberate: if the new model
// reasons, those two could come back empty, and the product would quietly fall
// back to a persona's one-line `thinking`. Three things make that survivable
// rather than silent — readCompletion logs the exact cause, every budget is
// overridable from the environment, and scripts/check-llm-model.mjs tests these
// two budgets for empty answers specifically. Raising a number is then one env
// change and a container restart, with no rebuild.
//
// Measured against assistant-balanced — which is Qwen/Qwen3.5-35B-A3B-FP8 behind
// the alias (03.11, /model/info) — on 28.10 and again on 03.11. An alias can be
// repointed without notice; these numbers belong to that model, not to the
// alias. All six budgets return a non-empty answer, and the free-text two were
// the point: personaResponse at 300 produced 1105 characters, moderatorMessage
// at 150 produced 560, with no readCompletion warnings in the log.
//
// The audit's output is stable with thinking disabled: across 55 audit calls
// (MEASUREMENTS-15PAGES §5.1) the longest answer was 1782 tokens, every call
// ended with finish_reason=stop and parsed as strict JSON — and answer length
// did not depend on input size: a 4 000-character section and a 52 000-character
// document both drew ~1 200–1 800 tokens. Measure with the switch on, the way
// the product sends it; scripts/check-llm-model.mjs does since stage 0.

/** Structured JSON — safe to give headroom: a schema bounds what comes back. */
export const COMPLETION_TOKENS_SUGGEST_PERSONAS = 1_024;
export const COMPLETION_TOKENS_PERSONA_POSITIONS = 4_096;
export const COMPLETION_TOKENS_DISCUSSION_REPORT = 3_072;

/**
 * One section of the audit. The longest of 51 section-sized answers was 1 628
 * tokens; 3 072 is ~1.9x that, so no section is cut, while still capping what a
 * looping generation can cost nine times over.
 */
export const COMPLETION_TOKENS_AUDIT_SECTION = 3_072;

/**
 * The intended-vs-perceived check that used to ride inside the single audit
 * call. Up to three messages, a few sentences each — not measured on its own;
 * sized as structured output with headroom.
 */
export const COMPLETION_TOKENS_AUDIT_ALIGNMENT = 2_048;

/**
 * The checklist of absences (config/auditChecklist.ts): eight answers of a
 * section and at most one sentence of quote each — the verdict is computed in
 * code. Measured in stage 0a: 1 020–1 419 tokens with the old verdict-and-note
 * format, so the evidence-only format fits with room.
 */
export const COMPLETION_TOKENS_AUDIT_CHECKLIST = 1_536;

/**
 * Confirming the contradiction candidates the code paired up (stage 0a). 1 024
 * was hit twice in the first acceptance and the answer came back empty, so the
 * budget was doubled by decision of 03.11.2026.
 */
export const COMPLETION_TOKENS_AUDIT_CONTRADICTIONS = 2_048;

/**
 * Candidate pairs sent for confirmation at most. Candidates are claims about
 * one phenomenon with opposite directions; more than this on 15 pages means the
 * phenomenon matching is too loose, and the list would only cost tokens.
 */
export const MAX_CONTRADICTION_CANDIDATES = 15;

/** Key claims a section audit extracts for the contradiction search. */
export const MAX_CLAIMS_PER_SECTION = 5;

/**
 * Free text — unchanged from the values the live behaviour was measured at,
 * because this model treats max_tokens as the length it should produce.
 */
export const COMPLETION_TOKENS_PERSONA_RESPONSE = 300;
export const COMPLETION_TOKENS_MODERATOR_MESSAGE = 150;

/**
 * Longest generated persona reply kept, in characters.
 *
 * A safety net rather than an active bound: 2000 is above the longest reply in
 * the live database (1808, against an average of 523), so nothing changes
 * today. It is what makes raising COMPLETION_TOKENS_PERSONA_RESPONSE safe if
 * the new model turns out to need the headroom — without it, a bigger budget
 * would silently inflate the transcript and every prompt that replays it.
 */
export const MAX_PERSONA_REPLY_CHARS = 2_000;

// ─── Trust in model output (stage E6) ────────────────────────
// The report is built from text nobody vouched for: the uploaded document, the
// model's own replies replayed as a transcript, and persona fields any client
// can edit. These bound what the verification pass reports, not what it reads —
// detection and quote checking run over everything; only the *findings* are
// capped, so one poisoned paragraph repeated two hundred times cannot push the
// rest of the report off the page.

/** Directive-like fragments reported per input source (document, transcript, one persona). */
export const MAX_DIRECTIVE_HITS_PER_SOURCE = 5;

/** Directive-like fragments reported in total across all sources. */
export const MAX_DIRECTIVE_HITS_TOTAL = 12;

/**
 * Persona fields scanned for directives, in total characters.
 *
 * MAX_MESSAGE_CHARS already bounds a transcript message and
 * MAX_DOCUMENT_TEXT_CHARS the document, but persona text has no single bound of
 * its own — 25 free-string columns across up to 8 personas. Scanning is linear
 * in the text, so this is a cost ceiling on report generation, not a safety
 * boundary: the fields still reach the prompt in full either way.
 */
export const MAX_PERSONA_SCAN_CHARS = 40_000;

/**
 * "The main conclusion comes first" (config/auditChecklist.ts, atStart): the
 * evidence sentence must begin in the document's first section or within this
 * many characters of the text quotes are checked in (decision of 03.11.2026).
 */
export const CHECKLIST_START_CHARS = 1_500;

// ─── Persona scores (A1 stage 1) ─────────────────────────────

/**
 * One persona scoring every section of the document in one call: per section a
 * sentence of what was read, up to three unclear points, the unclear terms, a
 * quote and five scores; then three document-level answers. Sized for ~10
 * sections; the answer is structured, so the budget is a ceiling, not a target.
 *
 * 4 096 until persona_score@3: a phrase per criterion took answers to
 * 3 500–4 096 tokens on test1 (9 sections), one hit the ceiling and lost its
 * document block. Window check: 15 pages ≈ 18 000 input + 6 144 + 1 024 fits
 * 49 152 with room; the service still refuses a document that does not.
 */
export const COMPLETION_TOKENS_PERSONA_SCORE = 6_144;

/** Personas scored at once — the same ceiling as audit sections. */
export const PERSONA_SCORE_CONCURRENCY = 4;

/**
 * Research profile: a low temperature, so two runs on the same document differ
 * by the persona and not by sampling (acceptance: per-criterion means of two
 * runs within one point).
 */
export const PERSONA_SCORE_TEMPERATURE = 0.1;

/**
 * Version of the persona_score prompt, written to LlmUsage.scenarioVersion.
 * Bump it with any change to the prompt or the scale wording, so scores from
 * two versions are never averaged as one measurement.
 *
 * @2 (03.11.2026): the prompt names the exact number of sections — on test1
 * the model stopped after 8 of 9 sections for 7 of 8 personas.
 * @3 (03.11.2026): level → phrase → score within ±1 for criteria 1, 2, 3, 5;
 * criterion 4 once per document; library profile for every persona. Scores of
 * @2 sat in 6–8 whatever the text said.
 */
export const PERSONA_SCORE_VERSION = 'persona_score@4';

/**
 * Per-call timeout for persona_score. Not the 45 s of the other scenarios:
 * those are paired with the round transaction's 120 s, and this call is not in
 * a transaction — it writes only after every persona has answered — while its
 * answer is several thousand tokens long.
 */
export const PERSONA_SCORE_TIMEOUT_MS = 180_000;

/**
 * Highest Persona.avatarIdx the API accepts. The seed uses 0–33 (two personas
 * added in A1 stage 1); a lower limit would refuse a PATCH that sends a
 * persona its own index back. An index with no picture falls back to the
 * chibi avatar drawn from Persona.look.
 */
export const MAX_AVATAR_IDX = 33;

// ─── Audience analysis (A1 stage 2) ──────────────────────────

/**
 * The decision reference: one verbatim sentence and the section it is in.
 * Short and structured; the window check is the same as for persona_score,
 * the input is the whole document.
 */
export const COMPLETION_TOKENS_DECISION_REFERENCE = 512;

/**
 * Verdicts on up to 8 decision answers: per persona a verdict and one phrase.
 * ~60 tokens each, so 1 024 leaves room.
 */
export const COMPLETION_TOKENS_DECISION_VERDICTS = 1_024;

/** Up to 5 missing explanations for one group, four short fields each. */
export const COMPLETION_TOKENS_MISSING_EXPLANATIONS = 1_536;

/** Structured scenarios: low temperature, as persona_score. */
export const AUDIENCE_ANALYSIS_TEMPERATURE = 0.1;

/**
 * Prompt versions, written to LlmUsage.scenarioVersion and to
 * AudienceAnalysis.versions. Bump with any change to the prompt.
 *
 * decision_verdict@2 (04.11.2026): only what the reference names is checked.
 * On the press release the reference «установить базовую ставку на уровне
 * 16,25%» names no direction, and @1 judged 6 of 8 correct «снизили» answers
 * wrong by direction — the title says «О снижении».
 * decision_verdict@3 (04.11.2026): what the answer adds (conditions, the next
 * meeting) is no error. On test1 @2 marked «сохранить 16,25%» plus a true
 * condition partial, and plus the date of the next meeting wrong; and on the
 * press release it was back to partial for «снизили».
 * decision_verdict@4, decision_reference@2 (04.11.2026): the verdict moved to
 * code. The reference names actor / direction / value, each with a verbatim
 * quote the server checks; per persona the model only extracts the same
 * fields from the answer; audienceRules.decideVerdict compares them.
 */

/** Values of the decision compared as numbers within this tolerance. */
export const DECISION_VALUE_TOLERANCE = 0.01;
export const DECISION_REFERENCE_VERSION = 'decision_reference@2';
export const DECISION_VERDICT_VERSION = 'decision_verdict@4';
export const MISSING_EXPLANATIONS_VERSION = 'missing_explanations@1';

/** Missing explanations kept per group. */
export const MAX_MISSING_PER_GROUP = 5;

/** Unclear terms shown per group. */
export const MAX_GROUP_TERMS = 10;

/**
 * Understanding levels per group. PRODUCT thresholds, not measured
 * (brief of 04.11.2026): index = mean of a persona's document scores on
 * criteria 1, 3, 6; share = correct + half of partial over personas with a
 * verdict.
 *   clear    — index ≥ 7 and share ≥ 0.75;
 *   unclear  — index < 5 or share < 0.5;
 *   partial  — everything else.
 */
export const UNDERSTANDING_CLEAR_INDEX = 7;
export const UNDERSTANDING_CLEAR_SHARE = 0.75;
export const UNDERSTANDING_UNCLEAR_INDEX = 5;
export const UNDERSTANDING_UNCLEAR_SHARE = 0.5;

/**
 * Two groups with the same level and share whose indices differ by less than
 * this are both named as best understood (decision of 04.11.2026): on test1
 * 7,0 against 6,4 made one of two equal groups the leader. Product, not measured.
 */
export const LEADER_INDEX_MARGIN = 1;

/**
 * «Чего не хватает»: an item needs two different personas only when three or
 * more personas of the group have material; in a group of one or two, one is
 * enough and the item is marked «1 участник» (decision of 04.11.2026 — with
 * two, the press release lost every item of the experts).
 */
export const MISSING_TWO_PERSONAS_FROM = 3;

// ─── Three versions of the text (A1 stage 3) ─────────────────

/** The card: four short fields, ~1000 characters at most. */
export const COMPLETION_TOKENS_REWRITE_CARD = 1_024;
/** The brief: four parts and up to six figures, ~4000 characters at most. */
export const COMPLETION_TOKENS_REWRITE_BRIEF = 3_072;
/** «Главное в начале» of the full text: 3–4 sentences. */
export const COMPLETION_TOKENS_REWRITE_BLUF = 768;
/** Edits of one section of the full text. */
export const COMPLETION_TOKENS_REWRITE_SECTION = 3_072;

/** Sections of the full text edited at once — as audit sections and persona scores. */
export const REWRITE_SECTION_CONCURRENCY = 4;

/** Low: the task is to restate what is in the document, not to invent. */
export const REWRITE_TEMPERATURE = 0.2;

/** Prompt versions, written to LlmUsage.scenarioVersion and to each layer. */
export const REWRITE_CARD_VERSION = 'rewrite_card@2';
export const REWRITE_BRIEF_VERSION = 'rewrite_brief@2';
export const REWRITE_BLUF_VERSION = 'rewrite_bluf@2';
export const REWRITE_SECTION_VERSION = 'rewrite_section@2';

/**
 * Volume and sentence length per version (brief of 04.11.2026). Shown, never
 * blocking. Reading speed for «время чтения»: ~180 words a minute.
 */
export const CARD_CHARS = { min: 600, max: 1_000 } as const;
export const BRIEF_CHARS = { min: 2_500, max: 4_000 } as const;
export const CARD_MAX_WORDS = 20;
export const BRIEF_MAX_WORDS = 30;
export const READING_WORDS_PER_MINUTE = 180;

/** Key figures of the brief. */
export const MAX_BRIEF_FIGURES = 6;

/**
 * Support of a rewritten statement (decision of 04.11.2026): the share of its
 * significant word stems that must be found in its basis and the basis's
 * section (in the full text — in the paragraph it replaces). Chosen on the
 * acceptance run; the false marks it gives on true sentences are reported.
 */
export const SUPPORT_MIN_COVERAGE = 0.75;

/**
 * «Проверить автору» (decision of 04.11.2026): a statement backed by its basis
 * and section, but whose significant stems are covered by the basis ALONE
 * below this share. The lexical check cannot tell a wrong relation between
 * words the document has from a true paraphrase — on the press release
 * «доступность кредитов будет ограничена» (0,60 by the basis) stood on a
 * sentence about prices. A soft mark: the author compares the two.
 */
export const AUTHOR_CHECK_BASIS_COVERAGE = 0.7;
