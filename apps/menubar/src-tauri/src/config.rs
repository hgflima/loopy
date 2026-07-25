use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

/// Persisted launch configuration — last used directory + flags.
///
/// Saved as JSON in the app config dir (no new Tauri plugin needed).
/// Reloaded on app start to pre-fill the LaunchConfig pane.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct LaunchConfig {
    /// Last selected target directory.
    #[serde(default)]
    pub dir: String,
    /// `--yes` flag (auto-approve gates). Default OFF.
    #[serde(default)]
    pub yes: bool,
    /// `--task <id>` flag (run a single task).
    #[serde(default)]
    pub task_id: String,
    /// `--verbose` flag.
    #[serde(default)]
    pub verbose: bool,
    /// Specs Interview agent preset (C-0018 D16/D18). Empty = the CLI default
    /// (`claude`). Persisted here, not in `loopy.yml` — authoring runs without a
    /// yml (D20), so the selection is a launch preference, not loop config.
    #[serde(default)]
    pub authoring_agent: String,
    /// Specs Interview model, best-effort (C-0018 D18). Empty = the agent default.
    #[serde(default)]
    pub authoring_model: String,
    /// Specs Interview reasoning effort, best-effort (C-0018 D18). Empty = default.
    #[serde(default)]
    pub authoring_effort: String,
}

const CONFIG_FILE: &str = "launch-config.json";

/// Resolve the config file path inside the app config dir.
fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to resolve app config dir: {e}"))?;
    Ok(dir.join(CONFIG_FILE))
}

/// Load persisted launch config. Returns defaults if the file doesn't exist.
#[tauri::command]
pub fn load_launch_config(app: tauri::AppHandle) -> Result<LaunchConfig, String> {
    let path = config_path(&app)?;
    if !path.exists() {
        return Ok(LaunchConfig::default());
    }
    let contents = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read config: {e}"))?;
    serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse config: {e}"))
}

/// Save launch config to disk. Creates the config dir if needed.
#[tauri::command]
pub fn save_launch_config(app: tauri::AppHandle, config: LaunchConfig) -> Result<(), String> {
    let path = config_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config dir: {e}"))?;
    }
    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {e}"))?;
    fs::write(&path, json)
        .map_err(|e| format!("Failed to write config: {e}"))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_has_empty_dir_and_flags_off() {
        let cfg = LaunchConfig::default();
        assert_eq!(cfg.dir, "");
        assert!(!cfg.yes);
        assert_eq!(cfg.task_id, "");
        assert!(!cfg.verbose);
        // C-0018: the Specs Interview selection defaults to empty (the CLI then
        // falls back to the `claude` preset and the agent's own model/effort).
        assert_eq!(cfg.authoring_agent, "");
        assert_eq!(cfg.authoring_model, "");
        assert_eq!(cfg.authoring_effort, "");
    }

    #[test]
    fn round_trip_serialization() {
        let cfg = LaunchConfig {
            dir: "/tmp/my-project".to_string(),
            yes: true,
            task_id: "T-001".to_string(),
            verbose: true,
            authoring_agent: "claude".to_string(),
            authoring_model: "opus".to_string(),
            authoring_effort: "high".to_string(),
        };
        let json = serde_json::to_string(&cfg).unwrap();
        let parsed: LaunchConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(cfg, parsed);
    }

    #[test]
    fn deserialize_with_missing_fields_uses_defaults() {
        let json = r#"{"dir": "/tmp/test"}"#;
        let cfg: LaunchConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.dir, "/tmp/test");
        assert!(!cfg.yes);
        assert_eq!(cfg.task_id, "");
        assert!(!cfg.verbose);
    }

    #[test]
    fn deserialize_pre_c0018_config_defaults_authoring_fields() {
        // A launch-config.json written before C-0018 has none of the authoring
        // keys; `#[serde(default)]` must fill them with empty strings so old
        // configs keep loading.
        let json = r#"{"dir": "/tmp/test", "yes": true, "task_id": "T-9", "verbose": true}"#;
        let cfg: LaunchConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.authoring_agent, "");
        assert_eq!(cfg.authoring_model, "");
        assert_eq!(cfg.authoring_effort, "");
        // The pre-existing fields survive untouched.
        assert_eq!(cfg.dir, "/tmp/test");
        assert!(cfg.yes);
    }

    #[test]
    fn deserialize_empty_object_uses_all_defaults() {
        let json = "{}";
        let cfg: LaunchConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg, LaunchConfig::default());
    }
}
