//! User keymaps: pure edits, explicit disabling and scoped conflict resolution.
mod catalog;
mod keys;
pub use catalog::{CommandId, ShortcutScope};
pub use keys::{KeySequence, KeyStroke, ShortcutPlatform};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(try_from = "StoredOverrides", into = "StoredOverrides")]
pub struct ShortcutOverrides(StoredOverrides);

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(default, deny_unknown_fields)]
struct StoredOverrides {
    macos: BTreeMap<CommandId, Vec<KeySequence>>,
    other: BTreeMap<CommandId, Vec<KeySequence>>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShortcutConflict {
    pub command: CommandId,
    pub other: CommandId,
    pub sequence: KeySequence,
}
impl std::fmt::Display for ShortcutConflict {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} conflicts with {:?}", self.sequence, self.other)
    }
}

#[derive(Debug)]
pub enum ShortcutError {
    Invalid(String),
    Conflicts(Vec<ShortcutConflict>),
}
impl std::fmt::Display for ShortcutError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Invalid(message) => f.write_str(message),
            Self::Conflicts(items) => write!(f, "{}", items[0]),
        }
    }
}

pub enum ShortcutEdit {
    Replace {
        command: CommandId,
        bindings: Vec<KeySequence>,
        reassign: bool,
    },
    Reset(CommandId),
    ResetAll,
}

impl ShortcutOverrides {
    fn overrides(&self, platform: ShortcutPlatform) -> &BTreeMap<CommandId, Vec<KeySequence>> {
        match platform {
            ShortcutPlatform::Macos => &self.0.macos,
            ShortcutPlatform::Other => &self.0.other,
        }
    }
    fn overrides_mut(
        &mut self,
        platform: ShortcutPlatform,
    ) -> &mut BTreeMap<CommandId, Vec<KeySequence>> {
        match platform {
            ShortcutPlatform::Macos => &mut self.0.macos,
            ShortcutPlatform::Other => &mut self.0.other,
        }
    }
    pub fn modified(&self, command: CommandId, platform: ShortcutPlatform) -> bool {
        self.overrides(platform).contains_key(&command)
    }
    pub fn bindings(&self, command: CommandId, platform: ShortcutPlatform) -> Vec<KeySequence> {
        self.overrides(platform)
            .get(&command)
            .cloned()
            .unwrap_or_else(|| command.defaults(platform))
    }
    pub fn conflicts(&self, platform: ShortcutPlatform) -> Vec<ShortcutConflict> {
        let mut conflicts = Vec::new();
        for (index, command) in CommandId::ALL.iter().enumerate() {
            for other in &CommandId::ALL[index + 1..] {
                if command.scope() != other.scope() {
                    continue;
                }
                for sequence in self.bindings(*command, platform) {
                    if self
                        .bindings(*other, platform)
                        .iter()
                        .any(|key| sequence.overlaps(key))
                    {
                        conflicts.push(ShortcutConflict {
                            command: *command,
                            other: *other,
                            sequence,
                        });
                    }
                }
            }
        }
        conflicts
    }
    /// Empty bindings explicitly disable a command. Reset removes the override.
    /// Reset is also conflict checked: restoring a default must not steal a reassigned key.
    pub fn apply(
        &self,
        platform: ShortcutPlatform,
        edit: ShortcutEdit,
    ) -> Result<Self, ShortcutError> {
        let mut next = self.clone();
        match edit {
            ShortcutEdit::ResetAll => next.overrides_mut(platform).clear(),
            ShortcutEdit::Reset(command) => {
                next.overrides_mut(platform).remove(&command);
            }
            ShortcutEdit::Replace {
                command,
                mut bindings,
                reassign,
            } => {
                bindings.sort();
                bindings.dedup();
                if reassign {
                    for other in CommandId::ALL {
                        if *other == command || other.scope() != command.scope() {
                            continue;
                        }
                        let old = next.bindings(*other, platform);
                        let retained = old
                            .iter()
                            .filter(|key| !bindings.iter().any(|new| new.overlaps(key)))
                            .cloned()
                            .collect::<Vec<_>>();
                        if retained != old {
                            next.overrides_mut(platform).insert(*other, retained);
                        }
                    }
                }
                next.overrides_mut(platform).insert(command, bindings);
            }
        }
        next.validate(platform)?;
        Ok(next)
    }
}
impl ShortcutOverrides {
    fn validate(&self, platform: ShortcutPlatform) -> Result<(), ShortcutError> {
        for (command, bindings) in self.overrides(platform) {
            if command.application_entry() && bindings.iter().any(|key| key.strokes().len() != 1) {
                return Err(ShortcutError::Invalid("Application entry commands require a single keystroke across embedded surfaces".into()));
            }
            if bindings.len() > 4 {
                return Err(ShortcutError::Invalid(
                    "At most four bindings per command".into(),
                ));
            }
            for (index, key) in bindings.iter().enumerate() {
                if bindings[index + 1..]
                    .iter()
                    .any(|other| key.overlaps(other))
                {
                    return Err(ShortcutError::Invalid(
                        "Duplicate or ambiguous key sequence".into(),
                    ));
                }
            }
        }
        let conflicts = self.conflicts(platform);
        if conflicts.is_empty() {
            Ok(())
        } else {
            Err(ShortcutError::Conflicts(conflicts))
        }
    }
}
impl TryFrom<StoredOverrides> for ShortcutOverrides {
    type Error = String;
    fn try_from(stored: StoredOverrides) -> Result<Self, String> {
        let value = Self(stored);
        for platform in [ShortcutPlatform::Macos, ShortcutPlatform::Other] {
            value.validate(platform).map_err(|e| e.to_string())?;
        }
        Ok(value)
    }
}
impl From<ShortcutOverrides> for StoredOverrides {
    fn from(value: ShortcutOverrides) -> Self {
        value.0
    }
}

#[cfg(test)]
mod tests;

/// Menu projection uses the same defaults and overrides as the GPUI adapter.
#[derive(Clone, Debug, Serialize)]
pub struct ShortcutMenu {
    pub entries: Vec<ShortcutMenuEntry>,
}
#[derive(Clone, Debug, Serialize)]
pub struct ShortcutMenuEntry {
    pub command: CommandId,
    pub label_key: &'static str,
    pub accelerators: Vec<String>,
    pub application_entry: bool,
}
impl ShortcutOverrides {
    pub fn menu(&self, platform: ShortcutPlatform) -> ShortcutMenu {
        ShortcutMenu {
            entries: CommandId::ALL
                .iter()
                .copied()
                .filter(|command| command.scope() == ShortcutScope::Workbench)
                .map(|command| ShortcutMenuEntry {
                    command,
                    label_key: command.label_key(),
                    accelerators: self
                        .bindings(command, platform)
                        .iter()
                        .filter_map(KeySequence::accelerator)
                        .collect(),
                    application_entry: command.application_entry(),
                })
                .collect(),
        }
    }
}
