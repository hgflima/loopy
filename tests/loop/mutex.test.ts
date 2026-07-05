import { describe, expect, it } from "vitest";
import { createMutex } from "../../src/loop/mutex";

describe("createMutex", () => {
  it("starts unlocked", () => {
    const m = createMutex();
    expect(m.locked).toBe(false);
  });

  it("acquire resolves immediately when uncontended", async () => {
    const m = createMutex();
    const release = await m.acquire();
    expect(m.locked).toBe(true);
    release();
    expect(m.locked).toBe(false);
  });

  it("serializes concurrent acquisitions in FIFO order", async () => {
    const m = createMutex();
    const order: number[] = [];

    // First acquire — gets the lock immediately.
    const r1 = await m.acquire();
    order.push(1);

    // Second and third acquire — queued (FIFO).
    const p2 = m.acquire().then((release) => {
      order.push(2);
      return release;
    });
    const p3 = m.acquire().then((release) => {
      order.push(3);
      return release;
    });

    // Release first — should grant to p2.
    r1();
    const r2 = await p2;

    // Release second — should grant to p3.
    r2();
    const r3 = await p3;
    r3();

    expect(order).toEqual([1, 2, 3]);
    expect(m.locked).toBe(false);
  });

  it("multiple sequential acquire/release cycles work", async () => {
    const m = createMutex();
    for (let i = 0; i < 5; i++) {
      const release = await m.acquire();
      expect(m.locked).toBe(true);
      release();
      expect(m.locked).toBe(false);
    }
  });

  it("release is idempotent-safe (double release does not corrupt state)", async () => {
    const m = createMutex();
    const r1 = await m.acquire();
    r1();
    // A second call to release when unlocked should not throw or corrupt.
    // (No queue, already unlocked — this is a no-op by design.)
    expect(m.locked).toBe(false);
  });

  it("handles high contention (many waiters) without deadlock", async () => {
    const m = createMutex();
    const N = 50;
    const order: number[] = [];

    const r0 = await m.acquire();
    const promises = Array.from({ length: N }, (_, i) =>
      m.acquire().then((release) => {
        order.push(i);
        return release;
      }),
    );

    // Release the initial lock — chain reaction.
    r0();

    // Each waiter releases for the next one.
    for (const p of promises) {
      const release = await p;
      release();
    }

    expect(order).toEqual(Array.from({ length: N }, (_, i) => i));
    expect(m.locked).toBe(false);
  });
});
