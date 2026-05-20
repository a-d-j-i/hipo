// Web Lock helpers for "only one tab owns the DB" coordination.
//
// The hosted shape opens a single OPFS sync access handle per origin.
// If two tabs both try to boot, the second tab's Worker can't acquire
// the handle and the app silently diverges. We use a named Web Lock
// (`hipo-db` by default) as the coordination primitive: the first tab
// in acquires it for the page lifetime; subsequent tabs see the lock
// held and render an "already open elsewhere" modal until the holder
// closes.
//
// Browser-only — Web Locks API isn't available in Deno or in a Service
// Worker. The Tauri shape is single-window so the probe always succeeds
// (the API exists in webkit2gtk; cost is one async call at boot).

export const DEFAULT_DB_LOCK_NAME = "hipo-db";

export type LockAcquireResult =
  | { acquired: true; release: () => void }
  | { acquired: false };

/**
 * Try to acquire the named lock without blocking. On success the lock
 * is held for the page lifetime (until `release()` is called, or the
 * page unloads — browsers release Web Locks on page teardown).
 *
 * Uses the held-promise pattern: navigator.locks.request runs its
 * callback while the lock is held; the lock releases when the
 * callback's returned promise resolves. We never resolve that promise
 * from inside; only the caller's `release()` triggers it.
 */
export function tryAcquireLock(
  name = DEFAULT_DB_LOCK_NAME,
): Promise<LockAcquireResult> {
  return new Promise((resolve) => {
    let releaseHold: (() => void) | null = null;
    const holdPromise = new Promise<void>((res) => {
      releaseHold = res;
    });

    void navigator.locks.request(
      name,
      { mode: "exclusive", ifAvailable: true },
      (lock) => {
        if (!lock) {
          resolve({ acquired: false });
          return;
        }
        resolve({
          acquired: true,
          release: () => releaseHold?.(),
        });
        return holdPromise;
      },
    );
  });
}

/**
 * Poll `navigator.locks.query()` until the named lock is no longer
 * held, then call `onReleased()`. Returns a `stop()` function that
 * cancels further polling.
 *
 * Web Locks has no event API for "lock released," so polling is the
 * only option. 1 s default cadence is cheap (one structured-clone
 * round-trip) and the UX target ("modal dismisses shortly after the
 * other tab closes") tolerates a second of latency.
 */
export function observeLockReleased(
  onReleased: () => void,
  options: { name?: string; intervalMs?: number } = {},
): () => void {
  const { name = DEFAULT_DB_LOCK_NAME, intervalMs = 1000 } = options;
  let stopped = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const state = await navigator.locks.query();
      const held = (state.held ?? []).some((entry) => entry.name === name);
      if (!held) {
        onReleased();
        return;
      }
    } catch {
      // Web Locks API absent or threw — stop silently. Caller's modal
      // remains; user can refresh manually.
      return;
    }
    timeoutId = setTimeout(() => {
      void tick();
    }, intervalMs);
  };
  void tick();

  return () => {
    stopped = true;
    if (timeoutId !== null) clearTimeout(timeoutId);
  };
}
