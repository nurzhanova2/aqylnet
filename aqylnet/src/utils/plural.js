/**
 * Russian plural form: plural(1, 'участник', 'участника', 'участников') →
 * 'участник'; 2–4 → the second form; 5–20, 0 and 11–14 → the third.
 */
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a >= 11 && a <= 14) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

/** «2 участника», «5 раундов» — the number with its word. */
export function countOf(n, one, few, many) {
  return `${n} ${plural(n, one, few, many)}`;
}
