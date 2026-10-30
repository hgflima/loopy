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
    let exe =
        std::env::current_exe().map_err(|e| format!("Failed to resolve executable path: {e}"))?;
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
    // every layout and take the first that exists (see sidecar_candidates).
    let candidates = sidecar_candidates(dir, triple, std::env::consts::EXE_SUFFIX);

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
    Err(format!(
        "No runnable sidecar binary found. Searched:\n{searched}"
    ))
}

/// Every layout the sidecar may have, in lookup order, each with `exe_suffix`
/// appended (`std::env::consts::EXE_SUFFIX`: `".exe"` on Windows, `""` elsewhere).
///
/// Pure (no I/O) so the Windows naming is testable on any host.
fn sidecar_candidates(dir: &Path, triple: &str, exe_suffix: &str) -> Vec<PathBuf> {
    vec![
        dir.join(format!("loopy{exe_suffix}")), // bundled .app (Contents/MacOS/loopy)
        dir.join(format!("loopy-{triple}{exe_suffix}")), // dev / flat, triple kept
        dir.join(format!("bin/loopy-{triple}{exe_suffix}")), // dev with bin/ prefix
        dir.join(format!("bin/loopy{exe_suffix}")), // flat bin/, triple stripped
    ]
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
    /// Bytes of `buf` already scanned for `\n` without finding one. The next
    /// `feed` resumes the search here instead of re-walking from the start —
    /// what keeps framing an unterminated line O(N) instead of O(N²). Reset to
    /// 0 whenever a complete line is drained or the buffer is flushed.
    scanned: usize,
}

impl LineFramer {
    pub fn new() -> Self {
        Self {
            buf: Vec::new(),
            scanned: 0,
        }
    }

    fn finish_line(&mut self, newline_pos: usize) -> String {
        let end = if newline_pos > 0 && self.buf[newline_pos - 1] == b'\r' {
            newline_pos - 1
        } else {
            newline_pos
        };
        let line = String::from_utf8_lossy(&self.buf[..end]).into_owned();
        self.buf.drain(..=newline_pos);
        self.scanned = 0;
        line
    }

    /// Feed a chunk of bytes; returns any complete lines (without trailing newline).
    pub fn feed(&mut self, chunk: &[u8]) -> Vec<String> {
        self.buf.extend_from_slice(chunk);
        let mut lines = Vec::new();
        while let Some(rel) = self.buf[self.scanned..].iter().position(|&b| b == b'\n') {
            lines.push(self.finish_line(self.scanned + rel));
        }
        // Whatever remains is an unterminated tail, so the next feed should
        // resume scanning from the end of the current buffer.
        self.scanned = self.buf.len();
        lines
    }

    /// Flush any remaining buffered data as a final (unterminated) line.
    pub fn flush(&mut self) -> Option<String> {
        self.scanned = 0;
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
    /// One Run at a time — by **refusing**, never by killing: with a sidecar
    /// alive this returns an error and leaves it untouched (C-0021 / B2: a
    /// `loopy open --run` used to kill a Run still starting up). Replacing a Run
    /// is an explicit `stop` first. The slot is held locked from the check to
    /// the store, so two concurrent starts can't both pass.
    pub fn start(&self, app: &AppHandle, dir: &str, flags: Vec<String>) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        ensure_no_live_sidecar(inner.is_some())?;

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

        *inner = Some(SidecarInner { stdin, pid });
        drop(inner);

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
///
/// Shared with [`crate::interview_process`] so the sidecar and the interview
/// process frame their streams identically — same reason the two reuse
/// [`LineFramer`], [`resolve_sidecar_path`] and [`login_shell_path`].
pub(crate) fn emit_lines<R: Read>(mut pipe: R, app: &AppHandle, event: &str) {
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
            release_if_current(&mut inner, pid, |h| h.pid);
        }
    }
}

/// Refuse a start while a sidecar is alive (see [`SidecarState::start`]).
fn ensure_no_live_sidecar(alive: bool) -> Result<(), String> {
    if alive {
        Err("Run em andamento: encerre-o antes de iniciar outro".to_string())
    } else {
        Ok(())
    }
}

/// Free the slot on exit — only if it still holds *this* pid, so a late exit
/// of an old process never frees a newer Run's slot.
fn release_if_current<T>(slot: &mut Option<T>, pid: u32, pid_of: impl Fn(&T) -> u32) {
    if slot.as_ref().is_some_and(|h| pid_of(h) == pid) {
        *slot = None;
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -- One Run at a time, never by killing (C-0021 / B2) -------------------

    #[test]
    fn start_is_refused_while_a_sidecar_is_alive() {
        assert!(ensure_no_live_sidecar(false).is_ok());
        let err = ensure_no_live_sidecar(true).unwrap_err();
        assert!(err.contains("Run em andamento"), "{err}");
    }

    #[test]
    fn exit_frees_the_slot_only_for_the_current_pid() {
        let mut slot = Some(42u32);
        release_if_current(&mut slot, 7, |p| *p);
        assert_eq!(slot, Some(42), "a stale exit must not free a newer Run");
        release_if_current(&mut slot, 42, |p| *p);
        assert_eq!(slot, None);
        // …and once freed, a new start is allowed again.
        assert!(ensure_no_live_sidecar(slot.is_some()).is_ok());
    }

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
        assert_eq!(f.feed(b"_started\"}\n"), vec!["{\"type\":\"run_started\"}"]);
    }

    // -- linearity invariant (kills the O(N²) framer cliff, T-004) -----------
    // The scan resumes from `scanned` instead of re-walking the whole buffer on
    // every chunk. We assert the MECHANISM, not the clock: `scanned` advances
    // with the buffer and never restarts from zero while the line stays open,
    // and it zeroes the moment the line closes (drain) or is flushed.

    #[test]
    fn scanned_resumes_and_never_rescans_open_line() {
        let mut f = LineFramer::new();
        let chunk = [b'x'; 4096];

        // First 4 KB, no newline: the whole chunk is scanned, no line yet.
        assert!(f.feed(&chunk).is_empty());
        assert_eq!(f.scanned, 4096);

        // Second 4 KB: the scan resumes at 4096 and only walks the new bytes —
        // scanned ends at 8192, it did NOT re-walk the first 4 KB from zero.
        assert!(f.feed(&chunk).is_empty());
        assert_eq!(f.scanned, 8192);

        // The feed that closes the line drains it and zeroes the offset.
        let lines = f.feed(b"\n");
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].len(), 8192);
        assert_eq!(f.scanned, 0);
    }

    #[test]
    fn ten_mb_line_framed_once_with_no_byte_lost_or_duplicated() {
        const SIZE: usize = 10 * 1024 * 1024;
        // Deterministic non-newline payload so byte integrity is checkable.
        let payload: Vec<u8> = (0..SIZE).map(|i| b'a' + (i % 26) as u8).collect();

        let mut f = LineFramer::new();
        let mut lines = Vec::new();
        for chunk in payload.chunks(4096) {
            lines.extend(f.feed(chunk));
        }
        // No line is emitted until the terminator arrives.
        assert!(lines.is_empty());
        lines.extend(f.feed(b"\n"));

        assert_eq!(lines.len(), 1, "a 10 MB line frames as exactly one line");
        let framed = &lines[0];
        assert_eq!(
            framed.len(),
            SIZE,
            "exact size — no byte lost or duplicated"
        );
        assert_eq!(
            framed.as_bytes(),
            &payload[..],
            "content preserved byte-for-byte"
        );
        assert_eq!(f.scanned, 0, "closing the line zeroes the offset");
    }

    #[test]
    fn flush_zeroes_scanned() {
        let mut f = LineFramer::new();
        f.feed(b"partial-no-newline");
        assert_eq!(f.scanned, "partial-no-newline".len());
        assert_eq!(f.flush(), Some("partial-no-newline".to_string()));
        assert_eq!(f.scanned, 0);
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

    // -- sidecar_candidates tests -------------------------------------------

    const TRIPLE: &str = "x86_64-pc-windows-msvc";

    #[test]
    fn candidates_without_suffix_match_unix_layouts() {
        let dir = Path::new("/app");
        assert_eq!(
            sidecar_candidates(dir, TRIPLE, ""),
            vec![
                dir.join("loopy"),
                dir.join(format!("loopy-{TRIPLE}")),
                dir.join(format!("bin/loopy-{TRIPLE}")),
                dir.join("bin/loopy"),
            ]
        );
    }

    #[test]
    fn candidates_with_exe_suffix_append_it_to_every_layout() {
        let dir = Path::new("/app");
        assert_eq!(
            sidecar_candidates(dir, TRIPLE, ".exe"),
            vec![
                dir.join("loopy.exe"),
                dir.join(format!("loopy-{TRIPLE}.exe")),
                dir.join(format!("bin/loopy-{TRIPLE}.exe")),
                dir.join("bin/loopy.exe"),
            ]
        );
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
