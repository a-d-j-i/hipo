import { assertEquals } from "jsr:@std/assert@^1.0";
import { splitPayment } from "@hipo/shared";

function sum(v: Array<[number, number]>): number {
  return v.reduce((s, [, c]) => s + c, 0);
}

Deno.test("split_empty_or_zero", () => {
  assertEquals(splitPayment(100, []), []);
  assertEquals(splitPayment(0, [[1, 50], [2, 50]]), [[1, 0], [2, 0]]);
});

Deno.test("split_single_lender", () => {
  assertEquals(splitPayment(123, [[1, 100]]), [[1, 123]]);
});

Deno.test("split_exact_division", () => {
  const r = splitPayment(100, [[1, 50], [2, 50]]);
  assertEquals(r, [[1, 50], [2, 50]]);
  assertEquals(sum(r), 100);
});

Deno.test("split_classic_thirds: smallest id gets the extra cent", () => {
  // 10000 / 3 → floor 3333 each, residual 1, lender 1 (asc id) gets +1
  const r = splitPayment(10000, [[1, 100], [2, 100], [3, 100]]);
  assertEquals(r, [[1, 3334], [2, 3333], [3, 3333]]);
  assertEquals(sum(r), 10000);
});

Deno.test("split_unequal_shares", () => {
  // payment=10, shares 33/33/34, principal=100
  // floors: 3,3,3 (sum=9), remainders: 30,30,40. residual=1 → id 3 gets +1
  const r = splitPayment(10, [[1, 33], [2, 33], [3, 34]]);
  assertEquals(r, [[1, 3], [2, 3], [3, 4]]);
  assertEquals(sum(r), 10);
});

Deno.test("split_two_cent_tip", () => {
  // payment=2, 3 lenders equal, principal=300
  // each: 200/300 = 0 rem 200. residual=2 → ids 1 and 2 get +1.
  const r = splitPayment(2, [[1, 100], [2, 100], [3, 100]]);
  assertEquals(r, [[1, 1], [2, 1], [3, 0]]);
  assertEquals(sum(r), 2);
});

Deno.test("split_sum_always_reconciles_random", () => {
  const cases: Array<[number, Array<[number, number]>]> = [
    [1, [[1, 1]]],
    [7, [[1, 1], [2, 1], [3, 1]]],
    [999_999, [[1, 333], [2, 333], [3, 334]]],
    [
      // i32::MAX-ish, mixed shares
      2_147_483_647,
      [[1, 7], [2, 11], [3, 13], [4, 17], [5, 19]],
    ],
  ];
  for (const [amount, shares] of cases) {
    const r = splitPayment(amount, shares);
    assertEquals(sum(r), amount, `amount=${amount} shares=${JSON.stringify(shares)}`);
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
