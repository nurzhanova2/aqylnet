import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  tailWithinBudget,
  transcriptWithinBudget,
  parsePositions,
} from './llm.service';

// Stage E4: prompt budgets (item 11b) and validation of model output before it
// becomes durable state (item 22).

const msg = (speaker: string, text: string) => ({ speaker, text });

describe('tailWithinBudget — persona transcript window', () => {
  test('keeps everything when it fits', () => {
    const messages = [msg('Алия', 'раз'), msg('Максат', 'два')];
    const { lines, dropped } = tailWithinBudget(messages, 1000);
    assert.equal(dropped, 0);
    assert.deepEqual(lines, ['Алия: раз', 'Максат: два']);
  });

  test('drops from the start, so the latest replies always survive', () => {
    // A persona answers what was just said; losing the end would defeat the
    // purpose of sending a transcript at all.
    const messages = Array.from({ length: 10 }, (_, i) => msg(`P${i}`, 'x'.repeat(100)));
    const { lines, dropped } = tailWithinBudget(messages, 320);
    assert.ok(dropped > 0, 'some messages must have been dropped');
    assert.equal(lines.length + dropped, messages.length, 'nothing is lost or duplicated');
    assert.ok(lines[lines.length - 1]?.startsWith('P9:'), 'the newest message is kept');
  });

  test('reports exactly how many were dropped', () => {
    const messages = Array.from({ length: 6 }, (_, i) => msg(`P${i}`, 'y'.repeat(50)));
    const { lines, dropped } = tailWithinBudget(messages, 120);
    assert.equal(lines.length + dropped, 6);
  });

  test('keeps one message even when it alone exceeds the budget', () => {
    // Returning an empty transcript would be worse than returning an oversized
    // one: the persona would be told the discussion had not started.
    const { lines, dropped } = tailWithinBudget([msg('Алия', 'z'.repeat(5000))], 100);
    assert.equal(lines.length, 1);
    assert.equal(dropped, 0);
  });

  test('an empty history yields nothing to drop', () => {
    const { lines, dropped } = tailWithinBudget([], 1000);
    assert.deepEqual(lines, []);
    assert.equal(dropped, 0);
  });
});

describe('transcriptWithinBudget — report and audit bound', () => {
  test('a discussion the product can actually produce is never trimmed', () => {
    // 90 messages of ~523 characters is the measured product maximum: 10 rounds
    // of 8 personas plus the moderator, about 47 000 characters against a
    // 60 000 budget.
    const messages = Array.from({ length: 90 }, (_, i) => msg(`P${i % 9}`, 'ы'.repeat(523)));
    const out = transcriptWithinBudget(messages);
    assert.ok(!out.includes('пропущено'), 'nothing should be elided at the real maximum');
    assert.equal(out.split('\n').length, 90);
  });

  test('over budget it drops the middle, keeping head and tail', () => {
    const messages = Array.from({ length: 400 }, (_, i) => msg(`P${i}`, 'q'.repeat(500)));
    const out = transcriptWithinBudget(messages, 10_000);

    assert.ok(out.startsWith('P0:'), 'the opening of the discussion is kept');
    assert.ok(out.trimEnd().endsWith('q'), 'the end of the discussion is kept');
    assert.ok(out.includes('P399:'), 'the last speaker is present');
    assert.match(out, /пропущено \d+ реплик/, 'the elision is declared, not silent');
    assert.ok(out.length < 12_000, `stayed near the budget, got ${out.length}`);
  });

  test('an empty discussion produces an empty string, not a marker', () => {
    assert.equal(transcriptWithinBudget([]), '');
  });
});

describe('parsePositions — model output before it reaches the database', () => {
  test('accepts a well-formed set', () => {
    const out = parsePositions([
      { id: 1, stance: 'Поддерживает', reasoning: 'р', priority: 'п', fears: 'о', thinking: 'м' },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0]?.stance, 'Поддерживает');
  });

  test('a non-string stance no longer crashes project creation', () => {
    // This was the live failure: the value went into ProjectPersona.stanceOverride
    // through a bare `as` cast, and a non-string produced a 500.
    const out = parsePositions([{ id: 2, stance: 42, reasoning: 'р' }]);
    assert.equal(out.length, 1);
    assert.equal(typeof out[0]?.stance, 'string');
  });

  test('an unknown stance becomes Неопределившийся rather than being stored verbatim', () => {
    const out = parsePositions([{ id: 3, stance: 'Восторженно поддерживает' }]);
    assert.equal(out[0]?.stance, 'Неопределившийся');
  });

  test('one malformed entry does not cost the whole set', () => {
    const out = parsePositions([
      { id: 1, stance: 'Против' },
      { id: 'не число', stance: 'Против' },
      { id: 3, stance: 'Нейтральный' },
    ]);
    assert.deepEqual(out.map((p) => p.id), [1, 3]);
  });

  test('a numeric string id is coerced, because JSON from a model is not typed', () => {
    const out = parsePositions([{ id: '7', stance: 'Против' }]);
    assert.equal(out[0]?.id, 7);
  });

  test('missing text fields default to empty rather than undefined', () => {
    const out = parsePositions([{ id: 1, stance: 'Против' }]);
    assert.equal(out[0]?.reasoning, '');
    assert.equal(out[0]?.thinking, '');
  });

  test('overlong text is truncated, not stored whole', () => {
    const out = parsePositions([{ id: 1, stance: 'Против', reasoning: 'a'.repeat(5000) }]);
    assert.ok((out[0]?.reasoning.length ?? 0) <= 1000);
  });

  test('a response that is not an array yields nothing', () => {
    assert.deepEqual(parsePositions({ id: 1 }), []);
    assert.deepEqual(parsePositions(null), []);
    assert.deepEqual(parsePositions('[]'), []);
  });
});
