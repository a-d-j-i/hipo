// Vault HTTP routes. Mount on any Router whose state satisfies
// VaultState (has db + user, matching the framework's Ctx shape).
//
// Usage:
//   registerVaultRoutes(app);
//
// This registers all /api/vault/* endpoints on the given router.
// In-page Worker shape: vault tables will be created in OPFS too —
// they'll be empty unless the user mints a PAT against in-page,
// which works fine (operates against OPFS like everything else).

import type { Db } from "@hipo/sqlite";
import type { User } from "@hipo/auth";
import { empty, json, type Router } from "@hipo/server";
import { vaultPatMiddleware } from "./middleware.ts";
import {
  do_getVaultBlob,
  do_listVaultPats,
  do_mintVaultPat,
  do_putVaultBlob,
  do_revokeVaultPat,
} from "./operations.ts";
import type { MintPatInput } from "./types.ts";

/** Minimal state shape the vault routes need on the router. */
export type VaultState = { db: Db; user: User | null };

export function registerVaultRoutes<T extends VaultState>(
  app: Router<T>,
): void {
  // Open — no auth. Lets the client verify the server is reachable.
  app.get("/api/vault/health", () => json({ ok: true }));

  // Whoami — PAT-authed. Lets the client verify a PAT is valid.
  // Called by vaultTarget.checkAccess() in @hipo/backup-vault.
  app.get("/api/vault/whoami", vaultPatMiddleware(), (c) => {
    const user = c.state.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthenticated" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    return json({ user_id: user.id, username: user.username });
  });

  // PAT management — session auth only (the user needs to be logged in
  // to mint/list/revoke their own PATs).
  app.post("/api/vault/pats", async (c) => {
    const body = (await c.req.json()) as MintPatInput;
    return json(await do_mintVaultPat(c.state, body));
  });

  app.get("/api/vault/pats", async (c) =>
    json(await do_listVaultPats(c.state)),
  );

  app.delete("/api/vault/pats/:hash", async (c) => {
    await do_revokeVaultPat(c.state, { token_hash: c.params.hash });
    return empty();
  });

  // Blob endpoints — accept session auth OR vault PAT.
  // The PAT middleware runs first; if a Bearer header is present it
  // resolves ctx.user from vault_pats. If absent, the session middleware
  // (already run before these routes are dispatched) has already set
  // ctx.user from the cookie/X-Hipo-Token.
  const patMw = vaultPatMiddleware();

  app.put("/api/vault/blob/:id", patMw, async (c) => {
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const result = await do_putVaultBlob(c.state, {
      blob_id: c.params.id,
      bytes,
    });
    return json(result);
  });

  app.get("/api/vault/blob/:id", patMw, async (c) => {
    const result = await do_getVaultBlob(c.state, { blob_id: c.params.id });
    if (!result) {
      return new Response(null, { status: 404 });
    }
    return new Response(result.bytes.buffer as ArrayBuffer, {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(result.size_bytes),
        "x-vault-updated-at": String(result.updated_at),
      },
    });
  });
}
