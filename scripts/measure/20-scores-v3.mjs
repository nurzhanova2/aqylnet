// A1 stage 1, persona_score@3 acceptance: new base projects with the approved
// composition, then persona scores through the product path.
//
//   node scripts/measure/20-scores-v3.mjs test1|test2 <tag>
//
// The 0a base projects (2554, 2558) keep Гульнар, Данияр and Светлана: they
// spoke in the copied transcripts and the API refuses to remove a persona that
// has messages. Persona scores never read the transcript, so a project with
// the same document text — same sections, the split is deterministic — is an
// equivalent base. Created once per document and reused by later runs
// (out/20-projects.json keeps the id and the session key).
//
// Composition (decision of 03.11.2026): population Нурлан, Айдос, Бауыржан,
// Балжан; business Айгерим, Максат; experts Даниэль Хартманн, Ерлан — 4/2/3
// is 9, over the limit of 8, so one expert (Зауреш) is left out.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const API = process.env.API_BASE_URL || 'http://127.0.0.1:3001/api';
const which = process.argv[2];
const tag = process.argv[3] || 'v3a';
const SOURCE = { test1: '12-accept-test1-g3.json', test2: '12-accept-test2-h1.json', press: '12-accept-press-h1.json' };
if (!SOURCE[which]) { console.log('usage: 20-scores-v3.mjs test1|test2|press <tag>'); process.exit(1); }
const NAMES = ['Нурлан', 'Айдос', 'Бауыржан', 'Балжан', 'Айгерим', 'Максат', 'Даниэль Хартманн', 'Ерлан'];

const registryFile = path.join(OUT, '20-projects.json');
const registry = fs.existsSync(registryFile) ? JSON.parse(fs.readFileSync(registryFile, 'utf8')) : {};

async function api(key, method, url, body) {
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

if (!registry[which]) {
  const key = crypto.randomUUID();
  const documentText = JSON.parse(fs.readFileSync(path.join(OUT, SOURCE[which]), 'utf8')).documentText;
  const library = (await api(key, 'GET', '/personas')).data;
  const ids = NAMES.map((n) => library.find((p) => p.name === n)?.id);
  if (ids.some((x) => !x)) throw new Error('persona missing from the library');
  const created = await api(key, 'POST', '/projects', {
    title: `[этап 1] оценки персон ${which}`,
    subtitle: 'Независимые оценки участников',
    documentText,
    documentFileName: `${which}.pdf`,
    personaIds: ids,
    iterations: 1,
    moderator: false,
    goal: 'risk_search',
    mode: 'Round Table',
  });
  registry[which] = { id: created.data.id, key };
  fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2), 'utf8');
  console.log(`created project ${created.data.id} for ${which}`);
}

const { id, key } = registry[which];
const run = await api(key, 'POST', `/projects/${id}/persona-scores`, {});
const d = run.data;
fs.writeFileSync(path.join(OUT, `16-scores-${which}-${tag}.json`), JSON.stringify({ which, tag, projectId: id, ms: run.ms, result: d }, null, 2), 'utf8');

const adjusted = d.personas.flatMap((p) => p.sections.flatMap((s) => Object.values(s.levels ?? {}).filter((l) => l.adjusted))).length;
const leveled = d.personas.flatMap((p) => p.sections.flatMap((s) => Object.values(s.levels ?? {}))).length;
console.log(`${which} ${tag} (project ${id}): ${run.ms} ms, ${d.personas.length} personas (${d.personas.filter((p) => p.status === 'failed').length} failed), quotes ${d.stats.quotes.verified}/${d.stats.quotes.total}, adjusted ${adjusted}/${leveled}, unanswered ${d.stats.unanswered}`);
for (const p of d.personas) console.log(`  ${p.name} [${p.group}] ${p.status} skipped=${p.sections.filter((s) => s.skipped).length} doc=${JSON.stringify(p.document)}`);
console.log('document:', Object.entries(d.stats.document).map(([k, c]) => `${k} ${c.mean} sd ${c.sd} gap ${c.gap}`).join(' | '));
