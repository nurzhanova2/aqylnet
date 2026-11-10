// A1 stage 2 acceptance: document fields, then the audience analysis through
// the product path. No persona_score is run — the analysis reads the stored
// scores of stage 1.
//
//   node scripts/measure/22-audience.mjs test1|test2|press <tag>
//
// Audience per the brief of 04.11.2026: test1 — population; test2 and the
// press release — population and business.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const API = process.env.API_BASE_URL || 'http://127.0.0.1:3001/api';
const which = process.argv[2];
const tag = process.argv[3] || 'a1';
const META = {
  test1: { docType: 'mpr', publishedAt: null, intendedAudience: ['population'] },
  test2: { docType: 'fsr', publishedAt: null, intendedAudience: ['population', 'business'] },
  press: { docType: 'press_release', publishedAt: '2026-09-04', intendedAudience: ['population', 'business'] },
};
if (!META[which]) { console.log('usage: 22-audience.mjs test1|test2|press <tag>'); process.exit(1); }
const { id, key } = JSON.parse(fs.readFileSync(path.join(OUT, '20-projects.json'), 'utf8'))[which];

async function api(method, url, body) {
  const t0 = Date.now();
  const res = await fetch(API + url, {
    method,
    headers: { 'X-Session-Key': key, 'Content-Type': 'application/json; charset=utf-8' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${url}: HTTP ${res.status} ${json?.message ?? ''}`);
  return { data: json.data, ms: Date.now() - t0 };
}

await api('PATCH', `/projects/${id}`, META[which]);
const started = new Date().toISOString();
const run = await api('POST', `/projects/${id}/audience-analysis`, {});
const d = run.data;
fs.writeFileSync(path.join(OUT, `22-audience-${which}-${tag}.json`), JSON.stringify({ which, tag, projectId: id, started, ms: run.ms, result: d }, null, 2), 'utf8');

const LEVEL = { clear: 'понятно', partial: 'частично', unclear: 'непонятно' };
const a = d.analysis;
console.log(`${which} ${tag} (project ${id}): ${run.ms} ms, started ${started}`);
console.log(`эталон: verified=${a.reference.verified} ${a.reference.reason} [${a.reference.section}] «${a.reference.quote}»`);
console.log('\nвердикты:');
for (const v of a.verdicts) console.log(`  ${v.name} [${v.group}] ${v.verdict ?? 'null'} (${v.by}) — «${v.decision}» — ${v.extracted ? JSON.stringify(v.extracted) : "—"} — ${v.reason}`);
console.log('\nгруппы:');
for (const g of d.groups) console.log(`  ${g.group}: n=${g.personas}${g.few ? ' (мало)' : ''} индекс ${g.index} доля ${g.share} → ${LEVEL[g.level] ?? 'null'}; ${JSON.stringify(g.criteria)}; без ответа ${g.unanswered}`);
console.log(`фраза: ${d.phrase}`);
console.log(`разрыв: ${d.gap?.verdict ?? '—'}; ${(d.gap?.phrases ?? []).join(' ')}`);
console.log('\nчего не хватает:');
for (const [g, m] of Object.entries(a.missing)) {
  console.log(`  ${g}: ${m.status} ${m.reason} — вернула ${m.returned}, отброшено ${m.dropped} ${JSON.stringify(m.droppedBy)}, чужих id ${m.unknownIds}`);
  m.items.forEach((it, i) => console.log(`    ${i + 1}. ${it.missing} | персон ${it.personas} | ${it.sections.join('; ')} | вопрос: ${it.question ?? '—'} | → ${it.suggestion} | ${it.sourceIds.join(',')}`));
  const t = d.terms[g];
  console.log(`    термины: ${t.terms.map((x) => `${x.term} (${x.personas})`).join(', ') || '—'}; вне словаря: ${t.extra.map((x) => `${x.word} (${x.personas})`).join(', ') || '—'}`);
}
