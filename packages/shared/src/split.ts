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
// Reserved sentinel id used by `splitDebtorPayment` to capture the slice
// of interest that flows back to the lender pool. Party ids are
// AUTOINCREMENT positives starting at 1, so 0 is always free.
const LENDER_RESIDUAL_ID = 0;

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

export type DebtorPaymentAllocation = {
  /** Promoter cuts (off the top of `interestCents`). Empty when the loan has none. */
  promoterSplits: Array<[number, number]>;
  /** Lender shares of `(principalCents + interest residual)`, by amount-lent weight. */
  lenderSplits: Array<[number, number]>;
};

/**
 * Allocate a debtor payment that's split into a principal portion and
 * an interest portion. Promoters take a fixed `share_bps` cut of the
 * **interest** only — never of principal. Whatever interest remains
 * after promoter cuts joins the principal in a single "lender pool",
 * which is then split among lenders proportional to `amount_lent`.
 *
 *   total_cents = principal + interest
 *   promoter_i  = LR(interest, share_bps_i / 10000)
 *   lender_j    = LR(principal + (interest − sum(promoter_i)),
 *                    amount_lent_j / sum(amount_lent))
 *
 * Both splits use the same largest-remainder algorithm as `splitPayment`,
 * so cents reconcile exactly. The implementation runs LR once across
 * promoters plus a sentinel "residual" slot so the dropped sub-cent of
 * the interest flows deterministically to the lender pool rather than
 * silently rounding away.
 */
export function splitDebtorPayment(
  principalCents: number,
  interestCents: number,
  lenderShares: ReadonlyArray<readonly [number, number]>,
  promoterShares: ReadonlyArray<readonly [number, number]>,
): DebtorPaymentAllocation {
  if (principalCents < 0 || interestCents < 0) {
    throw new Error("principalCents and interestCents must be >= 0");
  }
  if (lenderShares.length === 0) {
    throw new Error("at least one lender is required");
  }

  let lenderResidualInterest = interestCents;
  let promoterSplits: Array<[number, number]> = [];

  if (promoterShares.length > 0 && interestCents > 0) {
    const promoterBpsSum = promoterShares.reduce((s, [, b]) => s + b, 0);
    if (promoterBpsSum <= 0 || promoterBpsSum > 10000) {
      throw new Error("promoter share_bps sum must be in (0, 10000]");
    }
    const residualBps = 10000 - promoterBpsSum;
    const interestWeights: Array<[number, number]> = [
      ...promoterShares.map(([id, bps]): [number, number] => [id, bps]),
      [LENDER_RESIDUAL_ID, residualBps],
    ];
    const interestSplit = splitPayment(interestCents, interestWeights);
    lenderResidualInterest = 0;
    const ps: Array<[number, number]> = [];
    for (const [id, cents] of interestSplit) {
      if (id === LENDER_RESIDUAL_ID) lenderResidualInterest = cents;
      else ps.push([id, cents]);
    }
    promoterSplits = ps;
  } else if (promoterShares.length > 0) {
    // interest_cents == 0; every promoter gets zero deterministically.
    promoterSplits = promoterShares.map(([id]): [number, number] => [id, 0]);
  }

  const lenderPool = principalCents + lenderResidualInterest;
  const lenderSplits = splitPayment(lenderPool, lenderShares);

  return { promoterSplits, lenderSplits };
}
