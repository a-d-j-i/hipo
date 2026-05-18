// Hipo's full route surface, registered onto a Router<AppState>.
// Used by both the Deno server (apps/backend/src/server.ts) and the
// in-page Worker (apps/frontend/src/in-page-worker.ts).

import type { Router } from "@hipo/server";
import type { AppState } from "../middleware/session.ts";
import { registerHealthRoutes } from "./health.ts";
import { registerSystemRoutes } from "./system.ts";
import { registerAuthRoutes } from "./auth.ts";
import { registerPartyRoutes } from "./parties.ts";
import { registerLoanRoutes } from "./loans.ts";
import { registerPaymentRoutes } from "./payments.ts";
import { registerPayoutRoutes } from "./payouts.ts";
import { registerAuditRoutes } from "./audit.ts";

export function registerAllRoutes(app: Router<AppState>) {
  registerHealthRoutes(app);
  registerSystemRoutes(app);
  registerAuthRoutes(app);
  registerPartyRoutes(app);
  registerLoanRoutes(app);
  registerPaymentRoutes(app);
  registerPayoutRoutes(app);
  registerAuditRoutes(app);
}
