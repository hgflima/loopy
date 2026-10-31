/**
 * Host platform detection for the few UI details that differ per OS (shortcut
 * glyphs, the macOS-only popover vibrancy). Reads the webview's user agent —
 * WKWebView on macOS, WebKitGTK on Linux, WebView2 on Windows — so it needs no
 * extra Tauri plugin. Called at the point of use (never captured at module
 * scope), so tests can stub `navigator.userAgent`.
 */
export function isMacOS(): boolean {
  return typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
}

/** The primary shortcut modifier as shown to the user: `⌘` on macOS, `Ctrl+` elsewhere. */
export function modKeyLabel(): string {
  return isMacOS() ? "⌘" : "Ctrl+";
}
