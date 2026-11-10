import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CreatePersonaSchema, UpdatePersonaSchema } from './persona.validator';

// The invariant this file exists for: PATCH means "only what was sent".
//
// It held under zod 3 by accident — `.partial()` short-circuited each field's
// `.default()` — and broke silently on the upgrade to zod 4, which runs the
// default first. The consequence was measured on the live API: a PATCH carrying
// only `{ name }` rewrote 20 of 22 columns, wiping city, stance, fears,
// interests and the chibi avatar. Nothing covered it, which is why it would
// have shipped.
//
// These assertions are about the *absence* of keys, so they would have caught
// it: a test that only checked the fields it sent would have passed throughout.

const MINIMAL_CREATE = {
  name: 'Тестовая персона',
  role: 'Экономист',
  gender: 'Женский',
  age: '41 год',
  dot: '#34d399',
  style: 'Аналитический',
  criticality: 'Высокий',
  behaviorModel: 'Скептик',
};

describe('UpdatePersonaSchema — PATCH не трогает того, чего не присылали', () => {
  test('из одного поля получается ровно одно поле', () => {
    const parsed = UpdatePersonaSchema.parse({ name: 'Новое имя' });
    assert.deepEqual(parsed, { name: 'Новое имя' });
    assert.equal(Object.keys(parsed).length, 1, `лишние ключи: ${Object.keys(parsed).join(', ')}`);
  });

  test('ни одно поле с дефолтом не появляется само', () => {
    // Перечислено дословно, а не выведено из схемы: смысл теста в том, чтобы
    // он падал при возврате дефолтов, а не повторял за реализацией.
    const DEFAULTED = [
      'city', 'education', 'industry', 'employerType', 'income',
      'openness', 'decisionMaking', 'stance', 'priority', 'fears',
      'personalSituation', 'speechTone', 'argumentation', 'responseLength',
      'typicalPhrases', 'thinking', 'reasoning', 'interests', 'avatarIdx',
      'look', 'seatL', 'seatT', 'contexts',
    ];
    const parsed = UpdatePersonaSchema.parse({ role: 'Юрист' }) as Record<string, unknown>;
    const leaked = DEFAULTED.filter((f) => f in parsed);
    assert.deepEqual(leaked, [], `дефолты просочились в PATCH: ${leaked.join(', ')}`);
  });

  test('пустой PATCH ничего не приносит', () => {
    assert.deepEqual(UpdatePersonaSchema.parse({}), {});
  });

  test('явный null в look сохраняется — это «очистить», а не «не менять»', () => {
    const parsed = UpdatePersonaSchema.parse({ look: null }) as Record<string, unknown>;
    assert.equal('look' in parsed, true);
    assert.equal(parsed.look, null);
  });

  test('переданное значение по-прежнему проверяется', () => {
    assert.equal(UpdatePersonaSchema.safeParse({ city: 5 }).success, false, 'число в city');
    assert.equal(UpdatePersonaSchema.safeParse({ avatarIdx: 99 }).success, false, 'avatarIdx вне 0–31');
    assert.equal(UpdatePersonaSchema.safeParse({ dot: 'красный' }).success, false, 'dot не hex');
    assert.equal(UpdatePersonaSchema.safeParse({ name: '' }).success, false, 'пустое имя');
    assert.equal(UpdatePersonaSchema.safeParse({ look: { skin: 'нет' } }).success, false, 'битый look');
  });

  test('корректное значение проходит', () => {
    const parsed = UpdatePersonaSchema.parse({ avatarIdx: 31, interests: ['кредитование'] });
    assert.deepEqual(parsed, { avatarIdx: 31, interests: ['кредитование'] });
  });
});

describe('CreatePersonaSchema — дефолты на создании остаются', () => {
  test('необязательные поля получают значения', () => {
    const parsed = CreatePersonaSchema.parse(MINIMAL_CREATE);
    assert.equal(parsed.city, '');
    assert.equal(parsed.responseLength, 'Средний');
    assert.equal(parsed.avatarIdx, 0);
    assert.equal(parsed.look, null);
    assert.deepEqual(parsed.interests, []);
    assert.deepEqual(parsed.contexts, []);
    assert.equal(parsed.seatL, '50%');
  });

  test('обязательные поля по-прежнему обязательны', () => {
    const { name, ...withoutName } = MINIMAL_CREATE;
    assert.ok(name);
    assert.equal(CreatePersonaSchema.safeParse(withoutName).success, false);
  });
});
