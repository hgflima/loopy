#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
#[cfg(target_os = "macos")]
mod panel;
mod project_fs;
mod sidecar;

use config::{load_launch_config, save_launch_config};
use project_fs::{probe_agent, read_backlog, read_capabilities_cache, read_project_files, write_loopy_yml};
use sidecar::SidecarState;
use tauri::{
    image::Image,
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
    hide_tray_popover(app);
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
    eprintln!("[window] hide_main_window invoked");
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

// ---------------------------------------------------------------------------
// About window (C-0012)
// ---------------------------------------------------------------------------

/// Decide whether closing the About window should return the app to `Accessory`
/// (menu-bar-only) identity. Only when the main window is hidden: once no full
/// window remains, the Dock icon should disappear. Pure (AD-6) — unit-tested;
/// the `set_activation_policy` side effect around it is validated manually.
#[cfg(target_os = "macos")]
fn should_revert_to_accessory(main_visible: bool) -> bool {
    !main_visible
}

/// Show + focus the dedicated "About" window, promoting the app to `Regular`
/// (Dock icon + Cmd+Tab) while it's visible. Closing it hides the window and,
/// when the main window is also hidden, reverts to `Accessory` — wired by the
/// `about` close handler in `setup`. The window itself is declared (hidden) in
/// `tauri.conf.json`, so this only surfaces it.
#[tauri::command]
fn show_about_window(app: tauri::AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("about") else {
        return Err("about window not found".into());
    };
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(ActivationPolicy::Regular);
    Ok(())
}

/// Size the popover to the content height the frontend measured, then re-anchor
/// it under the tray icon. Called on mount, on open, and whenever the content
/// changes, so the popover always hugs its content and stays pinned to the icon.
#[tauri::command]
fn resize_popover(app: tauri::AppHandle, height: f64) {
    #[cfg(target_os = "macos")]
    panel::resize_popover_panel(&app, height);
    #[cfg(not(target_os = "macos"))]
    if let Some(window) = app.get_webview_window("popover") {
        use tauri_plugin_positioner::WindowExt;
        let _ = window.set_size(tauri::LogicalSize::new(320.0, height));
        let _ = window.move_window(tauri_plugin_positioner::Position::TrayBottomLeft);
    }
}

/// Order the tray popover out — the native NSMenu "dismiss on activation/Esc"
/// path the frontend calls when a menu item is chosen or Esc is pressed. Reuses
/// the resign-key order-out route (panel.rs `hide_popover_panel`), so it needs
/// no window `hide` permission and reliably dismisses the swizzled NSPanel.
#[tauri::command]
fn hide_popover(app: tauri::AppHandle) {
    hide_tray_popover(&app);
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

/// Debug aid: route uncaught webview errors to the Rust process stderr, which
/// outlives the webview. Lets us tell a native hide/close apart from a React
/// render crash when the main window "vanishes" back to the popover mid-Run.
#[tauri::command]
fn log_error(source: String, message: String, stack: String, component_stack: String) {
    eprintln!("[webview-error:{source}] {message}");
    if !stack.is_empty() {
        eprintln!("  stack: {stack}");
    }
    if !component_stack.is_empty() {
        eprintln!("  componentStack: {component_stack}");
    }
}

// ---------------------------------------------------------------------------
// Quit (shares the Run-active guard with Cmd+Q — see quit_if_confirmed)
// ---------------------------------------------------------------------------

/// Quit the app through the shared Run-active guard, so the menu's "Sair" and
/// Cmd+Q behave identically. Idle → exits immediately; a Run active → confirms
/// first and, on confirmation, stops the Run before exiting.
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    quit_if_confirmed(&app);
}

// ---------------------------------------------------------------------------
// App entry point
// ---------------------------------------------------------------------------

fn main() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        // Opens the "About" window's GitHub/npm links in the default browser.
        // Locked down to those two hosts by `opener:allow-open-url` (capabilities).
        .plugin(tauri_plugin_opener::init());

    // macOS: the tray popover is a floating NSPanel (see src/panel.rs).
    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_nspanel::init());
    }

    builder
        .manage(SidecarState::new())
        .setup(|app| {
            // Start as accessory on macOS (no Dock icon, menu bar only)
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(ActivationPolicy::Accessory);
                // Swizzle the popover window into a floating NSPanel now that it
                // exists, so a tray click overlays fullscreen apps in place
                // instead of opening on a Space you can't see (see panel.rs).
                panel::install_popover_panel(app.handle());
            }

            // Build tray icon — the loopy loop mark as a macOS template image
            // (monochrome + transparent, so macOS auto-tints it to the menubar
            // state). `update_tray_title` still drives the live pulse text.
            let tray_icon = Image::from_bytes(include_bytes!("../icons/tray-template.png"))?;
            let _tray = TrayIconBuilder::with_id("main")
                .tooltip("Loopy")
                .icon(tray_icon)
                .icon_as_template(true)
                .on_tray_icon_event(|tray_handle, event| {
                    // Feed every event to the positioner so it tracks the tray rect
                    tauri_plugin_positioner::on_tray_event(
                        tray_handle.app_handle(),
                        &event,
                    );
                    // macOS panel positions itself from the raw rect (panel.rs).
                    #[cfg(target_os = "macos")]
                    panel::track_tray_rect(tray_handle.app_handle(), &event);

                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_tray_popover(tray_handle.app_handle());
                    }
                })
                .build(app)?;

            // Main window: close → hide (app stays in tray, Run continues)
            if let Some(main_win) = app.get_webview_window("main") {
                let win = main_win.clone();
                main_win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        eprintln!("[window] CloseRequested on main -> hiding (Run continues)");
                        api.prevent_close();
                        let _ = win.hide();
                        #[cfg(target_os = "macos")]
                        let _ = win.app_handle().set_activation_policy(
                            ActivationPolicy::Accessory,
                        );
                    }
                });
            }

            // About window: close → hide it (keep the instance alive to re-show),
            // and drop back to Accessory when the main window is also hidden so the
            // Dock icon disappears (menu-bar-only again). See `show_about_window`.
            if let Some(about_win) = app.get_webview_window("about") {
                let win = about_win.clone();
                about_win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = win.hide();
                        #[cfg(target_os = "macos")]
                        {
                            let app = win.app_handle();
                            let main_visible = app
                                .get_webview_window("main")
                                .and_then(|w| w.is_visible().ok())
                                .unwrap_or(false);
                            if should_revert_to_accessory(main_visible) {
                                let _ = app.set_activation_policy(ActivationPolicy::Accessory);
                            }
                        }
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
            show_about_window,
            bring_to_front,
            resize_popover,
            hide_popover,
            update_tray_title,
            load_launch_config,
            save_launch_config,
            read_project_files,
            read_backlog,
            write_loopy_yml,
            read_capabilities_cache,
            probe_agent,
            log_error,
            quit_app,
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

            // Defer this OS-driven exit and route it through the shared quit path
            // (the same one `quit_app` uses). Idle → quits immediately with no
            // dialog. A Run active → confirm; on cancel we stay, since
            // prevent_exit already held.
            api.prevent_exit();
            quit_if_confirmed(app_handle);
        });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Decide whether the app may quit. Idle → quit immediately (`true`, no
/// dialog). A Run is active → ask the user via `ask` and return their verdict.
///
/// Pure over `is_running`; `ask` isolates the dialog side effect so the
/// non-dialog branch stays unit-testable without an `AppHandle`.
fn confirm_quit(is_running: bool, ask: impl FnOnce() -> bool) -> bool {
    if !is_running {
        return true;
    }
    ask()
}

/// Shared quit path for Cmd+Q (`ExitRequested`) and the `quit_app` command, so
/// both honour the "Run active" confirmation identically (the guard is never
/// bypassed). Idle → stop (a no-op) and `exit(0)` with no dialog. A Run active →
/// confirm "A Run is active. Quit anyway?"; on approval stop the Run and
/// `exit(0)`, on cancel do nothing (the caller stays alive).
fn quit_if_confirmed(app: &tauri::AppHandle) {
    let is_running = app.state::<SidecarState>().is_running();
    let confirmed = confirm_quit(is_running, || {
        app.dialog()
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
            .blocking_show()
    });
    if confirmed {
        let _ = app.state::<SidecarState>().stop();
        app.exit(0);
    }
}

/// Toggle the tray popover. macOS uses a floating NSPanel that overlays
/// fullscreen apps (see `panel.rs`); other platforms fall back to a plain window.
fn toggle_tray_popover(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    panel::toggle_popover_panel(app);
    #[cfg(not(target_os = "macos"))]
    toggle_popover_window(app);
}

/// Hide the tray popover (macOS panel or plain window).
fn hide_tray_popover(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    panel::hide_popover_panel(app);
    #[cfg(not(target_os = "macos"))]
    if let Some(popover) = app.get_webview_window("popover") {
        let _ = popover.hide();
    }
}

/// Non-macOS fallback: toggle the popover as a plain window (no fullscreen
/// overlay — that's a macOS-only concern handled by the NSPanel path).
#[cfg(not(target_os = "macos"))]
fn toggle_popover_window(app: &tauri::AppHandle) {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // The pure decision behind the shared quit path (`quit_if_confirmed`, used by
    // both Cmd+Q's ExitRequested and the `quit_app` command). The non-dialog
    // branch is unit-tested here; the dialog branch needs an AppHandle (manual).

    #[test]
    fn confirm_quit_idle_returns_true_without_asking() {
        // Arrange: idle (no Run active). The dialog closure must never fire.
        // Act
        let proceed = confirm_quit(false, || panic!("idle must not show a dialog"));
        // Assert
        assert!(proceed, "idle quit must proceed without confirmation");
    }

    #[test]
    fn confirm_quit_running_returns_dialog_verdict() {
        // A Run is active → the verdict is exactly what the dialog returns.
        assert!(confirm_quit(true, || true), "confirmed quit must proceed");
        assert!(!confirm_quit(true, || false), "cancelled quit must be blocked");
    }

    // About window: closing it reverts to Accessory only when the main window is
    // also hidden. Gated to macOS because `should_revert_to_accessory` is macOS-only.
    #[cfg(target_os = "macos")]
    #[test]
    fn about_close_reverts_to_accessory_only_when_main_hidden() {
        // Main hidden → back to menu-bar-only (Accessory), Dock icon gone.
        assert!(should_revert_to_accessory(false));
        // Main visible → stay Regular; a full window still warrants a Dock icon.
        assert!(!should_revert_to_accessory(true));
    }
}
