pub mod active_app;
pub mod category;
pub mod platform;
pub mod tracker;

#[cfg(target_os = "macos")]
pub mod macos;

#[cfg(target_os = "windows")]
pub mod windows;
