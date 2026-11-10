/**
 * A counting semaphore with a bounded wait.
 *
 * In-process by design, and that is a real limitation worth stating: it bounds
 * concurrency within one backend process, so running two replicas would double
 * the effective limit. The deployment is a single container (docker compose),
 * and the thing being bounded — how many pooled database connections long
 * rounds may hold at once — is a per-process resource anyway, because the Prisma
 * connection pool is per process. A second replica would bring its own pool of
 * the same size, so the per-process bound stays the right shape.
 */
export class Semaphore {
  private available: number;
  private readonly waiters: (() => void)[] = [];

  constructor(private readonly capacity: number) {
    this.available = capacity;
  }

  /** Slots currently in use — for diagnostics and tests. */
  get inUse(): number {
    return this.capacity - this.available;
  }

  /**
   * Takes a slot, waiting up to `timeoutMs` for one.
   *
   * Returns a release function on success and null on timeout. A bounded wait
   * rather than an immediate refusal, because the work being guarded takes
   * minutes: two users overlapping by a few seconds should queue, not fail.
   * Rather than an unbounded queue, because a request that waits forever is
   * indistinguishable to the user from one that hung.
   */
  async acquire(timeoutMs: number): Promise<(() => void) | null> {
    if (this.available > 0) {
      this.available -= 1;
      return this.release();
    }

    return new Promise<(() => void) | null>((resolve) => {
      let settled = false;

      const onGranted = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // No decrement here: a slot handed over by release() was never returned
        // to the pool, it was transferred. Decrementing again drove `available`
        // negative and inflated the effective limit on every handover — the
        // exact drift the unit test now pins down.
        resolve(this.release());
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        // Drop out of the queue so a later release is not handed to a waiter
        // that has already given up — that would leak a slot permanently.
        const idx = this.waiters.indexOf(onGranted);
        if (idx >= 0) this.waiters.splice(idx, 1);
        resolve(null);
      }, timeoutMs);

      this.waiters.push(onGranted);
    });
  }

  private release(): () => void {
    // Idempotent: the caller releases in a `finally`, and a double release
    // would hand out capacity that does not exist.
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) next();
      else this.available += 1;
    };
  }
}
