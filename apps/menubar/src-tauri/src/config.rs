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
    }

    #[test]
    fn round_trip_serialization() {
        let cfg = LaunchConfig {
            dir: "/tmp/my-project".to_string(),
            yes: true,
            task_id: "T-001".to_string(),
            verbose: true,
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
    fn deserialize_empty_object_uses_all_defaults() {
        let json = "{}";
        let cfg: LaunchConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg, LaunchConfig::default());
    }
}
