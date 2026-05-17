// Public entry point for @hipo/sqlite.
//
// Engine-specific clients (`client-deno`, `client-browser`) are not
// re-exported here because they have different runtime dependencies
// and option shapes. Consumers import the specific one they need.

export { runMigrations, splitStatements } from "./migrations-runner.ts";
export type { Db, Migration } from "./types.ts";
