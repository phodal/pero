//! Advertised native action subsets. These are not authorization grants.
use pero_contracts::computer_use::*;

pub fn observations() -> Vec<ComputerObservationKind> {
    vec![ComputerObservationKind::Screenshot]
}
pub fn environment(connected: bool, wayland: bool, desktop: Option<String>) -> ComputerEnvironment {
    let display = match (connected, wayland) {
        (true, false) => ComputerDisplay::X11,
        (true, true) => ComputerDisplay::Xwayland,
        (false, true) => ComputerDisplay::Wayland,
        (false, false) => ComputerDisplay::Unavailable,
    };
    ComputerEnvironment {
        platform: ComputerPlatform::Linux,
        display,
        desktop,
    }
}
pub fn actions() -> Vec<ComputerActionSupport> {
    use ComputerActionKind::*;
    use ComputerAddressing::*;
    use ComputerDelivery::*;
    vec![
        ComputerActionSupport {
            action: Click,
            delivery: Foreground,
            addressing: vec![Pixel],
        },
        ComputerActionSupport {
            action: TypeText,
            delivery: Foreground,
            addressing: vec![Pixel],
        },
        ComputerActionSupport {
            action: PressKey,
            delivery: Foreground,
            addressing: vec![Pixel],
        },
        ComputerActionSupport {
            action: Scroll,
            delivery: Foreground,
            addressing: vec![Pixel],
        },
        ComputerActionSupport {
            action: Drag,
            delivery: Foreground,
            addressing: vec![Pixel],
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn addressing_and_delivery_admission() {
        computer_testkit::assert_profile_admission(
            environment(true, false, None),
            observations(),
            actions(),
        );
    }
    #[test]
    fn display_classification_preserves_the_actual_connection_boundary() {
        for (connected, wayland, display) in [
            (true, false, ComputerDisplay::X11),
            (true, true, ComputerDisplay::Xwayland),
            (false, true, ComputerDisplay::Wayland),
            (false, false, ComputerDisplay::Unavailable),
        ] {
            assert_eq!(
                environment(connected, wayland, Some("sway".into())).display,
                display
            );
        }
    }
}
