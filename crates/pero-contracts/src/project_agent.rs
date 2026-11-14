//! A Project's conversation membership. Session execution remains with ACP.
use serde::{Deserialize, Serialize};
use crate::session_settings::{SessionSettings, SettingSelection};

/// A child's initial policy is the primary's acknowledged policy, not a default.
pub struct ProjectDelegationPolicy {
    pub initial_settings: Vec<SettingSelection>,
}
impl ProjectDelegationPolicy {
    pub fn inherit(primary_agent: &str, child_agent: &str, settings: &SessionSettings) -> Result<Self, String> {
        let permissions: Vec<_> = settings.options.iter().filter(|option| option.id == "permission" || option.category == "_permission").collect();
        if !permissions.is_empty() && primary_agent != child_agent {
            return Err("This Agent's permission policy cannot be mapped to a different Agent. Delegate with the same Agent or use a separate explicit conversation.".into());
        }
        let initial_settings = permissions.into_iter().map(|permission|
            settings.select(&permission.id, &permission.current).map_err(str::to_owned)
        ).collect::<Result<_,_>>()?;
        Ok(Self {initial_settings})
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProjectSessionBinding {
    pub project_id: String,
    pub parent_thread: Option<String>,
    pub label: String,
}

impl ProjectSessionBinding {
    pub fn primary(project_id: String, label: String) -> Result<Self, String> {
        Self::new(project_id, None, label)
    }
    pub fn child(&self, parent_thread: String, label: String) -> Result<Self, String> {
        if self.parent_thread.is_some() {
            return Err("Only the Project's primary Agent can delegate work".into());
        }
        Self::new(self.project_id.clone(), Some(parent_thread), label)
    }
    fn new(project_id: String, parent_thread: Option<String>, label: String) -> Result<Self, String> {
        let value = Self {project_id, parent_thread, label: label.trim().into()};
        value.validate()?;
        Ok(value)
    }
    pub fn validate(&self) -> Result<(), String> {
        request_key(&self.project_id)?;
        if let Some(parent) = &self.parent_thread { request_key(parent)?; }
        if self.label.trim().is_empty() || self.label.chars().count() > 200 || self.label.contains('\0') {
            return Err("Enter a work title of at most 200 characters".into());
        }
        Ok(())
    }
    /// Membership grants no execution rights and never admits another project's thread.
    pub fn owns_child(&self, primary_thread: &str, child: &Self) -> bool {
        self.parent_thread.is_none() && self.project_id == child.project_id
            && child.parent_thread.as_deref() == Some(primary_thread)
    }
}

pub fn request_key(value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 128
        || !value.bytes().all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b)) {
        return Err("Project and conversation identities must contain 1–128 letters, digits or ._:-".into());
    }
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ProjectAgentRequest {
    pub method: String,
    pub request_id: String,
    #[serde(flatten)]
    pub command: ProjectAgentAction,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum ProjectAgentAction {
    Start {project_id: String, agent_id: String, #[serde(default)] prompt: Option<String>},
    Snapshot {project_id: String},
    Delegate {thread_id: String, agent_id: String, title: String, prompt: String},
    Followup {thread_id: String, prompt: String},
    Cancel {thread_id: String},
    Summarize {thread_id: String},
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ProjectAgentEvidence {
    pub tool_call_id: String,
    pub title: String,
    pub status: String,
    pub output: String,
    pub truncated: bool,
}

/// A partial receipt observed at the ACP boundary, never a task transition.
pub struct ProjectAgentEvidenceUpdate {
    pub tool_call_id: String,
    pub title: Option<String>,
    pub status: Option<String>,
    pub output: Option<String>,
}
impl ProjectAgentEvidence {
    pub fn observe(receipts: &mut Vec<Self>, update: ProjectAgentEvidenceUpdate) {
        if update.tool_call_id.is_empty() {return;}
        let index = receipts.iter().position(|receipt| receipt.tool_call_id == update.tool_call_id)
            .unwrap_or_else(|| {
                receipts.push(Self {tool_call_id: update.tool_call_id.clone(), title: String::new(),
                    status: String::new(), output: String::new(), truncated: false});
                receipts.len() - 1
            });
        let receipt = &mut receipts[index];
        if let Some(title) = update.title {receipt.title = title;}
        if let Some(status) = update.status {receipt.status = status;}
        if let Some(output) = update.output {
            receipt.truncated = output.chars().count() > 1_000;
            receipt.output = output.chars().take(1_000).collect();
        }
        if receipts.len() > 8 {receipts.remove(0);}
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ProjectAgentSession {
    pub thread_id: String,
    pub binding: ProjectSessionBinding,
    pub agent_id: String,
    pub workspace: String,
    pub active: bool,
    pub status: String,
    pub result: String,
    pub error: Option<String>,
    #[serde(default)]
    pub evidence: Vec<ProjectAgentEvidence>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ProjectAgentSnapshot {
    pub project_id: String,
    pub sessions: Vec<ProjectAgentSession>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_thread: Option<String>,
}
/// The actual serialized model context has a byte budget, including metadata.
#[derive(Debug, Serialize)]
pub struct ProjectAgentEvidenceBatch {
    pub sessions: Vec<ProjectAgentSession>,
    pub omitted_sessions: usize,
}
impl ProjectAgentSnapshot {
    /// Shared evidence budget for model tool results and explicit summaries.
    /// The primary already owns its transcript; embedding it would recursively
    /// grow later summaries. All excerpts keep the original thread/tool IDs.
    pub fn child_evidence(&self) -> ProjectAgentEvidenceBatch {
        let mut budget = 24_000;
        let children = self.sessions.iter().filter(|session| session.binding.parent_thread.is_some());
        let mut batch = ProjectAgentEvidenceBatch {sessions: Vec::new(), omitted_sessions: children.clone().count()};
        for mut session in children.cloned() {
            let limit = budget.min(6_000);
            let truncated = session.result.chars().count() > limit;
            session.result = session.result.chars().take(limit).collect();
            budget -= session.result.chars().count();
            if truncated {session.result.push_str("\n[Excerpt truncated. Open the original conversation for the complete evidence.]");}
            for receipt in &mut session.evidence {
                let limit = budget.min(1_000);
                receipt.truncated |= receipt.output.chars().count() > limit;
                receipt.output = receipt.output.chars().take(limit).collect();
                budget -= receipt.output.chars().count();
            }
            batch.sessions.push(session);
            batch.omitted_sessions -= 1;
            if serde_json::to_vec_pretty(&batch).expect("Project evidence").len() > 120_000 {
                batch.sessions.pop();
                batch.omitted_sessions += 1;
                break;
            }
        }
        batch
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn project_membership_keeps_delegation_with_the_original_primary() {
        let primary = ProjectSessionBinding::primary("question".into(), "Project Agent".into()).unwrap();
        let child = primary.child("primary".into(), " Compare evidence ".into()).unwrap();
        for (parent, candidate, expected) in [
            ("primary", child.clone(), true),
            ("other", child.clone(), false),
            ("primary", ProjectSessionBinding {project_id:"another".into(), ..child.clone()}, false),
            ("primary", primary.clone(), false),
        ] { assert_eq!(primary.owns_child(parent, &candidate), expected); }
        assert!(child.child("child".into(), "nested".into()).is_err());
        assert_eq!(child.label, "Compare evidence");
        for (id, label) in [("", "work"), ("../outside", "work"), ("project", " "), ("project", "bad\0title")] {
            assert!(ProjectSessionBinding::primary(id.into(), label.into()).is_err());
        }
    }
    #[test]
    fn flat_host_requests_deserialize_at_the_entry_boundary() {
        for input in [
            serde_json::json!({"method":"project_agent","request_id":"a","action":"start","project_id":"p","agent_id":"pero"}),
            serde_json::json!({"method":"project_agent","request_id":"b","action":"snapshot","project_id":"p"}),
            serde_json::json!({"method":"project_agent","request_id":"c","action":"delegate","thread_id":"primary","agent_id":"pero","title":"Review","prompt":"Read the evidence"}),
        ] { assert!(serde_json::from_value::<ProjectAgentRequest>(input).is_ok()); }
        assert!(serde_json::from_value::<ProjectAgentRequest>(serde_json::json!({"method":"project_agent","request_id":"a","action":"snapshot","project_id":"p","grant":true})).is_err());
    }
    #[test]
    fn observed_evidence_retains_partial_fields_and_bounds_excerpts() {
        let mut receipts = Vec::new();
        for (title, status, output) in [
            (Some("Read evidence".into()), Some("in_progress".into()), None),
            (None, Some("completed".into()), Some("observed file contents".into())),
            (None, None, Some("x".repeat(1_001))),
        ] {
            ProjectAgentEvidence::observe(&mut receipts, ProjectAgentEvidenceUpdate {
                tool_call_id: "original-call".into(), title, status, output,
            });
        }
        assert_eq!(receipts[0].title, "Read evidence");
        assert_eq!(receipts[0].status, "completed");
        assert_eq!(receipts[0].output.chars().count(), 1_000);
        assert!(receipts[0].truncated);
        for number in 0..9 {
            ProjectAgentEvidence::observe(&mut receipts, ProjectAgentEvidenceUpdate {
                tool_call_id: number.to_string(), title: None, status: Some("failed".into()), output: None,
            });
        }
        assert_eq!(receipts.len(), 8);
        assert_eq!(receipts[0].tool_call_id, "1");
        assert!(receipts.iter().all(|receipt| receipt.status == "failed"));
    }
    #[test]
    fn serialized_child_evidence_is_bounded_and_reports_omissions() {
        for (count, output) in [(2, "observed evidence".to_owned()), (100, "证据\n\"".repeat(6_000))] {
            let primary = ProjectSessionBinding::primary("p".into(), "Primary".into()).unwrap();
            let snapshot = ProjectAgentSnapshot {project_id:"p".into(), selected_thread:None,
                sessions:(0..count).map(|i| ProjectAgentSession {thread_id:format!("child-{i}"),
                    binding:primary.child("primary".into(), "Check".into()).unwrap(), agent_id:"pero".into(),
                    workspace:"/workspace".repeat(100), active:false, status:"completed".into(),
                    result:output.clone(), error:None, evidence:vec![]}).collect()};
            let evidence = snapshot.child_evidence();
            assert!(serde_json::to_vec_pretty(&evidence).unwrap().len() <= 120_000);
            assert_eq!(evidence.sessions.len()+evidence.omitted_sessions, count);
            assert_eq!(evidence.omitted_sessions>0, count==100);
            if count==100 {assert!(evidence.sessions[0].result.contains("Excerpt truncated"));}
        }
    }
    #[test]
    fn delegation_carries_acknowledged_permissions_without_cross_agent_guessing() {
        use crate::session_settings::{SessionSetting, SettingChoice};
        for (parent, child, permission, expected) in [
            ("pero", "pero", Some("read-only"), Some("read-only")),
            ("pero", "pero", Some("auto-review"), Some("auto-review")),
            ("pero", "codex", Some("read-only"), None),
            ("codex", "codex", None, Some("")),
        ] {
            let settings = SessionSettings::new(permission.map(|value| SessionSetting {
                id: "permission".into(), name: "Permission".into(), category: "mode".into(), current: value.into(),
                choices: vec![SettingChoice {value: value.into(), label: value.into(), description: String::new()}],
            }).into_iter().collect()).unwrap();
            let actual = ProjectDelegationPolicy::inherit(parent, child, &settings);
            match expected {
                None => assert!(actual.is_err()),
                Some("") => assert!(actual.unwrap().initial_settings.is_empty()),
                Some(value) => assert_eq!(actual.unwrap().initial_settings[0].value, value),
            }
        }
    }
}
