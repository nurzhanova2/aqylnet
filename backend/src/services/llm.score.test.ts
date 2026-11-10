import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeOverallScore } from './llm.service';

// The overall score used to come from the model as the FIRST field of the audit
// JSON — named before any analysis existed. Repeated runs on an identical
// transcript pinned it at 42 while the axes it was supposed to summarise moved
// by 40 points. These tests lock in the property that broke back then: the
// overall must follow its own breakdown.

const axes = (...values: number[]) => values.map((value) => ({ value }));
// Verified findings: since A1 stage 0a only those (and checklist absences) can
// cap, so the cap tests below are about verified ones.
const issues = (...severities: string[]) => severities.map((severity) => ({ severity, quoteVerified: true }));

describe('computeOverallScore', () => {
  test('is the mean of the axes when nothing serious was found', () => {
    assert.equal(computeOverallScore(axes(60, 80, 70, 50), issues('Medium', 'Low')), 65);
  });

  test('moves when an axis moves — the regression that motivated this', () => {
    const before = computeOverallScore(axes(65, 35, 50, 20), issues('Medium'));
    const after  = computeOverallScore(axes(65, 75, 50, 25), issues('Medium'));
    assert.notEqual(before, after, 'a 40-point swing in one axis must change the overall');
    assert.ok(after! > before!, 'a better axis must raise the overall, not lower it');
  });

  test('a Critical issue caps the result however good the axes look', () => {
    assert.equal(computeOverallScore(axes(95, 95, 95, 95), issues('Critical')), 55);
  });

  test('a High issue caps lower than perfect but above the Critical cap', () => {
    assert.equal(computeOverallScore(axes(95, 95, 95, 95), issues('High')), 75);
  });

  test('caps are a ceiling, not a floor — a weak document stays weak', () => {
    assert.equal(computeOverallScore(axes(20, 20, 20, 20), issues('Critical')), 20);
  });

  test('Critical wins over High when both are present', () => {
    assert.equal(computeOverallScore(axes(90, 90, 90, 90), issues('High', 'Critical')), 55);
  });

  test('no axes means no score — null, never a fabricated zero', () => {
    assert.equal(computeOverallScore([], issues('Critical')), null);
  });

  test('result stays inside 0..100 for out-of-range axis values', () => {
    const high = computeOverallScore(axes(300, 300), []);
    const low  = computeOverallScore(axes(-50, -50), []);
    assert.equal(high, 100);
    assert.equal(low, 0);
  });

  test('rounds to a whole number', () => {
    assert.equal(computeOverallScore(axes(65, 75, 50, 25), []), 54);
  });
});

// A1 stage 0a: the cap trusts only what was checked. Every case has the mean
// (90) well above both caps, so a test that passes cannot be explained by
// "the cap happened to equal the mean".
describe('computeOverallScore — only verified findings and coded absences cap', () => {
  test('an unverified Critical is shown but does not cap', () => {
    assert.equal(computeOverallScore(axes(90, 90, 90, 90), [{ severity: 'Critical', quoteVerified: false }]), 90);
    assert.equal(computeOverallScore(axes(90, 90, 90, 90), [{ severity: 'Critical', quoteVerified: null }]), 90);
  });

  test('a verified Critical caps at 55', () => {
    assert.equal(computeOverallScore(axes(90, 90, 90, 90), [{ severity: 'Critical', quoteVerified: true }]), 55);
  });

  test('a checklist absence caps by the severity code gave it, without any quote', () => {
    assert.equal(computeOverallScore(axes(90, 90, 90, 90), [{ severity: 'High', kind: 'absence', checkId: 'decision-reason', quoteVerified: null }]), 75);
  });

  test('an "absence" with an id the checklist does not know does not cap', () => {
    assert.equal(computeOverallScore(axes(90, 90, 90, 90), [{ severity: 'Critical', kind: 'absence', checkId: 'invented-check', quoteVerified: null }]), 90);
  });

  test('a contradiction never caps, even with both quotes verified — it is only a possible one', () => {
    assert.equal(computeOverallScore(axes(90, 90, 90, 90), [{ severity: 'High', kind: 'contradiction', quoteVerified: true, quote2Verified: true }]), 90);
  });
});
