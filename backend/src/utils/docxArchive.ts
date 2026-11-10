import fs from 'fs/promises';
import {
  MAX_DOCX_ENTRIES,
  MAX_DOCX_EXPANSION_RATIO,
  MAX_DOCX_UNCOMPRESSED_BYTES,
  MAX_DOCX_XML_UNCOMPRESSED_BYTES,
} from '../config/limits';

// Zip-bomb screening for .docx, run before mammoth is handed the file.
//
// mammoth does none of this itself, and it is the route by which the
// @xmldom/xmldom weaknesses (quadratic parsing, end-tag ReDoS) are reachable.
// Updating xmldom to 0.8.15 in stage E1 closed the known CVEs; it did nothing
// about an unbounded amount of input being fed to the parser, which is what
// this file is for.
//
// Everything here reads the archive's *declared* sizes out of the central
// directory, without inflating anything. That is cheap and catches the ordinary
// case, but a crafted archive can lie about those numbers — which is why the
// parser also runs in a worker with a hard heap ceiling. Declared sizes are the
// cheap filter; the worker's resourceLimits are the one that cannot be forged.

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
/** EOCD is 22 bytes plus a comment of at most 65535. */
const EOCD_MAX_SEARCH = 22 + 0xffff;

export interface ArchiveVerdict {
  ok: boolean;
  /** Human-readable reason, suitable for a 400 body. Empty when ok. */
  reason: string;
}

interface ZipEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
}

/**
 * Walks the central directory. Returns null when the file is not a readable zip
 * at all — the caller turns that into a 400 rather than letting mammoth decide.
 */
function readCentralDirectory(buf: Buffer): ZipEntry[] | null {
  let eocd = -1;
  const lowest = Math.max(0, buf.length - EOCD_MAX_SEARCH);
  for (let i = buf.length - 22; i >= lowest; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) { eocd = i; break; }
  }
  if (eocd < 0) return null;

  const declaredCount = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];

  // Bounded by the declared count *and* by MAX_DOCX_ENTRIES, so a header
  // claiming 65535 members cannot make this loop the expensive part.
  const limit = Math.min(declaredCount, MAX_DOCX_ENTRIES + 1);
  for (let n = 0; n < limit; n++) {
    if (offset + 46 > buf.length) return null;
    if (buf.readUInt32LE(offset) !== CENTRAL_FILE_SIGNATURE) break;

    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);

    if (offset + 46 + nameLen > buf.length) return null;
    const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString('latin1');

    entries.push({ name, compressedSize, uncompressedSize });
    offset += 46 + nameLen + extraLen + commentLen;
  }

  // declaredCount can legitimately exceed what we read only if the archive is
  // malformed; an empty result means we could not make sense of it.
  return entries.length > 0 ? entries : null;
}

/** The parts mammoth actually parses: the XML of the OPC package. */
function isXmlPart(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.xml') || lower.endsWith('.rels');
}

export async function inspectDocx(filePath: string): Promise<ArchiveVerdict> {
  const buf = await fs.readFile(filePath);
  const entries = readCentralDirectory(buf);

  if (!entries) {
    return { ok: false, reason: 'Файл .docx повреждён: не удалось прочитать структуру архива.' };
  }

  if (entries.length > MAX_DOCX_ENTRIES) {
    return {
      ok: false,
      reason: `Архив .docx содержит слишком много элементов (${entries.length}, допустимо ${MAX_DOCX_ENTRIES}).`,
    };
  }

  let total = 0;
  let xmlTotal = 0;
  for (const e of entries) {
    total += e.uncompressedSize;
    if (isXmlPart(e.name)) xmlTotal += e.uncompressedSize;
  }

  if (total > MAX_DOCX_UNCOMPRESSED_BYTES) {
    return {
      ok: false,
      reason: `Распакованный размер .docx слишком велик (${Math.round(total / 1048576)} МБ, допустимо ${Math.round(MAX_DOCX_UNCOMPRESSED_BYTES / 1048576)} МБ).`,
    };
  }

  if (xmlTotal > MAX_DOCX_XML_UNCOMPRESSED_BYTES) {
    return {
      ok: false,
      reason: `Разметка внутри .docx слишком велика для обработки (${Math.round(xmlTotal / 1048576)} МБ, допустимо ${Math.round(MAX_DOCX_XML_UNCOMPRESSED_BYTES / 1048576)} МБ).`,
    };
  }

  const ratio = buf.length > 0 ? total / buf.length : 0;
  if (ratio > MAX_DOCX_EXPANSION_RATIO) {
    return {
      ok: false,
      reason: `Архив .docx расширяется в ${ratio.toFixed(0)} раз — это признак zip-бомбы (допустимо ${MAX_DOCX_EXPANSION_RATIO}).`,
    };
  }

  return { ok: true, reason: '' };
}
