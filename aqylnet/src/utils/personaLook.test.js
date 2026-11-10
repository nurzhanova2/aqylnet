import { describe, test, expect } from 'vitest';
import { personaLook, fallbackLook, isValidLook, mutedOutfit, LOOK_STYLES, SKIN_TONES, HAIR_COLORS } from './personaLook';

const HEX = /^#[0-9A-Fa-f]{6}$/;

describe('fallbackLook (deterministic look for personas without one)', () => {
  test('is deterministic for the same persona', () => {
    const p = { gender: 'Женский', avatarIdx: 5, dot: '#f472b6' };
    expect(fallbackLook(p)).toEqual(fallbackLook(p));
  });

  test('female personas get female hairstyles', () => {
    for (let i = 0; i < 12; i++) {
      const look = fallbackLook({ gender: 'Женский', avatarIdx: i, dot: '#36C988' });
      expect(['long', 'bob', 'bun']).toContain(look.style);
    }
  });

  test('male personas get short/spiky by avatarIdx', () => {
    expect(fallbackLook({ gender: 'Мужской', avatarIdx: 0 }).style).toBe('short');
    expect(fallbackLook({ gender: 'Мужской', avatarIdx: 1 }).style).toBe('spiky');
  });

  test('skin and hair come from the small palettes, keyed by avatarIdx', () => {
    const look = fallbackLook({ gender: 'Мужской', avatarIdx: 7, dot: '#60a5fa' });
    expect(SKIN_TONES).toContain(look.skin);
    expect(HAIR_COLORS).toContain(look.hair);
    expect(look.skin).toBe(SKIN_TONES[7 % SKIN_TONES.length]);
    expect(look.hair).toBe(HAIR_COLORS[7 % HAIR_COLORS.length]);
  });

  test('outfit is a muted valid hex derived from the dot colour', () => {
    const look = fallbackLook({ gender: 'Мужской', avatarIdx: 2, dot: '#F472B6' });
    expect(look.outfit).toMatch(HEX);
    expect(look.outfit.toLowerCase()).not.toBe('#f472b6');
  });

  test('survives missing fields', () => {
    const look = fallbackLook({});
    expect(look.skin).toMatch(HEX);
    expect(look.hair).toMatch(HEX);
    expect(look.outfit).toMatch(HEX);
    expect(LOOK_STYLES).toContain(look.style);
    expect(typeof look.glasses).toBe('boolean');
  });
});

describe('mutedOutfit', () => {
  test('returns Heritage green fallback for invalid input', () => {
    expect(mutedOutfit(null)).toBe('#174B34');
    expect(mutedOutfit('red')).toBe('#174B34');
  });

  test('darkens the colour', () => {
    const out = mutedOutfit('#ffffff');
    expect(out).toMatch(HEX);
    expect(parseInt(out.slice(1, 3), 16)).toBeLessThan(255);
  });
});

describe('isValidLook / personaLook', () => {
  const stored = { skin: '#F6D2B8', hair: '#2A1C17', outfit: '#7C5CC4', style: 'long', glasses: false };

  test('accepts a complete stored look', () => {
    expect(isValidLook(stored)).toBe(true);
    expect(personaLook({ look: stored })).toEqual(stored);
  });

  test('normalizes missing glasses to boolean', () => {
    const { glasses: _unused, ...noGlasses } = stored;
    expect(personaLook({ look: noGlasses }).glasses).toBe(false);
  });

  test('rejects null / incomplete looks and falls back deterministically', () => {
    expect(isValidLook(null)).toBe(false);
    expect(isValidLook({ ...stored, style: 'mohawk' })).toBe(false);
    expect(isValidLook({ ...stored, skin: 'peach' })).toBe(false);
    const persona = { gender: 'Мужской', avatarIdx: 3, dot: '#60a5fa', look: null };
    expect(personaLook(persona)).toEqual(fallbackLook(persona));
  });

  test('handles undefined persona', () => {
    expect(LOOK_STYLES).toContain(personaLook(undefined).style);
  });
});
