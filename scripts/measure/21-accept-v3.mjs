// A1 stage 1, persona_score@3: the acceptance table (no model calls).
//
//   node scripts/measure/21-accept-v3.mjs [new=v3] [old=v2]
//
// Runs: test1 <new>a, <new>b; test2 <new>a (projects 2728/2729, composition
// 4/2/2). "Before" for the spread: the same tags with <old>. Product
// sections, 0-based orders: section 1 = 0, 2 = 1, 5 = 4.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = (f) => JSON.parse(fs.readFileSync(path.join(HERE, 'out', `16-scores-${f}.json`), 'utf8')).result;
const NEW = process.argv[2] || 'v3';
const OLD = process.argv[3] || 'v2';
const a = load(`test1-${NEW}a`);
const b = load(`test1-${NEW}b`);
const t2 = load(`test2-${NEW}a`);
const before = { 'test1 a': load(`test1-${OLD}a`), 'test1 b': load(`test1-${OLD}b`), test2: load(`test2-${OLD}a`) };
const after = { 'test1 a': a, 'test1 b': b, test2: t2 };

const median = (xs) => {
  const s = [...xs].sort((x, y) => x - y);
  if (!s.length) return null;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const fmt = (x) => (x === null || x === undefined ? '—' : Number.isInteger(x) ? String(x) : x.toFixed(1));
const scored = (r, group) => r.personas.filter((p) => p.status === 'scored' && (!group || p.group === group));
const sectionValues = (r, order, key, group) => scored(r, group).map((p) => p.sections.find((s) => s.order === order)?.scores[key]).filter((v) => typeof v === 'number');
const groupMean = (r, order, key, group) => r.stats.sections.find((s) => s.order === order).cells[key].byGroup[group];

const rows = [];
const add = (check, threshold, fact, pass) => rows.push({ check, threshold, fact, pass });

for (const [name, r] of [['прогон 1', a], ['прогон 2', b]]) {
  const pop = groupMean(r, 0, 'terms', 'population');
  const exp = groupMean(r, 0, 'terms', 'experts');
  add(`test1 разд. 1, термины: население < эксперты (${name})`, 'ниже', `население ${fmt(pop)}, эксперты ${fmt(exp)}`, pop !== null && exp !== null && pop < exp);
}
for (const [name, r] of [['прогон 1', a], ['прогон 2', b]]) {
  const rs = scored(r).map((p) => p.rateSignal).filter((v) => typeof v === 'number');
  add(`test1 сигнал о ставке по документу, медиана (${name})`, '≤ 5', `${fmt(median(rs))} (${rs.join(', ')})`, median(rs) !== null && median(rs) <= 5);
}
for (const [name, r] of [['прогон 1', a], ['прогон 2', b]]) {
  const my = sectionValues(r, 4, 'myAction', 'population');
  add(`test1 разд. 5, «что делать мне», население, медиана (${name})`, '≤ 5', `${fmt(median(my))} (${my.join(', ')})`, median(my) !== null && median(my) <= 5);
}
for (const [name, r] of [['прогон 1', a], ['прогон 2', b]]) {
  const c1 = groupMean(r, 0, 'clarity', 'population');
  const c2 = groupMean(r, 1, 'clarity', 'population');
  add(`test1 понятность населения: разд. 2 > разд. 1 (${name})`, 'выше', `разд. 2 ${fmt(c2)}, разд. 1 ${fmt(c1)}`, c1 !== null && c2 !== null && c2 > c1);
}
const q = [a, b, t2].reduce((acc, r) => ({ v: acc.v + r.stats.quotes.verified, t: acc.t + r.stats.quotes.total }), { v: 0, t: 0 });
add('Дословность цитат, все прогоны вместе', '≥ 95 %', `${q.v}/${q.t} = ${(100 * q.v / q.t).toFixed(1)} %`, q.v / q.t >= 0.95);

const KEYS = ['clarity', 'reasons', 'myAction', 'rateSignal', 'trust', 'terms'];
const repro = KEYS.map((k) => ({ k, x: a.stats.document[k].mean, y: b.stats.document[k].mean }))
  .map((o) => ({ ...o, d: o.x === null || o.y === null ? null : Math.abs(o.x - o.y) }));
add('Воспроизводимость test1, |Δ среднего|', '≤ 1', repro.map((o) => `${o.k} ${fmt(o.x)}→${fmt(o.y)} (Δ${fmt(o.d)})`).join('; '), repro.every((o) => o.d !== null && o.d <= 1));

for (const r of rows) console.log(`${r.pass ? '✔' : '✘'} | ${r.check} | ${r.threshold} | ${r.fact}`);

console.log(`\nРазброс между персонами по документу (SD), до (${OLD}) → после (${NEW}):`);
console.log(`прогон | ${KEYS.join(' | ')}`);
for (const name of Object.keys(after)) {
  console.log(`${name} | ${KEYS.map((k) => `${fmt(before[name].stats.document[k].sd)} → ${fmt(after[name].stats.document[k].sd)}`).join(' | ')}`);
}

console.log('\nСигнал о ставке по персонам (уровень · фраза):');
for (const [name, r] of [['прогон 1', a], ['прогон 2', b]]) {
  for (const p of scored(r)) {
    const l = p.documentLevels?.rateSignal;
    console.log(`  ${name} ${p.name} [${p.group}]: ${fmt(p.rateSignal)} · ур. ${l?.level ?? '—'} · ${l?.why || l?.reason || ''}`);
  }
}
// A cut answer shows as skipped sections or an empty document block.
console.log('\nПолнота ответов:');
for (const [name, r] of Object.entries(after)) {
  const cut = scored(r).filter((p) => p.sections.some((s) => s.skipped) || !p.mainTakeaway || p.rateSignal === null);
  console.log(`  ${name}: ${cut.length ? cut.map((p) => p.name).join(', ') : 'обрывов нет'}`);
}
fs.writeFileSync(path.join(HERE, 'out', `21-accept-${NEW}.json`), JSON.stringify(rows, null, 2), 'utf8');
