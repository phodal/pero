//! Advertised native action subsets. These are not authorization grants.
use pero_contracts::computer_use::*;

/// Accessibility is advertised only when the AT-SPI bus answered at startup.
pub fn observations(accessibility: bool) -> Vec<ComputerObservationKind> {
    let mut kinds = Vec::new();
    if accessibility {
        kinds.push(ComputerObservationKind::Accessibility);
    }
    kinds.push(ComputerObservationKind::Screenshot);
    kinds
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
pub fn actions(accessibility: bool) -> Vec<ComputerActionSupport> {
    use ComputerActionKind::*;
    use ComputerAddressing::*;
    use ComputerDelivery::*;
    let mut actions = Vec::new();
    if accessibility {
        // An element's own invoking Action: no pointer movement or focus change.
        actions.push(ComputerActionSupport {
            action: Click,
            delivery: Background,
            addressing: vec![Element],
        });
    }
    actions.extend([
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
        ComputerActionSupport {
            action: Move,
            delivery: Foreground,
            addressing: vec![Pixel],
        },
        ComputerActionSupport {
            action: Hover,
            delivery: Foreground,
            addressing: vec![Pixel],
        },
        ComputerActionSupport {
            action: Hold,
            delivery: Foreground,
            addressing: vec![Pixel],
        },
    ]);
    actions
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn addressing_and_delivery_admission() {
        computer_testkit::assert_profile_admission(
            environment(true, false, None),
            observations(true),
            actions(true),
        );
    }
    #[test]
    fn without_atspi_no_element_or_background_input_is_advertised() {
        assert_eq!(
            observations(false),
            vec![ComputerObservationKind::Screenshot]
        );
        assert!(actions(false).iter().all(|support| {
            support.delivery == ComputerDelivery::Foreground
                && support.addressing == vec![ComputerAddressing::Pixel]
        }));
        assert_eq!(actions(true).len(), actions(false).len() + 1);
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
