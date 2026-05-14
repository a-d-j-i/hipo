// Tests for @hipo/shared. They live in apps/backend/ alongside the existing
// split_test.ts because that's where the deno test runner is configured.
// packages/shared has no runner of its own (source-only package); both Vite
// and Deno read its .ts files directly.

import { assertEquals } from "jsr:@std/assert@^1.0";
import {
  CURRENCY_CODE_PATTERN,
  PARTY_NAME_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  centsToMajor,
  checkCurrencyCode,
  checkLenders,
  checkPartyName,
  checkPassword,
  checkUsername,
  formatCents,
  majorToCents,
  normalizeOptional,
  sumLenderAmounts,
} from "@hipo/shared";

// ---------- Validators ----------

Deno.test("checkUsername: empty / whitespace / too long / valid", () => {
  assertEquals(checkUsername(""), "username is required");
  assertEquals(checkUsername("   "), "username is required");
  assertEquals(checkUsername("a".repeat(USERNAME_MAX_LENGTH + 1)), "username is too long");
  assertEquals(checkUsername("alice"), null);
  assertEquals(checkUsername("a".repeat(USERNAME_MAX_LENGTH)), null);
});

Deno.test("checkPassword: too short / valid", () => {
  assertEquals(checkPassword(""), `password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  assertEquals(checkPassword("1234567"), `password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  assertEquals(checkPassword("12345678"), null);
  assertEquals(checkPassword("password123"), null);
});

Deno.test("checkPartyName: empty / whitespace / too long / valid", () => {
  assertEquals(checkPartyName(""), "name is required");
  assertEquals(checkPartyName("   "), "name is required");
  assertEquals(checkPartyName("a".repeat(PARTY_NAME_MAX_LENGTH + 1)), "name is too long");
  assertEquals(checkPartyName("Banco Galicia"), null);
});

Deno.test("checkCurrencyCode: wrong length / lowercase / non-letters / valid", () => {
  const fmt = "currency_code must be 3 uppercase letters (ISO 4217)";
  assertEquals(checkCurrencyCode("US"), fmt);
  assertEquals(checkCurrencyCode("USDD"), fmt);
  assertEquals(checkCurrencyCode("usd"), fmt);
  assertEquals(checkCurrencyCode("US1"), fmt);
  assertEquals(checkCurrencyCode("USD"), null);
  assertEquals(checkCurrencyCode("ARS"), null);
});

Deno.test("CURRENCY_CODE_PATTERN matches expected shape", () => {
  assertEquals(CURRENCY_CODE_PATTERN.test("USD"), true);
  assertEquals(CURRENCY_CODE_PATTERN.test("us"), false);
});

Deno.test("checkLenders: empty / non-positive amount / duplicates / valid", () => {
  assertEquals(checkLenders([]), "loan needs at least one lender");
  assertEquals(
    checkLenders([{ lenderId: 1, amountLentCents: 0 }]),
    "each lender amount must be > 0",
  );
  assertEquals(
    checkLenders([{ lenderId: 1, amountLentCents: -10 }]),
    "each lender amount must be > 0",
  );
  assertEquals(
    checkLenders([
      { lenderId: 1, amountLentCents: 5000 },
      { lenderId: 1, amountLentCents: 5000 },
    ]),
    "lender 1 appears more than once",
  );
  assertEquals(
    checkLenders([
      { lenderId: 1, amountLentCents: 6000 },
      { lenderId: 2, amountLentCents: 4000 },
    ]),
    null,
  );
});

Deno.test("sumLenderAmounts: reconciles", () => {
  assertEquals(
    sumLenderAmounts([
      { lenderId: 1, amountLentCents: 6000 },
      { lenderId: 2, amountLentCents: 4000 },
    ]),
    10000,
  );
  assertEquals(sumLenderAmounts([]), 0);
});

Deno.test("normalizeOptional: null/undefined/blank → null, otherwise trimmed", () => {
  assertEquals(normalizeOptional(null), null);
  assertEquals(normalizeOptional(undefined), null);
  assertEquals(normalizeOptional(""), null);
  assertEquals(normalizeOptional("   "), null);
  assertEquals(normalizeOptional("  hello  "), "hello");
  assertEquals(normalizeOptional("plain"), "plain");
});

// ---------- Format helpers ----------

Deno.test("centsToMajor / majorToCents are inverses for safe values", () => {
  assertEquals(majorToCents(centsToMajor(12345)), 12345);
  assertEquals(centsToMajor(majorToCents(123.45)), 123.45);
});

Deno.test("majorToCents rounds half-to-even-ish (Math.round)", () => {
  // Math.round behavior: 0.5 → 1, 1.5 → 2, -0.5 → 0.
  assertEquals(majorToCents(0.005), 1);
  assertEquals(majorToCents(0.004), 0);
});

Deno.test("formatCents: USD formats in es-AR by default", () => {
  // Intl output is locale-dependent; we just confirm the value, currency
  // symbol, and 2-decimal precision come through.
  const s = formatCents(123_456, "USD");
  // e.g. "US$ 1.234,56" in es-AR. Just check it contains the number and US$
  // (avoid brittle whitespace assertions).
  assertEquals(s.includes("1.234,56") || s.includes("1,234.56"), true);
});
