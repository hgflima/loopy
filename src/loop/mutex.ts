/**
 * A simple async mutex (Promise-based FIFO queue).
 *
 * Serializes access to the parent branch: every `acquire()` returns a release
 * function; callers await it before entering the critical section and call
 * `release()` when done. Acquisitions are granted in FIFO order (the queue is
 * a linked list of resolvers). When uncontended (`concurrency: 1`, sequential
 * loop), `acquire()` resolves immediately — zero observable overhead.
 *
 * This is the **one** synchronization primitive the engine uses (T-004). It
 * lives in the step-execution layer, not in `GitPort`, because the mutations
 * it serializes are opaque shell/approval/checks commands run against the
 * workspace root (AD-1: the engine doesn't know they're git commands).
 */

/** A release function returned by {@link Mutex.acquire}. */
export type Release = () => void;

export interface Mutex {
  /** Acquire the lock. Resolves (FIFO) when it's this caller's turn. */
  acquire(): Promise<Release>;
  /** Whether the mutex is currently held. */
  readonly locked: boolean;
}

/**
 * Create a {@link Mutex}. The returned object is a single-holder lock with a
 * FIFO wait queue backed by chained Promises.
 */
export function createMutex(): Mutex {
  let locked = false;
  const queue: Array<() => void> = [];

  function release(): void {
    if (queue.length > 0) {
      // Hand the lock to the next waiter (FIFO).
      const next = queue.shift()!;
      next();
    } else {
      locked = false;
    }
  }

  async function acquire(): Promise<Release> {
    if (!locked) {
      locked = true;
      return release;
    }
    // Already held — enqueue and wait.
    return new Promise<Release>((resolve) => {
      queue.push(() => resolve(release));
    });
  }

  return {
    acquire,
    get locked() {
      return locked;
    },
  };
}

/**
 * Run `fn` inside `mutex` when `mutex` is provided; otherwise run directly.
 * The lock is always released (via `finally`), even if `fn` throws or rejects.
 */
export async function guarded<T>(
  mutex: Mutex | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!mutex) return fn();
  const release = await mutex.acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}
