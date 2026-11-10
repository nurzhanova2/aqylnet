// Regression tests for stage E3 of .ai/SECURITY.md (item 8): the upload path
// now verifies file signatures, screens .docx archives for expansion attacks,
// and parses in an isolated worker under a time and memory budget.
//
// Fixtures are built here rather than committed, so the suite needs no binary
// blobs and no zip dependency — tests/ ships only pg and playwright.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { BASE_URL } from '../api/helpers.mjs';

// ─── Minimal zip writer ──────────────────────────────────────
// Enough of the format to produce an archive the backend's central-directory
// reader accepts. CRC is computed when the runtime offers zlib.crc32 and left
// at zero otherwise: every archive built here is expected to be rejected by a
// size or ratio guard before any decompression, so the checksum is never read.

function crc32(buf) {
  return typeof zlib.crc32 === 'function' ? zlib.crc32(buf) : 0;
}

function dosTime() {
  // Fixed timestamp — nothing under test depends on it.
  return { time: 0, date: 0x2100 };
}

function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'latin1');
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const { time, date } = dosTime();

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(0, 6);             // flags
    local.writeUInt16LE(8, 8);             // method: deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);            // extra length
    locals.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);          // version made by
    central.writeUInt16LE(20, 6);          // version needed
    central.writeUInt16LE(0, 8);           // flags
    central.writeUInt16LE(8, 10);          // method
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);          // extra
    central.writeUInt16LE(0, 32);          // comment
    central.writeUInt16LE(0, 34);          // disk
    central.writeUInt16LE(0, 36);          // internal attrs
    central.writeUInt32LE(0, 38);          // external attrs
    central.writeUInt32LE(offset, 42);     // local header offset
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }

  const localPart = Buffer.concat(locals);
  const centralPart = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localPart, centralPart, eocd]);
}

const CONTENT_TYPES = Buffer.from(
  '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
  'utf8',
);
const SMALL_DOCUMENT = Buffer.from(
  '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:body><w:p><w:r><w:t>короткий документ</w:t></w:r></w:p></w:body></w:document>',
  'utf8',
);

async function upload(filename, content, contentType = 'application/octet-stream') {
  const form = new FormData();
  form.append('file', new File([content], filename, { type: contentType }));
  const res = await fetch(`${BASE_URL}/documents/upload`, { method: 'POST', body: form });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

describe('E3: upload signature checks', () => {
  test('a valid Cyrillic .txt is accepted', async () => {
    // Guards the bug the first implementation had: it trimmed a fixed four
    // bytes off the sample "to avoid splitting a multi-byte character", which
    // split one instead and rejected ordinary Russian text as invalid UTF-8.
    const { status, json } = await upload('ok.txt', 'Проект поправок в правила кредитования.');
    assert.equal(status, 201, `expected acceptance, got ${JSON.stringify(json)}`);
    assert.equal(json.data.truncated, false);
    assert.ok(json.data.extractedText.includes('Проект поправок'));
  });

  test('a .txt whose bytes are a PDF is rejected', async () => {
    const { status, json } = await upload('doc.txt', '%PDF-1.4\nnot really text');
    assert.equal(status, 400);
    assert.match(json.message, /PDF-данные|подпись/i);
  });

  test('a .pdf whose bytes are plain text is rejected', async () => {
    const { status, json } = await upload('doc.pdf', 'this is not a pdf at all');
    assert.equal(status, 400);
    assert.match(json.message, /не соответствует расширению/i);
  });

  test('a .txt containing NUL bytes is rejected', async () => {
    const { status, json } = await upload('doc.txt', new Uint8Array([0x61, 0x00, 0x62]));
    assert.equal(status, 400);
    assert.match(json.message, /нулевые байты/i);
  });

  test('an empty file is rejected', async () => {
    const { status, json } = await upload('empty.txt', '');
    assert.equal(status, 400);
    assert.match(json.message, /пустой|No file uploaded/i);
  });
});

describe('E3: .docx archive screening', () => {
  test('an archive that expands far beyond its size is rejected as a zip bomb', async () => {
    // 4 MB of zeros deflates to a couple of kilobytes: a genuine expansion
    // attack at small scale, ratio in the hundreds against a limit of 150.
    const docx = buildZip([
      { name: '[Content_Types].xml', data: CONTENT_TYPES },
      { name: 'word/document.xml', data: SMALL_DOCUMENT },
      { name: 'word/media/bomb.bin', data: Buffer.alloc(4 * 1024 * 1024, 0) },
    ]);
    const { status, json } = await upload('bomb.docx', docx);
    assert.equal(status, 400, `expected rejection, got ${JSON.stringify(json)}`);
    assert.match(json.message, /zip-бомб|расширяется/i);
  });

  test('an archive whose XML alone exceeds the parse budget is rejected', async () => {
    // Markup bulk, not media bulk — this is the limit that actually bounds
    // parser time and memory, and the reason the two caps are separate.
    const huge = Buffer.from(
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      '<w:p><w:r><w:t>Проект поправок в правила потребительского кредитования.</w:t></w:r></w:p>'.repeat(220_000) +
      '</w:body></w:document>',
      'utf8',
    );
    const docx = buildZip([
      { name: '[Content_Types].xml', data: CONTENT_TYPES },
      { name: 'word/document.xml', data: huge },
    ]);
    const { status, json } = await upload('xmlbig.docx', docx);
    assert.equal(status, 400, `expected rejection, got ${JSON.stringify(json)}`);
    assert.match(json.message, /Разметка внутри|слишком велика/i);
  });

  test('an archive with an absurd number of members is rejected', async () => {
    const entries = [
      { name: '[Content_Types].xml', data: CONTENT_TYPES },
      { name: 'word/document.xml', data: SMALL_DOCUMENT },
    ];
    for (let i = 0; i < 1100; i++) {
      entries.push({ name: `word/media/pad${i}.bin`, data: Buffer.from('x') });
    }
    const { status, json } = await upload('many.docx', buildZip(entries));
    assert.equal(status, 400, `expected rejection, got ${JSON.stringify(json)}`);
    assert.match(json.message, /слишком много элементов/i);
  });

  test('a .docx that is not a readable archive is rejected', async () => {
    // Correct PK signature, nothing behind it — must be a clean 400 rather than
    // whatever mammoth would have thrown.
    const { status, json } = await upload('broken.docx', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]));
    assert.equal(status, 400);
    assert.match(json.message, /повреждён|структуру архива/i);
  });
});

describe('E3: extracted text is bounded', () => {
  test('a document over the character cap is truncated and says so', async () => {
    // The product decision of stage E3: truncate and flag, never
    // silently analyse part of a document as though it were the whole one.
    const sentence = 'Проект поправок в правила потребительского кредитования. ';
    const text = sentence.repeat(Math.ceil(600_000 / sentence.length));
    const { status, json } = await upload('big.txt', text);

    assert.equal(status, 201);
    assert.equal(json.data.truncated, true, 'the truncation flag is what the UI warns on');
    assert.ok(
      json.data.extractedLength > json.data.extractedText.length,
      'extractedLength reports the length before cutting',
    );
    assert.equal(json.data.extractedText.length, 500_000, 'cut at MAX_DOCUMENT_TEXT_CHARS');
  });
});

describe('E3: parsing cannot block the API', () => {
  test('/api/health keeps answering while several documents are parsed', async () => {
    // The point of moving the parsers into a worker. Previously pdf-parse and
    // mammoth ran on the main thread, so a heavy document froze every route,
    // health included.
    const paragraph =
      '<w:p><w:r><w:t>Национальный Банк вправе устанавливать коэффициенты риска.</w:t></w:r></w:p>';
    const xml = Buffer.from(
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      paragraph.repeat(90_000) +
      '</w:body></w:document>',
      'utf8',
    );
    const docx = buildZip([
      { name: '[Content_Types].xml', data: CONTENT_TYPES },
      { name: 'word/document.xml', data: xml },
    ]);

    const parses = [upload('heavy1.docx', docx), upload('heavy2.docx', docx), upload('heavy3.docx', docx)];

    const timings = [];
    for (let i = 0; i < 8; i++) {
      const started = Date.now();
      const res = await fetch(`${BASE_URL}/health`);
      timings.push(Date.now() - started);
      assert.equal(res.status, 200, 'health must stay up during parsing');
    }

    await Promise.all(parses);

    const worst = Math.max(...timings);
    assert.ok(worst < 2_000, `health responded in up to ${worst}ms — the event loop was blocked`);
  });
});
