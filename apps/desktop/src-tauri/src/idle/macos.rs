use objc2_core_graphics::{CGEventSource, CGEventSourceStateID, CGEventType};

use super::{detector::IdleState, platform::IdleProvider};

pub struct MacOsIdleProvider;

impl IdleProvider for MacOsIdleProvider {
    fn idle_state(&self) -> IdleState {
        let idle_seconds = [
            CGEventType::KeyDown,
            CGEventType::LeftMouseDown,
            CGEventType::RightMouseDown,
            CGEventType::MouseMoved,
            CGEventType::ScrollWheel,
        ]
        .iter()
        .map(|event_type| {
            CGEventSource::seconds_since_last_event_type(
                CGEventSourceStateID::HIDSystemState,
                *event_type,
            )
        })
        .fold(f64::INFINITY, f64::min)
        .max(0.0)
        .round() as u64;

        IdleState {
            is_idle: idle_seconds > 0,
            idle_seconds,
        }
    }
}
