// A1 stage 3 preparation: the full text needs the audit's verified High and
// Critical findings, and the stage 1–2 base projects (2728, 2729, 2787) have
// no discussion, hence no report. The 0a acceptance audited the same document
// texts (md5 equal) in projects since deleted; their audit block is put here
// through PUT /analytics — only the audit (scores, issues, sections), no
// discussion summary. The server recomputes every verdict (quoteVerified,
// overallScore) on the way in.
//
//   node scripts/measure/26-import-audit.mjs

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const API = process.env.API_BASE_URL || 'http://127.0.0.1:3001/api';
const registry = JSON.parse(fs.readFileSync(path.join(OUT, '20-projects.json'), 'utf8'));
const SOURCE = { test1: '12-accept-test1-g3.json', test2: '12-accept-test2-h1.json', press: '12-accept-press-h1.json' };

for (const [which, file] of Object.entries(SOURCE)) {
  const saved = JSON.parse(fs.readFileSync(path.join(OUT, file), 'utf8'));
  const { id, key } = registry[which];
  const headers = { 'X-Session-Key': key, 'Content-Type': 'application/json; charset=utf-8' };
  const project = (await (await fetch(`${API}/projects/${id}`, { headers })).json()).data;
  const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
  if (md5(project.documentText) !== md5(saved.documentText)) throw new Error(`${which}: document text differs, not importing`);
  const a = saved.report.analytics;
  const body = { extras: { scores: a.scores ?? [], issues: a.issues ?? [], sections: a.sections ?? [], alignment: [] } };
  const res = await fetch(`${API}/projects/${id}/analytics`, { method: 'PUT', headers, body: JSON.stringify(body) });
  const json = await res.json();
  const issues = json.data?.issues ?? [];
  const hi = issues.filter((i) => ['High', 'Critical'].includes(i.severity));
  console.log(`${which} (${id}) from project ${saved.projectId}: HTTP ${res.status}; issues ${issues.length}, High/Critical ${hi.length}, of them verified ${hi.filter((i) => i.quoteVerified === true).length}; score ${json.data?.overallScore}`);
}
