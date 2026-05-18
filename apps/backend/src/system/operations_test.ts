// Unit tests for /api/system/status. Doesn't hit the router — calls
// `do_getSystemStatus` directly. Browser-shape coverage lives on the
// frontend (Phase 6 manual smoke + future Playwright milestone).

import { assert, assertEquals } from "jsr:@std/assert@^1.0";
import { STATUS_SCHEMA_VERSION } from "@hipo/server";
import { do_getSystemStatus } from "./operations.ts";
import type { AppCtx } from "../middleware/session.ts";

// The op doesn't touch ctx today — pass a stub. Keep this lazy in case
// a future signature change needs richer fields.
const stubCtx = {} as AppCtx;

Deno.test("system.status: schema version + framework version present", async () => {
  const s = await do_getSystemStatus(stubCtx);
  assertEquals(s.status_schema_version, STATUS_SCHEMA_VERSION);
  assert(typeof s.framework_version === "string");
});

Deno.test("system.status: Deno runtime reports shape=server + libsql-local", async () => {
  const s = await do_getSystemStatus(stubCtx);
  assertEquals(s.shape, "server");
  assertEquals(s.storage.backend, "libsql-local");
});

Deno.test("system.status: server shape clears cleared_by_browser_data_clear", async () => {
  const s = await do_getSystemStatus(stubCtx);
  assertEquals(s.risk_flags.cleared_by_browser_data_clear, false);
});

Deno.test("system.status: phase-6 has no backup targets configured", async () => {
  const s = await do_getSystemStatus(stubCtx);
  assertEquals(s.backups.targets.length, 0);
  assertEquals(s.risk_flags.no_backup_configured, true);
  assertEquals(s.risk_flags.survives_device_loss_via_backup, false);
});
