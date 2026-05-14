/**
 * Distribute `amountCents` among lenders proportionally to their
 * `amountLentCents`, using the largest-remainder method. Returns
 * `[lender_id, share_cents]` aligned with the input order. Sum of shares
 * equals `amountCents` exactly.
 *
 * Tiebreak on equal remainders: ascending `lender_id` (deterministic).
 *
 * Intermediate multiplication uses BigInt to stay i64-safe — the product of
 * two cent amounts can exceed Number.MAX_SAFE_INTEGER for non-trivial
 * principals.
 */
export function splitPayment(
  amountCents: number,
  shares: ReadonlyArray<readonly [number, number]>,
): Array<[number, number]> {
  if (shares.length === 0 || amountCents === 0) {
    return shares.map(([id]) => [id, 0]);
  }
  const principal = shares.reduce((s, [, a]) => s + BigInt(a), 0n);
  if (principal <= 0n) {
    return shares.map(([id]) => [id, 0]);
  }
  const amount = BigInt(amountCents);

  // rows: [lender_id, floorShare, remainder]
  const rows: Array<[number, number, bigint]> = shares.map(([id, amt]) => {
    const numerator = amount * BigInt(amt);
    const floorShare = Number(numerator / principal);
    const remainder = numerator % principal;
    return [id, floorShare, remainder];
  });

  const floorSum = rows.reduce((s, [, f]) => s + f, 0);
  const residual = amountCents - floorSum;

  // Sort indices by descending remainder, tiebreak by ascending lender_id.
  const indices = rows.map((_, i) => i);
  indices.sort((a, b) => {
    const ra = rows[a][2];
    const rb = rows[b][2];
    if (rb > ra) return 1;
    if (rb < ra) return -1;
    return rows[a][0] - rows[b][0];
  });

  const bump = Math.max(residual, 0);
  for (let k = 0; k < bump; k++) {
    rows[indices[k]][1] += 1;
  }

  return rows.map(([id, share]) => [id, share]);
}
