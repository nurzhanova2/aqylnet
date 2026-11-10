// A1 stage 1, part Б acceptance: run persona scores on a base project.
//
//   node scripts/measure/16-persona-scores.mjs test1|test2 <tag>
//
// The base projects of stage 0a (2554 test1, 2558 test2) are opened with the
// session key saved by 12-accept-0a.mjs. Up to 8 personas: the 3 already there
// (population) plus 2 business and 3 experts, both new personas included. Then
// POST /persona-scores through the product path, and the whole result is saved.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API = process.env.API_BASE_URL || 'http://127.0.0.1:3001/api';
const which = process.argv[2];
const tag = process.argv[3] || 's1';
const BASE = { test1: { id: 2554, run: '12-accept-test1-g3.json' }, test2: { id: 2558, run: '12-accept-test2-h1.json' } };
if (!BASE[which]) { console.log('usage: 16-persona-scores.mjs test1|test2 <tag>'); process.exit(1); }

const key = JSON.parse(fs.readFileSync(path.join(HERE, 'out', BASE[which].run), 'utf8')).sessionKey;
const projectId = BASE[which].id;
const ADD = ['Айгерим', 'Максат', 'Даниэль Хартманн', 'Ерлан', 'Зауреш'];

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

const library = (await api('GET', '/personas')).data;
const current = (await api('GET', `/projects/${projectId}/personas`)).data;
for (const name of ADD) {
  if (current.some((p) => p.name === name)) continue;
  const p = library.find((x) => x.name === name);
  await api('POST', `/projects/${projectId}/personas`, { personaId: p.id });
  console.log(`added ${name}`);
}

const run = await api('POST', `/projects/${projectId}/persona-scores`, {});
const d = run.data;
fs.writeFileSync(path.join(HERE, 'out', `16-scores-${which}-${tag}.json`), JSON.stringify({ which, tag, projectId, ms: run.ms, result: d }, null, 2), 'utf8');

console.log(`${which} ${tag}: ${run.ms} ms, ${d.personas.length} personas (${d.personas.filter((p) => p.status === 'failed').length} failed), quotes ${d.stats.quotes.verified}/${d.stats.quotes.total}`);
for (const p of d.personas) console.log(`  ${p.name} [${p.group}] ${p.status} doc=${JSON.stringify(p.document)}`);
console.log('document:', Object.entries(d.stats.document).map(([k, c]) => `${k} ${c.mean} sd ${c.sd} gap ${c.gap}`).join(' | '));
console.log(`→ scripts/measure/out/16-scores-${which}-${tag}.json`);
