// A1 stage 2: every verdict and every missing explanation of the acceptance
// runs, as markdown for the manual check (brief §2.3, §5.2).
//   node scripts/measure/25-acceptance-md.mjs > .ai/STAGE-2-ACCEPTANCE.md

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = (t) => JSON.parse(fs.readFileSync(path.join(HERE, 'out', `22-audience-${t}.json`), 'utf8')).result;
const G = { population: 'Население', business: 'Бизнес', experts: 'Эксперты и посредники' };
const V = { correct: 'верно', partial: 'частично', wrong: 'неверно', not_understood: 'не понял' };
const L = { clear: 'понятно', partial: 'частично', unclear: 'непонятно' };
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const out = [];
const p = (s = '') => out.push(s);

p('# Этап 2 — приёмка: все вердикты и все недостающие объяснения');
p();
p('Сгенерировано `scripts/measure/25-acceptance-md.mjs` из `scripts/measure/out/22-audience-*.json`. Промпты: `decision_reference@2`, `decision_verdict@4` (модель только извлекает поля, вердикт считает код), `missing_explanations@1`, если не сказано иное.');

const DOCS = [['test1-c1', 'test1 (2728), прогон 1'], ['test1-c2', 'test1 (2728), прогон 2'], ['test2-c1', 'test2 (2729)'], ['press-c1', 'Пресс-релиз 04.09.2026 (2787), прогон 1'], ['press-c2', 'Пресс-релиз 04.09.2026 (2787), прогон 2']];
const A = { central_bank: 'Национальный Банк', government: 'Правительство', banks: 'банки', other: 'другой' };
const D = { raise: 'повышение', lower: 'снижение', hold: 'сохранение', other: 'иное' };
const NS = 'не указано';
const exLine = (e) => (!e ? '—' : !e.named ? 'решение не названо' : `${e.actor ? A[e.actor] : NS} · ${e.direction ? D[e.direction] : NS} · ${e.value ?? NS}`);

p();
p('## 1. Вердикты (п. 2.3)');
for (const [t, title] of DOCS) {
  const d = load(t);
  const a = d.analysis;
  p();
  p(`### ${title}`);
  p();
  p(`Эталон (${a.reference.verified ? 'проверен, дословно' : `не проверен: ${a.reference.reason}`}) · ${esc(a.reference.section)}: «${esc(a.reference.quote)}»`);
  p();
  for (const k of ['actor', 'direction', 'value']) {
    const x = a.reference[k];
    p(`- ${k}: **${x.value ?? 'null'}**${x.value === null ? ` (предложено ${x.proposed ?? '—'}; ${x.reason})` : ''} — «${esc(x.quote)}»`);
  }
  p();
  p('| Участник | Группа | Ответ «decision» | Извлечено: кто · направление · величина | Вердикт (код) | Причина |');
  p('|---|---|---|---|---|---|');
  for (const v of a.verdicts) p(`| ${v.name} | ${G[v.group]} | ${esc(v.decision)} | ${exLine(v.extracted)} | ${v.verdict ? V[v.verdict] : 'не проверялось'} | ${esc(v.reason)} |`);
}

p();
p('### Те же ответы на прежних версиях сверки');
for (const [t, title, ver] of [['press-b1', 'Пресс-релиз', 'decision_verdict@3'], ['test1-b1', 'test1, прогон 1', 'decision_verdict@3'], ['test2-b1', 'test2', 'decision_verdict@3'], ['press-a1', 'Пресс-релиз', 'decision_verdict@1'], ['press-a2', 'Пресс-релиз', 'decision_verdict@2'], ['test1-a1', 'test1, прогон 1', 'decision_verdict@2'], ['test1-a2', 'test1, прогон 2', 'decision_verdict@2'], ['test2-a1', 'test2', 'decision_verdict@2']]) {
  const a = load(t).analysis;
  p();
  p(`**${title}, ${ver}:** ` + a.verdicts.filter((v) => v.by === 'model').map((v) => `${v.name} — ${V[v.verdict]}${v.reason ? ` («${esc(v.reason)}»)` : ''}`).join('; '));
}

p();
p('## 2. Уровни по группам');
for (const [t, title] of DOCS) {
  const d = load(t);
  p();
  p(`### ${title}`);
  p();
  p(`${(d.gap?.phrases ?? []).join(' ')} ${d.phrase ?? ''}`);
  p();
  p('| Группа | Участников | Индекс (критериев) | Доля верно понявших | Уровень | Понятность | Что делать мне | Термины | Вопросов без ответа |');
  p('|---|---|---|---|---|---|---|---|---|');
  for (const g of d.groups) p(`| ${G[g.group]}${d.document.intendedAudience.includes(g.group) ? ' (целевая)' : ''} | ${g.personas} | ${g.index ?? '—'} (${g.indexCriteria}) | ${g.share ?? '—'} | ${L[g.level] ?? '—'} | ${g.criteria.clarity ?? '—'} | ${g.criteria.myAction ?? '—'} | ${g.criteria.terms ?? '—'} | ${g.unanswered} |`);
}

p();
p('## 3. Чего не хватает (п. 5.2)');
for (const [t, title] of DOCS) {
  const d = load(t);
  p();
  p(`### ${title}`);
  for (const g of ['population', 'business', 'experts']) {
    const m = d.analysis.missing[g];
    p();
    p(`**${G[g]}** — ${m.status}${m.reason ? ` (${m.reason})` : ''}; модель вернула ${m.returned}, отброшено кодом ${m.dropped} (без опоры ${m.droppedBy?.noSource ?? 0}, без слов участников ${m.droppedBy?.noWords ?? 0}, на одном участнике ${m.droppedBy?.onePersona ?? 0}), ссылок на несуществующие id ${m.unknownIds}.`);
    p();
    m.items.forEach((it, i) => {
      p(`${i + 1}. **${esc(it.missing)}** — участников: ${it.personas}; источники ${it.sourceIds.length}`);
      if (it.question) p(`   - вопрос участника: «${esc(it.question)}»`);
      p(`   - что добавить: ${esc(it.suggestion)}`);
      p(`   - разделы: ${esc(it.sections.join('; ')) || '—'}`);
    });
    const tm = d.terms[g];
    if (tm.terms.length || tm.extra.length) p(`\n   Непонятные термины: ${tm.terms.map((x) => `${x.term} (${x.personas})`).join(', ') || '—'}; вне словаря: ${tm.extra.map((x) => `${x.word} (${x.personas})`).join(', ') || '—'}`);
  }
}
process.stdout.write(out.join('\n') + '\n');
