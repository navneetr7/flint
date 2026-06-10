use super::{active_app::ActiveApp, platform::ActiveAppProvider};

pub struct WindowsActiveAppProvider;

impl ActiveAppProvider for WindowsActiveAppProvider {
    fn current_app(&self) -> Option<ActiveApp> {
        None
    }
}
