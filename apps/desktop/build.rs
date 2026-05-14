fn main() {
    println!("cargo:rerun-if-changed=tauri.conf.json");

    // Refuse release builds while updater placeholders are still in the
    // config — shipping with them either fails open or silently breaks
    // updates. Debug builds pass through so `cargo tauri dev` works.
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        let conf = std::fs::read_to_string("tauri.conf.json")
            .expect("failed to read tauri.conf.json");
        for placeholder in [
            "CHANGE_ME_OWNER",
            "CHANGE_ME_REPO",
            "PLACEHOLDER_REPLACE_WITH_TAURI_SIGNING_PUBLIC_KEY",
        ] {
            if conf.contains(placeholder) {
                panic!(
                    "tauri.conf.json still contains placeholder `{placeholder}`. \
                     Replace it before building a release (see README → \
                     Auto-updater setup)."
                );
            }
        }
    }

    tauri_build::build()
}
