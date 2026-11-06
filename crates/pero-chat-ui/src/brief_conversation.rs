//! Presentation of a brief generated for Insights; its schema stays in the App.
use pero_contracts::AppChatScope;
use serde::Serialize;

#[derive(Clone, Default, Serialize)]
pub struct BriefConversation {
    pub raw_open: bool,
}

impl BriefConversation {
    pub fn from_origin(scope: Option<&AppChatScope>, app: Option<&str>, managed_run: bool) -> Option<Self> {
        (app == Some("insights") && !managed_run
            && scope.is_some_and(|scope| scope.app == "insights" && scope.panel == "main"))
            .then(Self::default)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_insights_generation_uses_the_brief_presentation() {
        for (scope_app, binding, run, expected) in [
            ("insights", Some("insights"), false, true),
            ("insights", None, false, false),
            ("insights", Some("insights"), true, false),
            ("paper-agent", Some("paper-agent"), false, false),
            ("paper-agent", Some("insights"), false, false),
        ] {
            let scope = AppChatScope { app: scope_app.into(), panel: "main".into() };
            assert_eq!(BriefConversation::from_origin(Some(&scope), binding, run).is_some(), expected);
        }
    }
}
