// A1 stage 3: do the personas understand the rewritten text better? A
// temporary project with the card (or the brief) of test1 as its document and
// the same personas as 2728, persona scores and the audience analysis through
// the product path, then the comparison with 2728. Deleted at the end.
//
//   node scripts/measure/29-persona-check.mjs card|brief <rewrites tag>

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const API = process.env.API_BASE_URL || 'http://127.0.0.1:3001/api';
const [layer = 'card', tag = 'f1'] = process.argv.slice(2);
const NAMES = layer === 'card' ? ['Нурлан', 'Айдос', 'Бауыржан', 'Балжан'] : ['Айгерим', 'Максат'];
const GROUP = layer === 'card' ? 'population' : 'business';
const PARTS = layer === 'card'
  ? [['decision', 'Что решили'], ['why', 'Почему'], ['forYou', 'Что это значит для вас'], ['next', 'Что дальше']]
  : [['main', 'Главное'], ['why', 'Почему так решили'], ['forBusiness', 'Что изменится для бизнеса'], ['next', 'Что дальше']];

const rw = JSON.parse(fs.readFileSync(path.join(OUT, `27-rewrites-test1-${tag}.json`), 'utf8')).result[layer];
// The version as a reader gets it: headings and text, placeholders as they are, no marks.
let documentText = PARTS.map(([k, h]) => `${h}\n\n${rw[k].map((i) => i.text).join(' ')}`).join('\n\n');
if (layer === 'brief' && rw.figures?.length) documentText += `\n\nКлючевые цифры\n\n${rw.figures.map((f) => `${f.indicator} — ${f.value}.`).join('\n')}`;

const key = crypto.randomUUID();
async function api(method, url, body) {
  const res = await fetch(API + url, { method, headers: { 'X-Session-Key': key, 'Content-Type': 'application/json; charset=utf-8' }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${url}: HTTP ${res.status} ${json?.message ?? ''}`);
  return json.data;
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const library = await api('GET', '/personas');
const ids = NAMES.map((n) => library.find((p) => p.name === n).id);
const project = await api('POST', '/projects', {
  title: `[этап 3] проверка ${layer} test1`, documentText, documentFileName: `${layer}.txt`, personaIds: ids, iterations: 1, moderator: false,
  intendedAudience: [GROUP],
});
const result = {};
try {
  const scores = await api('POST', `/projects/${project.id}/persona-scores`, {});
  const audience = await api('POST', `/projects/${project.id}/audience-analysis`, {});
  result.rewritten = summarize(scores, audience);
  result.reference = audience.analysis.reference;
} finally {
  await api('DELETE', `/projects/${project.id}`);
}
// 2728 as it is now: its persona scores and its latest audience analysis.
const base = JSON.parse(fs.readFileSync(path.join(OUT, '20-projects.json'), 'utf8')).test1;
async function baseGet(url) {
  const res = await fetch(API + url, { headers: { 'X-Session-Key': base.key } });
  return (await res.json()).data;
}
result.original = summarize(await baseGet(`/projects/${base.id}/persona-scores`), await baseGet(`/projects/${base.id}/audience-analysis`));
fs.writeFileSync(path.join(OUT, `29-persona-check-${layer}-${tag}.json`), JSON.stringify({ layer, tag, documentText, ...result }, null, 2), 'utf8');

function summarize(scores, audience) {
  const g = audience.groups.find((x) => x.group === GROUP);
  const ps = scores.personas.filter((p) => NAMES.includes(p.name) && p.status === 'scored');
  return {
    index: g?.index ?? null,
    share: g?.share ?? null,
    level: g?.level ?? null,
    criteria: g?.criteria ?? null,
    clarityMedian: median(ps.map((p) => p.document.clarity).filter((v) => typeof v === 'number')),
    unanswered: g?.unanswered ?? null,
    personas: ps.map((p) => ({ name: p.name, clarity: p.document.clarity, myAction: p.document.myAction, terms: p.document.terms, decision: p.decision, myActionText: p.myAction, takeaway: p.mainTakeaway, unclear: p.sections.flatMap((s) => s.unclear) })),
    verdicts: (audience.analysis?.verdicts ?? []).filter((v) => NAMES.includes(v.name)).map((v) => `${v.name}: ${v.verdict ?? 'null'} — ${v.reason}`),
  };
}

for (const k of ['original', 'rewritten']) {
  const r = result[k];
  console.log(`${k}: индекс ${r.index}, доля верно понявших ${r.share}, уровень ${r.level}, медиана понятности ${r.clarityMedian}, критерии ${JSON.stringify(r.criteria)}, вопросов без ответа ${r.unanswered}`);
  for (const p of r.personas) console.log(`  ${p.name}: понятность ${p.clarity}, что делать ${p.myAction}, термины ${p.terms} · решение «${p.decision}» · сделаю «${p.myActionText}»`);
  for (const v of r.verdicts) console.log(`  вердикт ${v}`);
}
