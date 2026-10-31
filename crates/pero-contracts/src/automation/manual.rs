use super::*;

/// A run-now intent is independent of event delivery and calendar advancement.
/// A calendar's fixed source still applies; an unfrozen definition may accept
/// the explicit candidate published atomically by ManualInput.
pub(super) fn accepts(trigger: &Trigger, subject: &str, exact: &Option<ExactRef>) -> bool {
    match trigger {
        Trigger::Manual | Trigger::Event { .. } => true,
        Trigger::Calendar { subject: fixed_subject, exact: fixed_exact, .. } => {
            subject == fixed_subject && fixed_exact.as_ref().is_none_or(|fixed| exact.as_ref() == Some(fixed))
        }
        Trigger::Time { .. } => false,
    }
}
