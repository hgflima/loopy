//! macOS: turn the tray popover into a non-activating `NSPanel` so it floats
//! over whatever is on screen — fullscreen apps included — exactly like a native
//! menubar popover.
//!
//! Why a panel and not a plain window: a Tauri window is an `NSWindow`, and
//! showing/focusing it *activates the app*. When another app owns the current
//! (fullscreen) Space, activating moves our window onto its own Desktop Space
//! instead of overlaying the fullscreen one — so the popover opens on a Space
//! you can't see and the click looks like it failed. A `NonActivatingPanel` with
//! `CanJoinAllSpaces | FullScreenAuxiliary` shows *without* activating,
//! overlaying the current Space in place. Built on the `tauri-nspanel` plugin —
//! the de-facto Tauri approach, mirroring ahkohd's macOS menubar example.

// `tauri-nspanel` v2 bridges through the now-deprecated `cocoa`/`objc` crates,
// and its `panel_delegate!` macro expands `objc` internals that reference a
// legacy `cargo-clippy` cfg. Both are inherent to the plugin's API surface and
// unfixable from here, so silence them for this bridge module only — the
// plugin's own menubar example does the same `#![allow(deprecated)]`.
#![allow(deprecated)]
#![allow(unexpected_cfgs)]

use std::sync::Mutex;

use tauri::{
    tray::TrayIconEvent, AppHandle, Emitter, Listener, Manager, PhysicalPosition, PhysicalSize,
};
use tauri_nspanel::{
    cocoa::appkit::{NSMainMenuWindowLevel, NSWindowCollectionBehavior},
    panel_delegate, ManagerExt, WebviewWindowExt,
};
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

/// Label of the popover window declared in `tauri.conf.json`.
const POPOVER: &str = "popover";

/// Corner radius of the vibrant popover surface, in points. Matches a native
/// macOS menubar popover (~ the `--r-lg` token on the web side).
const POPOVER_CORNER_RADIUS: f64 = 10.0;

/// Native material behind the popover webview. `Menu` (not `Popover`) gives the
/// more solid, opaque backdrop of a real `NSMenu` — the tray popover is styled
/// and operated as a native menu (C-0012), so its chrome should match. Both are
/// non-deprecated semantic materials in `window-vibrancy` 0.6 (macOS 10.11+).
const POPOVER_MATERIAL: NSVisualEffectMaterial = NSVisualEffectMaterial::Menu;

/// Popover content width, in points — mirrors the `popover` window in
/// `tauri.conf.json`. Height is driven by content (see `resize_popover_panel`).
const POPOVER_WIDTH: f64 = 320.0;

/// Internal event fired when the popover panel loses key focus (clicked away).
const DID_RESIGN_KEY: &str = "popover-panel://did-resign-key";

/// `NSWindowStyleMaskNonactivatingPanel` — lets the panel become key *without*
/// activating the app, so showing it never steals focus or switches Spaces.
const NS_NONACTIVATING_PANEL: i32 = 1 << 7;

/// Gap between the bottom of the menubar and the top of the popover, in
/// logical points — matched to a native status-item menu. Measured against a
/// native `NSMenu` (e.g. OrbStack) the drop is ~2 pt, not the 6 pt this used to
/// assume; at 6 pt the popover visibly hung lower than every native menubar menu.
const POPOVER_TOP_GAP: f64 = 2.0;

/// Last known tray icon rect — `(top-left position, size)` in *physical*
/// pixels with a top-left screen origin — captured from every tray event.
/// tray-icon reports `position.y` as the icon's TOP edge (0 for a menubar
/// icon), so dropping the popover below the bar means adding `size.height`.
pub struct TrayRect(Mutex<Option<(PhysicalPosition<f64>, PhysicalSize<f64>)>>);

/// Swizzle the popover `NSWindow` into a floating `NSPanel` and configure it to
/// overlay fullscreen Spaces. Call once, in `setup`, after the window exists.
/// No-op-with-log on any failure (errors as values at the boundary — AD-5).
pub fn install_popover_panel(app: &AppHandle) {
    // Tray rect store first, so it exists before the tray icon emits events.
    app.manage(TrayRect(Mutex::new(None)));

    let Some(window) = app.get_webview_window(POPOVER) else {
        eprintln!("[panel] no '{POPOVER}' window to convert");
        return;
    };

    // `POPOVER_MATERIAL` behind the transparent popover webview, so it reads as a
    // real menubar surface (translucent + rounded) instead of a flat opaque box.
    // `Active` (not the default follows-window-active) keeps it vibrant even
    // though this panel never activates the app — otherwise it would render
    // permanently greyed-out. Errors as values (AD-5): log and carry on; a
    // missing material is cosmetic, not a reason to skip the whole panel install.
    if let Err(err) = apply_vibrancy(
        &window,
        POPOVER_MATERIAL,
        Some(NSVisualEffectState::Active),
        Some(POPOVER_CORNER_RADIUS),
    ) {
        eprintln!("[panel] vibrancy not applied to '{POPOVER}': {err}");
    }

    // Dismiss like a real menubar popover: hide once the panel loses key focus
    // (the user clicked another app/window).
    let delegate = panel_delegate!(PopoverPanelDelegate { window_did_resign_key });
    let emit_handle = app.clone();
    delegate.set_listener(Box::new(move |event: String| {
        if event == "window_did_resign_key" {
            let _ = emit_handle.emit(DID_RESIGN_KEY, ());
        }
    }));

    let panel = match window.to_panel() {
        Ok(panel) => panel,
        Err(_) => {
            eprintln!("[panel] failed to convert '{POPOVER}' to NSPanel");
            return;
        }
    };

    // Above the menu bar, present on every Space — including other apps'
    // fullscreen Spaces (that's what `FullScreenAuxiliary` unlocks).
    panel.set_level(NSMainMenuWindowLevel + 1);
    panel.set_collection_behaviour(
        NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
            | NSWindowCollectionBehavior::NSWindowCollectionBehaviorStationary
            | NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary,
    );
    panel.set_style_mask(NS_NONACTIVATING_PANEL);
    panel.set_delegate(delegate);

    let hide_handle = app.clone();
    app.listen(DID_RESIGN_KEY, move |_| hide_popover_panel(&hide_handle));
}

/// Toggle the popover panel near the tray. Shows *without* activating the app,
/// so it overlays fullscreen apps instead of forcing a Space switch.
pub fn toggle_popover_panel(app: &AppHandle) {
    let Ok(panel) = app.get_webview_panel(POPOVER) else {
        eprintln!("[panel] toggle before '{POPOVER}' panel is installed");
        return;
    };
    if panel.is_visible() {
        panel.order_out(None);
        return;
    }
    // Position under the tray icon before showing (positioner tracks the rect).
    position_popover(app);
    panel.show();
}

/// Record the tray icon rect carried by `event`. Fed from the tray event
/// handler in `main.rs`, alongside the positioner plugin's own feed.
pub fn track_tray_rect(app: &AppHandle, event: &TrayIconEvent) {
    let rect = match event {
        TrayIconEvent::Click { rect, .. }
        | TrayIconEvent::Enter { rect, .. }
        | TrayIconEvent::Move { rect, .. }
        | TrayIconEvent::Leave { rect, .. } => rect,
        _ => return,
    };
    // tray-icon fills the Rect with Physical variants; scale 1.0 reads them raw
    // (same trick tauri-plugin-positioner uses).
    let position = rect.position.to_physical::<f64>(1.0);
    let size = rect.size.to_physical::<f64>(1.0);
    if let Some(state) = app.try_state::<TrayRect>() {
        *state.0.lock().unwrap() = Some((position, size));
    }
}

/// Anchor the popover's top-left at the tray icon's *bottom*-left, dropping it
/// just below the menubar like a native status-item menu.
///
/// Why not `positioner::TrayBottomLeft`: tray-icon reports the icon rect with
/// `y` at the icon's TOP edge (0 for a menubar icon, top-left screen origin),
/// and every `Tray*` positioner variant resolves to that raw `tray_y` on
/// macOS — none adds the icon height. At `NSMainMenuWindowLevel + 1` the panel
/// also escapes AppKit's menubar constraint, so it rendered OVER the bar. The
/// correct top is `tray_y + tray_height (+ gap)`, computed here from the rect
/// tracked by `track_tray_rect`.
pub fn position_popover(app: &AppHandle) {
    let Some(window) = app.get_webview_window(POPOVER) else {
        return;
    };
    let tray = app.state::<TrayRect>();
    let rect = *tray.0.lock().unwrap();
    let Some((tray_position, tray_size)) = rect else {
        // Nothing tracked yet (content resize on app start, popover hidden):
        // leave the window as-is — the tray click that shows it records the
        // rect before toggling.
        return;
    };
    let scale_factor = window.scale_factor().unwrap_or(1.0);
    let target = popover_origin(tray_position, tray_size, scale_factor);
    eprintln!(
        "[panel] tray rect pos=({:.0}, {:.0}) size={:.0}x{:.0} scale={scale_factor} -> popover top-left=({:.0}, {:.0})",
        tray_position.x, tray_position.y, tray_size.width, tray_size.height, target.x, target.y
    );
    let _ = window.set_position(target);
}

/// Pure math (AD-6): popover top-left from the tray icon rect (physical px,
/// top-left origin) — left edges aligned, top dropped below the icon by the
/// icon height plus the native-menu gap.
fn popover_origin(
    tray_position: PhysicalPosition<f64>,
    tray_size: PhysicalSize<f64>,
    scale_factor: f64,
) -> PhysicalPosition<f64> {
    PhysicalPosition::new(
        tray_position.x,
        tray_position.y + tray_size.height + POPOVER_TOP_GAP * scale_factor,
    )
}

/// Size the popover panel to the content height the frontend measured, then
/// re-anchor it under the tray. Uses the panel's *synchronous* `setContentSize:`
/// on the main thread — the window-level `set_size` goes through tao's async
/// path, which did not stick on the swizzled panel and left it at its full
/// config height. Runs on the main thread because it touches AppKit directly;
/// the panel handle isn't `Send`, so it's fetched inside the closure.
pub fn resize_popover_panel(app: &AppHandle, height: f64) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Ok(panel) = handle.get_webview_panel(POPOVER) {
            panel.set_content_size(POPOVER_WIDTH, height);
        }
        position_popover(&handle);
    });
}

/// Order the popover panel out. Used on resign-key and when surfacing `main`.
pub fn hide_popover_panel(app: &AppHandle) {
    if let Ok(panel) = app.get_webview_panel(POPOVER) {
        panel.order_out(None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn popover_origin_drops_below_the_menubar_left_aligned() {
        // Menubar icon on a notched 2x display: icon top at y=0, bar 74px tall.
        let origin = popover_origin(
            PhysicalPosition::new(2404.0, 0.0),
            PhysicalSize::new(80.0, 74.0),
            2.0,
        );

        assert_eq!(origin.x, 2404.0);
        assert_eq!(origin.y, 74.0 + POPOVER_TOP_GAP * 2.0);
    }

    #[test]
    fn popover_uses_the_native_menu_material() {
        // C-0012: the tray popover mimics a native `NSMenu`, so its backdrop must
        // be the `Menu` material — more solid/opaque than `Popover`. Guards against
        // a silent regression back to `Popover`.
        assert_eq!(POPOVER_MATERIAL, NSVisualEffectMaterial::Menu);
    }

    #[test]
    fn popover_origin_scales_gap_by_backing_factor() {
        // 1x display: 24px menubar, gap stays in raw points.
        let origin = popover_origin(
            PhysicalPosition::new(1000.0, 0.0),
            PhysicalSize::new(40.0, 24.0),
            1.0,
        );

        assert_eq!(origin.y, 24.0 + POPOVER_TOP_GAP);
    }
}
