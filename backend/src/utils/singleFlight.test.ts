import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { singleFlight } from './singleFlight';
import { ConflictError } from './errors';

// The guard against a second concurrent LLM run on one project. A key that is
// never released would block that project for good, so the release path on
// failure is tested as carefully as the refusal.

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('singleFlight', () => {
  test('a concurrent second call for the same key gets 409 with the given message', async () => {
    const run = singleFlight((id) => `busy ${id}`);
    const first = deferred<string>();
    const a = run(7, () => first.promise);

    await assert.rejects(run(7, async () => 'second'), (err: unknown) => {
      assert.ok(err instanceof ConflictError);
      assert.equal(err.statusCode, 409);
      assert.equal(err.message, 'busy 7');
      return true;
    });

    first.resolve('first');
    assert.equal(await a, 'first');
  });

  test('another key is not blocked', async () => {
    const run = singleFlight((id) => `busy ${id}`);
    const first = deferred<string>();
    const a = run(1, () => first.promise);
    assert.equal(await run(2, async () => 'other'), 'other');
    first.resolve('done');
    await a;
  });

  test('the key is released after success', async () => {
    const run = singleFlight((id) => `busy ${id}`);
    await run(3, async () => 'one');
    assert.equal(await run(3, async () => 'two'), 'two');
  });

  test('the key is released after the first call fails, and the error propagates', async () => {
    const run = singleFlight((id) => `busy ${id}`);
    const first = deferred<string>();
    const a = run(4, () => first.promise);
    first.reject(new Error('model down'));
    await assert.rejects(a, /model down/);
    assert.equal(await run(4, async () => 'retry'), 'retry');
  });

  test('a function that throws synchronously still releases the key', async () => {
    const run = singleFlight((id) => `busy ${id}`);
    await assert.rejects(run(5, () => { throw new Error('sync'); }), /sync/);
    assert.equal(await run(5, async () => 'after'), 'after');
  });
});
