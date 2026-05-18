import { Router } from "@hipo/server";
import { gzipped } from "@hipo/backup";
import { binaryFormat } from "@hipo/sqlite/binary-format-deno";
import { config } from "./config.ts";
import { openDb } from "./db/client.ts";
import { cors } from "./middleware/cors.ts";
import {
  type AppState,
  requireLocalToken,
  sessionMiddleware,
} from "./middleware/session.ts";
import { registerAllRoutes } from "./routes/index.ts";
import { staticSpa } from "./static.ts";

async function main(): Promise<void> {
  const { db, client, dbPath } = await openDb();
  // Envelope format = gzipped raw SQLite file. Same identifier
  // ("binary-gzip") as the in-page Worker so a backup taken on the
  // Deno shape can be restored on the in-page shape and vice versa.
  const backupFormat = gzipped(binaryFormat({ client, dbPath }));

  const app = new Router<AppState>();

  // Security headers on every response. CSP is HTML-only (other content
  // types ignore it); the rest are blanket. antd's css-in-js needs
  // 'unsafe-inline' on style-src; scripts never need it.
  const CSP = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");
  app.use(async (c, next) => {
    const res = await next();
    res.headers.set("X-Content-Type-Options", "nosniff");
    res.headers.set("Referrer-Policy", "no-referrer");
    res.headers.set("X-Frame-Options", "DENY");
    const ct = res.headers.get("content-type") ?? "";
    if (ct.startsWith("text/html")) {
      res.headers.set("Content-Security-Policy", CSP);
    }
    return res;
  });

  // CORS allowlist. Production shapes are same-origin; cross-origin only
  // matters when a browser at the Vite dev port bypasses the proxy and
  // hits the backend directly.
  const ALLOWED_ORIGINS = new Set([
    "http://localhost:1420",
    "http://127.0.0.1:1420",
  ]);
  app.use(cors({ allowedOrigins: ALLOWED_ORIGINS, credentials: true }));
  app.use(requireLocalToken);
  app.use(sessionMiddleware(db));

  registerAllRoutes(app, { backupFormat });

  // Static SPA fallback — runs whenever no route matches.
  app.notFound(staticSpa);

  Deno.serve(
    {
      hostname: "127.0.0.1",
      port: config.port,
      onListen: ({ hostname, port }) => {
        // Single, parseable line so the Tauri shell can read the actual port.
        console.log(`HIPO_READY hostname=${hostname} port=${port}`);
      },
    },
    app.fetch,
  );
}

await main();
