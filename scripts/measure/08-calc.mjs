// Step 8: what a 15-page document costs the product — computed from the
// measurements above, not estimated. No model calls.
//
// Every input is read from an out/*.json file where one exists. The few that do
// not come from this study are named in INHERITED with their source, so the
// report can say which numbers are this measurement's and which are not.

import fs from 'node:fs';
import path from 'node:path';
import { OUT, save, main } from './lib.mjs';

const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));

const WINDOW = 49_152;                       // vLLM max_model_len (step 1)
const DAILY = 5_000_000;                     // LLM_DAILY_TOKEN_BUDGET
const PAGES = 15;

// Numbers this study did not measure, with where they come from.
const INHERITED = {
  personaPromptAvg: { value: 4_200, src: 'limits.ts LLM_DAILY_TOKEN_BUDGET comment: avg persona prompt over a 8x10 run, transcript capped at 16 000 chars' },
  personaCompletionAvg: { value: 158, src: 'SECURITY.md §12: persona_response 1 418 completion / 9 calls' },
  moderatorTotal: { value: 1_183, src: 'SECURITY.md §12: moderator_message 3 550 / 3 calls (prompt+completion)' },
  positionsTotal: { value: 1_524, src: 'SECURITY.md §12: persona_positions, one call' },
  reportScaffold: { value: 2_800, src: 'SECURITY.md §12: discussion_report prompt 2 814 on a 3-round transcript' },
  reportCompletion: { value: 940, src: 'SECURITY.md §12: discussion_report completion' },
  personaDocChars: { value: 2_000, src: 'llm.service.ts:607 documentText.slice(0, 2000)' },
  productMaxTranscriptChars: { value: 47_000, src: 'limits.ts: 10 rounds x 9 messages x 523 chars' },
  summaryChars: { value: 1_500, src: 'ASSUMPTION — the section variant needs a running summary; its size is not measured' },
};

await main(async () => {
  const parse = J('04-parse.json');
  const calib = J('05c-calibrate.json');
  const step6 = [...J('06-concurrency-1-2-4.json'), ...J('06-concurrency-8.json')];
  const audits = ['map-test1', 'map-test2', 'reps-test1', 'reps-test2', 'map-test1-v1', 'map-test2-v1', 'reps-test1-v1', 'reps-test2-v1']
    .flatMap((f) => J(`05-${f}.json`));
  const wholes = ['whole-test1', 'whole-test2'].map((f) => J(`05-${f}.json`)[0]);
  const step2 = J('02-needle.json');

  // ── Document size ───────────────────────────────────────────
  const auditScaffoldNoPersonas = calib.scaffoldTokens - 150; // 8 persona lines ≈ 150 tokens (05c: with vs without is not split; see report)
  const docRatio = wholes.map((w) => ({ chars: w.chars, tokens: w.prompt - auditScaffoldNoPersonas, cpt: w.chars / (w.prompt - auditScaffoldNoPersonas) }));
  const cptReal = Math.min(...docRatio.map((d) => d.cpt));            // the denser of the two real documents
  const cptDense = 2.63;                                              // doc-1111, bank report (step 3) — pessimistic bound
  const charsPerPage = Math.max(...parse.map((p) => p.charsPerPage)); // PDF, the larger extraction
  const docChars15 = charsPerPage * PAGES;
  const docTokens15 = Math.round(docChars15 / cptReal);
  const docTokens15Dense = Math.round(docChars15 / cptDense);

  // ── Audit per section ───────────────────────────────────────
  const sectionCompletions = [...audits.map((a) => a.completion), ...step6.flatMap((b) => b.calls.map((c) => c.completion))];
  const sectionPrompts = audits.map((a) => a.prompt);
  const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const maxCompletion = Math.max(...sectionCompletions);
  const sectionsPerDoc = Math.ceil(docChars15 / 7_000);
  const auditMap = Math.round(sectionsPerDoc * (avg(sectionPrompts) + avg(sectionCompletions)));
  const transcriptTokensMax = Math.round(INHERITED.productMaxTranscriptChars.value / calib.transcriptCharsPerToken);
  const auditMerge = Math.round(transcriptTokensMax + 3_000 + calib.scaffoldTokens + 2_000); // transcript + section findings + scaffold + answer
  const auditMapWithTranscriptEach = auditMap + sectionsPerDoc * transcriptTokensMax;

  // ── Report (one call, whole transcript) ─────────────────────
  const report = INHERITED.reportScaffold.value + transcriptTokensMax + INHERITED.reportCompletion.value;

  // ── Discussion 8 x 10 in three variants ─────────────────────
  const personaDocTokensNow = Math.round(INHERITED.personaDocChars.value / cptReal);
  const sectionTokens = Math.round(7_000 / cptReal);
  const summaryTokens = Math.round(INHERITED.summaryChars.value / cptReal);
  const replies = 80;
  const perReply = {
    current: INHERITED.personaPromptAvg.value + INHERITED.personaCompletionAvg.value,
    section: INHERITED.personaPromptAvg.value - personaDocTokensNow + sectionTokens + summaryTokens + INHERITED.personaCompletionAvg.value,
    whole: INHERITED.personaPromptAvg.value - personaDocTokensNow + docTokens15 + INHERITED.personaCompletionAvg.value,
    wholeDense: INHERITED.personaPromptAvg.value - personaDocTokensNow + docTokens15Dense + INHERITED.personaCompletionAvg.value,
  };
  const fixed = 10 * INHERITED.moderatorTotal.value + INHERITED.positionsTotal.value + report;
  const currentAudit = calib.scaffoldTokens + Math.round(6_000 / cptReal) + transcriptTokensMax + Math.round(avg(sectionCompletions));
  const discussion = {
    current: replies * perReply.current + fixed + currentAudit,
    section: replies * perReply.section + fixed + auditMap + auditMerge,
    whole: replies * perReply.whole + fixed + auditMap + auditMerge,
    wholeDense: replies * perReply.wholeDense + fixed + auditMap + auditMerge,
  };
  const perDay = Object.fromEntries(Object.entries(discussion).map(([k, v]) => [k, +(DAILY / v).toFixed(1)]));
  const budgetFor = (n) => Object.fromEntries(Object.entries(discussion).map(([k, v]) => [k, Math.ceil((n * v * 1.1) / 100_000) * 100_000]));

  // ── Time, from step 6 ───────────────────────────────────────
  const decodeSingle = step6.find((b) => b.concurrency === 1).aggregateTokPerSec;      // tok/s, one stream
  const prefill = Math.max(...step2.map((n) => n.promptTokens / (n.ms / 1000)));      // tok/s, upper bound incl. overhead
  const replySeconds = (prompt) => prompt / prefill + 300 / decodeSingle + 0.3;         // worst case: full 300-token reply
  const timePerDiscussion = (prompt) => Math.round(replies * replySeconds(prompt) + 10 * 1.5 + 2 * avg(audits.map((a) => a.ms)) / 1000);
  const time = {
    current: timePerDiscussion(INHERITED.personaPromptAvg.value),
    section: timePerDiscussion(perReply.section),
    whole: timePerDiscussion(perReply.whole),
  };

  // ── Window budgets ──────────────────────────────────────────
  const margin = 1_024;
  const windowFor = (maxTokens) => WINDOW - maxTokens - margin;
  const transcriptRoomWhole = (maxTokens, docTok) => windowFor(maxTokens) - calib.scaffoldTokens - docTok;

  const out = {
    inherited: INHERITED,
    document: { charsPerPage, docChars15, cptReal: +cptReal.toFixed(2), docTokens15, docTokens15Dense, docRatio },
    audit: { sectionsPerDoc, maxSectionCompletion: maxCompletion, sectionCalls: sectionCompletions.length, auditMap, auditMerge, auditMapWithTranscriptEach, transcriptTokensMax },
    perReply, discussion, perDay, budgetFor5: budgetFor(5), budgetFor10: budgetFor(10),
    time: { decodeSingle, prefillUpperBound: Math.round(prefill), secondsPerDiscussion: time },
    window: {
      margin,
      personaReply: windowFor(300),
      auditSection: windowFor(3072),
      auditWholeAt6144: windowFor(6144),
      transcriptRoomWhole6144: transcriptRoomWhole(6144, docTokens15),
      transcriptRoomWhole6144Chars: Math.round(transcriptRoomWhole(6144, docTokens15) * calib.transcriptCharsPerToken),
      transcriptRoomWhole6144Dense: transcriptRoomWhole(6144, docTokens15Dense),
      transcriptRoomWhole6144DenseChars: Math.round(transcriptRoomWhole(6144, docTokens15Dense) * calib.transcriptCharsPerToken),
      personaWholeDocPrompt: perReply.whole - INHERITED.personaCompletionAvg.value,
      personaWholeDocPromptDense: perReply.wholeDense - INHERITED.personaCompletionAvg.value,
    },
  };
  console.log(JSON.stringify(out, null, 2));
  save('08-calc.json', out);
});
