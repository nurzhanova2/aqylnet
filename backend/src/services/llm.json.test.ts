import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseTruncatedJson } from './llm.service';

// A completion cut off by max_tokens used to cost the entire document audit —
// JSON.parse threw and everything, including fully-written issues, was dropped.
// These cover the shapes the audit actually produces when it runs out of room.

describe('parseTruncatedJson', () => {
  test('passes valid JSON straight through', () => {
    assert.deepEqual(parseTruncatedJson('{"a":1,"b":[2,3]}'), { a: 1, b: [2, 3] });
  });

  test('recovers completed array elements when the array is cut open', () => {
    const cut = '{"issues":[{"title":"первое"},{"title":"второе"},{"title":"обор';
    assert.deepEqual(parseTruncatedJson(cut), {
      issues: [{ title: 'первое' }, { title: 'второе' }],
    });
  });

  test('drops the dangling comma left by the cut', () => {
    assert.deepEqual(parseTruncatedJson('{"a":[1,2],'), { a: [1, 2] });
  });

  test('a brace inside a string is not mistaken for structure', () => {
    const cut = '{"quote":"ставка {46%} годовых","next":[{"n":1},{"n":2';
    assert.deepEqual(parseTruncatedJson(cut), {
      quote: 'ставка {46%} годовых',
      next: [{ n: 1 }],
    });
  });

  test('an escaped quote inside a string does not end the string early', () => {
    const cut = '{"note":"он сказал \\"да\\" уверенно","rest":[{"n":1},{"n":2';
    assert.deepEqual(parseTruncatedJson(cut), {
      note: 'он сказал "да" уверенно',
      rest: [{ n: 1 }],
    });
  });

  test('is conservative: a list of primitives cut mid-element is not salvaged', () => {
    // Recovery rewinds to the last *closed* bracket, so "[1,2" offers nothing to
    // rewind to. Harmless for the audit, whose every array holds objects — each
    // element closes with "}" — but worth pinning down so the limitation is a
    // decision rather than a surprise.
    assert.equal(parseTruncatedJson('{"rest":[1,2'), null);
  });

  test('closes several levels left open at once', () => {
    const cut = '{"a":{"b":{"c":[{"d":1},{"d":2}';
    assert.deepEqual(parseTruncatedJson(cut), { a: { b: { c: [{ d: 1 }, { d: 2 }] } } });
  });

  test('returns null when nothing was ever completed', () => {
    assert.equal(parseTruncatedJson('{"a":"незакрыт'), null);
  });

  test('returns null for text that is not JSON at all', () => {
    assert.equal(parseTruncatedJson('извините, не могу'), null);
  });
});
