// /api/backup/* routes. Snapshot/restore plumbed through a substrate-
// supplied `BackupFormat`; state CRUD is engine-agnostic.

import { type Router, empty, json } from "@hipo/server";
import type { BackupFormat } from "@hipo/backup";
import {
  do_applyDbSnapshot,
  do_configureTarget,
  do_getDbSnapshot,
  do_listBackupTargets,
  do_recordBackup,
  do_recordVerify,
} from "../backup/operations.ts";
import type { AppState } from "../middleware/session.ts";
import type {
  ConfigureTargetInput,
  RecordBackupInput,
  RecordVerifyInput,
  RestoreInput,
} from "../backup/types.ts";

export function registerBackupRoutes(
  app: Router<AppState>,
  format: BackupFormat | null,
) {
  app.get("/api/backup/targets", async (c) =>
    json(await do_listBackupTargets(c.state)),
  );

  app.post("/api/backup/targets/configure", async (c) => {
    const body = (await c.req.json()) as ConfigureTargetInput;
    return json(await do_configureTarget(c.state, body));
  });

  app.post("/api/backup/targets/record-backup", async (c) => {
    const body = (await c.req.json()) as RecordBackupInput;
    return json(await do_recordBackup(c.state, body));
  });

  app.post("/api/backup/targets/record-verify", async (c) => {
    const body = (await c.req.json()) as RecordVerifyInput;
    return json(await do_recordVerify(c.state, body));
  });

  // Snapshot/restore are only available when the runtime supplied a
  // BackupFormat. Cloud / shared-server shapes that don't expose
  // raw-bytes restore can pass `null` and these endpoints respond 501.
  app.get("/api/backup/snapshot", async (c) => {
    if (!format) {
      return new Response(
        JSON.stringify({ error: "snapshot not supported on this runtime" }),
        { status: 501, headers: { "content-type": "application/json" } },
      );
    }
    return json(await do_getDbSnapshot(c.state, format));
  });

  app.post("/api/backup/restore", async (c) => {
    if (!format) {
      return new Response(
        JSON.stringify({ error: "restore not supported on this runtime" }),
        { status: 501, headers: { "content-type": "application/json" } },
      );
    }
    const body = (await c.req.json()) as RestoreInput;
    await do_applyDbSnapshot(c.state, format, body);
    return empty();
  });
}
