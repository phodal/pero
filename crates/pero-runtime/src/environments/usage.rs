use super::*;
use serde::Serialize;

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
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct EnvironmentUse {
    request: UseRequest,
    state: UseState,
    release_requested: bool,
    grant: Option<ContentDigest>,
    stopped: Option<ContentDigest>,
    release: Option<ContentDigest>,
}
impl EnvironmentUse {
    pub fn state(&self) -> UseState {
        self.state
    }
    pub fn request(&self) -> &UseRequest {
        &self.request
    }
}

/// Pure fold. Effects are instructions for the existing owner, never launches.
pub fn apply_use(
    current: Option<&EnvironmentUse>,
    command: UseCommand,
) -> Result<(EnvironmentUse, Vec<UseEffect>), EnvironmentError> {
    let Some(current) = current else {
        return match command {
            UseCommand::Begin(request) => Ok((
                EnvironmentUse {
                    request,
                    state: UseState::Acquiring,
                    release_requested: false,
                    grant: None,
                    stopped: None,
                    release: None,
                },
                vec![UseEffect::Acquire],
            )),
            _ => Err(EnvironmentError::UseConflict),
        };
    };
    let mut next = current.clone();
    let mut effects = Vec::new();
    let check = |receipt: &OwnerReceipt| {
        if receipt.use_id != current.request.id
            || receipt.snapshot != current.request.snapshot.digest()
        {
            Err(EnvironmentError::IdentityChanged)
        } else {
            Ok(())
        }
    };
    match command {
        UseCommand::Begin(request) => {
            if request != next.request {
                return Err(EnvironmentError::UseConflict);
            }
        }
        UseCommand::End => {
            next.release_requested = true;
            if next.state == UseState::Active {
                next.state = UseState::Releasing;
                effects.push(UseEffect::Release);
            }
        }
        UseCommand::Acquired(receipt) => {
            check(&receipt)?;
            if let Some(grant) = &next.grant {
                if grant != &receipt.receipt {
                    return Err(EnvironmentError::UseConflict);
                }
            } else {
                if !matches!(next.state, UseState::Acquiring | UseState::UnknownAcquire) {
                    return Err(EnvironmentError::UseConflict);
                }
                next.grant = Some(receipt.receipt);
                next.state = if next.release_requested {
                    effects.push(UseEffect::Release);
                    UseState::Releasing
                } else {
                    UseState::Active
                };
            }
        }
        UseCommand::Refused(receipt) => {
            check(&receipt)?;
            if next.state == UseState::Released
                && next.grant.is_none()
                && next.release.as_ref() == Some(&receipt.receipt)
            {
                return Ok((next, effects));
            }
            if !matches!(next.state, UseState::Acquiring | UseState::UnknownAcquire) {
                return Err(EnvironmentError::UseConflict);
            }
            next.state = UseState::Released;
            next.release = Some(receipt.receipt);
        }
        UseCommand::Unknown => {
            next.state = match next.state {
                UseState::Acquiring | UseState::UnknownAcquire => UseState::UnknownAcquire,
                UseState::Releasing | UseState::UnknownRelease => UseState::UnknownRelease,
                _ => return Err(EnvironmentError::UseConflict),
            }
        }
        UseCommand::Released { stopped, released } => {
            check(&stopped)?;
            check(&released)?;
            if next.state == UseState::Released
                && next.release.as_ref() == Some(&released.receipt)
                && next.stopped.as_ref() == Some(&stopped.receipt)
            {
                return Ok((next, effects));
            }
            if !matches!(next.state, UseState::Releasing | UseState::UnknownRelease) {
                return Err(EnvironmentError::UseConflict);
            }
            next.state = UseState::Released;
            next.stopped = Some(stopped.receipt);
            next.release = Some(released.receipt);
        }
    }
    Ok((next, effects))
}
