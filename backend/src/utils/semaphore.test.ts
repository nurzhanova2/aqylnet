import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Semaphore } from './semaphore';

// Stage E4 item 10: this is what keeps discussion rounds from holding every
// connection in the Prisma pool. A leaked slot would silently shrink the limit
// until rounds stopped running at all, so the release path is tested as
// carefully as the acquire path.

const tick = () => new Promise((r) => setTimeout(r, 10));

describe('Semaphore', () => {
  test('hands out up to capacity without waiting', async () => {
    const s = new Semaphore(2);
    const a = await s.acquire(50);
    const b = await s.acquire(50);
    assert.ok(a && b);
    assert.equal(s.inUse, 2);
  });

  test('refuses past capacity once the wait elapses', async () => {
    const s = new Semaphore(1);
    const a = await s.acquire(50);
    assert.ok(a);
    const started = Date.now();
    const b = await s.acquire(60);
    assert.equal(b, null, 'the second caller must be refused, not queued forever');
    assert.ok(Date.now() - started >= 50, 'it waited before refusing');
  });

  test('a released slot is handed to a waiter', async () => {
    const s = new Semaphore(1);
    const a = await s.acquire(50);
    assert.ok(a);

    let granted = false;
    const pending = s.acquire(1_000).then((r) => { granted = r !== null; return r; });

    await tick();
    assert.equal(granted, false, 'still waiting while the slot is held');

    a();
    const b = await pending;
    assert.ok(b, 'the waiter got the released slot');
    assert.equal(s.inUse, 1);
  });

  test('releasing twice does not invent capacity', async () => {
    // The caller releases in a `finally`; a double release would hand out a
    // slot that does not exist and the limit would drift upward over time.
    const s = new Semaphore(1);
    const a = await s.acquire(50);
    assert.ok(a);
    a();
    a();
    assert.equal(s.inUse, 0);

    const b = await s.acquire(50);
    assert.ok(b);
    assert.equal(await s.acquire(20), null, 'capacity is still 1, not 2');
  });

  test('a timed-out waiter does not swallow a later release', async () => {
    // The dangerous leak: if a waiter that already gave up stays in the queue,
    // the next release is handed to nobody and the slot is gone for good.
    const s = new Semaphore(1);
    const a = await s.acquire(50);
    assert.ok(a);

    assert.equal(await s.acquire(30), null, 'the waiter gives up');
    a();

    const c = await s.acquire(50);
    assert.ok(c, 'the slot came back after the abandoned wait');
    assert.equal(s.inUse, 1);
  });

  test('slots are reusable across many sequential holders', async () => {
    const s = new Semaphore(2);
    for (let i = 0; i < 20; i++) {
      const r = await s.acquire(50);
      assert.ok(r, `acquire ${i} should succeed`);
      r();
    }
    assert.equal(s.inUse, 0);
  });
});
