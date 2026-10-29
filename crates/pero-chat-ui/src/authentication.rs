//! Some Agents advertise credential acknowledgement as if it were an interactive login.
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
pub struct AuthenticationMethod {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(rename = "type", default)]
    pub kind: Option<String>,
}

impl AuthenticationMethod {
    pub fn terminal_command(&self) -> Option<&'static str> {
        match self.id.as_str() {
            "opencode-login" => Some("opencode auth login"),
            "qodercli-login" => Some("qodercli login"),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_acknowledgement_requires_terminal_login_first() {
        for (id, command) in [("opencode-login", Some("opencode auth login")), ("qodercli-login", Some("qodercli login")), ("login", None)] {
            let method = AuthenticationMethod { id: id.into(), name: "Login".into(), description: String::new(), kind: None };
            assert_eq!(method.terminal_command(), command);
        }
    }
}
