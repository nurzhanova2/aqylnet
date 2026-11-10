// A1 stage 1: the raw persona_score answer, to see how the model numbers
// sections. Same prompt as the product (buildPersonaScorePrompt), one call.
//
//   sh scripts/measure/run.sh 15b-persona-score-raw.mjs <projectId> <personaName>

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire('/app/package.json');
const { PrismaClient } = require('@prisma/client');
const OpenAI = require('openai').default;
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
const tag = 'f00dfeedc0ffee11';
const { system, user } = llm.buildPersonaScorePrompt(persona, project.documentText, input, tag);

const client = new OpenAI({ apiKey: process.env.LLM_API_KEY, baseURL: process.env.LLM_API_BASE, timeout: 180000, maxRetries: 0 });
const c = await client.chat.completions.create({
  model: process.env.LLM_MODEL, max_tokens: 4096, temperature: 0.1,
  messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  chat_template_kwargs: { enable_thinking: false },
});
const raw = c.choices[0].message.content ?? '';
fs.writeFileSync(path.join(OUT, `15b-raw-${projectId}-${personaName}.txt`), raw, 'utf8');
console.log('finish:', c.choices[0].finish_reason, 'usage:', JSON.stringify(c.usage));
console.log('n values:', [...raw.matchAll(/"n"\s*:\s*(-?\d+)/g)].map((m) => m[1]).join(','));
console.log('section list sent:', input.map((s) => s.n).join(','));
await prisma.$disconnect();
