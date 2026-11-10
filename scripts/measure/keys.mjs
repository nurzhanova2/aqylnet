// Reads the defect keys (test*_klyuch_oshibok.md) into a list of planted
// defects, each with its verbatim quotes, and the "good" contrast fragments.
//
// The two keys are formatted differently — one puts the quote on a bullet
// ("- Цитата: «…»"), the other on its own line ("Цитата (раздел 3): …") — so
// the parser accepts both rather than assuming one layout.

export function parseKey(md) {
  const items = [];
  let cur = null;
  for (const line of md.split('\n')) {
    const h = line.match(/^#{2,3}\s+(.*)$/);
    if (h) {
      const title = h[1].trim();
      const kind = /^Дефект/i.test(title) ? 'defect' : /^Хорош/i.test(title) ? 'good' : null;
      cur = kind ? { kind, title, type: '', section: '', quotes: [] } : null;
      if (cur) items.push(cur);
      continue;
    }
    if (!cur) continue;
    const t = line.replace(/^\s*-\s*/, '');
    const q = t.match(/^(?:Дополнительная\s+)?Цитата[^:]*:\s*(.+)$/i);
    if (q) {
      let s = q[1].trim();
      if (s.startsWith('«') && s.endsWith('»')) s = s.slice(1, -1);
      cur.quotes.push(s);
      continue;
    }
    const ty = t.match(/^Тип:\s*(.+)$/i);
    if (ty) cur.type = ty[1].trim();
    const se = t.match(/^Разделы?:\s*(.+)$/i);
    if (se) cur.section = se[1].trim();
  }
  return items;
}
