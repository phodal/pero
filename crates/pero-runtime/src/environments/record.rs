//! Versioned Use evidence. Reconstruct through the same fold, never replay I/O.
use super::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
enum RecordSchema {
    #[serde(rename = "pero.environment.use-record.v2")]
    V2,
}

/// Persist the accepted inputs, not a second mutable copy of the state machine.
/// Decoding is historical reconstruction, not fresh execution authorization.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "UseRecordInput")]
pub struct UseRecord {
    schema: RecordSchema,
    commands: Vec<UseCommand>,
    #[serde(skip)]
    state: EnvironmentUse,
}
impl UseRecord {
    pub fn begin(request: UseRequest) -> Result<(Self, Vec<UseEffect>), EnvironmentError> {
        let command = UseCommand::Begin(request);
        let (state, effects) = apply_use(None, command.clone())?;
        Ok((
            Self {
                schema: RecordSchema::V2,
                commands: vec![command],
                state,
            },
            effects,
        ))
    }
    pub fn state(&self) -> &EnvironmentUse {
        &self.state
    }
    /// The shell must save the returned record before carrying out its effects.
    pub fn apply(&self, command: UseCommand) -> Result<(Self, Vec<UseEffect>), EnvironmentError> {
        let (state, effects) = apply_use(Some(&self.state), command.clone())?;
        if state == self.state && effects.is_empty() {
            return Ok((self.clone(), effects));
        }
        let mut commands = self.commands.clone();
        commands.push(command);
        Ok((
            Self {
                schema: RecordSchema::V2,
                commands,
                state,
            },
            effects,
        ))
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UseRecordInput {
    schema: RecordSchema,
    commands: Vec<UseCommand>,
}
impl TryFrom<UseRecordInput> for UseRecord {
    type Error = EnvironmentError;
    fn try_from(value: UseRecordInput) -> Result<Self, Self::Error> {
        let _ = value.schema;
        let mut state = None;
        for command in &value.commands {
            // Old effects have possibly happened already. Discard them; the
            // actual Owner must reconcile using the original Use/resource IDs.
            state = Some(apply_use(state.as_ref(), command.clone())?.0);
        }
        Ok(Self {
            schema: RecordSchema::V2,
            commands: value.commands,
            state: state.ok_or(EnvironmentError::Invalid("empty use record"))?,
        })
    }
}

#[cfg(test)]
mod tests;
