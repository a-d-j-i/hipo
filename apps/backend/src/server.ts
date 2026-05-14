import { Hono } from "hono";
import { cors } from "hono/cors";
import { config } from "./config.ts";
import { openDb } from "./db/client.ts";
import { errorHandler } from "./error_handler.ts";
import {
  type AppEnv,
  requireLocalToken,
  sessionMiddleware,
} from "./middleware/session.ts";
import { auditRoutes } from "./routes/audit.ts";
import { authRoutes, userRoutes } from "./routes/auth.ts";
import { healthRoutes } from "./routes/health.ts";
import { loanRoutes } from "./routes/loans.ts";
import { partyRoutes } from "./routes/parties.ts";
import { paymentRoutes } from "./routes/payments.ts";
import { payoutRoutes } from "./routes/payouts.ts";
import { staticSpa } from "./static.ts";

async function main(): Promise<void> {
  const { db } = await openDb();

  const app = new Hono<AppEnv>();

  app.onError(errorHandler);
  // CORS allowlist. All production shapes are same-origin (Tauri webview
  // hits the sidecar at its own host:port; cloud serves the SPA via
  // staticSpa). Cross-origin only happens when a browser at the Vite dev
  // port bypasses the proxy and hits the backend directly — that's the
  // single legitimate origin we need to allow.
  const ALLOWED_ORIGINS = new Set([
    "http://localhost:1420",
    "http://127.0.0.1:1420",
  ]);
  app.use(
    "*",
    cors({
      origin: (origin) => {
        if (!origin) return null;
        return ALLOWED_ORIGINS.has(origin) ? origin : null;
      },
      credentials: true,
    }),
  );
  app.use("*", requireLocalToken);
  app.use("*", sessionMiddleware(db));

  app.route("/api", healthRoutes);
  app.route("/api/auth", authRoutes);
  app.route("/api/users", userRoutes);
  app.route("/api/parties", partyRoutes);
  app.route("/api/loans", loanRoutes);
  app.route("/api/payments", paymentRoutes);
  app.route("/api/payouts", payoutRoutes);
  app.route("/api/audit", auditRoutes);

  // Static SPA fallback — must be last so it doesn't shadow /api/*.
  app.use("*", staticSpa);

  Deno.serve(
    {
      hostname: "127.0.0.1",
      port: config.port,
      onListen: ({ hostname, port }) => {
        // Single, parseable line so the Tauri shell can read the actual port
        // from stdout once we wire up the sidecar (Phase 6).
        console.log(`HIPO_READY hostname=${hostname} port=${port}`);
      },
    },
    app.fetch,
  );
}

await main();
