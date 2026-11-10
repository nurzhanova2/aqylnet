import fs from 'node:fs';
import path from 'node:path';
import { splitDocument } from '../../backend/src/services/documentSections';

const dir = process.argv[2];
for (const f of fs.readdirSync(dir).filter((n) => n.startsWith('parsed-'))) {
  const text = fs.readFileSync(path.join(dir, f), 'utf8');
  const { method, sections } = splitDocument(text);
  let ok = sections.length > 0 && sections[0].startOffset === 0 && sections[sections.length - 1].endOffset === text.length;
  sections.forEach((s, i) => {
    if (text.slice(s.startOffset, s.endOffset) !== s.text) ok = false;
    if (i > 0 && sections[i - 1].endOffset !== s.startOffset) ok = false;
  });
  console.log(`${f}: ${method}, ${sections.length} sections, invariant ${ok ? 'OK' : 'BROKEN'}`);
  for (const s of sections) console.log(`   ${s.order} ${s.text.length} ${s.heading ?? '(без заголовка)'}`);
}
