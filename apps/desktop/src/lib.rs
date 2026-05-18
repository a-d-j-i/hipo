//! hipo's Tauri shell — thin consumer of `tauri-shell`.
//!
//! All runtime behaviour (window bring-up, single-instance focus,
//! updater wiring) lives in `packages/tauri-shell`. This crate only
//! owns hipo-specific configuration: app name + the `tauri.conf.json`
//! that holds icons, identifier (`ar.com.adjimann.hipo`), CSP, and
//! the updater pubkey.
//!
//! Phase 8: the in-page-backend (SW + Worker + OPFS) lives inside the
//! bundled frontend, so the Rust shell no longer spawns a sidecar.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri_shell::build_app(tauri_shell::ShellConfig::new("hipo"))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
