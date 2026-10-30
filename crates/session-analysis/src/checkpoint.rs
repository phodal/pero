//! A checkpoint is the reduce state plus its cursor. It is a value.
//! Persistence belongs to a later shell.

use serde::{Deserialize, Serialize};

use crate::reduce::{ReduceState, check};
use crate::types::Error;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Checkpoint {
    state: ReduceState,
}

impl Checkpoint {
    pub(crate) fn from_state(state: ReduceState) -> Self {
        Self { state }
    }

    pub(crate) fn into_state(self) -> ReduceState {
        self.state
    }

    pub fn cursor(&self) -> Option<u32> {
        self.state.cursor
    }

    pub fn covers(&self, index: u32) -> bool {
        self.state.cursor.is_some_and(|cursor| index <= cursor)
    }

    pub fn encode(&self) -> Result<Vec<u8>, Error> {
        serde_json::to_vec(self).map_err(|_| Error::CHECKPOINT)
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, Error> {
        let checkpoint: Self = serde_json::from_slice(bytes).map_err(|_| Error::CHECKPOINT)?;
        check(&checkpoint.state)?;
        Ok(checkpoint)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reduce::prepare;
    use crate::test_support::{assistant, input, session, user};
    use crate::types::Transcript;

    #[test]
    fn checkpoint_bytes_round_trip_and_reject_garbage() {
        let prepared = prepare(
            &Transcript {
                session: session(),
                records: vec![user(1, 10, "ask"), assistant(2, 11, "yes")],
            },
            &input(),
        )
        .unwrap();
        let checkpoint = Checkpoint::from_state(prepared.state);
        let bytes = checkpoint.encode().unwrap();
        assert_eq!(Checkpoint::decode(&bytes).unwrap(), checkpoint);

        let cases: &[(&[u8], Error)] = &[
            (b"", Error::CHECKPOINT),
            (b"{", Error::CHECKPOINT),
            (b"{}", Error::CHECKPOINT),
            (b"null", Error::CHECKPOINT),
        ];
        for (bytes, expect) in cases {
            assert_eq!(Checkpoint::decode(bytes).unwrap_err(), *expect);
        }
    }
}
