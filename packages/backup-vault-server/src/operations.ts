// Vault do_* operations. Each function follows the project's "Testability
// pattern": pure function taking (ctx, args) against any Drizzle DB. Route
// handlers call these and return JSON; tests call them directly.
//
// Auth model:
//   - PAT management (mint/list/revoke) requires a session-authed user.
//   - Blob put/get accepts either session auth OR a resolved PAT user
//     (the PAT middleware sets ctx.user before these are called).

import { and, eq } from "drizzle-orm";
import type { Ctx } from "@hipo/auth";
import { requireAuth, nowSecs } from "@hipo/auth";
import { writeAudit } from "@hipo/audit";
import { badRequest, notFound } from "@hipo/server";
import { vaultPats, vaultBlobs } from "./schema.ts";
import type { MintPatInput, MintPatResponse, PatView } from "./types.ts";

// ---------------------------------------------------------------------------
// SHA-256 via Web Crypto — works in Deno and browser
// ---------------------------------------------------------------------------

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomTokenHex(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// PAT management
// ---------------------------------------------------------------------------

export async function do_mintVaultPat(
  ctx: Ctx,
  args: MintPatInput,
): Promise<MintPatResponse> {
  const user = requireAuth(ctx);
  const token = randomTokenHex();
  const tokenHash = await sha256Hex(token);
  const createdAt = nowSecs();
  const label = args.label?.trim() || null;

  await ctx.db.transaction(async (tx) => {
    await tx.insert(vaultPats).values({
      tokenHash,
      userId: user.id,
      label,
      createdAt,
    });
    await writeAudit(tx, user.id, "vault.pat.mint", "vault_pat", null, {
      token_hash: tokenHash,
      label,
    });
  });

  return { token, token_hash: tokenHash, label, created_at: createdAt };
}

export async function do_listVaultPats(ctx: Ctx): Promise<PatView[]> {
  const user = requireAuth(ctx);
  const rows = await ctx.db
    .select()
    .from(vaultPats)
    .where(eq(vaultPats.userId, user.id));
  return rows.map((r) => ({
    token_hash: r.tokenHash,
    label: r.label,
    created_at: r.createdAt,
    last_used_at: r.lastUsedAt,
  }));
}

export async function do_revokeVaultPat(
  ctx: Ctx,
  args: { token_hash: string },
): Promise<void> {
  const user = requireAuth(ctx);
  const { token_hash } = args;
  if (!token_hash) throw badRequest("token_hash is required");

  await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(vaultPats)
      .where(
        and(
          eq(vaultPats.tokenHash, token_hash),
          eq(vaultPats.userId, user.id),
        ),
      )
      .limit(1);
    if (rows.length === 0) throw notFound("PAT not found");

    await tx
      .delete(vaultPats)
      .where(
        and(
          eq(vaultPats.tokenHash, token_hash),
          eq(vaultPats.userId, user.id),
        ),
      );
    await writeAudit(tx, user.id, "vault.pat.revoke", "vault_pat", null, {
      token_hash,
    });
  });
}

// ---------------------------------------------------------------------------
// Blob put / get — accept session or PAT user (PAT middleware resolves ctx.user)
// ---------------------------------------------------------------------------

export async function do_putVaultBlob(
  ctx: Ctx,
  args: { blob_id: string; bytes: Uint8Array },
): Promise<{ size_bytes: number; updated_at: number }> {
  const user = requireAuth(ctx);
  const { blob_id, bytes } = args;
  if (!blob_id) throw badRequest("blob_id is required");
  if (!bytes || bytes.length === 0) throw badRequest("bytes is required");

  const sizeBytes = bytes.length;
  const updatedAt = nowSecs();

  await ctx.db.transaction(async (tx) => {
    await tx
      .insert(vaultBlobs)
      .values({
        userId: user.id,
        blobId: blob_id,
        bytes,
        sizeBytes,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: [vaultBlobs.userId, vaultBlobs.blobId],
        set: {
          bytes,
          sizeBytes,
          updatedAt,
        },
      });
    await writeAudit(tx, user.id, "vault.blob.put", "vault_blob", null, {
      blob_id,
      size_bytes: sizeBytes,
    });
  });

  return { size_bytes: sizeBytes, updated_at: updatedAt };
}

export async function do_getVaultBlob(
  ctx: Ctx,
  args: { blob_id: string },
): Promise<{ bytes: Uint8Array; size_bytes: number; updated_at: number } | null> {
  const user = requireAuth(ctx);
  const { blob_id } = args;
  if (!blob_id) throw badRequest("blob_id is required");

  const rows = await ctx.db
    .select()
    .from(vaultBlobs)
    .where(
      and(
        eq(vaultBlobs.userId, user.id),
        eq(vaultBlobs.blobId, blob_id),
      ),
    )
    .limit(1);

  if (rows.length === 0) return null;
  const row = rows[0];
  // customType fromDriver normalises to Uint8Array.
  return {
    bytes: row.bytes,
    size_bytes: row.sizeBytes,
    updated_at: row.updatedAt,
  };
}
