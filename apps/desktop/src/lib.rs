//! hipo's Tauri shell — thin consumer of `tauri-shell`.
//!
//! All runtime behaviour (sidecar spawn, ready-line parsing, webview
//! bring-up, updater wiring) lives in `packages/tauri-shell`. This
//! crate only owns hipo-specific configuration: app name, env-var
//! prefix, sidecar binary name, dev URL — plus the `tauri.conf.json`
//! that holds icons, identifier (`ar.com.adjimann.hipo`), and updater
//! pubkey.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri_shell::build_app(tauri_shell::ShellConfig::from_prefix(
        "hipo",
        "HIPO",
        "hipo-backend",
        "http://localhost:1420",
    ))
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
