import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, BASE_URL, personaPayload, projectPayload, deletePersonaSafe, deleteProjectSafe } from './helpers.mjs';

const createdPersonaIds = [];
const createdProjectIds = [];
after(async () => {
  for (const id of createdProjectIds) await deleteProjectSafe(id);
  for (const id of createdPersonaIds) await deletePersonaSafe(id);
});

function txtFile(content, name = 'doc.txt') {
  return new File([content], name, { type: 'text/plain' });
}

describe('Documents API', () => {
  test('POST /documents/upload with a .txt file extracts text verbatim', async () => {
    const content = 'Текст тестового документа для проверки извлечения.';
    const form = new FormData();
    form.append('file', txtFile(content));
    const res = await fetch(`${BASE_URL}/documents/upload`, { method: 'POST', body: form });
    const json = await res.json();
    assert.equal(res.status, 201);
    assert.equal(json.data.extractedText, content);
    assert.equal(json.data.mimeType, 'text/plain');
  });

  test('POST /documents/upload with no file field returns 400', async () => {
    const form = new FormData();
    const res = await fetch(`${BASE_URL}/documents/upload`, { method: 'POST', body: form });
    const json = await res.json();
    assert.equal(res.status, 400);
    assert.equal(json.success, false);
  });

  test('BUG-6 (fixed): POST /documents/upload with a disallowed extension (.exe) returns a clean 400, not 500', async () => {
    const form = new FormData();
    form.append('file', new File(['MZ...'], 'payload.exe', { type: 'application/octet-stream' }));
    const res = await fetch(`${BASE_URL}/documents/upload`, { method: 'POST', body: form });
    const json = await res.json();
    // multer's fileFilter now rejects via BadRequestError (an AppError), which
    // errorHandler's `instanceof AppError` branch maps to 400, instead of a
    // plain Error falling through to the generic 500 branch.
    assert.equal(res.status, 400, 'FIXED: disallowed file type must be a clean 400 Bad Request');
    assert.equal(json.success, false);
    assert.match(json.message, /file type not allowed/i);
  });

  test('the declared MIME type is not a boundary: a .txt sent as image/png is accepted when its bytes really are text', async () => {
    // This test asserted the opposite until stage E3, when requiring the mime
    // to match was deliberately dropped: Content-Type in a multipart body is
    // chosen by the client and on Windows comes from the OS registry, where
    // .txt and .md routinely arrive as application/octet-stream. Requiring an
    // exact match rejected valid documents — in practice only PDFs got through.
    //
    // What replaced it is a check the client cannot forge: the bytes actually
    // written to disk are matched against the extension
    // (utils/documentSignature.ts), and those cases live in
    // tests/security/upload_hardening.test.mjs. So a lying mime over honest
    // content must be accepted, and honest mime over lying content rejected —
    // this is the first half.
    const form = new FormData();
    form.append('file', new File(['Текст документа для проверки.'], 'doc.txt', { type: 'image/png' }));
    const res = await fetch(`${BASE_URL}/documents/upload`, { method: 'POST', body: form });
    const json = await res.json();
    assert.equal(res.status, 201, `a forged mime must not reject a real text file: ${JSON.stringify(json)}`);
    assert.equal(json.success, true);
    assert.match(json.data.extractedText, /Текст документа/, 'the text must be extracted, not just accepted');
    assert.equal(json.data.mimeType, 'image/png', 'the claim is recorded as given and simply not acted on');
  });

  test('regression guard: an oversized file still returns 413 via the untouched multer.MulterError branch', async () => {
    const oversized = new Uint8Array(21 * 1024 * 1024); // > MAX_FILE_SIZE_MB (20)
    const form = new FormData();
    form.append('file', new File([oversized], 'big.txt', { type: 'text/plain' }));
    const res = await fetch(`${BASE_URL}/documents/upload`, { method: 'POST', body: form });
    const json = await res.json();
    assert.equal(res.status, 413);
    assert.equal(json.success, false);
  });

  test('POST /documents/upload with projectId links the document and updates project.documentText', async () => {
    const persona = await api('POST', '/personas', personaPayload());
    createdPersonaIds.push(persona.json.data.id);
    const proj = await api('POST', '/projects', projectPayload([persona.json.data.id], { documentText: undefined }));
    createdProjectIds.push(proj.json.data.id);

    const content = 'Новый документ после привязки к проекту.';
    const form = new FormData();
    form.append('file', txtFile(content));
    form.append('projectId', String(proj.json.data.id));
    const res = await fetch(`${BASE_URL}/documents/upload`, { method: 'POST', body: form });
    const json = await res.json();
    assert.equal(res.status, 201);
    assert.equal(json.data.projectId, proj.json.data.id);

    const updated = await api('GET', `/projects/${proj.json.data.id}`);
    assert.equal(updated.json.data.documentText, content);
  });

  test('POST /documents/upload with an unknown projectId returns 404 (file is still validated before the DB check)', async () => {
    const form = new FormData();
    form.append('file', txtFile('x'));
    form.append('projectId', '999999999');
    const res = await fetch(`${BASE_URL}/documents/upload`, { method: 'POST', body: form });
    const json = await res.json();
    assert.equal(res.status, 404);
  });

  test('POST /documents/text happy path returns length + preview, does not echo full text back', async () => {
    const longText = 'A'.repeat(500);
    const { status, json } = await api('POST', '/documents/text', { text: longText });
    assert.equal(status, 201);
    assert.equal(json.data.textLength, 500);
    assert.equal(json.data.preview.length, 200);
  });

  test('POST /documents/text rejects empty text', async () => {
    const { status } = await api('POST', '/documents/text', { text: '' });
    assert.equal(status, 400);
  });

  test('POST /documents/text with unknown projectId returns 404', async () => {
    const { status } = await api('POST', '/documents/text', { text: 'x', projectId: 999999999 });
    assert.equal(status, 404);
  });
});
