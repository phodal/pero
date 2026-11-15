//! Fixed numerical method inputs. This is a bounded method, not a command API.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(try_from = "QuadratureInput")]
pub struct Quadrature {
    samples: u32,
    repetitions: u32,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct QuadratureInput {
    samples: u32,
    repetitions: u32,
}
impl TryFrom<QuadratureInput> for Quadrature {
    type Error = String;
    fn try_from(value: QuadratureInput) -> Result<Self, String> {
        if !(1_000..=10_000_000).contains(&value.samples)
            || !(1..=100_000).contains(&value.repetitions)
        {
            return Err(
                "Quadrature needs 1,000–10,000,000 samples and 1–100,000 repetitions".into(),
            );
        }
        Ok(Self {
            samples: value.samples,
            repetitions: value.repetitions,
        })
    }
}
impl Quadrature {
    pub fn samples(&self) -> u32 {
        self.samples
    }
    pub fn repetitions(&self) -> u32 {
        self.repetitions
    }
}
/// Bundled Host-owned entrypoint; the App cannot replace it or supply code.
pub const QUADRATURE: &str = include_str!("quadrature.py");
