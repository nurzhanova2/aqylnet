// Step 5, last view — no model calls: axis scores, severities and the overall
// score the product would compute (computeOverallScore from dist) for every
// audit run. The question is what map-reduce does to the Critical cap: one
// false Critical in any of eight sections caps the whole document at 55.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { OUT, save, main } from './lib.mjs';

const require = createRequire('/app/package.json');
const { parseTruncatedJson, computeOverallScore } = require('/app/dist/services/llm.service.js');

await main(async () => {
  const rows = [];
  for (const v of ['-v1', '']) {
    for (const which of ['test1', 'test2']) {
      for (const mode of ['map', 'reps', 'whole']) {
        const f = path.join(OUT, `05-${mode}-${which}${v}.json`);
        if (!fs.existsSync(f)) continue;
        for (const run of JSON.parse(fs.readFileSync(f, 'utf8'))) {
          const p = parseTruncatedJson(run.content.slice(Math.max(0, run.content.indexOf('{'))));
          const scores = (p?.scores ?? []).map((s) => ({ value: Number(s?.value) || 0 }));
          const issues = (p?.issues ?? []).map((i) => ({ severity: String(i?.severity ?? '') }));
          const sev = { Critical: 0, High: 0, Medium: 0, Low: 0 };
          issues.forEach((i) => { if (i.severity in sev) sev[i.severity] += 1; });
          const mean = scores.length ? Math.round(scores.reduce((s, x) => s + x.value, 0) / scores.length) : null;
          rows.push({ version: v ? 'v1' : 'v2', which, mode, section: run.section, axes: scores.map((s) => s.value), mean, overall: computeOverallScore(scores, issues), ...sev });
        }
      }
    }
  }
  for (const r of rows) console.log(`${r.version} ${r.which} ${r.mode.padEnd(5)} s${String(r.section).padEnd(5)} axes ${JSON.stringify(r.axes).padEnd(16)} mean ${r.mean} overall ${r.overall}  C${r.Critical} H${r.High} M${r.Medium} L${r.Low}`);
  const v2map = rows.filter((r) => r.version === 'v2' && r.mode === 'map');
  console.log(`\nv2 map sections with ≥1 Critical: ${v2map.filter((r) => r.Critical > 0).length}/${v2map.length}`);
  save('05-scores.json', rows);
});
