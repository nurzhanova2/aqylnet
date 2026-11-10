// Turns a `psql COPY ... (format text)` dump of one value back into the
// original text, and checks it against the length the database reports.
//
//   node scripts/measure/00-unescape-copy.mjs <raw.txt> <out.txt> <expectedLength>
//
// A file rather than `node -e`: Git Bash rewrites backslashes in command-line
// arguments on the way to node.exe, and the first attempt at this unescaped the
// letters t and n instead of \t and \n.

import fs from 'node:fs';

const [raw, out, expected] = process.argv.slice(2);
const MAP = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '\\': '\\' };
const text = fs.readFileSync(raw, 'utf8').replace(/\n$/, '').replace(/\\([ntrbfv\\])/g, (_, c) => MAP[c]);

const bad = (text.match(/�/g) || []).length;
if (bad) { console.error(`${raw}: ${bad} U+FFFD`); process.exit(1); }
if (expected && text.length !== Number(expected)) {
  console.error(`${raw}: length ${text.length}, database says ${expected}`);
  process.exit(1);
}
fs.writeFileSync(out, text, 'utf8');
console.log(`${out}: ${text.length} chars, ${text.split('\n').length} lines, intact`);
