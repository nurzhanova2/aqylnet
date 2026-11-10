// A1 stage 1: persona answers for the sections whose expected direction did
// not hold (brief: bring the answers, do not tune the prompt to the test).
//
//   node scripts/measure/18-direction-answers.mjs
//
// test1 s1 and s2: section 9 (7.3 + 8, criterion 4), section 5 (5.1 + 5.2,
// criterion 3), section 1 (criterion 6 — which terms each persona marked).
// Writes out/18-direction-answers.md.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const lines = ['# Ответы персон по разделам, где направление не выполнилось', ''];
for (const tag of ['s1', 's2']) {
  const r = JSON.parse(fs.readFileSync(path.join(HERE, 'out', `16-scores-test1-${tag}.json`), 'utf8')).result;
  const block = (order, title, show) => {
    lines.push(`## test1 ${tag} — ${title}`, '', `Раздел продукта ${order + 1}: «${r.sections.find((s) => s.order === order).title}»`, '');
    for (const p of r.personas) {
      const s = p.sections.find((x) => x.order === order);
      lines.push(`- **${p.name}** (${p.group}) — ${show(s)}`);
      lines.push(`  - прочитал: ${s.read}`);
      if (s.unclear.length) lines.push(`  - непонятно: ${s.unclear.join('; ')}`);
      lines.push(`  - цитата (${s.quoteHelped === true ? 'помогло' : s.quoteHelped === false ? 'помешало' : '—'}${s.quoteVerified === false ? ', не найдена дословно' : ''}): «${s.quote}»`);
    }
    lines.push('');
  };
  block(8, 'критерий 4 «Сигнал о будущей ставке»', (s) => `балл ${s.scores.rateSignal ?? `null (${s.nullReasons.rateSignal})`}`);
  block(4, 'критерий 3 «Понятно, что делать мне»', (s) => `балл ${s.scores.myAction ?? `null (${s.nullReasons.myAction})`}`);
  block(0, 'критерий 6 «Термины»', (s) => `балл ${s.scores.terms}; найдено ${s.termsFound.length}: ${s.termsFound.join(', ')}; непонятны: ${s.termsUnclear.join(', ') || 'ничего'}`);
  lines.push(`### test1 ${tag} — что персоны поняли о решении`, '');
  for (const p of r.personas) lines.push(`- **${p.name}** (${p.group}): решение — «${p.decision}»; что делать — «${p.myAction}»`);
  lines.push('');
}
fs.writeFileSync(path.join(HERE, 'out', '18-direction-answers.md'), lines.join('\n'), 'utf8');
console.log(lines.join('\n'));
