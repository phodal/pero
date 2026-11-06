use super::*;
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct UseRequest {
    pub id: Identity,
    pub consumer: Identity,
    pub snapshot: EnvironmentSnapshot,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OwnerReceipt {
    pub use_id: Identity,
    pub snapshot: ContentDigest,
    /// Composite receipts must identify the exact selected resource/operations.
    /// None is accepted only for the legacy single-binding contract.
    pub target: Option<ContentDigest>,
    pub receipt: ContentDigest,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum UseState {
    Acquiring,
    Active,
    Releasing,
    UnknownAcquire,
    UnknownRelease,
    Released,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UseCommand {
    Begin(UseRequest),
    Acquired(OwnerReceipt),
    Refused(OwnerReceipt),
    Unknown,
    TargetUnknown {
        target: ContentDigest,
    },
    End,
    Released {
        stopped: OwnerReceipt,
        released: OwnerReceipt,
    },
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UseEffect {
    Acquire,
    Release,
    AcquireTarget(UseTarget),
    ReleaseTarget(UseTarget),
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
enum MemberState {
    Pending,
    Acquiring,
    Active,
    Releasing,
    UnknownAcquire,
    UnknownRelease,
    Released,
    Skipped,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
struct MemberUse {
    target: Option<UseTarget>,
    state: MemberState,
    grant: Option<ContentDigest>,
    stopped: Option<ContentDigest>,
    release: Option<ContentDigest>,
}
impl MemberUse {
    fn pending(target: Option<UseTarget>) -> Self {
        Self {
            target,
            state: MemberState::Pending,
            grant: None,
            stopped: None,
            release: None,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct EnvironmentUse {
    request: UseRequest,
    state: UseState,
    release_requested: bool,
    members: BTreeMap<ContentDigest, MemberUse>,
}
impl EnvironmentUse {
    pub fn state(&self) -> UseState {
        self.state
    }
    pub fn request(&self) -> &UseRequest {
        &self.request
    }

    fn key(&self, target: Option<&ContentDigest>) -> Result<ContentDigest, EnvironmentError> {
        match (&self.request.snapshot, target) {
            (EnvironmentSnapshot::Legacy(_), None) => Ok(self.request.snapshot.digest()),
            (EnvironmentSnapshot::Composite(_), Some(key)) if self.members.contains_key(key) => {
                Ok(key.clone())
            }
            _ => Err(EnvironmentError::IdentityChanged),
        }
    }
    fn receipt_key(&self, receipt: &OwnerReceipt) -> Result<ContentDigest, EnvironmentError> {
        if receipt.use_id != self.request.id || receipt.snapshot != self.request.snapshot.digest() {
            return Err(EnvironmentError::IdentityChanged);
        }
        self.key(receipt.target.as_ref())
    }

    /// The only coordinator: reserve one acquisition at a time. Release can
    /// settle independently; an unknown member prevents aggregate release.
    fn advance(&mut self) -> Vec<UseEffect> {
        let mut effects = Vec::new();
        if self.release_requested {
            for member in self.members.values_mut() {
                match member.state {
                    MemberState::Pending => member.state = MemberState::Skipped,
                    MemberState::Active => {
                        member.state = MemberState::Releasing;
                        effects.push(match &member.target {
                            Some(target) => UseEffect::ReleaseTarget(target.clone()),
                            None => UseEffect::Release,
                        });
                    }
                    _ => (),
                }
            }
        } else if !self.members.values().any(|m| {
            matches!(
                m.state,
                MemberState::Acquiring | MemberState::UnknownAcquire
            )
        }) {
            if let Some(member) = self
                .members
                .values_mut()
                .find(|m| m.state == MemberState::Pending)
            {
                member.state = MemberState::Acquiring;
                effects.push(match &member.target {
                    Some(target) => UseEffect::AcquireTarget(target.clone()),
                    None => UseEffect::Acquire,
                });
            }
        }
        let any = |state| self.members.values().any(|m| m.state == state);
        self.state = if self
            .members
            .values()
            .all(|m| matches!(m.state, MemberState::Released | MemberState::Skipped))
        {
            UseState::Released
        } else if any(MemberState::UnknownRelease) {
            UseState::UnknownRelease
        } else if any(MemberState::UnknownAcquire) {
            UseState::UnknownAcquire
        } else if any(MemberState::Releasing) {
            UseState::Releasing
        } else if any(MemberState::Acquiring) {
            UseState::Acquiring
        } else {
            UseState::Active
        };
        effects
    }
}

/// Pure fold. Effects instruct existing Owners; this function never launches.
/// Receipts must come from the selected Owner's private shell, not App claims.
pub fn apply_use(
    current: Option<&EnvironmentUse>,
    command: UseCommand,
) -> Result<(EnvironmentUse, Vec<UseEffect>), EnvironmentError> {
    let Some(current) = current else {
        let UseCommand::Begin(request) = command else {
            return Err(EnvironmentError::UseConflict);
        };
        let members = match &request.snapshot {
            EnvironmentSnapshot::Legacy(_) => {
                BTreeMap::from([(request.snapshot.digest(), MemberUse::pending(None))])
            }
            EnvironmentSnapshot::Composite(snapshot) => snapshot
                .targets()
                .into_iter()
                .map(|(id, target)| (id, MemberUse::pending(Some(target))))
                .collect(),
        };
        let mut next = EnvironmentUse {
            request,
            state: UseState::Acquiring,
            release_requested: false,
            members,
        };
        let effects = next.advance();
        return Ok((next, effects));
    };
    let mut next = current.clone();
    match command {
        UseCommand::Begin(request) => {
            if request != current.request {
                return Err(EnvironmentError::UseConflict);
            }
        }
        UseCommand::End => next.release_requested = true,
        UseCommand::Acquired(receipt) => {
            let key = next.receipt_key(&receipt)?;
            let member = next.members.get_mut(&key).expect("checked target");
            if let Some(grant) = &member.grant {
                if grant != &receipt.receipt {
                    return Err(EnvironmentError::UseConflict);
                }
            } else {
                if !matches!(
                    member.state,
                    MemberState::Acquiring | MemberState::UnknownAcquire
                ) {
                    return Err(EnvironmentError::UseConflict);
                }
                member.grant = Some(receipt.receipt);
                member.state = MemberState::Active;
            }
        }
        UseCommand::Refused(receipt) => {
            let key = next.receipt_key(&receipt)?;
            let member = next.members.get_mut(&key).expect("checked target");
            if member.state == MemberState::Released
                && member.grant.is_none()
                && member.release.as_ref() == Some(&receipt.receipt)
            {
                return Ok((next, vec![]));
            }
            if !matches!(
                member.state,
                MemberState::Acquiring | MemberState::UnknownAcquire
            ) {
                return Err(EnvironmentError::UseConflict);
            }
            member.release = Some(receipt.receipt);
            member.state = MemberState::Released;
            next.release_requested = true;
        }
        UseCommand::Unknown | UseCommand::TargetUnknown { .. } => {
            let key = match command {
                UseCommand::TargetUnknown { target } => next.key(Some(&target))?,
                _ => next.key(None)?,
            };
            let member = next.members.get_mut(&key).expect("checked target");
            member.state = match member.state {
                MemberState::Acquiring | MemberState::UnknownAcquire => MemberState::UnknownAcquire,
                MemberState::Releasing | MemberState::UnknownRelease => MemberState::UnknownRelease,
                _ => return Err(EnvironmentError::UseConflict),
            };
        }
        UseCommand::Released { stopped, released } => {
            let key = next.receipt_key(&stopped)?;
            if next.receipt_key(&released)? != key {
                return Err(EnvironmentError::IdentityChanged);
            }
            let member = next.members.get_mut(&key).expect("checked target");
            if member.state == MemberState::Released
                && member.release.as_ref() == Some(&released.receipt)
                && member.stopped.as_ref() == Some(&stopped.receipt)
            {
                return Ok((next, vec![]));
            }
            if !matches!(
                member.state,
                MemberState::Releasing | MemberState::UnknownRelease
            ) {
                return Err(EnvironmentError::UseConflict);
            }
            member.state = MemberState::Released;
            member.stopped = Some(stopped.receipt);
            member.release = Some(released.receipt);
        }
    }
    let effects = next.advance();
    Ok((next, effects))
}

#[cfg(test)]
mod tests;
