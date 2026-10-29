//! Provider-reported usage. Context occupancy and cumulative cost are separate
//! from turn token consumption; absent measurements remain absent.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SessionUsage {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_used: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_capacity: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u64>,
    /// The provider's cumulative session cost, never a sum of UI snapshots.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost: Option<UsageCost>,
}

impl SessionUsage {
    pub fn reported_context(used: u64, capacity: u64, cost: Option<UsageCost>) -> Self {
        Self {
            context_used: Some(used),
            context_capacity: (capacity > 0).then_some(capacity),
            cost,
            ..Self::default()
        }
    }

    pub fn context_ratio(&self) -> Option<f64> {
        self.context_used
            .zip(self.context_capacity)
            .filter(|(_, capacity)| *capacity > 0)
            .map(|(used, capacity)| used as f64 / capacity as f64)
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UsageCost {
    pub amount: f64,
    pub currency: String,
}

impl UsageCost {
    /// Discard an invalid optional measurement without rejecting a valid reply.
    pub fn reported(amount: f64, currency: String) -> Option<Self> {
        (amount.is_finite()
            && amount >= 0.0
            && currency.len() == 3
            && currency.bytes().all(|byte| byte.is_ascii_uppercase()))
        .then_some(Self { amount, currency })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reported_usage_preserves_measurement_scope_and_missing_values() {
        for (used, capacity, ratio) in [
            (0, 100, Some(0.0)),
            (25, 100, Some(0.25)),
            (120, 100, Some(1.2)),
            (25, 0, None),
        ] {
            let usage = SessionUsage::reported_context(used, capacity, None);
            assert_eq!(usage.context_ratio(), ratio);
            assert_eq!(usage.input_tokens, None);
            assert_eq!(usage.output_tokens, None);
            let wire = serde_json::to_value(&usage).unwrap();
            assert!(wire.get("input_tokens").is_none());
            assert!(wire.get("cost").is_none());
        }
        for (amount, currency, valid) in [
            (0.0, "USD", true),
            (0.025, "EUR", true),
            (-0.1, "USD", false),
            (f64::INFINITY, "USD", false),
            (1.0, "usd", false),
            (1.0, "US", false),
        ] {
            assert_eq!(
                UsageCost::reported(amount, currency.into()).is_some(),
                valid
            );
        }
    }
}
