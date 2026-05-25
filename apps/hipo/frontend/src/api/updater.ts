import { Modal, notification } from "antd";

type Options = {
  /**
   * `silent` is the startup path: errors and "no update available" are
   * not surfaced. Manual checks from the Settings page pass `silent: false`
   * so the user gets feedback regardless of the outcome.
   */
  silent?: boolean;
  /**
   * Translated copy passed by the caller so this module stays React-free.
   * The defaults are English fallbacks if no translations are provided.
   */
  copy?: Partial<{
    upToDate: string;
    checkFailed: string;
    updateAvailable: (version: string) => string;
    updateBodyFallback: string;
    install: string;
    later: string;
    updateFailed: string;
  }>;
};

const defaults = {
  upToDate: "You're on the latest version.",
  checkFailed: "Couldn't reach the update server.",
  updateAvailable: (v: string) => `Update available — ${v}`,
  updateBodyFallback: "A new version is ready. Install it and restart now?",
  install: "Install and restart",
  later: "Later",
  updateFailed: "Update failed",
};

/**
 * Asks the updater plugin whether a newer signed bundle is available.
 *
 * Startup callers pass `silent: true` so a flaky network doesn't pester the
 * user. The Settings page passes `silent: false` so the user always gets
 * confirmation that the check ran.
 *
 * `main.tsx` gates this on `window.__TAURI_INTERNALS__` — outside the Tauri
 * shell the Tauri plugin imports would throw, so don't call this in a
 * browser context.
 */
export async function checkForUpdates(opts: Options = {}): Promise<void> {
  const copy = { ...defaults, ...(opts.copy ?? {}) };
  const silent = opts.silent !== false;

  // Defer dynamic imports so the Tauri-only modules stay out of the browser
  // bundle.
  const [{ check }, { relaunch }] = await Promise.all([
    import("@tauri-apps/plugin-updater"),
    import("@tauri-apps/plugin-process"),
  ]);

  let update: Awaited<ReturnType<typeof check>> = null;
  try {
    update = await check();
  } catch (err) {
    console.warn("[hipo] update check failed:", err);
    if (!silent) {
      notification.error({
        message: copy.checkFailed,
        description: String(err),
        duration: 8,
      });
    }
    return;
  }

  if (!update) {
    if (!silent) {
      notification.success({ message: copy.upToDate, duration: 4 });
    }
    return;
  }

  Modal.confirm({
    title: copy.updateAvailable(update.version),
    content:
      update.body && update.body.trim() !== ""
        ? update.body
        : copy.updateBodyFallback,
    okText: copy.install,
    cancelText: copy.later,
    width: 480,
    onOk: async () => {
      try {
        await update.downloadAndInstall();
        await relaunch();
      } catch (err) {
        notification.error({
          message: copy.updateFailed,
          description: String(err),
          duration: 10,
        });
      }
    },
  });
}
