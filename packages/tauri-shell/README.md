# tauri-shell

Framework crate: a generic Tauri shell for local-first apps. Spawns a
sidecar backend, opens the webview at the announced port with a
per-launch auth token in the URL hash, runs the auto-updater (release
builds), gracefully shuts down the sidecar.

Extracted from hipo's `apps/desktop` in Phase 1D — same behaviour,
parameterised on `ShellConfig`.

## Usage

```rust
// apps/<app>/src/lib.rs
pub fn run() {
    tauri_shell::build_app(tauri_shell::ShellConfig::from_prefix(
        "myapp",                        // window title
        "MYAPP",                        // env-var + ready-line prefix
        "myapp-backend",                // sidecar binary basename
        "http://localhost:1420",        // dev URL (debug builds)
    ))
    .run(tauri::generate_context!())
    .expect("tauri runtime error");
}
```

`tauri::generate_context!()` stays in the consumer crate so it reads
the consumer's `tauri.conf.json` (icons, app id, window settings).
This crate only owns the runtime behaviour.

## What the sidecar must do

- Read its bind port from `<PREFIX>_PORT` (0 = any).
- Read its auth token from `<PREFIX>_AUTH_TOKEN` and gate `/api/*` on
  the `X-<App>-Token` header.
- Read its data dir from `<PREFIX>_DATA_DIR`.
- Emit a single line to stdout when listening:
  `<PREFIX>_READY hostname=<host> port=<port>`.

The webview opens at `http://<host>:<port>/#token=<auth_token>`; the
SPA bootstrap reads the token from `location.hash` and forwards it as
the `X-<App>-Token` header on every fetch.

## Phase 8 note

This crate is the framework-provided Rust shell *today*. Phase 8 of the
framework plan removes the sidecar entirely in favour of an in-page
Hono via service-worker + dedicated Worker; at that point this crate
shrinks dramatically (no sidecar logic, just window + updater) or gets
deprecated outright.
