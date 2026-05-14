/**
 * Wraps a shared `check*` function (from `@hipo/shared`) into an antd
 * `Form.Item` rule. Empty inputs are intentionally allowed — the built-in
 * `{ required: true, message: t("...") }` rule alongside this one handles
 * presence, with a localized message. The check fires only for non-empty
 * values, so its (English) error surfaces only for structural problems
 * (too long, bad format, etc.).
 *
 * Usage:
 *   rules={[
 *     { required: true, message: t("...required") },
 *     rule(checkUsername),
 *   ]}
 */
export function rule(check: (s: string) => string | null) {
  return {
    validator: async (_: unknown, value: unknown) => {
      if (value === undefined || value === null || value === "") return;
      const err = check(String(value));
      if (err) throw new Error(err);
    },
  };
}
