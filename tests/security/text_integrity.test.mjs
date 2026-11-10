// Guards the delivery of Russian text through the API end to end.
//
// This exists because of a real failure that went unnoticed through five
// stages of work. Live verification runs passed Cyrillic document text as a
// shell argument (`curl -d '{"documentText":"Проект..."}'`), Git Bash on
// Windows re-encoded the argument through the ANSI codepage, and the body
// arrived as invalid UTF-8. Express replaced every Cyrillic character with
// U+FFFD, so the database held runs of `ef bf bd` and the model answered,
// correctly, that the document was an unreadable jumble of symbols. That was
// read twice as a quirk of the model and waved through.
//
// The product was never broken — text typed in the browser arrives clean — but
// nothing in the suite would have caught it, and "a live round passes" was
// claimed on the strength of those runs. These tests close that gap: they send
// bytes, not shell arguments, and assert the text comes back unchanged.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_URL, api, personaPayload, deleteProjectSafe, deletePersonaSafe } from '../api/helpers.mjs';
import { query } from '../api/db.mjs';

const REPLACEMENT = '�';

// Deliberately exercises more than plain Cyrillic: Kazakh-specific letters, the
// characters JSON has to escape, and a 4-byte emoji — a cap or a slice applied
// at the wrong boundary would corrupt the last of these first.
const SAMPLE = [
  'Проект изменений в Правила предоставления потребительских кредитов.',
  'Годовая эффективная ставка не может превышать 46 процентов годовых.',
  'Қазақстан Республикасының Ұлттық Банкі — казахские буквы: ә, ғ, қ, ң, ө, ұ, ү, h, і.',
  'Кавычки «ёлочки», тире — и дефис-, апостроф ’, символ № и 50 %.',
  'Эмодзи как 4-байтовый символ: 📊 конец.',
].join('\n');

const personas = [];
const projects = [];

after(async () => {
  for (const id of projects) await deleteProjectSafe(id);
  for (const id of personas) await deletePersonaSafe(id);
});

async function makePersona() {
  const r = await api('POST', '/personas', personaPayload());
  assert.equal(r.status, 201, `persona setup failed: ${JSON.stringify(r.json)}`);
  personas.push(r.json.data.id);
  return r.json.data.id;
}

describe('Целостность текста: кириллица проходит через API без потерь', () => {
  test('POST /projects сохраняет documentText символ в символ', async () => {
    const pid = await makePersona();
    // JSON.stringify + fetch send UTF-8 bytes directly. The bug being guarded
    // against only happens when the body travels as a process argument.
    const r = await api('POST', '/projects', {
      title: 'Проверка целостности текста',
      personaIds: [pid],
      documentText: SAMPLE,
      iterations: 1,
    });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    projects.push(r.json.data.id);

    assert.ok(!r.json.data.documentText.includes(REPLACEMENT), 'в ответе API есть U+FFFD');
    assert.equal(r.json.data.documentText, SAMPLE, 'documentText в ответе не совпадает с отправленным');

    // The response could in principle echo the request while the database held
    // something else, so check the stored value too.
    const rows = await query('SELECT "documentText" FROM "Project" WHERE id = $1', [r.json.data.id]);
    assert.equal(rows[0].documentText, SAMPLE, 'в базе лежит не то, что отправили');
  });

  test('POST /documents/text сохраняет текст символ в символ', async () => {
    const pid = await makePersona();
    const created = await api('POST', '/projects', {
      title: 'Проверка целостности через /documents/text',
      personaIds: [pid],
      iterations: 1,
    });
    assert.equal(created.status, 201);
    const projectId = created.json.data.id;
    projects.push(projectId);

    const saved = await api('POST', '/documents/text', { text: SAMPLE, projectId });
    assert.equal(saved.status, 201, JSON.stringify(saved.json));

    const rows = await query('SELECT "documentText" FROM "Project" WHERE id = $1', [projectId]);
    assert.ok(!rows[0].documentText.includes(REPLACEMENT), 'в базе есть U+FFFD');
    assert.equal(rows[0].documentText, SAMPLE, 'в базе лежит не то, что отправили');
  });

  test('загрузка .txt извлекает текст символ в символ', async () => {
    // The upload path was never affected by the shell bug — files written by
    // redirection keep their bytes — but it is the other way text enters the
    // product, and the signature check in stage E3 now rejects invalid UTF-8,
    // so a regression here would look like a rejected upload rather than
    // corrupted text.
    const form = new FormData();
    form.append('file', new File([SAMPLE], 'целостность.txt', { type: 'text/plain' }));
    const res = await fetch(`${BASE_URL}/documents/upload`, { method: 'POST', body: form });
    const json = await res.json();

    assert.equal(res.status, 201, JSON.stringify(json));
    assert.equal(json.data.extractedText, SAMPLE, 'извлечённый текст не совпадает с содержимым файла');
    assert.equal(json.data.truncated, false);
  });

  test('невалидный UTF-8 в .txt отклоняется, а не записывается как U+FFFD', async () => {
    // The same bytes the broken verification runs produced: Cyrillic encoded in
    // CP1251. Silently storing these as replacement characters is exactly how
    // the original failure stayed invisible — a 400 is the honest answer.
    const cp1251 = new Uint8Array([0xcf, 0xf0, 0xee, 0xe5, 0xea, 0xf2, 0x20, 0xe8, 0xe7, 0xec]);
    const form = new FormData();
    form.append('file', new File([cp1251], 'cp1251.txt', { type: 'text/plain' }));
    const res = await fetch(`${BASE_URL}/documents/upload`, { method: 'POST', body: form });
    const json = await res.json();

    assert.equal(res.status, 400, `ожидался отказ, получено ${res.status}: ${JSON.stringify(json)}`);
    assert.match(json.message, /UTF-8/i);
  });

  test('реплики раунда не содержат U+FFFD', async () => {
    // The end of the chain: whatever the model returns is stored and replayed
    // into later prompts, so a corrupted reply would propagate.
    const pid = await makePersona();
    const created = await api('POST', '/projects', {
      title: 'Проверка целостности реплик',
      personaIds: [pid],
      documentText: SAMPLE,
      iterations: 1,
      moderator: true,
    });
    assert.equal(created.status, 201);
    const projectId = created.json.data.id;
    projects.push(projectId);

    const round = await api('POST', `/projects/${projectId}/run-iteration`);
    assert.equal(round.status, 200, JSON.stringify(round.json));

    for (const m of round.json.data.messages) {
      assert.ok(!m.text.includes(REPLACEMENT), `U+FFFD в реплике n=${m.n}`);
      assert.ok(m.text.length > 0, `пустая реплика n=${m.n}`);
    }
  });
});
