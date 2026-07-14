use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Emitter, Manager};

// ---------------------------------------------------------------------------
// Sidecar binary resolution — matches Tauri externalBin conventions
// ---------------------------------------------------------------------------

/// Resolve the sidecar binary path.
///
/// `externalBin: ["bin/loopy"]` in `tauri.conf.json` means the binary is placed
/// next to the main executable (inside `bin/`) by `tauri build`/`tauri dev`.
/// The target triple is embedded at compile-time by `tauri_build::build()`.
pub(crate) fn resolve_sidecar_path() -> Result<PathBuf, String> {
    let triple = env!("TAURI_ENV_TARGET_TRIPLE");
    let exe = std::env::current_exe()
        .map_err(|e| format!("Failed to resolve executable path: {e}"))?;
    let dir = exe
        .parent()
        .ok_or_else(|| "Executable has no parent directory".to_string())?;

    // NOTE: `build.rs` writes a 0-byte, mode-644 placeholder at
    // `bin/loopy-<triple>` so `tauri_build` doesn't fail before the real
    // sidecar is compiled. `tauri dev` copies that placeholder beside the exe.
    // Selecting by `Path::exists()` would pick the placeholder and spawning it
    // fails with EACCES (os error 13). We require a runnable executable so the
    // placeholder is skipped in favour of a real binary (see is_executable_file).

    // The bundled `.app` and `tauri dev` name the sidecar differently. When
    // `tauri build` bundles `externalBin: ["bin/loopy"]` it STRIPS both the
    // `bin/` prefix and the `-<triple>` suffix, placing it flat beside the main
    // executable as `Contents/MacOS/loopy`. `tauri dev` keeps the triple. Try
    // every layout and take the first that exists.
    let candidates = [
        dir.join("loopy"),                       // bundled .app (Contents/MacOS/loopy)
        dir.join(format!("loopy-{triple}")),     // dev / flat, triple kept
        dir.join(format!("bin/loopy-{triple}")), // dev with bin/ prefix
        dir.join("bin/loopy"),                   // flat bin/, triple stripped
    ];

    for candidate in &candidates {
        if is_executable_file(candidate) {
            return Ok(candidate.clone());
        }
    }

    let searched = candidates
        .iter()
        .map(|c| {
            let note = if c.exists() {
                " (present but not a runnable executable — run `npm run build:sidecar`)"
            } else {
                ""
            };
            format!("  {}{note}", c.display())
        })
        .collect::<Vec<_>>()
        .join("\n");
    Err(format!("No runnable sidecar binary found. Searched:\n{searched}"))
}

/// Whether `path` is a regular, non-empty file with an executable bit set.
///
/// [`Path::exists`] is `true` for directories and for the 0-byte, mode-644
/// placeholder that `build.rs` creates (and `tauri dev` copies beside the
/// exe). Spawning such a path fails with EACCES (os error 13). Requiring a
/// runnable executable makes the resolver skip the placeholder and fall
/// through to the real binary — or report a precise, actionable error.
fn is_executable_file(path: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    if !meta.is_file() || meta.len() == 0 {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        meta.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// Resolve the user's login-shell `PATH`.
///
/// A macOS `.app` launched from Finder/the menubar tray does **not** inherit
/// the interactive shell's `PATH` — it gets the minimal launchd default
/// (`/usr/bin:/bin:/usr/sbin:/sbin`). Version managers (nvm), `~/.local/bin`
/// and `~/.bun/bin` live outside that, so the sidecar can't spawn the ACP
/// agent adapter (`npx …`) and the Run dies before `run_started`.
///
/// We recover the real `PATH` the way `fix-path-for-macos` does: ask the login
/// shell (`$SHELL -ilc 'echo $PATH'`). Interactive (`-i`) is required so files
/// like `.zshrc`, where nvm usually lives, are sourced. Best-effort: returns
/// `None` on any failure and the caller falls back to the inherited `PATH`.
pub(crate) fn login_shell_path() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let output = Command::new(&shell)
        .args(["-ilc", "echo $PATH"])
        .stdin(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}

// ---------------------------------------------------------------------------
// LineFramer — accumulates raw bytes and emits complete lines
// ---------------------------------------------------------------------------

/// Buffers incoming byte chunks and yields complete lines (delimited by `\n`).
/// Handles partial lines across chunks and optional `\r\n` line endings.
pub struct LineFramer {
    buf: Vec<u8>,
}

impl LineFramer {
    pub fn new() -> Self {
        Self { buf: Vec::new() }
    }

    /// Feed a chunk of bytes; returns any complete lines (without trailing newline).
    pub fn feed(&mut self, chunk: &[u8]) -> Vec<String> {
        self.buf.extend_from_slice(chunk);
        let mut lines = Vec::new();
        while let Some(pos) = self.buf.iter().position(|&b| b == b'\n') {
            let end = if pos > 0 && self.buf[pos - 1] == b'\r' {
                pos - 1
            } else {
                pos
            };
            let line = String::from_utf8_lossy(&self.buf[..end]).into_owned();
            lines.push(line);
            self.buf.drain(..=pos);
        }
        lines
    }

    /// Flush any remaining buffered data as a final (unterminated) line.
    pub fn flush(&mut self) -> Option<String> {
        if self.buf.is_empty() {
            None
        } else {
            let line = String::from_utf8_lossy(&self.buf).into_owned();
            self.buf.clear();
            Some(line)
        }
    }
}

// ---------------------------------------------------------------------------
// Approval decision helper
// ---------------------------------------------------------------------------

/// Format an `approval_decision` command as NDJSON.
/// Used by T-016 (ApprovalPrompt) via `send_command`.
#[allow(dead_code)]
pub fn format_approval_decision(request_id: &str, approved: bool) -> String {
    serde_json::json!({
        "type": "approval_decision",
        "requestId": request_id,
        "approved": approved,
    })
    .to_string()
}

// ---------------------------------------------------------------------------
// SidecarState — managed Tauri state for the sidecar process
// ---------------------------------------------------------------------------

pub struct SidecarState {
    inner: Mutex<Option<SidecarInner>>,
}

struct SidecarInner {
    stdin: ChildStdin,
    pid: u32,
}

impl SidecarState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    /// Returns `true` if a sidecar process is currently running.
    pub fn is_running(&self) -> bool {
        self.inner
            .lock()
            .map(|inner| inner.is_some())
            .unwrap_or(false)
    }

    /// Spawn the sidecar binary and set up stdout/stderr/exit event forwarding.
    ///
    /// If a sidecar is already running it is killed first (one Run at a time).
    pub fn start(&self, app: &AppHandle, dir: &str, flags: Vec<String>) -> Result<(), String> {
        self.stop()?;

        let mut args = vec![
            "--no-tui".to_string(),
            "--emit-events".to_string(),
            dir.to_string(),
        ];
        args.extend(flags);

        let sidecar_bin = resolve_sidecar_path()?;

        let mut command = Command::new(sidecar_bin);
        command
            .args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Recover the login-shell PATH so the sidecar (and the ACP agent
        // adapters it spawns via `npx`/`node`) resolve inside a `.app`, which
        // otherwise runs with launchd's minimal PATH. The sidecar inherits
        // this env and passes it down to the adapter processes.
        if let Some(path) = login_shell_path() {
            command.env("PATH", path);
        }

        let mut child = command
            .spawn()
            .map_err(|e| format!("Failed to spawn sidecar: {e}"))?;

        let pid = child.id();

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture stdout".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Failed to capture stderr".to_string())?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to capture stdin".to_string())?;

        {
            let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
            *inner = Some(SidecarInner { stdin, pid });
        }

        // stdout → sidecar://line
        let app_stdout = app.clone();
        thread::spawn(move || {
            emit_lines(stdout, &app_stdout, "sidecar://line");
        });

        // stderr → sidecar://stderr
        let app_stderr = app.clone();
        thread::spawn(move || {
            emit_lines(stderr, &app_stderr, "sidecar://stderr");
        });

        // wait → sidecar://exit
        let app_wait = app.clone();
        thread::spawn(move || {
            wait_and_emit(child, pid, &app_wait);
        });

        Ok(())
    }

    /// Write a command line to the sidecar's stdin (e.g. `approval_decision` NDJSON).
    pub fn send_command(&self, payload: &str) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        let handle = inner.as_mut().ok_or("No sidecar running")?;
        writeln!(handle.stdin, "{payload}")
            .map_err(|e| format!("Failed to write to sidecar stdin: {e}"))?;
        handle
            .stdin
            .flush()
            .map_err(|e| format!("Failed to flush sidecar stdin: {e}"))?;
        Ok(())
    }

    /// Kill the running sidecar (if any). Idempotent.
    pub fn stop(&self) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        if let Some(handle) = inner.take() {
            // Send SIGTERM on Unix; stdin drop causes broken pipe as fallback.
            #[cfg(unix)]
            {
                let _ = Command::new("kill")
                    .args(["-TERM", &handle.pid.to_string()])
                    .status();
            }
            drop(handle);
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Read from a pipe using [`LineFramer`] and emit each line as a Tauri event.
fn emit_lines<R: Read>(mut pipe: R, app: &AppHandle, event: &str) {
    let mut framer = LineFramer::new();
    let mut buf = [0u8; 4096];
    loop {
        match pipe.read(&mut buf) {
            Ok(0) => {
                // EOF — flush any partial trailing line
                if let Some(line) = framer.flush() {
                    let _ = app.emit(event, &line);
                }
                break;
            }
            Ok(n) => {
                for line in framer.feed(&buf[..n]) {
                    let _ = app.emit(event, &line);
                }
            }
            Err(_) => break,
        }
    }
}

/// Wait for the child process to exit and emit `sidecar://exit` with the code.
/// Also cleans up `SidecarState` if this is still the active sidecar (by PID).
fn wait_and_emit(mut child: Child, pid: u32, app: &AppHandle) {
    let code = match child.wait() {
        Ok(s) => s.code().unwrap_or(-1),
        Err(_) => -1,
    };
    let _ = app.emit("sidecar://exit", code);

    // Clean up state if this PID is still the active sidecar
    if let Some(state) = app.try_state::<SidecarState>() {
        if let Ok(mut inner) = state.inner.lock() {
            if inner.as_ref().is_some_and(|h| h.pid == pid) {
                *inner = None;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -- LineFramer tests ---------------------------------------------------

    #[test]
    fn complete_single_line() {
        let mut f = LineFramer::new();
        assert_eq!(f.feed(b"hello\n"), vec!["hello"]);
    }

    #[test]
    fn multiple_lines_in_one_chunk() {
        let mut f = LineFramer::new();
        assert_eq!(f.feed(b"a\nb\nc\n"), vec!["a", "b", "c"]);
    }

    #[test]
    fn partial_line_across_chunks() {
        let mut f = LineFramer::new();
        assert!(f.feed(b"hel").is_empty());
        assert_eq!(f.feed(b"lo\n"), vec!["hello"]);
    }

    #[test]
    fn partial_then_multiple() {
        let mut f = LineFramer::new();
        assert!(f.feed(b"hel").is_empty());
        assert_eq!(f.feed(b"lo\nworld\nfoo"), vec!["hello", "world"]);
        assert_eq!(f.flush(), Some("foo".to_string()));
    }

    #[test]
    fn flush_empty_returns_none() {
        let mut f = LineFramer::new();
        assert_eq!(f.flush(), None);
    }

    #[test]
    fn flush_returns_remaining() {
        let mut f = LineFramer::new();
        f.feed(b"partial");
        assert_eq!(f.flush(), Some("partial".to_string()));
        assert_eq!(f.flush(), None);
    }

    #[test]
    fn handles_crlf() {
        let mut f = LineFramer::new();
        assert_eq!(f.feed(b"hello\r\nworld\r\n"), vec!["hello", "world"]);
    }

    #[test]
    fn empty_lines() {
        let mut f = LineFramer::new();
        assert_eq!(f.feed(b"\n\n\n"), vec!["", "", ""]);
    }

    #[test]
    fn ndjson_lines() {
        let mut f = LineFramer::new();
        let chunk = b"{\"type\":\"run_started\"}\n{\"type\":\"task_started\",\"id\":\"T-001\"}\n";
        let lines = f.feed(chunk);
        assert_eq!(
            lines,
            vec![
                "{\"type\":\"run_started\"}",
                "{\"type\":\"task_started\",\"id\":\"T-001\"}",
            ]
        );
    }

    #[test]
    fn ndjson_split_across_chunks() {
        let mut f = LineFramer::new();
        assert!(f.feed(b"{\"type\":\"run").is_empty());
        assert_eq!(
            f.feed(b"_started\"}\n"),
            vec!["{\"type\":\"run_started\"}"]
        );
    }

    // -- approval_decision formatting tests ---------------------------------

    #[test]
    fn format_approval_approved() {
        let json = format_approval_decision("req-1", true);
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["type"], "approval_decision");
        assert_eq!(v["requestId"], "req-1");
        assert_eq!(v["approved"], true);
    }

    #[test]
    fn format_approval_rejected() {
        let json = format_approval_decision("req-2", false);
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["type"], "approval_decision");
        assert_eq!(v["requestId"], "req-2");
        assert_eq!(v["approved"], false);
    }

    #[test]
    fn format_approval_is_single_line() {
        let json = format_approval_decision("req-3", true);
        assert!(!json.contains('\n'), "NDJSON must be a single line");
    }

    // -- is_executable_file tests -------------------------------------------
    // These lock in the fix for the EACCES (os error 13) sidecar spawn bug:
    // the resolver must reject the 0-byte, mode-644 placeholder written by
    // build.rs and only accept a real, runnable executable.

    /// Unique temp path per test to avoid cross-test collisions.
    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("loopy-sidecar-test-{}-{name}", std::process::id()))
    }

    #[test]
    fn rejects_nonexistent_path() {
        let p = temp_path("missing");
        let _ = std::fs::remove_file(&p);
        assert!(!is_executable_file(&p));
    }

    #[test]
    fn rejects_empty_placeholder() {
        // Mirrors build.rs: File::create yields a 0-byte, non-executable file.
        let p = temp_path("placeholder");
        std::fs::File::create(&p).unwrap();
        let result = is_executable_file(&p);
        let _ = std::fs::remove_file(&p);
        assert!(!result, "0-byte placeholder must be rejected");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_non_executable_file_with_content() {
        use std::os::unix::fs::PermissionsExt;
        let p = temp_path("nonexec");
        std::fs::write(&p, b"#!/bin/sh\necho hi\n").unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o644)).unwrap();
        let result = is_executable_file(&p);
        let _ = std::fs::remove_file(&p);
        assert!(!result, "mode-644 file must be rejected");
    }

    #[cfg(unix)]
    #[test]
    fn accepts_executable_file_with_content() {
        use std::os::unix::fs::PermissionsExt;
        let p = temp_path("exec");
        std::fs::write(&p, b"#!/bin/sh\necho hi\n").unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        let result = is_executable_file(&p);
        let _ = std::fs::remove_file(&p);
        assert!(result, "mode-755 non-empty file must be accepted");
    }

    #[test]
    fn rejects_directory() {
        let p = temp_path("dir");
        std::fs::create_dir_all(&p).unwrap();
        let result = is_executable_file(&p);
        let _ = std::fs::remove_dir(&p);
        assert!(!result, "directory must be rejected even though it exists");
    }
}
