// Phase 12 real-env smoke. Verifies the rusqlite + IPC + sqlite-proxy
// path works end-to-end inside the real WebKitGTK/WebView2 webview.
//
// Strategy (mirrors spikes/04-perf-baseline/smoke-inpage.mjs): drive
// the in-page backend by calling `/api/*` through `window.fetch` from
// inside the webview. The Service Worker routes the request to the
// dedicated Worker; the Worker's Drizzle proxy (`@hipo/sqlite/
// client-tauri-bridge`) forwards every SQL op via `postMessage` to
// the main thread, which calls `@tauri-apps/api/core` `invoke()` into
// the Rust `sql_exec` / `sql_query` commands defined in
// `packages/tauri-shell/src/sql.rs`. Every assertion below exercises
// that whole chain.
//
// Run prerequisites:
//   Terminal 1: npm run dev:desktop:e2e
//   Terminal 2: npm run test:e2e:tauri
//
// The Tauri binary opens `<app_data_dir>/hipo.db`; this test does NOT
// wipe that file between runs, so a previous run's admin user will
// trip the setup flow with a 409. The test handles that by skipping
// setup when /api/auth/status reports `needs_setup === false`.

import type { TauriPage } from "@srsholmes/tauri-playwright";
import { test, expect } from "../fixtures";

// Same in-page wrapper used by spikes/04-perf-baseline/smoke-inpage.mjs.
// Mirrors apps/frontend/src/api/http.ts: sends X-Hipo-Token from
// sessionStorage and syncs it from the X-Hipo-Session response header.
const API_HELPER = `
  (() => {
    let authToken = sessionStorage.getItem("hipo:authToken");
    window.__HIPO_API = async (method, path, body) => {
      const headers = {};
      if (body !== undefined) headers["content-type"] = "application/json";
      if (authToken) headers["X-Hipo-Token"] = authToken;
      const r = await fetch(path, {
        method,
        credentials: "include",
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const session = r.headers.get("X-Hipo-Session");
      if (session !== null) {
        authToken = session && session.length > 0 ? session : null;
        if (authToken) sessionStorage.setItem("hipo:authToken", authToken);
        else sessionStorage.removeItem("hipo:authToken");
      }
      const text = await r.text();
      return {
        status: r.status,
        body: text === "" ? null : JSON.parse(text),
      };
    };
  })()
`;

const ADMIN_USER = "admin";
const ADMIN_PASS = "admin12345";

// Boot readiness is two-phase: (1) the SW must be controlling the
// page (so /api/* gets intercepted instead of falling through to
// Vite's :8787 proxy), (2) /api/healthz must return 200 (so the
// Worker is reachable and the DB is open).
//
// We deliberately do NOT wait for any UI element. When the React
// app is rendered inside webkit2gtk under Tauri it can stall in an
// antd-Spin loading state even after the backend is live (separate
// AuthContext quirk, not a Phase 12 concern). Phase 12 is about
// proving the rusqlite + IPC + sqlite-proxy stack works end-to-end,
// not the React rendering.
//
// First-boot is slow (SW install + COI self-reload + Worker spawn);
// warm reloads complete in < 5s. We allow up to 60s on the outer
// loop. Each `tauriPage.evaluate` is independently bounded below
// the plugin's hard-coded 30s IPC cap (server.rs in
// tauri-plugin-playwright 0.2.2).
async function waitForBackendReady(tauriPage: TauriPage): Promise<void> {
  await tauriPage.evaluate(API_HELPER);

  const start = Date.now();
  const deadlineMs = 60_000;
  let lastNote = "";
  while (Date.now() - start < deadlineMs) {
    const probe = await tauriPage.evaluate<{
      sw: boolean;
      healthz: number;
    }>(`(async () => {
      const sw = !!navigator.serviceWorker.controller;
      if (!sw) return { sw: false, healthz: 0 };
      try {
        const r = await Promise.race([
          fetch("/api/healthz").then(r => r.status),
          new Promise((_, rej) => setTimeout(() => rej("t"), 5000)),
        ]);
        return { sw: true, healthz: r };
      } catch { return { sw: true, healthz: 0 }; }
    })()`);
    if (probe.sw && probe.healthz === 200) return;
    lastNote = `sw=${probe.sw} healthz=${probe.healthz}`;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `Backend not ready after ${deadlineMs}ms (last: ${lastNote})`,
  );
}

test("Phase 12 smoke: rusqlite + IPC end-to-end, including reload persistence and backup/restore", async ({
  tauriPage,
}) => {
  // ── Boot handshake ───────────────────────────────────────────────
  await waitForBackendReady(tauriPage);

  // ── Status / setup / login ──────────────────────────────────────
  const status = await tauriPage.evaluate<{
    status: number;
    body: { needs_setup: boolean };
  }>(`window.__HIPO_API("GET", "/api/auth/status")`);
  expect(status.status).toBe(200);

  if (status.body.needs_setup) {
    const setup = await tauriPage.evaluate<{ status: number }>(
      `window.__HIPO_API("POST", "/api/auth/setup", { username: ${JSON.stringify(
        ADMIN_USER,
      )}, password: ${JSON.stringify(ADMIN_PASS)} })`,
    );
    expect(setup.status).toBe(200);
  } else {
    const login = await tauriPage.evaluate<{ status: number }>(
      `window.__HIPO_API("POST", "/api/auth/login", { username: ${JSON.stringify(
        ADMIN_USER,
      )}, password: ${JSON.stringify(ADMIN_PASS)} })`,
    );
    expect(login.status).toBe(200);
  }

  // ── Authenticated read ──────────────────────────────────────────
  const me = await tauriPage.evaluate<{
    status: number;
    body: { username: string };
  }>(`window.__HIPO_API("GET", "/api/auth/me")`);
  expect(me.status).toBe(200);
  expect(me.body.username).toBe(ADMIN_USER);

  // ── Write + read + audit (the load-bearing rusqlite proof) ──────
  const partyName = `Phase12 Smoke ${Date.now()}`;
  const createParty = await tauriPage.evaluate<{
    status: number;
    body: { id: string; name: string };
  }>(
    `window.__HIPO_API("POST", "/api/parties", { name: ${JSON.stringify(
      partyName,
    )} })`,
  );
  expect(createParty.status).toBe(200);
  expect(createParty.body.name).toBe(partyName);

  const listParties = await tauriPage.evaluate<{
    status: number;
    body: { name: string }[];
  }>(`window.__HIPO_API("GET", "/api/parties")`);
  expect(listParties.status).toBe(200);
  expect(listParties.body.some((p) => p.name === partyName)).toBe(true);

  const audit = await tauriPage.evaluate<{
    status: number;
    body: { action: string }[];
  }>(`window.__HIPO_API("GET", "/api/audit?limit=20")`);
  expect(audit.status).toBe(200);
  expect(audit.body.some((row) => row.action === "party.create")).toBe(true);

  // ── Backup snapshot via sql_backup_to_bytes ─────────────────────
  const snapshot = await tauriPage.evaluate<{
    status: number;
    body: { bytes_b64: string };
  }>(`window.__HIPO_API("GET", "/api/backup/snapshot")`);
  expect(snapshot.status).toBe(200);
  expect(typeof snapshot.body.bytes_b64).toBe("string");
  expect(snapshot.body.bytes_b64.length).toBeGreaterThan(0);

  // The Tauri shape's backup format is `gzipped(binaryFormat())` (see
  // apps/frontend/src/in-page-worker.ts), so /api/backup/snapshot
  // returns gzipped SQLite bytes. Check the gzip magic (0x1f 0x8b) and
  // let the restore step below validate the SQLite payload underneath.
  const gzipMagicOk = await tauriPage.evaluate<boolean>(
    `(() => { const bin = atob(${JSON.stringify(snapshot.body.bytes_b64)}); return bin.charCodeAt(0) === 0x1f && bin.charCodeAt(1) === 0x8b; })()`,
  );
  expect(gzipMagicOk).toBe(true);

  // ── Restore the same snapshot via sql_restore_from_bytes ────────
  const restore = await tauriPage.evaluate<{ status: number }>(
    `window.__HIPO_API("POST", "/api/backup/restore", { bytes_b64: ${JSON.stringify(
      snapshot.body.bytes_b64,
    )} })`,
  );
  expect(restore.status).toBe(200);

  // ── Reload, verify persistence (the durable-DB proof) ───────────
  // After restore the live rusqlite connection has been swapped. Reload
  // to re-open everything cleanly — same path the Settings UI takes
  // after `applyRestore`. Then poll /api/healthz again before the
  // first real fetch.
  await tauriPage.reload();
  await waitForBackendReady(tauriPage);

  const meAfter = await tauriPage.evaluate<{
    status: number;
    body: { username: string };
  }>(`window.__HIPO_API("GET", "/api/auth/me")`);
  expect(meAfter.status).toBe(200);
  expect(meAfter.body.username).toBe(ADMIN_USER);

  const partiesAfter = await tauriPage.evaluate<{
    status: number;
    body: { name: string }[];
  }>(`window.__HIPO_API("GET", "/api/parties")`);
  expect(partiesAfter.status).toBe(200);
  expect(partiesAfter.body.some((p) => p.name === partyName)).toBe(true);
});
