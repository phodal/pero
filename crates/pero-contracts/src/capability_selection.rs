//! A user's choice of operation and target. A selection grants no access.
use crate::context::{ContextContent, ContextKind, ContextReference};
use crate::mcp_runtime::{McpRuntimeSession, McpRuntimeStatus};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScienceLanguage {
    Python,
    R,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CapabilitySelection {
    Browser,
    BrowserTab {
        tab_id: String,
        origin: String,
    },
    Computer,
    RemoteDesktop {
        attachment: String,
    },
    AppData {
        app: String,
        panel: String,
    },
    AppPanel {
        app: String,
        panel: String,
        surface_id: String,
        instance: String,
    },
    Connector {
        connector_id: String,
    },
    ProjectDelegate,
    Science {
        language: ScienceLanguage,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilitySetup {
    TabGrant,
    ComputerEnabled,
    PanelVisible,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ComposerCapability {
    pub selection: CapabilitySelection,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub needs: Option<CapabilitySetup>,
}

impl CapabilitySelection {
    pub fn valid(&self) -> bool {
        let valid = |s: &str| !s.is_empty() && s.len() <= 2048 && !s.chars().any(char::is_control);
        match self {
            Self::AppData { app, panel } => valid(app) && valid(panel),
            Self::AppPanel {
                app,
                panel,
                surface_id,
                instance,
            } => valid(app) && valid(panel) && valid(surface_id) && valid(instance),
            Self::BrowserTab { tab_id, origin } => valid(tab_id) && valid(origin),
            Self::Connector { connector_id } => valid(connector_id),
            Self::RemoteDesktop { attachment } => valid(attachment),
            _ => true,
        }
    }

    pub fn mounted(&self, runtime: Option<&McpRuntimeSession>, science: bool) -> bool {
        let Some(runtime) = runtime.filter(|runtime| !runtime.closed) else {
            return false;
        };
        let (server, tool) = match self {
            Self::Browser | Self::BrowserTab { .. } => ("pero-app-use", "browser_use"),
            Self::Computer | Self::RemoteDesktop { .. } => ("pero-app-use", "computer_use"),
            Self::AppPanel { .. } => ("pero-app-use", "app_use"),
            Self::AppData { .. } => ("pero-app-use", "app_describe"),
            Self::Connector { .. } => ("pero-connectors", "connectors_call"),
            Self::ProjectDelegate => ("pero-project", "project_work"),
            Self::Science { .. } => return science,
        };
        runtime.servers.iter().any(|s| {
            s.server == server
                && (!runtime.observable
                    || s.status == McpRuntimeStatus::Connected && s.tools.iter().any(|t| t == tool))
        })
    }

    pub fn prompt(&self) -> String {
        let instruction = match self {
            Self::Browser => "Use browser_use. Call tabs to discover the available tabs and use the intended tab ID for page operations.",
            Self::BrowserTab { .. } => {
                "Use browser_use with this tabId and origin. Stop if the selected tab is no longer available."
            }
            Self::Computer | Self::RemoteDesktop { .. } => {
                "Use computer_use on the selected desktop. Check status and observe the requested window before acting."
            }
            Self::AppData { .. } => {
                "Use the selected App's declared data tools for this request. Inspect app_describe for its current schemas."
            }
            Self::AppPanel { .. } => {
                "Use app_use on this exact panel instance. Check both surfaceId and instance in inventory before starting."
            }
            Self::Connector { .. } => {
                "Use the selected connector. Inspect connectors_list and call explicitly allowed tools for this connectorId."
            }
            Self::ProjectDelegate => "Use project_work for delegation in this project.",
            Self::Science { .. } => {
                "Use the selected language in this conversation's shared science session."
            }
        };
        format!(
            "User-selected capability\n{instruction}\nTarget: {}",
            serde_json::to_string(self).expect("serializable target")
        )
    }

    pub fn reference(&self, label: String) -> ContextReference {
        let id = format!(
            "pero-capability:{}",
            serde_json::to_string(self).expect("serializable target")
        );
        ContextReference {
            id: id.clone(),
            kind: ContextKind::Capability,
            source: id,
            label,
            content: ContextContent::Capability {
                selection: self.clone(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp_runtime::McpRuntimeServer;

    #[test]
    fn only_mounted_capabilities_enter_the_picker() {
        let mut runtime = McpRuntimeSession {
            incarnation: 1,
            agent_id: "agent".into(),
            thread_id: "chat".into(),
            session_id: None,
            revision: 1,
            observable: true,
            closed: false,
            servers: vec![McpRuntimeServer {
                server: "pero-app-use".into(),
                generation: 1,
                status: McpRuntimeStatus::Connected,
                tools: vec!["app_describe".into()],
            }],
        };
        let app = CapabilitySelection::AppData {
            app: "notebook".into(),
            panel: "main".into(),
        };
        let panel = CapabilitySelection::AppPanel {
            app: "notebook".into(),
            panel: "main".into(),
            surface_id: "notebook:main".into(),
            instance: "1".into(),
        };
        let science = CapabilitySelection::Science {
            language: ScienceLanguage::Python,
        };
        for (selection, negotiated, expected) in [
            (&app, false, true),
            (&panel, false, false),
            (&science, false, false),
            (&science, true, true),
        ] {
            assert_eq!(selection.mounted(Some(&runtime), negotiated), expected);
        }
        runtime.observable = false;
        assert!(panel.mounted(Some(&runtime), false));
        runtime.closed = true;
        assert!(!panel.mounted(Some(&runtime), false));
    }
}
