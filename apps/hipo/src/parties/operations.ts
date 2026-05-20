import { and, asc, eq, isNull } from "drizzle-orm";
import { writeAudit } from "@hipo/audit";
import {
  type Ctx,
  nowSecs,
  requireAdmin,
  requireAuth,
} from "@hipo/auth";
import { parties } from "../db/schema.ts";
import { notFound } from "@hipo/server";
import { type PartyInput, publicParty, type Party } from "./types.ts";
import { normalizeOpt, validateName } from "./validators.ts";

async function selectActive(ctx: Ctx, id: number) {
  const rows = await ctx.db
    .select()
    .from(parties)
    .where(and(eq(parties.id, id), isNull(parties.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function doListParties(ctx: Ctx): Promise<Party[]> {
  requireAuth(ctx);
  const rows = await ctx.db
    .select()
    .from(parties)
    .where(isNull(parties.deletedAt))
    .orderBy(asc(parties.name));
  return rows.map(publicParty);
}

export async function doGetParty(
  ctx: Ctx,
  args: { id: number },
): Promise<Party> {
  requireAuth(ctx);
  const row = await selectActive(ctx, args.id);
  if (!row) throw notFound("party not found");
  return publicParty(row);
}

export async function doCreateParty(
  ctx: Ctx,
  args: PartyInput,
): Promise<Party> {
  const me = requireAuth(ctx);
  validateName(args.name);
  const name = args.name.trim();
  const externalRef = normalizeOpt(args.externalRef);
  const notes = normalizeOpt(args.notes);
  const now = nowSecs();

  return await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(parties)
      .values({
        name,
        externalRef,
        notes,
        createdAt: now,
        createdBy: me.id,
      })
      .returning();
    const pub = publicParty(row);
    await writeAudit(tx, me.id, "party.create", "party", row.id, {
      after: pub,
    });
    return pub;
  });
}

export async function doUpdateParty(
  ctx: Ctx,
  args: { id: number } & PartyInput,
): Promise<Party> {
  const me = requireAuth(ctx);
  validateName(args.name);

  const before = await selectActive(ctx, args.id);
  if (!before) throw notFound("party not found");

  const name = args.name.trim();
  const externalRef = normalizeOpt(args.externalRef);
  const notes = normalizeOpt(args.notes);

  return await ctx.db.transaction(async (tx) => {
    await tx
      .update(parties)
      .set({ name, externalRef, notes })
      .where(eq(parties.id, args.id));
    const after: Party = {
      id: args.id,
      name,
      external_ref: externalRef,
      notes,
      created_at: before.createdAt,
      created_by: before.createdBy,
    };
    await writeAudit(tx, me.id, "party.update", "party", args.id, {
      before: publicParty(before),
      after,
    });
    return after;
  });
}

export async function doDeleteParty(
  ctx: Ctx,
  args: { id: number },
): Promise<void> {
  const me = requireAdmin(ctx);
  const before = await selectActive(ctx, args.id);
  if (!before) throw notFound("party not found");

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(parties)
      .set({ deletedAt: nowSecs() })
      .where(eq(parties.id, args.id));
    await writeAudit(tx, me.id, "party.delete", "party", args.id, {
      before: publicParty(before),
    });
  });
}
