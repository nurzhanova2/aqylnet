// A1 stage 2: an analysis built on persona scores that were rerun later is
// marked stale. On a copy of the press release with two personas (cheap),
// deleted at the end.
//
//   node scripts/measure/23-stale.mjs

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API = process.env.API_BASE_URL || 'http://127.0.0.1:3001/api';
const key = crypto.randomUUID();

async function api(method, url, body) {
  const res = await fetch(API + url, {
    method,
    headers: { 'X-Session-Key': key, 'Content-Type': 'application/json; charset=utf-8' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, data: json?.data, message: json?.message };
}

const documentText = JSON.parse(fs.readFileSync(path.join(HERE, 'out', '12-accept-press-h1.json'), 'utf8')).documentText;
const library = (await api('GET', '/personas')).data;
const ids = ['Бауыржан', 'Ерлан'].map((n) => library.find((p) => p.name === n).id);
const created = await api('POST', '/projects', {
  title: '[этап 2] копия для проверки устаревания', documentText, documentFileName: 'press.pdf',
  personaIds: ids, iterations: 1, moderator: false, docType: 'press_release', publishedAt: '2026-09-04', intendedAudience: ['population'],
});
const id = created.data.id;
console.log('copy', id, 'meta', created.data.docType, created.data.publishedAt, created.data.intendedAudience);
try {
  const early = await api('POST', `/projects/${id}/audience-analysis`, {});
  console.log('analysis before scores:', early.status, early.message);
  console.log('scores #1:', (await api('POST', `/projects/${id}/persona-scores`, {})).status);
  const a = await api('POST', `/projects/${id}/audience-analysis`, {});
  console.log('analysis:', a.status, 'stale =', a.data.analysis.stale, 'basedOn', a.data.analysis.basedOn);
  console.log('scores #2:', (await api('POST', `/projects/${id}/persona-scores`, {})).status);
  const g = await api('GET', `/projects/${id}/audience-analysis`);
  console.log('after rerun:', g.status, 'stale =', g.data.analysis.stale, 'basedOn', g.data.analysis.basedOn, 'scoresAt', g.data.scoresAt);
  const again = await api('POST', `/projects/${id}/audience-analysis`, {});
  console.log('analysis rerun:', again.status, 'stale =', again.data.analysis.stale);
} finally {
  console.log('delete copy:', (await api('DELETE', `/projects/${id}`)).status);
}
