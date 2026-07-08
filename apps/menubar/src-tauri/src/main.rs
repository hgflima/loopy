#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod sidecar;

use config::{load_launch_config, save_launch_config};
use sidecar::SidecarState;
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

#[cfg(target_os = "macos")]
use tauri::ActivationPolicy;

// ---------------------------------------------------------------------------
// Sidecar commands (T-009 — unchanged)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Window management commands (T-014)
// ---------------------------------------------------------------------------

/// Hide popover, show + focus main window, promote to Regular on macOS.
fn surface_main_window(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(popover) = app.get_webview_window("popover") {
        let _ = popover.hide();
    }
    if let Some(w) = app.get_webview_window("main") {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(ActivationPolicy::Regular);
    Ok(())
}

/// Show the main (full) window. Hides the popover and switches macOS identity
/// from accessory to regular (Dock + Cmd+Tab).
#[tauri::command]
fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    surface_main_window(&app)
}

/// Hide the main window and switch macOS identity back to accessory
/// (no Dock icon, menu bar only).
#[tauri::command]
fn hide_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("main") {
        w.hide().map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(ActivationPolicy::Accessory);
    Ok(())
}

/// Bring the app to the front (T-016 approval arrival, T-017 notification click).
#[tauri::command]
fn bring_to_front(app: tauri::AppHandle) -> Result<(), String> {
    surface_main_window(&app)
}

/// Update the tray icon title (used by the frontend to echo `pulseFrame`).
#[tauri::command]
fn update_tray_title(app: tauri::AppHandle, title: String) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_title(Some(&title))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// App entry point
// ---------------------------------------------------------------------------

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(SidecarState::new())
        .setup(|app| {
            // Start as accessory on macOS (no Dock icon, menu bar only)
            #[cfg(target_os = "macos")]
            app.set_activation_policy(ActivationPolicy::Accessory);

            // Build tray icon — title "●" as fallback when no icon asset exists
            let _tray = TrayIconBuilder::with_id("main")
                .tooltip("Loopy")
                .title("●")
                .icon_as_template(true)
                .on_tray_icon_event(|tray_handle, event| {
                    // Feed every event to the positioner so it tracks the tray rect
                    tauri_plugin_positioner::on_tray_event(
                        tray_handle.app_handle(),
                        &event,
                    );

                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_popover(tray_handle.app_handle());
                    }
                })
                .build(app)?;

            // Main window: close → hide (app stays in tray, Run continues)
            if let Some(main_win) = app.get_webview_window("main") {
                let win = main_win.clone();
                main_win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = win.hide();
                        #[cfg(target_os = "macos")]
                        let _ = win.app_handle().set_activation_policy(
                            ActivationPolicy::Accessory,
                        );
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_sidecar,
            send_command,
            stop_sidecar,
            show_main_window,
            hide_main_window,
            bring_to_front,
            update_tray_title,
            load_launch_config,
            save_launch_config,
        ])
        .build(tauri::generate_context!())
        .expect("error building tauri application")
        .run(|app_handle, event| {
            // Only intercept user-initiated quit (Cmd+Q / menu); code is None.
            // Programmatic app.exit(N) sets code = Some(N) — let it through.
            let tauri::RunEvent::ExitRequested { api, code, .. } = event else {
                return;
            };
            if code.is_some() {
                return;
            }
            let state = app_handle.state::<SidecarState>();
            if !state.is_running() {
                return;
            }

            api.prevent_exit();

            let confirmed = app_handle
                .dialog()
                .message(
                    "A Run is active. Quit anyway?\n\
                     The Run will be checkpointed for later resume.",
                )
                .title("Confirm Quit")
                .kind(MessageDialogKind::Warning)
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "Quit".into(),
                    "Cancel".into(),
                ))
                .blocking_show();

            if confirmed {
                let _ = state.stop();
                app_handle.exit(0);
            }
        });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Toggle the popover window: if visible → hide, else → position near tray and show.
fn toggle_popover(app: &tauri::AppHandle) {
    let Some(popover) = app.get_webview_window("popover") else {
        return;
    };
    if popover.is_visible().unwrap_or(false) {
        let _ = popover.hide();
    } else {
        use tauri_plugin_positioner::WindowExt;
        let _ = popover.move_window(tauri_plugin_positioner::Position::TrayCenter);
        let _ = popover.show();
        let _ = popover.set_focus();
    }
}
