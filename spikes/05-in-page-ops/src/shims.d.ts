// tsc walks @hipo/auth/src/passwords.ts even though Vite's resolve.alias
// substitutes passwords.browser.ts at bundle time. The Node-only
// `@node-rs/argon2` types aren't installed in this spike; declare a
// minimal stub so type-checking succeeds.
declare module "@node-rs/argon2" {
  export function hash(password: string): Promise<string>;
  export function verify(hash: string, password: string): Promise<boolean>;
}
