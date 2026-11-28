//! A picked file is an opaque local handle. Transfer commits an immutable
//! Paper revision only after the bytes and the authorized scope check out.
use sha2::{Digest, Sha256};

pub const MAX_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PickOutcome {
    Selected,
    Cancelled,
    Denied,
    Offline,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalHandle {
    pub id: String,
    pub provider: String,
    pub media_type: String,
    pub size: u64,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pick {
    pub outcome: PickOutcome,
    pub handle: Option<LocalHandle>,
    pub path: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FileError {
    Cancelled,
    Denied,
    Offline,
    Foreign,
    Expired,
    Traversal,
    OverLimit,
    DigestMismatch,
    WrongProject,
    WrongApp,
    Revoked,
    Interrupted,
    Conflict,
    CancelledTransfer,
    Unavailable,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Transfer {
    pub upload_id: String,
    pub project: String,
    pub app: String,
    pub handle_id: String,
    pub digest: String,
    pub size: u64,
    pub media_type: String,
    pub received: u64,
    pub cancelled: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PaperCommit {
    pub paper_id: String,
    pub revision: String,
    pub digest: String,
    pub created: bool,
}

pub fn interpret_pick(pick: &Pick) -> Result<LocalHandle, FileError> {
    if pick.path.as_deref().is_some_and(|path| !path.is_empty())
        || pick
            .handle
            .as_ref()
            .is_some_and(|handle| traversed(&handle.id) || traversed(&handle.name))
    {
        return Err(FileError::Traversal);
    }
    match pick.outcome {
        PickOutcome::Cancelled => Err(FileError::Cancelled),
        PickOutcome::Denied => Err(FileError::Denied),
        PickOutcome::Offline => Err(FileError::Offline),
        PickOutcome::Selected => {
            let Some(handle) = pick.handle.clone() else {
                return Err(FileError::Foreign);
            };
            if handle.provider != "browser" && handle.provider != "desktop" {
                return Err(FileError::Foreign);
            }
            if handle.size > MAX_BYTES || handle.media_type != "application/pdf" {
                return Err(FileError::OverLimit);
            }
            if handle.id.is_empty() || handle.name.is_empty() {
                return Err(FileError::Foreign);
            }
            Ok(handle)
        }
    }
}

/// Finalize one upload. `prior` is an earlier receipt for this upload id.
/// `imported` is the revision the domain already stored for this digest, if any.
pub fn finalize(
    member: bool,
    project: &str,
    transfer: &Transfer,
    body: &[u8],
    handle_known: bool,
    handle_expired: bool,
    prior: Option<&PaperCommit>,
    domain: Option<(&str, &str)>,
) -> Result<PaperCommit, FileError> {
    if !member {
        return Err(FileError::Revoked);
    }
    if traversed(&transfer.upload_id)
        || traversed(&transfer.handle_id)
        || traversed(&transfer.project)
        || traversed(&transfer.app)
    {
        return Err(FileError::Traversal);
    }
    if transfer.project != project {
        return Err(FileError::WrongProject);
    }
    if transfer.app != "paper-agent" {
        return Err(FileError::WrongApp);
    }
    if transfer.media_type != "application/pdf"
        || transfer.size > MAX_BYTES
        || body.len() as u64 > MAX_BYTES
    {
        return Err(FileError::OverLimit);
    }
    if !handle_known {
        return Err(FileError::Foreign);
    }
    if handle_expired {
        return Err(FileError::Expired);
    }
    if transfer.cancelled {
        return Err(FileError::CancelledTransfer);
    }
    if transfer.received != transfer.size || (body.len() as u64) != transfer.size {
        return Err(FileError::Interrupted);
    }
    let actual = hex_digest(body);
    if actual != transfer.digest {
        return Err(FileError::DigestMismatch);
    }
    if let Some(prior) = prior {
        if prior.digest == transfer.digest {
            return Ok(PaperCommit {
                created: false,
                ..prior.clone()
            });
        }
        return Err(FileError::Conflict);
    }
    let Some((paper_id, revision)) = domain else {
        return Err(FileError::Unavailable);
    };
    if paper_id.is_empty() || revision.is_empty() || paper_id == format!("paper-{}", &actual[..12])
    {
        return Err(FileError::Unavailable);
    }
    Ok(PaperCommit {
        paper_id: paper_id.to_owned(),
        revision: revision.to_owned(),
        digest: actual,
        created: true,
    })
}

fn hex_digest(body: &[u8]) -> String {
    format!("{:x}", Sha256::digest(body))
}

fn traversed(value: &str) -> bool {
    value.contains("..") || value.contains('/') || value.contains('\\') || value.contains('\0')
}

#[cfg(test)]
mod tests {
    use super::*;

    const PDF: &[u8] = b"%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n";

    fn handle(provider: &str) -> LocalHandle {
        LocalHandle {
            id: "handle-1".into(),
            provider: provider.into(),
            media_type: "application/pdf".into(),
            size: PDF.len() as u64,
            name: "note.pdf".into(),
        }
    }

    fn transfer() -> Transfer {
        Transfer {
            upload_id: "upload-1".into(),
            project: "lab".into(),
            app: "paper-agent".into(),
            handle_id: "handle-1".into(),
            digest: hex_digest(PDF),
            size: PDF.len() as u64,
            media_type: "application/pdf".into(),
            received: PDF.len() as u64,
            cancelled: false,
        }
    }

    #[test]
    fn browser_and_desktop_picks_share_one_contract() {
        for provider in ["browser", "desktop"] {
            let selected = interpret_pick(&Pick {
                outcome: PickOutcome::Selected,
                handle: Some(handle(provider)),
                path: None,
            })
            .unwrap();
            assert_eq!(selected.provider, provider);
            assert!(
                interpret_pick(&Pick {
                    outcome: PickOutcome::Cancelled,
                    handle: None,
                    path: None
                })
                .is_err_and(|e| e == FileError::Cancelled)
            );
            assert!(
                interpret_pick(&Pick {
                    outcome: PickOutcome::Denied,
                    handle: None,
                    path: None
                })
                .is_err_and(|e| e == FileError::Denied)
            );
            assert!(
                interpret_pick(&Pick {
                    outcome: PickOutcome::Offline,
                    handle: None,
                    path: None
                })
                .is_err_and(|e| e == FileError::Offline)
            );
        }
        assert_eq!(
            interpret_pick(&Pick {
                outcome: PickOutcome::Selected,
                handle: Some(handle("browser")),
                path: Some("/tmp/note.pdf".into())
            }),
            Err(FileError::Traversal)
        );
    }

    #[test]
    fn import_commits_one_revision_and_retries_do_not_duplicate_it() {
        let transfer = transfer();
        let first = finalize(
            true,
            "lab",
            &transfer,
            PDF,
            true,
            false,
            None,
            Some(("doc-1", transfer.digest.as_str())),
        )
        .unwrap();
        assert_eq!(first.paper_id, "doc-1");
        assert!(first.created);
        assert_eq!(first.digest, transfer.digest);
        let again = finalize(
            true,
            "lab",
            &transfer,
            PDF,
            true,
            false,
            Some(&first),
            Some(("doc-1", first.revision.as_str())),
        )
        .unwrap();
        assert!(!again.created);
        assert_eq!(again.revision, first.revision);
        let mut mismatched = transfer.clone();
        mismatched.digest = "ab".repeat(32);
        assert_eq!(
            finalize(true, "lab", &mismatched, PDF, true, false, None, None),
            Err(FileError::DigestMismatch)
        );
        let mut prior = first.clone();
        prior.digest = mismatched.digest.clone();
        assert_eq!(
            finalize(true, "lab", &transfer, PDF, true, false, Some(&prior), None),
            Err(FileError::Conflict)
        );
        let mut partial = transfer.clone();
        partial.received = 1;
        assert_eq!(
            finalize(true, "lab", &partial, PDF, true, false, None, None),
            Err(FileError::Interrupted)
        );
        let mut cancelled = transfer.clone();
        cancelled.cancelled = true;
        assert_eq!(
            finalize(true, "lab", &cancelled, PDF, true, false, None, None),
            Err(FileError::CancelledTransfer)
        );
        assert_eq!(
            finalize(true, "lab", &transfer, PDF, false, false, None, None),
            Err(FileError::Foreign)
        );
        assert_eq!(
            finalize(true, "lab", &transfer, PDF, true, true, None, None),
            Err(FileError::Expired)
        );
        assert_eq!(
            finalize(false, "lab", &transfer, PDF, true, false, None, None),
            Err(FileError::Revoked)
        );
        assert_eq!(
            finalize(true, "other", &transfer, PDF, true, false, None, None),
            Err(FileError::WrongProject)
        );
        let mut app = transfer.clone();
        app.app = "other-app".into();
        assert_eq!(
            finalize(true, "lab", &app, PDF, true, false, None, None),
            Err(FileError::WrongApp)
        );
        let mut huge = transfer.clone();
        huge.size = MAX_BYTES + 1;
        assert_eq!(
            finalize(true, "lab", &huge, PDF, true, false, None, None),
            Err(FileError::OverLimit)
        );
        let mut walked = transfer.clone();
        walked.handle_id = "../secret".into();
        assert_eq!(
            finalize(true, "lab", &walked, PDF, true, false, None, None),
            Err(FileError::Traversal)
        );
    }
}
