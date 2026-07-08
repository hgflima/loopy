#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod sidecar;

use sidecar::SidecarState;

#[tauri::command]
fn start_sidecar(
    app: tauri::AppHandle,
    state: tauri::State<'_, SidecarState>,
    dir: String,
    flags: Vec<String>,
) -> Result<(), String> {
    state.start(&app, &dir, flags)
}

#[tauri::command]
fn send_command(
    state: tauri::State<'_, SidecarState>,
    payload: String,
) -> Result<(), String> {
    state.send_command(&payload)
}

#[tauri::command]
fn stop_sidecar(state: tauri::State<'_, SidecarState>) -> Result<(), String> {
    state.stop()
}

fn main() {
    tauri::Builder::default()
        .manage(SidecarState::new())
        .invoke_handler(tauri::generate_handler![
            start_sidecar,
            send_command,
            stop_sidecar,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
