//! `InterviewState` — a *second* managed process, independent of the Run's sidecar.
//!
//! The Specs tab (C-0018) conducts an **Interview**: it spawns
//! `loopy interview <dir> --emit-events`, which talks the same NDJSON Transport
//! as the Run's sidecar. But it is deliberately **not** the sidecar.
//!
//! Why a separate managed state? [`crate::sidecar::SidecarState::start`] *kills
//! the previous sidecar* ("one Run at a time", `sidecar.rs`). The Interview must
//! never kill an in-flight Run (spec Boundary "Never"). So it lives in its own
//! `Mutex<Option<…>>` and its `start`/`stop` only ever touch *its own* process —
//! the Interview's effect on a Run is that of a dirty parent (D22), never a kill.
//!
//! It mirrors `SidecarState` closely and **reuses** its primitives —
//! [`emit_lines`], [`resolve_sidecar_path`], [`login_shell_path`] (and, through
//! `emit_lines`, `LineFramer`) — so the two managed processes stay byte-for-byte
//! consistent on framing and PATH recovery.

use std::io::Write;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Emitter, Manager};

use crate::sidecar::{emit_lines, login_shell_path, resolve_sidecar_path};

// ---------------------------------------------------------------------------
// Argv construction — the engine always injects `interview` + `--emit-events`
// ---------------------------------------------------------------------------

/// Build the argv for `loopy interview <dir> --emit-events [flags…]`.
///
/// The Rust side **always** injects `--emit-events` (mirroring how the Run
/// always gets `--no-tui --emit-events`): the process exists to speak to the
/// GUI, so the flag is not optional. The remaining flags (`--change`,
/// `--phase`, `--agent`, `--model`, `--effort`) come from the React caller.
///
/// Pure + testable — the spawn side effect lives in [`InterviewState::start`].
fn build_interview_argv(dir: &str, flags: &[String]) -> Vec<String> {
    let mut argv = vec![
        "interview".to_string(),
        dir.to_string(),
        "--emit-events".to_string(),
    ];
    argv.extend_from_slice(flags);
    argv
}

// ---------------------------------------------------------------------------
// NDJSON command formatting — one line, no interior newline (mirrors sidecar's
// `format_approval_decision`; the TS transport duplicates these GUI→engine
// commands, so these Rust helpers are the future boundary / test anchor).
// ---------------------------------------------------------------------------

/// Format a `question_answer` command as a single NDJSON line.
///
/// The user's answer `text` may contain literal newlines (a multi-line answer);
/// `serde_json` escapes them to `\n`, so the emitted string is always a single
/// physical line — the NDJSON invariant `send_command` relies on.
#[allow(dead_code)]
pub fn format_question_answer(question_id: &str, text: &str, attachments: &[String]) -> String {
    let mut obj = serde_json::json!({
        "command": "question_answer",
        "questionId": question_id,
        "text": text,
    });
    // `attachments?` is optional (spec) — omit it entirely when empty so the
    // wire shape matches the React caller, which sends it only when present.
    if !attachments.is_empty() {
        obj["attachments"] = serde_json::json!(attachments);
    }
    obj.to_string()
}

/// Format a `phase_wrap_up` command ("Chega, grave o que temos" — D17).
#[allow(dead_code)]
pub fn format_phase_wrap_up() -> String {
    serde_json::json!({ "command": "phase_wrap_up" }).to_string()
}

/// Format an `interview_cancel` command.
#[allow(dead_code)]
pub fn format_interview_cancel() -> String {
    serde_json::json!({ "command": "interview_cancel" }).to_string()
}

// ---------------------------------------------------------------------------
// InterviewState — managed Tauri state for the interview process
// ---------------------------------------------------------------------------

pub struct InterviewState {
    inner: Mutex<Option<InterviewInner>>,
}

struct InterviewInner {
    stdin: ChildStdin,
    pid: u32,
}

impl InterviewState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    /// Returns `true` if an interview process is currently running.
    #[allow(dead_code)]
    pub fn is_running(&self) -> bool {
        self.inner
            .lock()
            .map(|inner| inner.is_some())
            .unwrap_or(false)
    }

    /// Spawn `loopy interview` and set up stdout/stderr/exit event forwarding.
    ///
    /// If a *previous interview* is already running it is stopped first (one
    /// Interview at a time). Crucially, this only touches `InterviewState`'s own
    /// process — it **never** reaches into [`crate::sidecar::SidecarState`], so
    /// starting an Interview cannot kill an in-flight Run (spec Boundary "Never").
    pub fn start(&self, app: &AppHandle, dir: &str, args: Vec<String>) -> Result<(), String> {
        // Stops only the prior *interview* process — self.inner, not the Run.
        self.stop()?;

        let argv = build_interview_argv(dir, &args);

        let sidecar_bin = resolve_sidecar_path()?;

        let mut command = Command::new(sidecar_bin);
        command
            .args(&argv)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Recover the login-shell PATH so the interview process (and the ACP
        // agent adapters it spawns via `npx`/`node`) resolve inside a `.app`,
        // which otherwise runs with launchd's minimal PATH. Same reason as the
        // sidecar — the `.app` opened by the tray does not inherit the user PATH.
        if let Some(path) = login_shell_path() {
            command.env("PATH", path);
        }

        let mut child = command
            .spawn()
            .map_err(|e| format!("Failed to spawn interview: {e}"))?;

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
            *inner = Some(InterviewInner { stdin, pid });
        }

        // stdout → interview://line
        let app_stdout = app.clone();
        thread::spawn(move || {
            emit_lines(stdout, &app_stdout, "interview://line");
        });

        // stderr → interview://stderr
        let app_stderr = app.clone();
        thread::spawn(move || {
            emit_lines(stderr, &app_stderr, "interview://stderr");
        });

        // wait → interview://exit
        let app_wait = app.clone();
        thread::spawn(move || {
            wait_and_emit(child, pid, &app_wait);
        });

        Ok(())
    }

    /// Write a command line to the interview's stdin (one NDJSON frame).
    #[allow(dead_code)]
    pub fn send_command(&self, payload: &str) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        let handle = inner.as_mut().ok_or("No interview running")?;
        writeln!(handle.stdin, "{payload}")
            .map_err(|e| format!("Failed to write to interview stdin: {e}"))?;
        handle
            .stdin
            .flush()
            .map_err(|e| format!("Failed to flush interview stdin: {e}"))?;
        Ok(())
    }

    /// Kill the running interview (if any). Idempotent — a no-op when none runs.
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
// Internal helpers — mirror sidecar.rs but bound to the interview:// channel
// and to InterviewState (not SidecarState). Line framing is shared: the stdout
// and stderr threads reuse `sidecar::emit_lines`.
// ---------------------------------------------------------------------------

/// Wait for the interview process to exit and emit `interview://exit` with the
/// code. Cleans up `InterviewState` if this PID is still the active interview.
fn wait_and_emit(mut child: Child, pid: u32, app: &AppHandle) {
    let code = match child.wait() {
        Ok(s) => s.code().unwrap_or(-1),
        Err(_) => -1,
    };
    let _ = app.emit("interview://exit", code);

    // Clean up state if this PID is still the active interview
    if let Some(state) = app.try_state::<InterviewState>() {
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
    use crate::sidecar::{LineFramer, SidecarState};

    // -- argv construction --------------------------------------------------
    // The engine ALWAYS injects the `interview` subcommand + `--emit-events`;
    // the phase flags come from React.

    #[test]
    fn argv_injects_subcommand_dir_and_emit_events() {
        let argv = build_interview_argv("/proj", &[]);
        assert_eq!(argv, vec!["interview", "/proj", "--emit-events"]);
    }

    #[test]
    fn argv_appends_react_flags_after_emit_events() {
        let flags = vec![
            "--change".to_string(),
            "C-0018".to_string(),
            "--phase".to_string(),
            "spec".to_string(),
        ];
        let argv = build_interview_argv("/proj", &flags);
        assert_eq!(
            argv,
            vec![
                "interview",
                "/proj",
                "--emit-events",
                "--change",
                "C-0018",
                "--phase",
                "spec",
            ]
        );
    }

    #[test]
    fn argv_always_contains_emit_events_even_with_custom_flags() {
        // React never has to remember `--emit-events` — the engine forces it.
        let flags = vec!["--agent".to_string(), "claude".to_string()];
        let argv = build_interview_argv("/proj", &flags);
        assert!(argv.contains(&"--emit-events".to_string()));
        assert_eq!(argv.first().unwrap(), "interview");
    }

    // -- NDJSON command formatting ------------------------------------------
    // One physical line, no interior newline — the invariant `send_command`
    // relies on (writeln! adds exactly one trailing newline).

    #[test]
    fn question_answer_is_well_formed_single_line() {
        let json = format_question_answer("q1", "use zustand", &[]);
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["command"], "question_answer");
        assert_eq!(v["questionId"], "q1");
        assert_eq!(v["text"], "use zustand");
        assert!(v.get("attachments").is_none(), "empty attachments omitted");
        assert!(!json.contains('\n'), "NDJSON must be a single line");
    }

    #[test]
    fn question_answer_includes_attachments_when_present() {
        let attachments = vec![
            ".loopy/attachments/20260725-143012-erro.png".to_string(),
            ".loopy/attachments/20260725-143013-app.log".to_string(),
        ];
        let json = format_question_answer("q2", "see attached", &attachments);
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(
            v["attachments"][0],
            ".loopy/attachments/20260725-143012-erro.png"
        );
        assert_eq!(
            v["attachments"][1],
            ".loopy/attachments/20260725-143013-app.log"
        );
        assert!(!json.contains('\n'), "NDJSON must be a single line");
    }

    #[test]
    fn question_answer_with_multiline_text_stays_single_line() {
        // A multi-line user answer must not break the NDJSON frame: serde_json
        // escapes the interior newline to `\n`, so no literal newline survives.
        let json = format_question_answer("q3", "line one\nline two\nline three", &[]);
        assert!(
            !json.contains('\n'),
            "interior newline must be JSON-escaped, not literal"
        );
        // …and it still round-trips back to the exact multi-line text.
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["text"], "line one\nline two\nline three");
    }

    #[test]
    fn phase_wrap_up_is_single_line() {
        let json = format_phase_wrap_up();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["command"], "phase_wrap_up");
        assert!(!json.contains('\n'), "NDJSON must be a single line");
    }

    #[test]
    fn interview_cancel_is_single_line() {
        let json = format_interview_cancel();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["command"], "interview_cancel");
        assert!(!json.contains('\n'), "NDJSON must be a single line");
    }

    // -- line framing (reused LineFramer) -----------------------------------
    // The interview reuses sidecar's LineFramer; confirm it frames the
    // interview control/event NDJSON exactly as the Run's stream does.

    #[test]
    fn line_framer_splits_interview_ndjson_frames() {
        let mut f = LineFramer::new();
        let chunk = b"{\"control\":\"phase_started\",\"phase\":\"spec\"}\n{\"control\":\"question_asked\",\"questionId\":\"q1\"}\n";
        assert_eq!(
            f.feed(chunk),
            vec![
                "{\"control\":\"phase_started\",\"phase\":\"spec\"}",
                "{\"control\":\"question_asked\",\"questionId\":\"q1\"}",
            ]
        );
    }

    #[test]
    fn line_framer_holds_partial_interview_frame() {
        let mut f = LineFramer::new();
        assert!(f.feed(b"{\"control\":\"agent_act").is_empty());
        assert_eq!(
            f.feed(b"ivity\"}\n"),
            vec!["{\"control\":\"agent_activity\"}"]
        );
    }

    // -- separation from the Run's SidecarState -----------------------------

    #[test]
    fn stop_is_idempotent_when_never_started() {
        let state = InterviewState::new();
        assert!(state.stop().is_ok());
        // A second stop is a no-op and still Ok — never a double-kill error.
        assert!(state.stop().is_ok());
        assert!(!state.is_running());
    }

    #[test]
    fn interview_is_independent_of_the_run_sidecar() {
        // The whole reason InterviewState exists: operating on the Interview
        // never touches the Run's sidecar. They are two separate managed states
        // with independent `Mutex<Option<…>>`; InterviewState's methods only
        // ever reach into `self.inner`, so `start` (which calls `self.stop`)
        // cannot clear or kill the SidecarState.
        let sidecar = SidecarState::new();
        let interview = InterviewState::new();
        assert!(!sidecar.is_running());
        assert!(!interview.is_running());

        interview.stop().unwrap();
        interview.stop().unwrap();

        assert!(!interview.is_running());
        assert!(
            !sidecar.is_running(),
            "operating on InterviewState must not touch SidecarState"
        );
    }
}
