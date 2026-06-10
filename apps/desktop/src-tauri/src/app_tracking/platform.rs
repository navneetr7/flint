use super::active_app::ActiveApp;

pub trait ActiveAppProvider {
    fn current_app(&self) -> Option<ActiveApp>;

    fn enrich_context(&self, active_app: ActiveApp) -> ActiveApp {
        active_app
    }
}
