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
        platform: ComputerPlatform::Windows,
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
            action: Click,
            delivery: Background,
            addressing: vec![Element],
        },
        ComputerActionSupport {
            action: Click,
            delivery: Foreground,
            addressing: vec![Element, Pixel],
        },
        ComputerActionSupport {
            action: TypeText,
            delivery: Foreground,
            addressing: vec![Element],
        },
        ComputerActionSupport {
            action: PressKey,
            delivery: Foreground,
            addressing: vec![Element],
        },
        ComputerActionSupport {
            action: Scroll,
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
