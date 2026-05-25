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
    #[allow(unused_mut)]
    let mut builder = tauri_shell::build_app(tauri_shell::ShellConfig::new("hipo"));

    // Phase 12 smoke (and future Tauri smokes) drive the real
    // WebKitGTK/WebView2 webview through `tauri-plugin-playwright`'s
    // Unix-socket bridge. Off by default; enabled with the
    // `e2e-testing` Cargo feature.
    #[cfg(feature = "e2e-testing")]
    {
        builder = builder.plugin(tauri_plugin_playwright::init());
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
