#[cfg(target_os = "macos")]
use std::process::Command;

pub struct Keychain;

impl Keychain {
    #[cfg(target_os = "macos")]
    pub fn read(service: &str, account: &str) -> Option<String> {
        let output = Command::new("security")
            .args(["find-generic-password", "-s", service, "-a", account, "-w"])
            .output()
            .ok()?;

        if !output.status.success() {
            return None;
        }

        String::from_utf8(output.stdout)
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
    }

    #[cfg(target_os = "macos")]
    pub fn write(service: &str, account: &str, value: &str) -> Result<(), String> {
        let output = Command::new("security")
            .args([
                "add-generic-password",
                "-U",
                "-s",
                service,
                "-a",
                account,
                "-w",
                value,
            ])
            .output()
            .map_err(|e| format!("Keychain write failed: {e}"))?;

        if output.status.success() {
            return Ok(());
        }

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            "Keychain write failed".to_string()
        } else {
            stderr
        })
    }
}
