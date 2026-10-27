fn main() {
    // Ensure the sidecar placeholder exists so tauri_build doesn't fail
    // during `cargo check` / `tauri dev`. The real binary is produced by
    // `npm run build:sidecar` which runs before `tauri build`.
    // On Windows `tauri_build` looks for `bin/loopy-<triple>.exe`, so the
    // placeholder must carry the suffix of the TARGET (not the host) OS.
    let triple = std::env::var("TARGET").unwrap_or_default();
    let exe_suffix = match std::env::var("CARGO_CFG_TARGET_OS").as_deref() {
        Ok("windows") => ".exe",
        _ => "",
    };
    let sidecar = format!("bin/loopy-{triple}{exe_suffix}");
    let path = std::path::Path::new(&sidecar);
    if !path.exists() {
        let _ = std::fs::create_dir_all(path.parent().unwrap_or(path));
        let _ = std::fs::File::create(path);
    }

    tauri_build::build();
}
