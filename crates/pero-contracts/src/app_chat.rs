//! App identity associates a conversation with its originating panel. It grants no tools.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AppChatScope {
    pub app: String,
    pub panel: String,
}

impl AppChatScope {
    pub fn valid(&self) -> bool {
        [&self.app, &self.panel].into_iter().all(|value| {
            !value.is_empty()
                && value.len() <= 128
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        })
    }
}
