import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDocumentFitsWindow,
  estimateTokens,
  inputBudget,
  maxDocumentChars,
  transcriptRoomChars,
} from './promptBudget';
import { env } from '../config/env';
import { CHARS_PER_TOKEN_ESTIMATE, INPUT_SAFETY_TOKENS } from '../config/limits';

// A1 stage 0: one estimate, one budget rule, one order of giving way —
// the transcript shrinks, the document never does.

describe('promptBudget', () => {
  test('the budget is the window minus the completion minus the safety margin', () => {
    assert.equal(inputBudget(300), env.llm.contextTokens - 300 - INPUT_SAFETY_TOKENS);
  });

  test('estimates pessimistically, at 2.2 characters a token', () => {
    assert.equal(estimateTokens('а'.repeat(220)), 100);
    assert.equal(estimateTokens(['а'.repeat(110), 'б'.repeat(110)]), 100);
  });

  test('the transcript gets what the fixed parts leave, up to its own cap', () => {
    const room = transcriptRoomChars(300, ['x'.repeat(1000)], 16_000);
    assert.equal(room, 16_000, 'a short document leaves the full window');
    const tight = transcriptRoomChars(300, ['x'.repeat(Math.floor((inputBudget(300) - 1000) * CHARS_PER_TOKEN_ESTIMATE))], 16_000);
    assert.ok(tight > 0 && tight < 16_000, `a long document narrows the window (${tight})`);
  });

  test('a document that fills the budget leaves no transcript, not a negative one', () => {
    const huge = 'x'.repeat(Math.ceil(inputBudget(300) * CHARS_PER_TOKEN_ESTIMATE) + 10);
    assert.equal(transcriptRoomChars(300, [huge], 16_000), 0);
  });

  test('a 15-page document fits; the limit sits around 20 pages at the pessimistic ratio', () => {
    assert.doesNotThrow(() => assertDocumentFitsWindow('а'.repeat(15 * 4_700)));
    const limit = maxDocumentChars();
    assert.ok(limit > 90_000 && limit < 100_000, `limit ${limit}`);
  });

  test('a longer document is a 400; without a page count the pages are called an estimate', () => {
    assert.throws(
      () => assertDocumentFitsWindow('а'.repeat(maxDocumentChars() + 1)),
      (err: Error & { statusCode?: number }) => err.statusCode === 400 &&
        /слишком длинный: [\d\s ]+ символов, около \d+ стр\. сплошного текста\. Предел — [\d\s ]+ символов/.test(err.message),
    );
  });

  test('a PDF is named by its real page count, not by an estimate', () => {
    // An NBK report holds ~2 600 characters a page; the estimate at 4 700 would
    // have called a 42-page report "~24 pages".
    assert.throws(
      () => assertDocumentFitsWindow('а'.repeat(maxDocumentChars() + 1), 42),
      (err: Error) => /слишком длинный: 42 стр\., [\d\s ]+ символов\./.test(err.message) && !/около 2\d стр\. сплошного текста\. Предел/.test(err.message),
    );
  });

  test('no document is not an error', () => {
    assert.doesNotThrow(() => assertDocumentFitsWindow(null));
    assert.doesNotThrow(() => assertDocumentFitsWindow(''));
  });
});
