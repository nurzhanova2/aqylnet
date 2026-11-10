// A1 stage 1, part Б: the acceptance table from saved runs (no model calls).
//
//   node scripts/measure/17-accept-b.mjs
//
// Sections are the product's (approved mapping of 03.11.2026): the brief's
// "раздел 1" is product section 1 (Резюме + 1 + 2), "2.1" is section 2,
// "5.2" is section 5, "8" is section 9 (7.3 + 8). Orders are 0-based here.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = (f) => JSON.parse(fs.readFileSync(path.join(HERE, 'out', f), 'utf8')).result;
const t1a = load('16-scores-test1-s1.json');
const t1b = load('16-scores-test1-s2.json');
const t2 = load('16-scores-test2-s1.json');

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return null;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const values = (r, order, key, group) => r.personas
  .filter((p) => p.status === 'scored' && (!group || p.group === group))
  .map((p) => p.sections.find((s) => s.order === order)?.scores[key])
  .filter((v) => typeof v === 'number');
const groupMean = (r, order, key, group) => r.stats.sections.find((s) => s.order === order).cells[key].byGroup[group];
const fmt = (x) => (x === null || x === undefined ? '—' : Number.isInteger(x) ? String(x) : x.toFixed(1));

const rows = [];
const add = (check, threshold, fact, pass) => rows.push({ check, threshold, fact, pass });

for (const [name, r] of [['test1 s1', t1a], ['test1 s2', t1b], ['test2 s1', t2]]) {
  const q = r.stats.quotes;
  const pct = q.total ? (100 * q.verified) / q.total : 0;
  add(`Дословность цитат, ${name}`, '≥ 95 %', `${q.verified}/${q.total} = ${pct.toFixed(1)} %`, pct >= 95);
  const keys = ['clarity', 'reasons', 'myAction', 'rateSignal', 'trust'];
  const spread = keys.filter((k) => (r.stats.document[k].sd ?? 0) > 0);
  add(`Разброс > 0 по документу, ${name}`, '≥ 4 из 5', `${spread.length} из 5 (${keys.map((k) => `${k} ${fmt(r.stats.document[k].sd)}`).join(', ')})`, spread.length >= 4);
}

for (const [name, r] of [['s1', t1a], ['s2', t1b]]) {
  const pop = groupMean(r, 0, 'terms', 'population');
  const exp = groupMean(r, 0, 'terms', 'experts');
  add(`test1 разд. 1, критерий 6: население < эксперты (${name})`, 'население ниже', `население ${fmt(pop)}, эксперты ${fmt(exp)}`, pop !== null && exp !== null && pop < exp);

  const rs = values(r, 8, 'rateSignal');
  add(`test1 разд. 9 (8.), критерий 4: медиана (${name})`, '≤ 4', `${fmt(median(rs))} (n=${rs.length}: ${rs.join(', ')})`, median(rs) !== null && median(rs) <= 4);

  const my = values(r, 4, 'myAction', 'population');
  add(`test1 разд. 5 (5.2), критерий 3, население: медиана (${name})`, '≤ 4', `${fmt(median(my))} (n=${my.length}: ${my.join(', ')})`, median(my) !== null && median(my) <= 4);

  const c1 = groupMean(r, 0, 'clarity', 'population');
  const c2 = groupMean(r, 1, 'clarity', 'population');
  add(`test1 понятность населения: разд. 2 > разд. 1 (${name})`, 'разд. 2 выше', `разд. 2 ${fmt(c2)}, разд. 1 ${fmt(c1)}`, c1 !== null && c2 !== null && c2 > c1);
}

const repro = ['clarity', 'reasons', 'myAction', 'rateSignal', 'trust', 'terms'].map((k) => {
  const a = t1a.stats.document[k].mean;
  const b = t1b.stats.document[k].mean;
  return { k, a, b, d: a === null || b === null ? null : Math.abs(a - b) };
});
add('Воспроизводимость test1: |Δ среднего| по критерию', '≤ 1', repro.map((x) => `${x.k} ${fmt(x.a)}→${fmt(x.b)} (Δ${fmt(x.d)})`).join('; '), repro.every((x) => x.d !== null && x.d <= 1));

for (const r of rows) console.log(`${r.pass ? '✔' : '✘'} | ${r.check} | ${r.threshold} | ${r.fact}`);
fs.writeFileSync(path.join(HERE, 'out', '17-accept-b.json'), JSON.stringify(rows, null, 2), 'utf8');
