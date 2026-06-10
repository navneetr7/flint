use super::detector::IdleState;

pub trait IdleProvider {
    fn idle_state(&self) -> IdleState;
}
