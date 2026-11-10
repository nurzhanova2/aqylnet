/**
 * personaLook — детерминированный fallback-«look» для персон без сохранённой
 * внешности (look == null у старых записей).
 *
 * Контракт look (Persona DTO):
 *   { skin: '#hex', hair: '#hex', outfit: '#hex',
 *     style: 'short' | 'long' | 'bob' | 'bun' | 'spiky', glasses?: boolean }
 *
 * Генерация строго детерминирована по полям персоны (gender, avatarIdx, dot),
 * чтобы одна и та же персона всегда выглядела одинаково на всех экранах.
 */

export const LOOK_STYLES = ['short', 'long', 'bob', 'bun', 'spiky'];

/** Небольшие палитры для fallback-генерации (подобраны по макетам). */
export const SKIN_TONES = ['#F6D2B8', '#F1CFB4', '#EBC29E', '#E9BE98', '#E4B892', '#B9835C'];
export const HAIR_COLORS = ['#1C1412', '#1E1A18', '#2A1C17', '#2B2420', '#4A2C22', '#6B645E', '#C9C4BE', '#E2B867'];

const FEMALE_STYLES = ['long', 'bob', 'bun'];
const MALE_STYLES = ['short', 'spiky'];

function isFemale(gender) {
  return typeof gender === 'string' && gender.trim().toLowerCase().startsWith('жен');
}

function parseHex(hex) {
  if (typeof hex !== 'string') return null;
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * Приглушённый вариант цвета: уменьшаем насыщенность и яркость,
 * чтобы dot-цвет персоны превратился в цвет одежды гаммы Heritage.
 */
export function mutedOutfit(hex, fallback = '#174B34') {
  const rgb = parseHex(hex);
  if (!rgb) return fallback;
  const [r, g, b] = rgb;
  const gray = (r + g + b) / 3;
  const mix = (v) => v * 0.52 + gray * 0.18; // desaturate + darken
  return toHex([mix(r), mix(g), mix(b)]);
}

/**
 * Детерминированный fallback-look по полям персоны.
 * @param {{ gender?: string, avatarIdx?: number, dot?: string }} persona
 */
export function fallbackLook(persona = {}) {
  const idx = Number.isFinite(Number(persona.avatarIdx)) ? Math.abs(Number(persona.avatarIdx)) : 0;
  const styles = isFemale(persona.gender) ? FEMALE_STYLES : MALE_STYLES;
  return {
    skin: SKIN_TONES[idx % SKIN_TONES.length],
    hair: HAIR_COLORS[idx % HAIR_COLORS.length],
    outfit: mutedOutfit(persona.dot),
    style: styles[idx % styles.length],
    glasses: idx % 4 === 3,
  };
}

/** Проверяет, что сохранённый look полон и валиден. */
export function isValidLook(look) {
  return Boolean(
    look
    && parseHex(look.skin)
    && parseHex(look.hair)
    && parseHex(look.outfit)
    && LOOK_STYLES.includes(look.style)
  );
}

/**
 * Эффективный look персоны: сохранённый (если валиден) или детерминированный
 * fallback. Единая точка входа для всех мест рендера ChibiAvatar.
 */
export function personaLook(persona) {
  if (!persona) return fallbackLook();
  if (isValidLook(persona.look)) {
    return { ...persona.look, glasses: Boolean(persona.look.glasses) };
  }
  return fallbackLook(persona);
}
