//! Durable environment evidence. The Host calls actual Owners after commit.
use crate::environments::{EnvironmentUse, Identity, UseCommand, UseEffect, UseRecord};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use std::path::Path;

pub struct EnvironmentUses {
    db: Connection,
}
impl EnvironmentUses {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let db = Connection::open(path).map_err(|e| e.to_string())?;
        db.execute_batch(
            "PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS environment_uses (id TEXT PRIMARY KEY, body TEXT NOT NULL);",
        )
        .map_err(|e| e.to_string())?;
        Ok(Self { db })
    }
    /// Loading reports recorded facts only. No recovered effect is dispatched.
    pub fn get(&self, id: &Identity) -> Result<Option<UseRecord>, String> {
        let body: Option<String> = self
            .db
            .query_row(
                "SELECT body FROM environment_uses WHERE id=?1",
                [id.as_str()],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        body.map(|body| decode(id, &body)).transpose()
    }
    /// Call the one domain fold, commit its evidence, then return new effects.
    /// A failed commit leaves the caller without permission to carry them out.
    pub fn apply(
        &mut self,
        id: &Identity,
        command: UseCommand,
    ) -> Result<(EnvironmentUse, Vec<UseEffect>), String> {
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let body: Option<String> = tx
            .query_row(
                "SELECT body FROM environment_uses WHERE id=?1",
                [id.as_str()],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let (record, effects) = if let Some(body) = body {
            decode(id, &body)?.apply(command)
        } else {
            let UseCommand::Begin(request) = command else {
                return Err("Environment Use not found".into());
            };
            if &request.id != id {
                return Err("Environment Use identity changed".into());
            }
            UseRecord::begin(request)
        }
        .map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO environment_uses(id,body) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
            params![id.as_str(), serde_json::to_string(&record).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok((record.state().clone(), effects))
    }
}
fn decode(id: &Identity, body: &str) -> Result<UseRecord, String> {
    let record: UseRecord = serde_json::from_str(body).map_err(|e| e.to_string())?;
    if &record.state().request().id != id {
        return Err("Stored Environment Use identity changed".into());
    }
    Ok(record)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::environments::{UseRequest, UseState};

    #[test]
    fn restart_does_not_repeat_acquisition_and_failed_commit_has_no_effect() {
        let directory =
            std::env::temp_dir().join(format!("pero-environment-use-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("uses.sqlite");
        let id: Identity = "use".to_owned().try_into().unwrap();
        let request = UseRequest {
            id: id.clone(),
            consumer: "attempt".to_owned().try_into().unwrap(),
            snapshot: serde_json::from_str(include_str!(
                "../../pero-runtime/src/environments/software/legacy-snapshot.json"
            ))
            .unwrap(),
        };
        let mut store = EnvironmentUses::open(&path).unwrap();
        assert_eq!(
            store
                .apply(&id, UseCommand::Begin(request.clone()))
                .unwrap()
                .1,
            vec![UseEffect::Acquire]
        );
        drop(store);
        let mut store = EnvironmentUses::open(&path).unwrap();
        assert_eq!(
            store.get(&id).unwrap().unwrap().state().state(),
            UseState::Acquiring
        );
        assert!(
            store
                .apply(&id, UseCommand::Begin(request))
                .unwrap()
                .1
                .is_empty()
        );
        store.db.execute_batch("CREATE TRIGGER fail_write BEFORE UPDATE ON environment_uses BEGIN SELECT RAISE(ABORT,'test storage failure'); END;").unwrap();
        assert!(store.apply(&id, UseCommand::Unknown).is_err());
        assert_eq!(
            store.get(&id).unwrap().unwrap().state().state(),
            UseState::Acquiring
        );
        drop(store);
        let store = EnvironmentUses::open(&path).unwrap();
        assert_eq!(
            store.get(&id).unwrap().unwrap().state().state(),
            UseState::Acquiring
        );
        drop(store);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
