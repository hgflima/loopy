#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod changes;
mod config;
mod interview_process;
mod launch_args;
#[cfg(target_os = "macos")]
mod panel;
mod project_fs;
mod sidecar;
mod telemetry;

use changes::{discard_change, read_changes};
use config::{load_launch_config, save_launch_config};
use interview_process::InterviewState;
use launch_args::{parse_launch_args, LaunchArgs};
use project_fs::{probe_agent, read_backlog, read_capabilities_cache, read_project_files, write_loopy_yml};
use sidecar::SidecarState;
use telemetry::{
    insights_add_bug, insights_set_change_status, insights_set_verdict, read_baseline,
    read_change_insights, read_change_list, read_step_insights, read_task_insights,
    telemetry_db_exists,
};
use std::path::Path;
use std::sync::Mutex;
use tauri::{
    image::Image,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
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
// Interview commands (C-0018 / T-008) — a second managed process for the Specs
// tab's Interview. Deliberately separate from the sidecar: starting one must
// NOT kill an in-flight Run (spec Boundary "Never").
// ---------------------------------------------------------------------------

#[tauri::command]
fn start_interview(
    app: tauri::AppHandle,
    state: tauri::State<'_, InterviewState>,
    dir: String,
    args: Vec<String>,
) -> Result<(), String> {
    state.start(&app, &dir, args)
}

#[tauri::command]
fn send_interview_command(
    state: tauri::State<'_, InterviewState>,
    payload: String,
) -> Result<(), String> {
    state.send_command(&payload)
}

#[tauri::command]
fn stop_interview(state: tauri::State<'_, InterviewState>) -> Result<(), String> {
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
        let _ = window.set_size(tauri::LogicalSize::new(320.0, height));
        anchor_popover(&window, tauri_plugin_positioner::Position::TrayBottomLeft);
    }
}

/// Move the popover with the positioner — only when the window has a monitor.
///
/// The positioner `unwrap()`s `current_monitor()`, and on Linux (GTK/Wayland) a
/// window that was never shown has none: the call panics *inside a callback that
/// cannot unwind* and aborts the whole app. `resize_popover` runs on the
/// popover's mount, while it is still hidden, so this guard is load-bearing.
#[cfg(not(target_os = "macos"))]
fn anchor_popover(window: &tauri::WebviewWindow, position: tauri_plugin_positioner::Position) {
    use tauri_plugin_positioner::WindowExt;
    if matches!(window.current_monitor(), Ok(Some(_))) {
        let _ = window.move_window(position);
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
// Launch argv (C-0020 / E2-E3)
// ---------------------------------------------------------------------------

/// The initial launch argv, parsed in `setup` and handed to the webview once.
///
/// *Pull*, not *push*: an `emit` from `setup` fires before the webview has a
/// listener and is silently lost, so the webview asks via [`take_launch_args`]
/// when it mounts. Only a second instance (E3) arrives as the `launch-args` event.
struct LaunchArgsState(Mutex<Option<LaunchArgs>>);

/// Hand the initial launch argv to the webview, once (later calls get `None`).
/// `None` also means "launched bare" — today's behaviour, nothing to apply.
#[tauri::command]
fn take_launch_args(state: tauri::State<'_, LaunchArgsState>) -> Option<LaunchArgs> {
    state.0.lock().ok().and_then(|mut slot| slot.take())
}

/// Parse a launch argv into what the webview should apply. A bare launch (no
/// dir, no flags) is `None`, as is a parse error — which is logged, never fatal
/// (AD-5): the app still comes up, it just doesn't switch project.
fn launch_args_to_apply(argv: &[String], cwd: &Path) -> Option<LaunchArgs> {
    match parse_launch_args(argv, cwd) {
        Ok(args) if args == LaunchArgs::default() => None,
        Ok(args) => Some(args),
        Err(e) => {
            eprintln!("[launch-args] argv ignorado: {e}");
            None
        }
    }
}

/// Second instance (E3): the plugin hands us its argv and the *caller's* cwd.
/// Forward what it asked for to the `main` webview and bring the window up —
/// on a parse error or a bare launch, only the focus happens.
fn on_second_instance(app: &tauri::AppHandle, argv: Vec<String>, cwd: String) {
    if let Some(args) = launch_args_to_apply(&argv, Path::new(&cwd)) {
        if let Err(e) = app.emit_to("main", "launch-args", args) {
            eprintln!("[launch-args] falha ao emitir: {e}");
        }
    }
    let _ = surface_main_window(app);
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
        // Single instance (E3) must be the FIRST plugin registered: a second
        // launch exits here, forwarding its argv + cwd to the live instance.
        .plugin(tauri_plugin_single_instance::init(on_second_instance))
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
        .manage(InterviewState::new())
        .setup(|app| {
            // Initial launch argv (E2), kept for the webview to pull on mount.
            let argv: Vec<String> = std::env::args().collect();
            let cwd = std::env::current_dir().unwrap_or_default();
            let initial = launch_args_to_apply(&argv, &cwd);
            let surface_on_launch = initial.is_some();
            app.manage(LaunchArgsState(Mutex::new(initial)));

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
            #[cfg(target_os = "macos")]
            let tray_icon = Image::from_bytes(include_bytes!("../icons/tray-template.png"))?;
            // Elsewhere nothing tints a template image: a black mark vanishes on a
            // dark Linux panel, so use the colored app icon instead.
            #[cfg(not(target_os = "macos"))]
            let tray_icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))?;

            #[allow(unused_mut)]
            let mut tray_builder = TrayIconBuilder::with_id("main")
                .tooltip("Loopy")
                .icon(tray_icon)
                .icon_as_template(true);

            // Non-macOS: a native tray menu mirroring the popover's actions. On
            // Linux it is the ONLY way in — libappindicator never delivers click
            // events, so the left-click popover toggle below never fires there.
            // On Windows it is the right-click menu; left click keeps the popover.
            #[cfg(not(target_os = "macos"))]
            {
                tray_builder = tray_builder
                    .menu(&build_tray_menu(app.handle())?)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| handle_tray_menu(app, event.id().as_ref()));
            }

            let _tray = tray_builder
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

            // Linux: the tray can be invisible (GNOME without the AppIndicator
            // extension), and there is no Dock to click — start with the main
            // window up so the app is never launched into nowhere.
            #[cfg(target_os = "linux")]
            surface_main_window(app.handle())?;

            // Launched with a dir or flags (`loopy open`): show the window the
            // webview will apply them to. Bare launch keeps today's tray start.
            if surface_on_launch {
                surface_main_window(app.handle())?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_sidecar,
            send_command,
            stop_sidecar,
            // Interview process (C-0018 / T-008): a second managed process for
            // the Specs tab that never kills the Run's sidecar.
            start_interview,
            send_interview_command,
            stop_interview,
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
            // Specs authoring bridge (C-0018 / T-007): list + non-destructive
            // discard of devy Changes.
            read_changes,
            discard_change,
            // Telemetry Insights bridge (C-0017 / T-009): SELECT-only reads over
            // the engine's views + one-shot CLI writes (verdict/bug/change).
            read_change_list,
            read_change_insights,
            read_task_insights,
            read_step_insights,
            read_baseline,
            telemetry_db_exists,
            insights_set_verdict,
            insights_add_bug,
            insights_set_change_status,
            log_error,
            quit_app,
            // Launch argv (C-0020 / E2): the webview pulls the initial argv once.
            take_launch_args,
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

/// Non-macOS tray menu: the popover's actions (Abrir/Parar · Sobre/Sair) as a
/// native menu. Ids are routed by [`handle_tray_menu`].
#[cfg(not(target_os = "macos"))]
fn build_tray_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder};
    MenuBuilder::new(app)
        .item(&MenuItemBuilder::with_id("open", "Abrir").build(app)?)
        .item(&MenuItemBuilder::with_id("stop", "Parar").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("about", "Sobre").build(app)?)
        .item(&MenuItemBuilder::with_id("quit", "Sair").build(app)?)
        .build()
}

/// Route a tray menu click to the same commands the popover invokes.
#[cfg(not(target_os = "macos"))]
fn handle_tray_menu(app: &tauri::AppHandle, id: &str) {
    match id {
        "open" => {
            let _ = surface_main_window(app);
        }
        "stop" => {
            let _ = app.state::<SidecarState>().stop();
        }
        "about" => {
            let _ = show_about_window(app.clone());
        }
        "quit" => {
            // Menu events run on the main thread; the quit guard may block on a
            // confirmation dialog, which must not happen there.
            let app = app.clone();
            std::thread::spawn(move || quit_if_confirmed(&app));
        }
        _ => {}
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
        let _ = popover.show();
        anchor_popover(&popover, tauri_plugin_positioner::Position::TrayCenter);
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

    fn argv(args: &[&str]) -> Vec<String> {
        std::iter::once("Loopy")
            .chain(args.iter().copied())
            .map(String::from)
            .collect()
    }

    // A bare launch is today's behaviour: nothing to apply, window stays hidden.
    #[test]
    fn launch_args_bare_launch_is_none() {
        let cwd = std::env::temp_dir();
        assert_eq!(launch_args_to_apply(&argv(&[]), &cwd), None);
        assert_eq!(launch_args_to_apply(&argv(&["-psn_0_123"]), &cwd), None);
    }

    #[test]
    fn launch_args_dir_resolves_against_given_cwd() {
        let cwd = std::env::temp_dir().join("caller");
        let got = launch_args_to_apply(&argv(&["proj", "--run"]), &cwd).expect("args");
        assert_eq!(
            got.dir,
            Some(cwd.join("proj").to_string_lossy().into_owned())
        );
        assert!(got.run);
    }

    #[test]
    fn launch_args_flags_only_is_applied() {
        let got = launch_args_to_apply(&argv(&["--yes"]), &std::env::temp_dir()).expect("args");
        assert!(got.yes);
        assert_eq!(got.dir, None);
    }

    // A parse error never takes the app down: it degrades to "nothing to apply".
    #[test]
    fn launch_args_parse_error_is_none() {
        let cwd = std::env::temp_dir();
        assert_eq!(launch_args_to_apply(&argv(&["--bogus"]), &cwd), None);
        assert_eq!(launch_args_to_apply(&argv(&["--task"]), &cwd), None);
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
