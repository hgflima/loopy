//! Pure parsing of the GUI argv (E2): `Loopy [dir] [--task <id>] [--yes]
//! [--verbose] [--run]`. No I/O — the caller supplies the argv and the cwd, so
//! the first launch (`std::env::args` + the app's cwd) and a forwarded second
//! instance (the plugin's argv + the *caller's* cwd, E3) share one parser.

use std::path::Path;

/// What the GUI was asked to open (E2). Parsed from argv on first launch and
/// from the forwarded argv of a second instance (E3) — one parser, two callers.
#[derive(Debug, Default, PartialEq, serde::Serialize, Clone)]
pub struct LaunchArgs {
    pub dir: Option<String>,
    pub task: Option<String>,
    pub yes: bool,
    pub verbose: bool,
    pub run: bool,
}

/// `cwd` resolves a relative `dir` against the *caller's* cwd, not the app's.
///
/// `argv[0]` is the executable and is ignored. macOS may inject a
/// process-serial-number argument (`-psn_…`) on launch; it is skipped. Errors
/// are values (AD-5): an unknown flag, a `--task` without a value, or a second
/// positional `dir` yield `Err` with a human-readable message.
pub fn parse_launch_args(argv: &[String], cwd: &Path) -> Result<LaunchArgs, String> {
    let mut out = LaunchArgs::default();
    let mut rest = argv.iter().skip(1);
    while let Some(arg) = rest.next() {
        match arg.as_str() {
            "--yes" => out.yes = true,
            "--verbose" => out.verbose = true,
            "--run" => out.run = true,
            "--task" => match rest.next() {
                Some(id) if !id.is_empty() && !id.starts_with('-') => {
                    out.task = Some(id.clone());
                }
                _ => return Err("--task exige um valor (<id>)".to_string()),
            },
            a if a.starts_with("-psn_") => {}
            a if a.starts_with('-') => return Err(format!("flag desconhecida: {a}")),
            a => {
                if out.dir.is_some() {
                    return Err(format!("argumento inesperado: {a} (só um dir é aceito)"));
                }
                out.dir = Some(cwd.join(a).to_string_lossy().into_owned());
            }
        }
    }
    Ok(out)
}

/// Every launch request not yet applied by the webview — the initial argv and
/// each second instance's (C-0021 / M3). The webview *drains* it; a request
/// never depends on a listener existing when it arrives, so none is lost to an
/// `emit` fired before the webview listened.
#[derive(Debug, Default)]
pub struct LaunchQueue(Vec<LaunchArgs>);

impl LaunchQueue {
    /// A queue that starts with the initial argv (if any). Seed it at creation:
    /// a second instance may be forwarded before `setup` runs.
    pub fn seeded(initial: Option<LaunchArgs>) -> Self {
        Self(initial.into_iter().collect())
    }

    pub fn push(&mut self, args: LaunchArgs) {
        self.0.push(args);
    }

    /// Everything queued, in arrival order; the queue is left empty.
    pub fn drain(&mut self) -> Vec<LaunchArgs> {
        std::mem::take(&mut self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn argv(args: &[&str]) -> Vec<String> {
        std::iter::once("Loopy")
            .chain(args.iter().copied())
            .map(String::from)
            .collect()
    }

    fn cwd() -> PathBuf {
        std::env::temp_dir().join("caller-cwd")
    }

    // -- LaunchQueue (C-0021 / M3) -------------------------------------------

    fn dir(d: &str) -> LaunchArgs {
        LaunchArgs {
            dir: Some(d.to_string()),
            ..LaunchArgs::default()
        }
    }

    #[test]
    fn queue_drains_every_request_in_arrival_order_then_empties() {
        let mut q = LaunchQueue::default();
        q.push(dir("/initial"));
        q.push(dir("/second"));
        q.push(dir("/third"));
        assert_eq!(
            q.drain(),
            vec![dir("/initial"), dir("/second"), dir("/third")]
        );
        assert_eq!(q.drain(), Vec::<LaunchArgs>::new());
    }

    #[test]
    fn the_initial_argv_always_comes_first() {
        // A second instance can fire before `setup` runs (C-0021 verification:
        // `loopy open B; loopy open C` opened B) — so the initial argv seeds
        // the queue when it is created, not later.
        let mut q = LaunchQueue::seeded(Some(dir("/b")));
        q.push(dir("/c"));
        assert_eq!(q.drain(), vec![dir("/b"), dir("/c")]);
        assert_eq!(LaunchQueue::seeded(None).drain(), Vec::<LaunchArgs>::new());
    }

    #[test]
    fn a_request_pushed_after_a_drain_is_not_lost() {
        let mut q = LaunchQueue::default();
        q.push(dir("/a"));
        assert_eq!(q.drain(), vec![dir("/a")]);
        q.push(dir("/b"));
        assert_eq!(q.drain(), vec![dir("/b")]);
    }

    #[test]
    fn empty_argv_is_default() {
        assert_eq!(parse_launch_args(&[], &cwd()), Ok(LaunchArgs::default()));
    }

    #[test]
    fn only_executable_is_default() {
        assert_eq!(
            parse_launch_args(&argv(&[]), &cwd()),
            Ok(LaunchArgs::default())
        );
    }

    #[test]
    fn relative_dir_resolves_against_caller_cwd() {
        let got = parse_launch_args(&argv(&["proj/a"]), &cwd()).unwrap();
        let expected = cwd().join("proj/a").to_string_lossy().into_owned();
        assert_eq!(got.dir, Some(expected));
    }

    #[test]
    fn absolute_dir_is_kept() {
        let abs = std::env::temp_dir().join("abs-proj");
        let abs_str = abs.to_string_lossy().into_owned();
        let got = parse_launch_args(&argv(&[&abs_str]), &cwd()).unwrap();
        assert_eq!(got.dir, Some(abs_str));
    }

    #[test]
    fn task_flag_takes_value() {
        let got = parse_launch_args(&argv(&["--task", "C-0020/T-011"]), &cwd()).unwrap();
        assert_eq!(got.task.as_deref(), Some("C-0020/T-011"));
    }

    #[test]
    fn task_without_value_is_error() {
        assert!(parse_launch_args(&argv(&["--task"]), &cwd()).is_err());
    }

    #[test]
    fn task_followed_by_flag_is_error() {
        assert!(parse_launch_args(&argv(&["--task", "--yes"]), &cwd()).is_err());
    }

    #[test]
    fn yes_flag() {
        let got = parse_launch_args(&argv(&["--yes"]), &cwd()).unwrap();
        assert!(got.yes);
        assert_eq!(
            got,
            LaunchArgs {
                yes: true,
                ..LaunchArgs::default()
            }
        );
    }

    #[test]
    fn verbose_flag() {
        let got = parse_launch_args(&argv(&["--verbose"]), &cwd()).unwrap();
        assert_eq!(
            got,
            LaunchArgs {
                verbose: true,
                ..LaunchArgs::default()
            }
        );
    }

    #[test]
    fn run_flag() {
        let got = parse_launch_args(&argv(&["--run"]), &cwd()).unwrap();
        assert_eq!(
            got,
            LaunchArgs {
                run: true,
                ..LaunchArgs::default()
            }
        );
    }

    #[test]
    fn full_contract_order() {
        let got = parse_launch_args(
            &argv(&["proj", "--task", "T-1", "--yes", "--verbose", "--run"]),
            &cwd(),
        )
        .unwrap();
        assert_eq!(
            got,
            LaunchArgs {
                dir: Some(cwd().join("proj").to_string_lossy().into_owned()),
                task: Some("T-1".to_string()),
                yes: true,
                verbose: true,
                run: true,
            }
        );
    }

    #[test]
    fn unknown_flag_is_error() {
        let err = parse_launch_args(&argv(&["--bogus"]), &cwd()).unwrap_err();
        assert!(err.contains("--bogus"));
    }

    #[test]
    fn second_positional_is_error() {
        assert!(parse_launch_args(&argv(&["a", "b"]), &cwd()).is_err());
    }

    #[test]
    fn macos_psn_argument_is_ignored() {
        let got = parse_launch_args(&argv(&["-psn_0_12345", "proj"]), &cwd()).unwrap();
        assert_eq!(
            got.dir,
            Some(cwd().join("proj").to_string_lossy().into_owned())
        );
        assert_eq!(
            parse_launch_args(&argv(&["-psn_0_12345"]), &cwd()),
            Ok(LaunchArgs::default())
        );
    }
}
