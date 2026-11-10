import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { revealSequentially, PERSONA_RESPONSE_DELAY_MS } from './revealSequentially';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('revealSequentially', () => {
  test('the first item is delivered immediately, with no delay', () => {
    const onReveal = vi.fn();
    revealSequentially(['a', 'b'], { onReveal });
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(onReveal).toHaveBeenCalledWith('a', 0);
  });

  test('the second item appears only after PERSONA_RESPONSE_DELAY_MS', () => {
    const onReveal = vi.fn();
    revealSequentially(['a', 'b'], { onReveal });

    vi.advanceTimersByTime(PERSONA_RESPONSE_DELAY_MS - 1);
    expect(onReveal).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(onReveal).toHaveBeenCalledTimes(2);
    expect(onReveal).toHaveBeenNthCalledWith(2, 'b', 1);
  });

  test('order is preserved across many items', () => {
    const seen = [];
    revealSequentially(['a', 'b', 'c', 'd'], { onReveal: (item) => seen.push(item) });
    vi.runAllTimers();
    expect(seen).toEqual(['a', 'b', 'c', 'd']);
  });

  test('onComplete fires exactly once, after the last item', () => {
    const onComplete = vi.fn();
    const onReveal = vi.fn();
    revealSequentially(['a', 'b'], { onReveal, onComplete });
    expect(onComplete).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onReveal).toHaveBeenCalledTimes(2);
  });

  test('a single item is revealed immediately with no artificial delay and no extra timers', () => {
    const onReveal = vi.fn();
    const onComplete = vi.fn();
    revealSequentially(['only'], { onReveal, onComplete });
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1); // synchronous — no pending timer needed
  });

  test('an empty list completes immediately without calling onReveal', () => {
    const onReveal = vi.fn();
    const onComplete = vi.fn();
    revealSequentially([], { onReveal, onComplete });
    expect(onReveal).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  test('cancel() stops any further reveals and never calls onComplete', () => {
    const onReveal = vi.fn();
    const onComplete = vi.fn();
    const cancel = revealSequentially(['a', 'b', 'c'], { onReveal, onComplete });
    expect(onReveal).toHaveBeenCalledTimes(1); // 'a' already delivered synchronously

    cancel();
    vi.runAllTimers();

    expect(onReveal).toHaveBeenCalledTimes(1); // 'b' and 'c' never arrive
    expect(onComplete).not.toHaveBeenCalled();
  });

  test('cancel() is safe to call more than once', () => {
    const cancel = revealSequentially(['a', 'b'], {});
    expect(() => { cancel(); cancel(); }).not.toThrow();
  });

  test('no duplicate reveals even if items are revisited across a long run', () => {
    const seen = [];
    revealSequentially(['a', 'b', 'c'], { onReveal: (item) => seen.push(item) });
    vi.runAllTimers();
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(new Set(seen).size).toBe(seen.length);
  });

  test('a custom delayMs is honored instead of the default', () => {
    const onReveal = vi.fn();
    revealSequentially(['a', 'b'], { delayMs: 1000, onReveal });
    vi.advanceTimersByTime(999);
    expect(onReveal).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(onReveal).toHaveBeenCalledTimes(2);
  });
});
