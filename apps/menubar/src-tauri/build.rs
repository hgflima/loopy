fn main() {
    // Ensure the sidecar placeholder exists so tauri_build doesn't fail
    // during `cargo check` / `tauri dev`. The real binary is produced by
    // `npm run build:sidecar` which runs before `tauri build`.
    let triple = std::env::var("TARGET").unwrap_or_default();
    let sidecar = format!("bin/loopy-{triple}");
    let path = std::path::Path::new(&sidecar);
    if !path.exists() {
        let _ = std::fs::create_dir_all(path.parent().unwrap_or(path));
        let _ = std::fs::File::create(path);
    }

    tauri_build::build();
}
