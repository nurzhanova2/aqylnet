// Stage 0a acceptance: the audit on the same input as stage 0, on the host,
// against the running backend.
//
//   node scripts/measure/12-accept-0a.mjs test1|test2|dkp_feb|dkp_aug
//
// test1/test2: a new project with the same three personas, the transcript of
// stage 0 (projects 2213/2214, saved in out/10-live-*.json) copied in through
// POST /timeline, then the report. Projects 2213/2214 are not touched — they
// stay the baseline. The audit therefore sees the same discussion, and only
// the audit changed.
//
// dkp_*: a real NBK report with a one-message transcript — the point there is
// false Critical and findings on substance, not the discussion.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API = process.env.API_BASE_URL || 'http://127.0.0.1:3001/api';
const which = process.argv[2];
const tag = process.argv[3] || 'v1';
const FILES = {
  test1: 'test1_obzor_dkp.pdf', test2: 'test2_finstabilnost.pdf',
  dkp_feb: 'dkp_feb2026.pdf', dkp_aug: 'dkp_aug2026.pdf', press: 'press_sep2026.pdf',
};
if (!FILES[which]) { console.log('usage: 12-accept-0a.mjs test1|test2|dkp_feb|dkp_aug|press [tag]'); process.exit(1); }

const KEY = crypto.randomUUID();
const headers = { 'X-Session-Key': KEY };

async function api(method, url, body) {
  const t0 = Date.now();
  const res = await fetch(API + url, {
    method,
    headers: body instanceof FormData ? headers : { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${url}: HTTP ${res.status} ${json?.message ?? ''}`);
  return { data: json.data, ms: Date.now() - t0 };
}

const out = { which, tag, startedAt: new Date().toISOString() };

const fd = new FormData();
const bytes = fs.readFileSync(path.join(HERE, 'in', FILES[which]));
fd.append('file', new Blob([bytes], { type: 'application/pdf' }), FILES[which]);
const up = await api('POST', '/documents/upload', fd);
const text = up.data.extractedText;
if (!text || text.includes('�')) throw new Error('extracted text missing or corrupted');
out.upload = { chars: text.length, truncated: up.data.truncated };
console.log(`upload: ${text.length} chars`);

const personas = (await api('GET', '/personas')).data;
const pick = ['Гульнар', 'Данияр', 'Светлана'].map((n) => personas.find((p) => p.name === n)).filter(Boolean);
const created = await api('POST', '/projects', {
  title: `[приёмка 0а ${tag}] ${which}`,
  subtitle: 'Как документ поймут вкладчики, заёмщики и пенсионеры?',
  documentText: text,
  documentFileName: FILES[which],
  personaIds: pick.map((p) => p.id),
  iterations: 2,
  moderator: true,
  goal: 'risk_search',
  mode: 'Round Table',
});
const projectId = created.data.id;
out.projectId = projectId;
out.sessionKey = KEY;
out.documentText = text;
console.log(`project ${projectId}`);

// The transcript: stage 0's for the test documents, one line for the reports.
const byName = new Map(pick.map((p) => [p.name, p.id]));
let messages;
if (which.startsWith('test')) {
  const base = JSON.parse(fs.readFileSync(path.join(HERE, 'out', `10-live-${which}.json`), 'utf8'));
  out.baselineProject = base.projectId;
  messages = base.rounds.flatMap((r) => r.messages.map((m) => ({ ...m, iteration: r.round })));
} else {
  messages = [{ name: 'Гульнар', speakerType: 'persona', iteration: 1,
    text: 'Прочитала документ. Хочу понять, что это решение значит для моих вкладов и для кредита, который мы с мужем планируем брать.' }];
}
for (const m of messages) {
  await api('POST', `/projects/${projectId}/timeline`, {
    speakerType: m.speakerType === 'moderator' ? 'moderator' : 'persona',
    ...(m.speakerType === 'moderator' ? {} : { personaId: byName.get(m.name) }),
    text: m.text.slice(0, 4000),
    iteration: m.iteration,
  });
}
out.transcriptMessages = messages.length;
console.log(`transcript: ${messages.length} messages`);

const rep = await api('POST', `/projects/${projectId}/generate-report`, {});
const a = rep.data;
out.report = { ms: rep.ms, analytics: a };
const issues = a.issues ?? [];
const quoted = issues.filter((i) => i.quote && i.kind !== 'absence');
const q2 = issues.filter((i) => i.quote2);
out.quotes = {
  quoted: quoted.length + q2.length,
  verified: quoted.filter((i) => i.quoteVerified === true).length + q2.filter((i) => i.quote2Verified === true).length,
};
const kinds = issues.reduce((m, i) => ((m[i.kind ?? 'finding'] = (m[i.kind ?? 'finding'] ?? 0) + 1), m), {});
console.log(`report ${rep.ms} ms: ${issues.length} issues ${JSON.stringify(kinds)}, overall ${a.overallScore}`);
console.log(`severity: ${JSON.stringify(issues.reduce((m, i) => ((m[i.severity] = (m[i.severity] ?? 0) + 1), m), {}))}`);
console.log(`quotes verified: ${out.quotes.verified}/${out.quotes.quoted}`);

fs.mkdirSync(path.join(HERE, 'out'), { recursive: true });
const file = `12-accept-${which}-${tag}.json`;
fs.writeFileSync(path.join(HERE, 'out', file), JSON.stringify(out, null, 2), 'utf8');
console.log(`→ scripts/measure/out/${file}`);
