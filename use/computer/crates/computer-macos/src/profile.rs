//! Advertised native action subsets. These are not authorization grants.
use pero_contracts::computer_use::*;

pub fn observations() -> Vec<ComputerObservationKind> {
    vec![
        ComputerObservationKind::Accessibility,
        ComputerObservationKind::Screenshot,
    ]
}
pub fn environment() -> ComputerEnvironment {
    ComputerEnvironment {
        platform: ComputerPlatform::Macos,
        display: ComputerDisplay::Native,
        desktop: None,
    }
}
pub fn actions() -> Vec<ComputerActionSupport> {
    use ComputerActionKind::*;
    use ComputerAddressing::*;
    use ComputerDelivery::*;
    vec![
        ComputerActionSupport {
            action: Hold,
            delivery: Background,
            addressing: vec![Element, Pixel],
        },
        ComputerActionSupport {
            action: Hold,
            delivery: Foreground,
            addressing: vec![Element, Pixel],
        },
        ComputerActionSupport {
            action: FocusWindow,
            delivery: Foreground,
            addressing: vec![Target],
        },
        ComputerActionSupport {
            action: SetValue,
            delivery: Background,
            addressing: vec![Element],
        },
        ComputerActionSupport {
            action: PerformAction,
            delivery: Background,
            addressing: vec![Element],
        },
        ComputerActionSupport {
            action: Move,
            delivery: Background,
            addressing: vec![Element, Pixel],
        },
        ComputerActionSupport {
            action: Move,
            delivery: Foreground,
            addressing: vec![Element, Pixel],
        },
        ComputerActionSupport {
            action: Hover,
            delivery: Background,
            addressing: vec![Element, Pixel],
        },
        ComputerActionSupport {
            action: Hover,
            delivery: Foreground,
            addressing: vec![Element, Pixel],
        },
        ComputerActionSupport {
            action: Click,
            delivery: Background,
            addressing: vec![Element, Pixel],
        },
        ComputerActionSupport {
            action: TypeText,
            delivery: Background,
            addressing: vec![Element, Pixel],
        },
        ComputerActionSupport {
            action: PressKey,
            delivery: Background,
            addressing: vec![Element, Pixel],
        },
        ComputerActionSupport {
            action: Scroll,
            delivery: Background,
            addressing: vec![Element, Pixel],
        },
        ComputerActionSupport {
            action: Drag,
            delivery: Background,
            addressing: vec![Pixel],
        },
        ComputerActionSupport {
            action: Click,
            delivery: Foreground,
            addressing: vec![Element, Pixel],
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
        computer_testkit::assert_profile_admission(environment(), observations(), actions());
    }
}
