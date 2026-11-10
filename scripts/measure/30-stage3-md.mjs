// A1 stage 3: the texts of the three versions for test1 and the press release,
// with every mark and basis, as markdown for the manual check.
//   node scripts/measure/30-stage3-md.mjs > .ai/STAGE-3-ACCEPTANCE.md

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = (t) => JSON.parse(fs.readFileSync(path.join(HERE, 'out', `27-rewrites-${t}.json`), 'utf8')).result;
const out = [];
const p = (s = '') => out.push(s);
const mark = (i) => {
  const s = i.checks.support;
  const m = [];
  if (s?.ok === false) m.push(`⛔ не подтверждено документом (${s.reason})`);
  else if (s?.authorCheck) m.push('✋ проверить автору');
  if (i.checks.numbers.length) m.push(`⛔ число не найдено: ${i.checks.numbers.join(', ')}`);
  if (i.checks.mustBePlaceholder) m.push('⚠ должно быть заглушкой');
  if (i.checks.terms?.length) m.push(`⚠ термин без пояснения: ${i.checks.terms.join(', ')}`);
  return m.length ? ` — **${m.join('; ')}**` : '';
};
const item = (i) => `- ${i.text}${mark(i)}${i.basis && !i.placeholder ? `\n  - опора: «${i.basis}»` : ''}`;

p('# Этап 3 — тексты трёх версий (приёмка 04.11.2026)');
p();
p('Сгенерировано `scripts/measure/30-stage3-md.mjs` из `scripts/measure/out/27-rewrites-*.json`. Промпты `rewrite_*@2`. Полный текст — «Главное» и все правки; неизменные абзацы совпадают с документом байт в байт и не выписаны.');
for (const [t, title] of [['test1-f1', 'test1 (2728), прогон 1'], ['test1-f2', 'test1 (2728), прогон 2'], ['press-f1', 'Пресс-релиз (2787), прогон 1'], ['press-f2', 'Пресс-релиз (2787), прогон 2'], ['test2-f1', 'test2 (2729)']]) {
  const d = load(t);
  p();
  p(`## ${title}`);
  for (const [layer, parts, name] of [['card', [['decision', 'Что решили'], ['why', 'Почему'], ['forYou', 'Что это значит для вас'], ['next', 'Что дальше']], 'Карточка'], ['brief', [['main', 'Главное'], ['why', 'Почему так решили'], ['forBusiness', 'Что изменится для бизнеса'], ['next', 'Что дальше']], 'Справка']]) {
    const l = d[layer];
    p();
    p(`### ${name} — ${l.summary.chars} символов, заглушек ${l.summary.placeholders.length}, «проверить автору» ${l.summary.authorChecks}, не подтверждено ${l.summary.unsupported}; решение: ${l.decisionCheck ? (l.decisionCheck.ok ? 'совпадает' : l.decisionCheck.reason) : 'не проверялось'}`);
    for (const [k, h] of parts) { p(); p(`**${h}**`); p(); for (const i of l[k]) p(item(i)); }
    if (l.figures?.length) { p(); p('**Ключевые цифры**'); p(); for (const f of l.figures) p(`- ${f.indicator} — ${f.value}${f.section ? ` (разд. ${f.section})` : ''}${f.numbers.length ? ` — **⛔ ${f.numbers.join(', ')}**` : ''}`); }
  }
  const f = d.full;
  p();
  p(`### Полный текст — правок ${f.edits.applied}, отброшено ${JSON.stringify(f.edits.dropped)}, неизменных абзацев байт в байт ${f.integrity.matching}/${f.integrity.same}; «Главное»: ${f.blufDecision ? (f.blufDecision.ok ? 'решение совпадает' : f.blufDecision.reason) : '—'}`);
  p();
  p('**Главное (добавлено)**');
  p();
  for (const i of f.bluf) p(item(i));
  p();
  p('**Правки**');
  p();
  for (const x of f.paragraphs.filter((y) => y.status !== 'same')) {
    p(`- \`${x.id}\` ${x.status}${x.kind ? ` · ${x.kind}` : ''} · ${x.issueId ?? x.missingId}${x.checks?.authorCheck ? ' — **✋ проверить автору**' : ''}: ${x.text.trim().replace(/\s+/g, ' ')}`);
    if (x.before) p(`  - было: ${x.before.trim().replace(/\s+/g, ' ')}`);
    if (x.checks?.bases?.length) p(`  - опоры: ${x.checks.bases.map((b) => `«${b}»`).join(' ')}`);
  }
  p();
  p(`**Замечания:** ${f.issues.map((i) => `${i.id} — ${{ in_quote_paragraph: 'правка в абзаце с цитатой', wrong_paragraph: 'правка не в том абзаце', no_edit: 'нет правки' }[i.status]}`).join('; ')}`);
}
process.stdout.write(out.join('\n') + '\n');
