import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CreateProjectSchema, UpdateProjectSchema } from './project.validator';

// A1 stage 2: the document fields — enums only, a real date, at least one
// group when the audience is set; no defaults, so a PATCH touches only what
// it sends.

describe('document fields', () => {
  test('valid values pass', () => {
    const r = UpdateProjectSchema.parse({ docType: 'press_release', publishedAt: '2026-09-04', intendedAudience: ['population', 'business'] });
    assert.deepEqual(r, { docType: 'press_release', publishedAt: '2026-09-04', intendedAudience: ['population', 'business'] });
  });

  test('free strings, a date that does not exist and an empty audience are refused', () => {
    assert.equal(UpdateProjectSchema.safeParse({ docType: 'пресс-релиз' }).success, false);
    assert.equal(UpdateProjectSchema.safeParse({ publishedAt: '2026-02-30' }).success, false);
    assert.equal(UpdateProjectSchema.safeParse({ publishedAt: '04.09.2026' }).success, false);
    assert.equal(UpdateProjectSchema.safeParse({ intendedAudience: [] }).success, false);
    assert.equal(UpdateProjectSchema.safeParse({ intendedAudience: ['citizens'] }).success, false);
  });

  test('null clears; an omitted field is absent, not defaulted', () => {
    assert.deepEqual(UpdateProjectSchema.parse({ docType: null, intendedAudience: null }), { docType: null, intendedAudience: null });
    const r = UpdateProjectSchema.parse({ title: 'x' });
    for (const k of ['docType', 'publishedAt', 'intendedAudience']) assert.equal(k in r, false, `${k} absent`);
  });

  test('creation takes the same fields and no audience by default — the default per type is the UI\'s', () => {
    const r = CreateProjectSchema.parse({ title: 'x', docType: 'mpr' });
    assert.equal(r.docType, 'mpr');
    assert.equal(r.intendedAudience, undefined);
  });
});
