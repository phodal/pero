//! Whether an installed App can leave the enabled state.
//! The product names Required Apps. A manifest and an installation file cannot.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tenure {
    Optional,
    Required,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TenureAsk {
    Enable,
    Disable,
    Remove,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TenureFault {
    Required,
}

impl TenureFault {
    pub const CODE: &'static str = "app.required";
}

impl std::fmt::Display for TenureFault {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(Self::CODE)
    }
}

/// One transition for every App. Required has no disabled state.
pub fn permit(tenure: Tenure, ask: TenureAsk) -> Result<(), TenureFault> {
    match (tenure, ask) {
        (Tenure::Required, TenureAsk::Disable | TenureAsk::Remove) => Err(TenureFault::Required),
        _ => Ok(()),
    }
}

#[derive(Debug)]
pub enum StoreError {
    Required(TenureFault),
    Failed(String),
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Required(fault) => write!(f, "{fault}"),
            Self::Failed(message) => f.write_str(message),
        }
    }
}

impl From<String> for StoreError {
    fn from(value: String) -> Self {
        Self::Failed(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tenure_permit() {
        for (tenure, ask, allowed) in [
            (Tenure::Optional, TenureAsk::Enable, true),
            (Tenure::Optional, TenureAsk::Disable, true),
            (Tenure::Optional, TenureAsk::Remove, true),
            (Tenure::Required, TenureAsk::Enable, true),
            (Tenure::Required, TenureAsk::Disable, false),
            (Tenure::Required, TenureAsk::Remove, false),
        ] {
            assert_eq!(permit(tenure, ask).is_ok(), allowed, "{tenure:?} {ask:?}");
            if let Err(fault) = permit(tenure, ask) {
                assert_eq!(fault.to_string(), TenureFault::CODE);
            }
        }
    }
}
