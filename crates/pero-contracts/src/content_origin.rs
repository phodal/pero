//! Authority namespaces for documents; a reference never grants new access.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag="kind",rename_all="snake_case",deny_unknown_fields)]
pub enum ContentOrigin {
    Conversation {thread_id:String},
    File {path:String},
    App {app:String,panel:String},
    Mcp {server:String,thread_id:String},
}
impl ContentOrigin {
    pub fn thread_id(&self)->Option<&str> {
        match self {Self::Conversation {thread_id}|Self::Mcp {thread_id,..}=>Some(thread_id),_=>None}
    }
}
