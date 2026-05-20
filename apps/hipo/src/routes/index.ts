// Hipo's full route surface, registered onto a Router<AppState>.
// Used by both the Deno server (apps/hipo/src/server.ts) and the
// in-page Worker (apps/frontend/src/in-page-worker.ts).

import type { Router } from "@hipo/server";
import type { BackupFormat } from "@hipo/backup";
import type { AppState } from "../middleware/session.ts";
import { registerHealthRoutes } from "./health.ts";
import { registerSystemRoutes } from "./system.ts";
import { registerAuthRoutes } from "./auth.ts";
import { registerPartyRoutes } from "./parties.ts";
import { registerLoanRoutes } from "./loans.ts";
import { registerPaymentRoutes } from "./payments.ts";
import { registerPayoutRoutes } from "./payouts.ts";
import { registerAuditRoutes } from "./audit.ts";
import { registerBackupRoutes } from "./backup.ts";
import { registerVaultRoutes } from "@hipo/backup-vault-server";

export type RegisterAllOptions = {
  /** Substrate-supplied DB snapshot/restore. Null on runtimes that
   *  don't expose raw bytes (the snapshot endpoints answer 501). */
  backupFormat?: BackupFormat | null;
};

export function registerAllRoutes(
  app: Router<AppState>,
  opts: RegisterAllOptions = {},
) {
  registerHealthRoutes(app);
  registerSystemRoutes(app);
  registerAuthRoutes(app);
  registerPartyRoutes(app);
  registerLoanRoutes(app);
  registerPaymentRoutes(app);
  registerPayoutRoutes(app);
  registerAuditRoutes(app);
  registerBackupRoutes(app, opts.backupFormat ?? null);
  // Vault routes: PAT-authed blob storage. Tables created via vaultMigrations
  // (version 100+). Works in both Deno-server and in-page Worker shapes.
  registerVaultRoutes(app);
}
