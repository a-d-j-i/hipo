import { afterEach, describe, expect, it, vi } from "vitest";
import { observeLockReleased, tryAcquireLock } from "@hipo/server";

// JSDOM has no Web Locks API; stub navigator.locks per test.

type LockCallback = (lock: { name: string } | null) => Promise<void> | void;
type LockState = { held: Array<{ name: string }> };

function installFakeLocks(initial?: { held?: Array<{ name: string }> }) {
  const held = new Set<string>();
  for (const entry of initial?.held ?? []) held.add(entry.name);

  const locks = {
    request: vi.fn(
      async (
        name: string,
        opts: { mode: string; ifAvailable?: boolean },
        cb: LockCallback,
      ) => {
        if (opts.ifAvailable && held.has(name)) {
          await cb(null);
          return;
        }
        held.add(name);
        try {
          const result = cb({ name });
          if (result instanceof Promise) await result;
        } finally {
          held.delete(name);
        }
      },
    ),
    query: vi.fn(
      async (): Promise<LockState> => ({
        held: Array.from(held).map((name) => ({ name })),
      }),
    ),
  };
  Object.defineProperty(globalThis.navigator, "locks", {
    value: locks,
    configurable: true,
  });
  return {
    locks,
    forceHold(name: string) {
      held.add(name);
    },
    forceRelease(name: string) {
      held.delete(name);
    },
  };
}

afterEach(() => {
  delete (globalThis.navigator as { locks?: unknown }).locks;
});

describe("tryAcquireLock", () => {
  it("acquires when the lock is free", async () => {
    installFakeLocks();
    const result = await tryAcquireLock("hipo-db");
    expect(result.acquired).toBe(true);
    if (result.acquired) result.release();
  });

  it("returns acquired:false when the lock is already held", async () => {
    installFakeLocks({ held: [{ name: "hipo-db" }] });
    const result = await tryAcquireLock("hipo-db");
    expect(result.acquired).toBe(false);
  });

  it("releases when release() is called so a follower can acquire", async () => {
    installFakeLocks();
    const first = await tryAcquireLock("hipo-db");
    expect(first.acquired).toBe(true);

    // Second probe should see the lock held.
    const blocked = await tryAcquireLock("hipo-db");
    expect(blocked.acquired).toBe(false);

    if (first.acquired) first.release();
    // Yield once so the held set sees the deletion before the next probe.
    await new Promise((r) => setTimeout(r, 0));
    const reacquired = await tryAcquireLock("hipo-db");
    expect(reacquired.acquired).toBe(true);
    if (reacquired.acquired) reacquired.release();
  });
});

describe("observeLockReleased", () => {
  it("fires when the named lock disappears from the held set", async () => {
    const env = installFakeLocks({ held: [{ name: "hipo-db" }] });
    const onReleased = vi.fn();

    const stop = observeLockReleased(onReleased, {
      name: "hipo-db",
      intervalMs: 5,
    });

    // First poll: lock still held → no call yet.
    await new Promise((r) => setTimeout(r, 20));
    expect(onReleased).not.toHaveBeenCalled();

    env.forceRelease("hipo-db");
    await new Promise((r) => setTimeout(r, 20));
    expect(onReleased).toHaveBeenCalledTimes(1);

    stop();
  });

  it("stop() cancels further polling", async () => {
    installFakeLocks({ held: [{ name: "hipo-db" }] });
    const onReleased = vi.fn();
    const stop = observeLockReleased(onReleased, {
      name: "hipo-db",
      intervalMs: 5,
    });
    stop();
    await new Promise((r) => setTimeout(r, 30));
    expect(onReleased).not.toHaveBeenCalled();
  });

  it("ignores unrelated locks", async () => {
    installFakeLocks({ held: [{ name: "other" }] });
    const onReleased = vi.fn();
    const stop = observeLockReleased(onReleased, {
      name: "hipo-db",
      intervalMs: 5,
    });
    await new Promise((r) => setTimeout(r, 20));
    // hipo-db never held → onReleased called on the first tick.
    expect(onReleased).toHaveBeenCalledTimes(1);
    stop();
  });
});
