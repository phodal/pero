//! Owner-qualified App resource identity. A reference names an object.
//! It is not a grant, a path, or a runtime incarnation.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const PAPER_EVIDENCE: &[u8] = b"pero-paper-evidence-v1";
pub const PAPER_DIGEST: &str = "34ad712113ddbb4f4c4dc5f46380924a5ff69f53e0e5bc1b63e03c5bb6d44f90";
pub const DOMAIN_PROVENANCE: &str = "domain:paper";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RevisionClass {
    Immutable,
    Observed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ResourceOperation {
    Read,
    Create,
    Device,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ResourceError {
    Missing,
    Stale,
    Revoked,
    OwnerUnavailable,
    MissingPolicy,
    WrongProject,
    DisabledApp,
    Ungranted,
    Traversal,
    Spoofed,
    NotEvidence,
    Unsupported,
}

impl std::fmt::Display for ResourceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Missing => "missing",
            Self::Stale => "stale",
            Self::Revoked => "revoked",
            Self::OwnerUnavailable => "owner_unavailable",
            Self::MissingPolicy => "missing_policy",
            Self::WrongProject => "wrong_project",
            Self::DisabledApp => "disabled_app",
            Self::Ungranted => "ungranted",
            Self::Traversal => "traversal",
            Self::Spoofed => "spoofed",
            Self::NotEvidence => "not_evidence",
            Self::Unsupported => "unsupported",
        })
    }
}

/// Identity of one App object on one owner. No path, URL, or credential.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct QualifiedResource {
    pub owner_host: String,
    pub shared_project: Option<String>,
    pub local_project: String,
    pub app: String,
    pub app_instance: String,
    pub app_version: String,
    pub kind: String,
    pub id: String,
    pub revision: String,
    pub class: RevisionClass,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolveRequest<'a> {
    pub operation: ResourceOperation,
    pub existing: Option<&'a QualifiedResource>,
    pub policy_owner: Option<&'a str>,
    pub owner_available: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Resolved {
    Local,
    Remote { host_id: String },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResourceGrant {
    pub shared_project: String,
    pub app: String,
    pub id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Evidence<'a> {
    pub digest: &'a str,
    pub media_type: &'a str,
    pub body: &'a [u8],
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CacheEntry<'a> {
    pub owner_host: &'a str,
    pub revision: &'a str,
    pub provenance: &'a str,
    pub digest: &'a str,
    pub body: &'a [u8],
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReadRequest<'a> {
    pub resource: &'a QualifiedResource,
    pub project: &'a str,
    pub member: bool,
    pub app_enabled: bool,
    pub grants: &'a [ResourceGrant],
    pub evidence: Option<Evidence<'a>>,
    pub cache: Option<CacheEntry<'a>>,
    pub owner_available: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReadResult<'a> {
    pub owner_host: &'a str,
    pub revision: &'a str,
    pub digest: &'a str,
    pub media_type: &'a str,
    pub body: &'a [u8],
    pub provenance: &'a str,
}

fn token(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && !value.contains('/')
        && !value.contains('\\')
        && !value.contains("..")
        && value.bytes().all(|b| b.is_ascii_graphic() && b != b':')
}

fn sha256_hex(body: &[u8]) -> String {
    format!("{:x}", Sha256::digest(body))
}

fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn traversed(value: &str) -> bool {
    value.contains("..") || value.contains('/') || value.contains('\\') || value.contains('\0')
}

impl QualifiedResource {
    pub fn fields_ok(&self) -> Result<(), ResourceError> {
        for value in [
            self.owner_host.as_str(),
            self.local_project.as_str(),
            self.app.as_str(),
            self.app_instance.as_str(),
            self.app_version.as_str(),
            self.kind.as_str(),
            self.id.as_str(),
            self.revision.as_str(),
        ] {
            if traversed(value) {
                return Err(ResourceError::Traversal);
            }
        }
        if let Some(project) = &self.shared_project {
            if traversed(project) {
                return Err(ResourceError::Traversal);
            }
            if !token(project) {
                return Err(ResourceError::Missing);
            }
        }
        if !token(&self.owner_host)
            || !token(&self.local_project)
            || !token(&self.app)
            || !token(&self.app_instance)
            || !token(&self.app_version)
            || !token(&self.kind)
            || !token(&self.id)
            || !token(&self.revision)
        {
            return Err(ResourceError::Missing);
        }
        Ok(())
    }
}

/// Existing object keeps its owner. A new operation needs an explicit policy.
/// A device operation stays local. Unavailability never selects another owner.
pub fn resolve(request: ResolveRequest<'_>) -> Result<Resolved, ResourceError> {
    if let Some(existing) = request.existing {
        existing.fields_ok()?;
        if !request.owner_available {
            return Err(ResourceError::OwnerUnavailable);
        }
        return Ok(if existing.owner_host == "local" {
            Resolved::Local
        } else {
            Resolved::Remote {
                host_id: existing.owner_host.clone(),
            }
        });
    }
    if request.operation == ResourceOperation::Device {
        return Ok(Resolved::Local);
    }
    if request.operation == ResourceOperation::Create {
        let Some(owner) = request.policy_owner else {
            return Err(ResourceError::MissingPolicy);
        };
        if traversed(owner) {
            return Err(ResourceError::Traversal);
        }
        if !request.owner_available {
            return Err(ResourceError::OwnerUnavailable);
        }
        return Ok(if owner == "local" {
            Resolved::Local
        } else if token(owner) {
            Resolved::Remote {
                host_id: owner.to_owned(),
            }
        } else {
            return Err(ResourceError::MissingPolicy);
        });
    }
    Err(ResourceError::Missing)
}

/// Read one Paper revision. The body comes from the domain source, not from Go storage.
pub fn read_paper<'a>(request: ReadRequest<'a>) -> Result<ReadResult<'a>, ResourceError> {
    let resource = request.resource;
    resource.fields_ok()?;
    if !request.member {
        return Err(ResourceError::Revoked);
    }
    let Some(shared) = resource.shared_project.as_deref() else {
        return Err(ResourceError::WrongProject);
    };
    if shared != request.project {
        return Err(ResourceError::WrongProject);
    }
    if !request.app_enabled {
        return Err(ResourceError::DisabledApp);
    }
    if resource.app != "paper-agent" || resource.kind != "paper" {
        return Err(ResourceError::Unsupported);
    }
    if resource.class != RevisionClass::Immutable || !digest(&resource.revision) {
        return Err(ResourceError::NotEvidence);
    }
    if !request.grants.iter().any(|grant| {
        grant.shared_project == shared && grant.app == resource.app && grant.id == resource.id
    }) {
        return Err(ResourceError::Ungranted);
    }
    let resolved = resolve(ResolveRequest {
        operation: ResourceOperation::Read,
        existing: Some(resource),
        policy_owner: None,
        owner_available: request.owner_available,
    })?;
    match resolved {
        Resolved::Local if resource.owner_host == "local" => {}
        Resolved::Remote { host_id } if host_id == resource.owner_host => {}
        _ => return Err(ResourceError::OwnerUnavailable),
    }
    let Some(evidence) = request.evidence else {
        return Err(ResourceError::OwnerUnavailable);
    };
    if evidence.digest != resource.revision || evidence.digest != &sha256_hex(evidence.body) {
        return Err(ResourceError::Stale);
    }
    if let Some(cache) = request.cache {
        let matches = cache.owner_host == resource.owner_host
            && cache.revision == resource.revision
            && cache.digest == evidence.digest
            && cache.provenance == DOMAIN_PROVENANCE
            && cache.body == evidence.body;
        if !matches {
            return Err(ResourceError::Stale);
        }
    }
    Ok(ReadResult {
        owner_host: resource.owner_host.as_str(),
        revision: resource.revision.as_str(),
        digest: evidence.digest,
        media_type: evidence.media_type,
        body: evidence.body,
        provenance: DOMAIN_PROVENANCE,
    })
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalResource {
    pub app: String,
    pub kind: String,
    pub id: String,
    pub revision: String,
    pub class: RevisionClass,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProjectBinding {
    pub owner_host: String,
    pub shared_project: String,
    pub local_project: String,
    pub app_instance: String,
    pub app_version: String,
}

/// A local reference stays local until a caller supplies one binding.
/// The binding copies the revision class; it does not promote an observation.
pub fn qualify(
    local: &LocalResource,
    binding: Option<&ProjectBinding>,
) -> Result<QualifiedResource, ResourceError> {
    let Some(binding) = binding else {
        return Err(ResourceError::MissingPolicy);
    };
    let qualified = QualifiedResource {
        owner_host: binding.owner_host.clone(),
        shared_project: Some(binding.shared_project.clone()),
        local_project: binding.local_project.clone(),
        app: local.app.clone(),
        app_instance: binding.app_instance.clone(),
        app_version: binding.app_version.clone(),
        kind: local.kind.clone(),
        id: local.id.clone(),
        revision: local.revision.clone(),
        class: local.class,
    };
    qualified.fields_ok()?;
    Ok(qualified)
}

pub fn paper(owner: &str, project: &str, id: &str) -> QualifiedResource {
    QualifiedResource {
        owner_host: owner.into(),
        shared_project: Some(project.into()),
        local_project: format!("local-{project}"),
        app: "paper-agent".into(),
        app_instance: format!("paper-agent@{owner}"),
        app_version: "1".into(),
        kind: "paper".into(),
        id: id.into(),
        revision: PAPER_DIGEST.into(),
        class: RevisionClass::Immutable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grant(project: &str, id: &str) -> ResourceGrant {
        ResourceGrant {
            shared_project: project.into(),
            app: "paper-agent".into(),
            id: id.into(),
        }
    }

    fn evidence() -> Evidence<'static> {
        Evidence {
            digest: PAPER_DIGEST,
            media_type: "text/plain",
            body: PAPER_EVIDENCE,
        }
    }

    #[test]
    fn the_same_paper_evidence_is_read_from_its_owner_only() {
        let local = paper("local", "lab", "paper-1");
        let remote = paper("host-b", "lab", "paper-1");
        let other = paper("host-c", "lab", "paper-1");
        let grants = [grant("lab", "paper-1")];
        let local_read = read_paper(ReadRequest {
            resource: &local,
            project: "lab",
            member: true,
            app_enabled: true,
            grants: &grants,
            evidence: Some(evidence()),
            cache: None,
            owner_available: true,
        })
        .unwrap();
        let remote_read = read_paper(ReadRequest {
            resource: &remote,
            project: "lab",
            member: true,
            app_enabled: true,
            grants: &grants,
            evidence: Some(evidence()),
            cache: Some(CacheEntry {
                owner_host: "host-b",
                revision: PAPER_DIGEST,
                provenance: DOMAIN_PROVENANCE,
                digest: PAPER_DIGEST,
                body: PAPER_EVIDENCE,
            }),
            owner_available: true,
        })
        .unwrap();
        assert_eq!(local_read.body, remote_read.body);
        assert_eq!(local_read.digest, PAPER_DIGEST);
        assert_eq!(remote_read.owner_host, "host-b");
        assert_eq!(remote_read.provenance, DOMAIN_PROVENANCE);
        let separate = resolve(ResolveRequest {
            operation: ResourceOperation::Read,
            existing: Some(&other),
            policy_owner: Some("host-b"),
            owner_available: true,
        })
        .unwrap();
        assert_eq!(
            separate,
            Resolved::Remote {
                host_id: "host-c".into()
            }
        );
    }

    #[test]
    fn resolution_never_changes_owner() {
        let existing = paper("host-b", "lab", "paper-1");
        let cases = [
            (
                ResourceOperation::Read,
                None,
                None,
                true,
                Err(ResourceError::Missing),
            ),
            (
                ResourceOperation::Create,
                None,
                None,
                true,
                Err(ResourceError::MissingPolicy),
            ),
            (
                ResourceOperation::Create,
                None,
                Some("host-b"),
                true,
                Ok(Resolved::Remote {
                    host_id: "host-b".into(),
                }),
            ),
            (
                ResourceOperation::Device,
                None,
                Some("host-b"),
                true,
                Ok(Resolved::Local),
            ),
            (
                ResourceOperation::Read,
                Some(&existing),
                Some("host-c"),
                false,
                Err(ResourceError::OwnerUnavailable),
            ),
            (
                ResourceOperation::Create,
                None,
                Some("host-b"),
                false,
                Err(ResourceError::OwnerUnavailable),
            ),
        ];
        for (operation, existing, policy, available, expect) in cases {
            assert_eq!(
                resolve(ResolveRequest {
                    operation,
                    existing,
                    policy_owner: policy,
                    owner_available: available
                }),
                expect
            );
        }
    }

    #[test]
    fn paper_reads_fail_closed() {
        let resource = paper("host-b", "lab", "paper-1");
        let grants = [grant("lab", "paper-1")];
        let ok = ReadRequest {
            resource: &resource,
            project: "lab",
            member: true,
            app_enabled: true,
            grants: &grants,
            evidence: Some(evidence()),
            cache: None,
            owner_available: true,
        };
        assert_eq!(
            read_paper(ReadRequest {
                member: false,
                ..ok.clone()
            }),
            Err(ResourceError::Revoked)
        );
        assert_eq!(
            read_paper(ReadRequest {
                project: "other",
                ..ok.clone()
            }),
            Err(ResourceError::WrongProject)
        );
        assert_eq!(
            read_paper(ReadRequest {
                app_enabled: false,
                ..ok.clone()
            }),
            Err(ResourceError::DisabledApp)
        );
        assert_eq!(
            read_paper(ReadRequest {
                grants: &[],
                ..ok.clone()
            }),
            Err(ResourceError::Ungranted)
        );
        assert_eq!(
            read_paper(ReadRequest {
                owner_available: false,
                ..ok.clone()
            }),
            Err(ResourceError::OwnerUnavailable)
        );
        let stale = "ab".repeat(32);
        assert_eq!(
            read_paper(ReadRequest {
                evidence: Some(Evidence {
                    digest: &stale,
                    media_type: "text/plain",
                    body: b"other"
                }),
                ..ok.clone()
            }),
            Err(ResourceError::Stale)
        );
        let mut traversed = resource.clone();
        traversed.id = "../secret".into();
        assert_eq!(traversed.fields_ok(), Err(ResourceError::Traversal));
        let mut observed = resource.clone();
        observed.class = RevisionClass::Observed;
        assert_eq!(
            read_paper(ReadRequest {
                resource: &observed,
                ..ok.clone()
            }),
            Err(ResourceError::NotEvidence)
        );
        assert_eq!(
            read_paper(ReadRequest {
                cache: Some(CacheEntry {
                    owner_host: "host-c",
                    revision: PAPER_DIGEST,
                    provenance: DOMAIN_PROVENANCE,
                    digest: PAPER_DIGEST,
                    body: PAPER_EVIDENCE,
                }),
                ..ok
            }),
            Err(ResourceError::Stale)
        );
    }

    #[test]
    fn shared_binding_is_explicit() {
        let local = LocalResource {
            app: "paper-agent".into(),
            kind: "paper".into(),
            id: "paper-1".into(),
            revision: PAPER_DIGEST.into(),
            class: RevisionClass::Immutable,
        };
        assert_eq!(qualify(&local, None), Err(ResourceError::MissingPolicy));
        let bound = qualify(
            &local,
            Some(&ProjectBinding {
                owner_host: "host-b".into(),
                shared_project: "lab".into(),
                local_project: "local-lab".into(),
                app_instance: "paper-agent@host-b".into(),
                app_version: "1".into(),
            }),
        )
        .unwrap();
        assert_eq!(bound.owner_host, "host-b");
        assert_eq!(bound.class, RevisionClass::Immutable);
        let mut observed = local;
        observed.class = RevisionClass::Observed;
        let still = qualify(
            &observed,
            Some(&ProjectBinding {
                owner_host: "host-b".into(),
                shared_project: "lab".into(),
                local_project: "local-lab".into(),
                app_instance: "paper-agent@host-b".into(),
                app_version: "1".into(),
            }),
        )
        .unwrap();
        assert_eq!(still.class, RevisionClass::Observed);
    }
}
