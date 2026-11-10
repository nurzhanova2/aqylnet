import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDiscussionContext, jurisdictionGrounding, normalizeJurisdictionTerms } from './llm.service';

test('discussion context includes the optional task and Kazakhstan grounding', () => {
  const task = '\u041e\u0446\u0435\u043d\u0438\u0442\u0435 \u0440\u0438\u0441\u043a\u0438 \u0434\u043b\u044f \u041a\u0430\u0437\u0430\u0445\u0441\u0442\u0430\u043d\u0430';
  const context = buildDiscussionContext('\u0411\u0430\u043d\u043a\u043e\u0432\u0441\u043a\u0438\u0439 \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442', task);

  assert.match(context, new RegExp(task));
  assert.match(context, /\u041d\u0430\u0446\u0438\u043e\u043d\u0430\u043b\u044c\u043d\u044b\u0439 \u0411\u0430\u043d\u043a \u0420\u0435\u0441\u043f\u0443\u0431\u043b\u0438\u043a\u0438 \u041a\u0430\u0437\u0430\u0445\u0441\u0442\u0430\u043d/);
});

test('Kazakhstan output normalizes the Ukrainian bank acronym', () => {
  const context = '\u0420\u0435\u0433\u0443\u043b\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435 \u0431\u0430\u043d\u043a\u043e\u0432 \u041a\u0430\u0437\u0430\u0445\u0441\u0442\u0430\u043d\u0430';
  const output = normalizeJurisdictionTerms('\u041f\u043e \u0434\u0430\u043d\u043d\u044b\u043c \u041d\u0411\u0423 \u0440\u0438\u0441\u043a \u0432\u044b\u0441\u043e\u043a', context);

  assert.equal(output, '\u041f\u043e \u0434\u0430\u043d\u043d\u044b\u043c \u041d\u0411\u041a \u0440\u0438\u0441\u043a \u0432\u044b\u0441\u043e\u043a');
  assert.equal(jurisdictionGrounding('\u0414\u043e\u043a\u0443\u043c\u0435\u043d\u0442 \u043e \u0424\u0440\u0430\u043d\u0446\u0438\u0438'), '');
});
