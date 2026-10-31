//! Display metadata for the Point-compatible Automation App. Execution state
//! remains in State; editing a label never creates a second scheduler.
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CatalogEntry {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub deleted: bool,
    pub created_at: u64,
}
impl CatalogEntry {
    pub fn rename(&mut self, name: String) -> Result<(), &'static str> {
        let name = name.trim();
        if name.is_empty() || name.len() > 512 || name.chars().any(char::is_control) { return Err("Automation name is required and must fit within 512 bytes"); }
        self.name = name.to_owned();
        Ok(())
    }
}
