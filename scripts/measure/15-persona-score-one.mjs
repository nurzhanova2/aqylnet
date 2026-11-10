// A1 stage 1, Б6: the cost of one persona scoring test1, before building the
// rest. Runs inside the backend container against the built dist.
//
//   sh scripts/measure/run.sh 15-persona-score-one.mjs <projectId> <personaName>
//
// Reads the project's document and stored sections, finds dictionary terms per
// section, calls generatePersonaScore once and reports tokens (from LlmUsage),
// time and the shape of the answer. Writes the answer to out/.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire('/app/package.json');
const { PrismaClient } = require('@prisma/client');
const llm = require('/app/dist/services/llm.service.js');
const { findTerms } = require('/app/dist/services/jargon.js');

const projectId = Number(process.argv[2]);
const personaName = process.argv[3] || 'Гульнар';
const OUT = process.env.MEASURE_OUT || '/tmp/measure-out';
const prisma = new PrismaClient();

const project = await prisma.project.findUnique({ where: { id: projectId } });
const sections = await prisma.documentSection.findMany({ where: { projectId }, orderBy: { order: 'asc' } });
const persona = await prisma.persona.findFirst({ where: { name: personaName } });
const input = sections.map((s, i) => ({ n: i + 1, title: llm.sectionTitle(s.order, s.heading), terms: findTerms(s.text).map((t) => t.canonical) }));

const prompt = llm.buildPersonaScorePrompt(persona, project.documentText, input, 'x'.repeat(16));
const t0 = Date.now();
const before = new Date();
const r = await llm.generatePersonaScore(persona, project.documentText, input);
const ms = Date.now() - t0;
await new Promise((res) => setTimeout(res, 1500)); // recordUsage does not await
const usage = await prisma.llmUsage.findFirst({ where: { scenario: 'persona_score', createdAt: { gte: before } }, orderBy: { id: 'desc' } });

const out = {
  projectId, persona: personaName, sections: sections.length, ms,
  promptChars: prompt.system.length + prompt.user.length,
  usage: usage && { prompt: usage.promptTokens, completion: usage.completionTokens, total: usage.totalTokens, version: usage.scenarioVersion, hash: usage.promptHash },
  ok: r.ok, reason: r.ok ? undefined : r.reason,
  answer: r,
};
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, `15-persona-score-${projectId}-${personaName}.json`), JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify({ ...out, answer: undefined }, null, 2));
if (r.ok) {
  for (const s of r.sections) console.log(`[${s.n}] ${s.skipped ? 'ПРОПУЩЕН' : ''} ${JSON.stringify(s.scores)} na=${JSON.stringify(s.nullReasons)} terms=${s.unclearTerms.length}`);
  console.log('decision:', r.decision, '| myAction:', r.myAction);
}
await prisma.$disconnect();
