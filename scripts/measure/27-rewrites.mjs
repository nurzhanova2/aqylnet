// A1 stage 3 acceptance: three versions of the text through the product path.
//
//   node scripts/measure/27-rewrites.mjs test1|test2|press <tag>
//
// Saves out/27-rewrites-<which>-<tag>.json and prints the checks; the cost by
// call is read from LlmUsage separately (the run's start is saved).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const API = process.env.API_BASE_URL || 'http://127.0.0.1:3001/api';
const [which, tag = 'r1'] = process.argv.slice(2);
const { id, key } = JSON.parse(fs.readFileSync(path.join(OUT, '20-projects.json'), 'utf8'))[which];

const started = new Date().toISOString();
const t0 = Date.now();
const res = await fetch(`${API}/projects/${id}/rewrites`, { method: 'POST', headers: { 'X-Session-Key': key, 'Content-Type': 'application/json' }, body: '{}' });
const json = await res.json();
if (!res.ok) { console.log(`HTTP ${res.status} ${json.message}`); process.exit(1); }
const d = json.data;
fs.writeFileSync(path.join(OUT, `27-rewrites-${which}-${tag}.json`), JSON.stringify({ which, tag, projectId: id, started, ms: Date.now() - t0, result: d }, null, 2), 'utf8');

const line = (items) => items.map((i) => `    ${i.placeholder ? '[З] ' : ''}${i.text}${i.checks.numbers.length ? `  ⚠ числа: ${i.checks.numbers.join(', ')}` : ''}${i.checks.terms?.length ? `  ⚠ термины: ${i.checks.terms.join(', ')}` : ''}${i.checks.unsourced ? '  ⚠ без раздела' : ''}${i.checks.support?.ok === false ? `  ⛔ не подтверждено (${i.checks.support.reason}; покрытие ${i.checks.support.coverage})` : i.checks.support ? `  ✓${i.checks.support.coverage}/${i.checks.support.basisCoverage}${i.checks.support.authorCheck ? '  ✋ проверить автору' : ''}` : ''}${i.checks.mustBePlaceholder ? '  ⛔ должно быть заглушкой' : ''}
      опора: ${i.basis || '—'}${i.checks.long ? `  (${i.checks.longest} слов)` : ''}  {${i.sourceSections.join(',')}}`).join('\n');
console.log(`${which} ${tag} (project ${id}): ${Date.now() - t0} ms, started ${started}`);
for (const [layer, parts] of [['card', ['decision', 'why', 'forYou', 'next']], ['brief', ['main', 'why', 'forBusiness', 'next']]]) {
  const l = d[layer];
  console.log(`\n== ${layer}: ${l.status} ${l.failReason} · решение ${JSON.stringify(l.decisionCheck)} · ${JSON.stringify(l.summary)}`);
  for (const p of parts) console.log(`  ${p}:\n${line(l[p])}`);
  if (layer === 'brief') for (const f of l.figures) console.log(`  цифра: ${f.indicator} — ${f.value} (разд. ${f.section})${f.numbers.length ? `  ⚠ ${f.numbers.join(', ')}` : ''}`);
}
const f = d.full;
console.log(`\n== full: ${f.status} ${f.failReason} · главное ${JSON.stringify(f.blufDecision)} · ${JSON.stringify(f.summary)} · правки ${JSON.stringify(f.edits)} · целостность ${JSON.stringify(f.integrity)} · сбои ${JSON.stringify(f.sectionsFailed)}`);
console.log(`  главное:\n${line(f.bluf)}`);
for (const p of f.paragraphs.filter((x) => x.status !== 'same')) {
  console.log(`  ${p.id} ${p.status}${p.kind ? ` ${p.kind}` : ''}${p.checks?.authorCheck ? ' (проверить автору)' : ''}${p.checks?.mustBePlaceholder ? ' ⛔ должно быть заглушкой' : ''} покрытие ${p.checks?.coverage ?? '—'} [${p.issueId ?? p.missingId}] ${p.reason}${p.checks?.numbers.length ? `  ⚠ числа: ${p.checks.numbers.join(', ')}` : ''}\n    было: ${(p.before ?? '').trim()}\n    стало: ${p.text.trim()}${p.checks?.bases?.length ? `
    опоры: ${p.checks.bases.join(' | ')}` : ''}`);
}
console.log('  замечания:', f.issues.map((i) => `${i.id} ${i.status}`).join('; '));
