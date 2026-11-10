import fs from 'fs/promises';

// Content checks performed on the file **after** multer has written it.
//
// This does not replace, soften or reintroduce the multipart MIME check. That
// check was removed deliberately and must stay removed (SECURITY.md §11): the
// Content-Type in a multipart part is chosen by the client, derived from the
// uploader's OS, and refused perfectly valid .txt files in practice. What
// follows is the opposite kind of check — it reads the bytes that were actually
// stored, which no client can misdeclare.
//
// The extension still decides which parser runs. The signature decides whether
// the bytes are plausibly that format at all, so a .txt full of PDF internals,
// or a .pdf that is really a zip, is refused before any parser sees it.

export type DocumentKind = 'pdf' | 'docx' | 'doc' | 'text';

/** How many bytes the longest signature below needs. */
const SNIFF_BYTES = 8;

const SIGNATURES: Record<Exclude<DocumentKind, 'text'>, { bytes: Buffer; label: string }> = {
  // "%PDF-" — the header is required at the start of the file by the PDF spec.
  pdf: { bytes: Buffer.from('%PDF-', 'latin1'), label: '%PDF-' },
  // Local file header of a zip member. .docx is a zip container (OPC).
  docx: { bytes: Buffer.from([0x50, 0x4b, 0x03, 0x04]), label: 'PK\\x03\\x04' },
  // OLE2 compound file, the legacy binary .doc container.
  doc: { bytes: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), label: '\\xD0\\xCF\\x11\\xE0' },
};

export function kindForExtension(ext: string): DocumentKind | null {
  switch (ext) {
    case '.pdf':  return 'pdf';
    case '.docx': return 'docx';
    case '.doc':  return 'doc';
    case '.txt':
    case '.md':   return 'text';
    default:      return null;
  }
}

export interface SignatureVerdict {
  ok: boolean;
  /** Human-readable reason, suitable for a 400 body. Empty when ok. */
  reason: string;
}

/**
 * Trims a byte sample back to a UTF-8 character boundary.
 *
 * Only meaningful when the sample is a prefix of a larger file, where the cut
 * can land inside a multi-byte sequence. Walks back over continuation bytes
 * (10xxxxxx) and drops the lead byte they belonged to.
 *
 * The first version of this trimmed a fixed four bytes instead, which *created*
 * the very split it was meant to avoid and rejected an ordinary 87-byte
 * Cyrillic .txt as invalid UTF-8.
 */
function trimToCharBoundary(sample: Buffer): Buffer {
  // A UTF-8 sequence is at most 4 bytes, so at most 3 trailing continuation
  // bytes can precede the lead byte that started an incomplete character.
  let end = sample.length;
  for (let back = 0; back < 4 && end > 0; back++) {
    const byte = sample[end - 1] as number;
    if ((byte & 0b1100_0000) === 0b1000_0000) {
      // Continuation byte: keep walking back toward its lead byte.
      end -= 1;
      continue;
    }
    if ((byte & 0b1000_0000) === 0) {
      // ASCII: the sample already ends on a boundary.
      return sample;
    }
    // Lead byte of a multi-byte sequence. If the bytes we walked past complete
    // it, the sample ends on a boundary after all; otherwise drop the sequence.
    const needed =
      (byte & 0b1111_1000) === 0b1111_0000 ? 4 :
      (byte & 0b1111_0000) === 0b1110_0000 ? 3 :
      (byte & 0b1110_0000) === 0b1100_0000 ? 2 : 1;
    const have = sample.length - end + 1;
    return have === needed ? sample : sample.subarray(0, end - 1);
  }
  return sample.subarray(0, end);
}

/**
 * Plain-text formats have no signature, so the test is the inverse: the bytes
 * must *not* look like a container, must decode as UTF-8, and must contain no
 * NUL — a NUL is the cheapest reliable sign that something binary was renamed
 * to .txt. Validated on a prefix rather than the whole file: a 20 MB read here
 * would duplicate the work the parser is about to do under its own limits.
 *
 * `complete` says whether the sample is the entire file; only a partial sample
 * needs trimming, and trimming a complete one would corrupt valid input.
 */
function verifyText(head: Buffer, sample: Buffer, complete: boolean): SignatureVerdict {
  for (const [kind, sig] of Object.entries(SIGNATURES)) {
    if (head.subarray(0, sig.bytes.length).equals(sig.bytes)) {
      return {
        ok: false,
        reason: `Файл с расширением .txt/.md содержит ${kind.toUpperCase()}-данные (подпись ${sig.label}).`,
      };
    }
  }

  if (sample.includes(0x00)) {
    return { ok: false, reason: 'Текстовый файл содержит нулевые байты — это не текст.' };
  }

  // Decode and re-encode: a round-trip mismatch means the bytes were not valid
  // UTF-8 and Node substituted replacement characters.
  const safe = complete ? sample : trimToCharBoundary(sample);
  const decoded = safe.toString('utf8');
  if (!Buffer.from(decoded, 'utf8').equals(safe)) {
    return { ok: false, reason: 'Текстовый файл не является корректным UTF-8.' };
  }

  return { ok: true, reason: '' };
}

/**
 * Checks the stored bytes against what the extension claims.
 *
 * Returns a verdict rather than throwing, so the caller owns the response and —
 * importantly — owns deleting the file through the single path in
 * utils/uploadFiles.ts. A rejected upload must not leave its file behind.
 */
export async function verifySignature(
  filePath: string,
  kind: DocumentKind,
): Promise<SignatureVerdict> {
  const handle = await fs.open(filePath, 'r');
  try {
    // 64 KiB is enough to judge UTF-8 validity and NUL presence while staying a
    // single read.
    const buf = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    const sample = buf.subarray(0, bytesRead);
    const head = sample.subarray(0, SNIFF_BYTES);

    if (bytesRead === 0) {
      return { ok: false, reason: 'Файл пустой.' };
    }

    // A short read means we have the whole file, so nothing was cut mid-character.
    const complete = bytesRead < buf.length;
    if (kind === 'text') return verifyText(head, sample, complete);

    const sig = SIGNATURES[kind];
    if (!head.subarray(0, sig.bytes.length).equals(sig.bytes)) {
      return {
        ok: false,
        reason: `Содержимое файла не соответствует расширению: ожидалась подпись ${sig.label}.`,
      };
    }
    return { ok: true, reason: '' };
  } finally {
    await handle.close();
  }
}
