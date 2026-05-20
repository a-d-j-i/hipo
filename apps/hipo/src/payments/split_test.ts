import { assertEquals, assertThrows } from "jsr:@std/assert@^1.0";
import { splitDebtorPayment, splitPayment } from "@hipo/shared";

function sum(v: Array<[number, number]>): number {
  return v.reduce((s, [, c]) => s + c, 0);
}

Deno.test("split_empty_or_zero", () => {
  assertEquals(splitPayment(100, []), []);
  assertEquals(
    splitPayment(0, [
      [1, 50],
      [2, 50],
    ]),
    [
      [1, 0],
      [2, 0],
    ],
  );
});

Deno.test("split_single_lender", () => {
  assertEquals(splitPayment(123, [[1, 100]]), [[1, 123]]);
});

Deno.test("split_exact_division", () => {
  const r = splitPayment(100, [
    [1, 50],
    [2, 50],
  ]);
  assertEquals(r, [
    [1, 50],
    [2, 50],
  ]);
  assertEquals(sum(r), 100);
});

Deno.test("split_classic_thirds: smallest id gets the extra cent", () => {
  // 10000 / 3 → floor 3333 each, residual 1, lender 1 (asc id) gets +1
  const r = splitPayment(10000, [
    [1, 100],
    [2, 100],
    [3, 100],
  ]);
  assertEquals(r, [
    [1, 3334],
    [2, 3333],
    [3, 3333],
  ]);
  assertEquals(sum(r), 10000);
});

Deno.test("split_unequal_shares", () => {
  // payment=10, shares 33/33/34, principal=100
  // floors: 3,3,3 (sum=9), remainders: 30,30,40. residual=1 → id 3 gets +1
  const r = splitPayment(10, [
    [1, 33],
    [2, 33],
    [3, 34],
  ]);
  assertEquals(r, [
    [1, 3],
    [2, 3],
    [3, 4],
  ]);
  assertEquals(sum(r), 10);
});

Deno.test("split_two_cent_tip", () => {
  // payment=2, 3 lenders equal, principal=300
  // each: 200/300 = 0 rem 200. residual=2 → ids 1 and 2 get +1.
  const r = splitPayment(2, [
    [1, 100],
    [2, 100],
    [3, 100],
  ]);
  assertEquals(r, [
    [1, 1],
    [2, 1],
    [3, 0],
  ]);
  assertEquals(sum(r), 2);
});

Deno.test("split_sum_always_reconciles_random", () => {
  const cases: Array<[number, Array<[number, number]>]> = [
    [1, [[1, 1]]],
    [
      7,
      [
        [1, 1],
        [2, 1],
        [3, 1],
      ],
    ],
    [
      999_999,
      [
        [1, 333],
        [2, 333],
        [3, 334],
      ],
    ],
    [
      // i32::MAX-ish, mixed shares
      2_147_483_647,
      [
        [1, 7],
        [2, 11],
        [3, 13],
        [4, 17],
        [5, 19],
      ],
    ],
  ];
  for (const [amount, shares] of cases) {
    const r = splitPayment(amount, shares);
    assertEquals(
      sum(r),
      amount,
      `amount=${amount} shares=${JSON.stringify(shares)}`,
    );
  }
});

Deno.test("split_handles_large_principals_without_float_loss", () => {
  // Stress test that the BigInt math doesn't drop precision for large
  // numerators that would overflow Number.MAX_SAFE_INTEGER if multiplied.
  // 1_000_000_000 cents × 1_000_000_000 cents = 10^18 — exceeds 2^53.
  const r = splitPayment(1_000_000_000, [
    [1, 1_000_000_000],
    [2, 1_000_000_000],
  ]);
  assertEquals(sum(r), 1_000_000_000);
  assertEquals(r[0][1], 500_000_000);
  assertEquals(r[1][1], 500_000_000);
});

// -- splitDebtorPayment ----------------------------------------------------

Deno.test("debtor_split: no promoters falls back to lender-only", () => {
  const r = splitDebtorPayment(
    6000,
    4000,
    [
      [1, 60],
      [2, 40],
    ],
    [],
  );
  assertEquals(r.promoterSplits, []);
  // lender_pool = 6000 + 4000 = 10000 → 60/40 split
  assertEquals(r.lenderSplits, [
    [1, 6000],
    [2, 4000],
  ]);
});

Deno.test("debtor_split: promoter takes off the top of interest only", () => {
  // 10000 principal + 1000 interest, promoter takes 10% (1000 bps) of interest.
  // promoter cut: 100 cents from 1000 interest → lender residual = 900.
  // lender_pool = 10000 + 900 = 10900, split 60/40 → 6540/4360.
  const r = splitDebtorPayment(
    10_000,
    1_000,
    [
      [1, 60],
      [2, 40],
    ],
    [[3, 1000]],
  );
  assertEquals(r.promoterSplits, [[3, 100]]);
  assertEquals(sum(r.promoterSplits) + sum(r.lenderSplits), 11_000);
  assertEquals(r.lenderSplits, [
    [1, 6540],
    [2, 4360],
  ]);
});

Deno.test(
  "debtor_split: residual cents flow deterministically to lender pool",
  () => {
    // interest = 7, one promoter at 50% (5000 bps).
    // promoter: 7 * 5000/10000 = 3 (floor), remainder pulled by sentinel slot
    //   (largest-remainder picks the bigger remainder). Sentinel weight is 5000
    //   so it gets the +1 bump → lender_residual = 4.
    // Sum check: promoter 3 + lender_residual 4 = 7. ✓
    const r = splitDebtorPayment(0, 7, [[1, 1]], [[2, 5000]]);
    assertEquals(sum(r.promoterSplits) + sum(r.lenderSplits), 7);
    assertEquals(r.promoterSplits, [[2, 3]]);
    assertEquals(r.lenderSplits, [[1, 4]]);
  },
);

Deno.test(
  "debtor_split: promoter sum == 100% leaves lenders with principal only",
  () => {
    const r = splitDebtorPayment(
      5000,
      1000,
      [[1, 100]],
      [
        [2, 5000],
        [3, 5000],
      ],
    );
    assertEquals(r.promoterSplits, [
      [2, 500],
      [3, 500],
    ]);
    assertEquals(r.lenderSplits, [[1, 5000]]);
  },
);

Deno.test("debtor_split: zero-interest payment routes 100% to lenders", () => {
  const r = splitDebtorPayment(
    1000,
    0,
    [
      [1, 50],
      [2, 50],
    ],
    [[3, 2000]],
  );
  assertEquals(r.promoterSplits, [[3, 0]]);
  assertEquals(r.lenderSplits, [
    [1, 500],
    [2, 500],
  ]);
});

Deno.test("debtor_split: rejects negative inputs", () => {
  assertThrows(() => splitDebtorPayment(-1, 0, [[1, 1]], []));
  assertThrows(() => splitDebtorPayment(0, -1, [[1, 1]], []));
});

Deno.test("debtor_split: requires at least one lender", () => {
  assertThrows(() => splitDebtorPayment(100, 0, [], []));
});

Deno.test("debtor_split: rejects promoter sum > 100%", () => {
  assertThrows(() =>
    splitDebtorPayment(
      100,
      100,
      [[1, 1]],
      [
        [2, 6000],
        [3, 5000],
      ],
    ),
  );
});
