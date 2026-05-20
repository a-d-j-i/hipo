// Hipo's Deno backend entry. Most of the boot boilerplate (security
// headers, CORS, X-Hipo-Token gate, static SPA fallback, Deno.serve
// with a parseable READY line) lives in @hipo/server-deploy — this
// file just supplies the hipo-specific pieces (config, DB open,
// session middleware, hipo routes + vault routes).
//
// Shape 2 ("hipo as a regular web app with a backend") runs this
// same entry. The router stays runnable in-page (Worker) too — see
// apps/frontend/src/in-page-worker.ts.

import { serve } from "@hipo/server-deploy";
import { gzipped } from "@hipo/backup";
import { binaryFormat } from "@hipo/sqlite/binary-format-deno";
import { config } from "./config.ts";
import { openDb } from "./db/client.ts";
import { type AppState, sessionMiddleware } from "./middleware/session.ts";
import { registerAllRoutes } from "./routes/index.ts";

const { db, client, dbPath } = await openDb();
// Envelope format = gzipped raw SQLite file. Same identifier
// ("binary-gzip") as the in-page Worker so a backup taken on the
// Deno shape can be restored on the in-page shape and vice versa.
const backupFormat = gzipped(binaryFormat({ client, dbPath }));

await serve<AppState>({
  port: config.port,
  cors: {
    // Cross-origin only matters when a browser at the Vite dev port
    // bypasses the proxy and hits the backend directly.
    allowedOrigins: new Set([
      "http://localhost:1420",
      "http://127.0.0.1:1420",
    ]),
    credentials: true,
  },
  localToken: config.authToken,
  staticDir: config.staticDir,
  build(app) {
    app.use(sessionMiddleware(db));
    registerAllRoutes(app, { backupFormat });
  },
});
