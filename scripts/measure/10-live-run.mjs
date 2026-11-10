// Stage 0 acceptance: the product path end to end, on the host, against the
// running backend (http://127.0.0.1:3001 — no proxy TLS involved here; the
// backend talks to the model).
//
//   node scripts/measure/10-live-run.mjs test1|test2
//
// Upload the PDF through /documents/upload (the real parser), create a project
// with 3 personas and 2 rounds, run both rounds, generate the report, and save
// everything the acceptance table needs. Cyrillic only ever travels inside
// files and JSON bodies built here, never as a shell argument.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API = process.env.API_BASE_URL || 'http://127.0.0.1:3001/api';
const which = process.argv[2];
const FILES = { test1: 'test1_obzor_dkp.pdf', test2: 'test2_finstabilnost.pdf' };
if (!FILES[which]) { console.log('usage: 10-live-run.mjs test1|test2'); process.exit(1); }

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

const out = { which, startedAt: new Date().toISOString() };

// 1. Upload through the real parser.
const fd = new FormData();
const bytes = fs.readFileSync(path.join(HERE, 'in', FILES[which]));
fd.append('file', new Blob([bytes], { type: 'application/pdf' }), FILES[which]);
const up = await api('POST', '/documents/upload', fd);
const text = up.data.extractedText;
if (!text || text.includes('�')) throw new Error('extracted text missing or corrupted');
out.upload = { chars: text.length, truncated: up.data.truncated, ms: up.ms };
console.log(`upload: ${text.length} chars, ${up.ms} ms`);

// 2. Project: 3 personas, 2 rounds.
const personas = (await api('GET', '/personas')).data;
const pick = ['Гульнар', 'Данияр', 'Светлана'].map((n) => personas.find((p) => p.name === n)).filter(Boolean);
const created = await api('POST', '/projects', {
  title: `[замер этапа 0] ${which}`,
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
out.personas = pick.map((p) => p.name);
console.log(`project ${projectId} created in ${created.ms} ms with ${out.personas.join(', ')}`);

// 3. Two rounds.
out.rounds = [];
for (let r = 1; r <= 2; r++) {
  const it = await api('POST', `/projects/${projectId}/run-iteration`, {});
  out.rounds.push({ round: r, ms: it.ms, messages: it.data.messages.map((m) => ({ name: m.name, speakerType: m.speakerType, text: m.text })) });
  console.log(`round ${r}: ${it.data.messages.length} messages in ${it.ms} ms`);
}

// 4. Report.
const rep = await api('POST', `/projects/${projectId}/generate-report`, {});
out.report = { ms: rep.ms, analytics: rep.data };
console.log(`report in ${rep.ms} ms: ${rep.data.issues?.length ?? 0} issues, ${rep.data.sections?.length ?? 0} sections, overall ${rep.data.overallScore}`);

const issues = rep.data.issues ?? [];
const quoted = issues.filter((i) => i.quote);
out.quotes = { quoted: quoted.length, verified: quoted.filter((i) => i.quoteVerified === true).length };
console.log(`quotes verified: ${out.quotes.verified}/${out.quotes.quoted}`);
console.log(`sections: ${(rep.data.sections ?? []).map((s) => `${s.title} [${s.analyzed === false ? 'не проанализирован' : s.clarity}]`).join(' | ')}`);

fs.mkdirSync(path.join(HERE, 'out'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'out', `10-live-${which}.json`), JSON.stringify(out, null, 2), 'utf8');
console.log(`→ scripts/measure/out/10-live-${which}.json  (session key ${KEY})`);
