//! Transactional responsibility owned by one Host profile, never chat history.
use pero_contracts::automation::{self as domain, Command, Effect, Ids, Limits, Receipt, State};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{path::Path, time::{Duration, SystemTime, UNIX_EPOCH}};

pub const INPUT_LIMIT: usize = 65_536;
const STORE_LIMIT: i64 = 64 * 1024 * 1024;

pub struct Store { db: Connection }
pub struct Commit { pub receipt: Receipt, pub effects: Vec<Effect> }

pub fn digest(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
fn failure(error: impl std::fmt::Display) -> String { format!("Automation storage: {error}") }

impl Store {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).map_err(failure)?; }
        let mut db = Connection::open(path).map_err(failure)?;
        db.busy_timeout(Duration::from_millis(250)).map_err(failure)?;
        // Retain the exclusive profile lock after the first transaction. Another
        // Host cannot recover live reservations or act as an automatic failover.
        db.execute_batch("PRAGMA locking_mode=EXCLUSIVE; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA max_page_count=32768;
            CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL, sequence INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS inputs (id TEXT PRIMARY KEY, content TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS admissions (execution_id TEXT PRIMARY KEY, body TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS effects (sequence INTEGER NOT NULL, ordinal INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(sequence,ordinal));
            CREATE TABLE IF NOT EXISTS attention (request_id TEXT PRIMARY KEY, reason TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS observations (execution_id TEXT NOT NULL, position INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL);")
            .map_err(failure)?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Exclusive).map_err(failure)?;
        let existing: Option<String> = tx.query_row("SELECT body FROM state WHERE id=1", [], |row| row.get(0)).optional().map_err(failure)?;
        if let Some(body) = existing {
            let restored: State = serde_json::from_str(&body).map_err(failure)?;
            restored.validate_restored().map_err(failure)?;
            for candidate in &restored.snapshots {
                let content: String = tx.query_row("SELECT content FROM inputs WHERE id=?1",[&candidate.content_ref],|row|row.get(0)).map_err(failure)?;
                if candidate.digest != candidate.content_ref || digest(content.as_bytes()) != candidate.digest {
                    return Err("Stored Automation input is corrupt".into());
                }
            }
        } else {
            let nonce = format!("{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).map_err(failure)?.as_nanos());
            let owner = format!("host-{}", &digest(nonce.as_bytes())[..24]);
            let limits = Limits { max_events: 2048, max_requests: 2048, max_snapshots: 512,
                max_definitions: 128, max_fanout: 16, max_event_bytes: INPUT_LIMIT,
                max_active: 1, max_dispatches: 2048 };
            let initial = State::new(owner.clone(), limits).map_err(failure)?;
            let initial = domain::apply(&initial, Command::PutBinding { binding: domain::SourceBinding {
                id: "local".into(), owner, authority: "trusted-local-host".into(),
                event_kinds: vec!["changed".into()],
            } }, 0, Ids::default()).map_err(failure)?.state;
            tx.execute("INSERT INTO state VALUES(1,?1,0)", [serde_json::to_string(&initial).map_err(failure)?]).map_err(failure)?;
        }
        tx.commit().map_err(failure)?;
        Ok(Self { db })
    }

    pub fn state(&self) -> Result<State, String> {
        let body: String = self.db.query_row("SELECT body FROM state WHERE id=1", [], |row| row.get(0)).map_err(failure)?;
        serde_json::from_str(&body).map_err(failure)
    }

    pub fn content(&self, id: &str) -> Result<String, String> {
        self.db.query_row("SELECT content FROM inputs WHERE id=?1", [id], |row| row.get(0)).map_err(failure)
    }

    /// Inputs, admission, decisions, reservations and effects commit together.
    /// Nothing returned from this function may be executed before COMMIT succeeds.
    pub fn apply(&mut self, commands: Vec<Command>, now: u64, input: Option<(&str, &str)>,
                 admission: Option<(&str, &Value)>, observation: Option<(&str, &Value)>) -> Result<Commit, String> {
        let tx = self.db.transaction_with_behavior(TransactionBehavior::Immediate).map_err(failure)?;
        let (body, mut sequence): (String, i64) = tx.query_row("SELECT body,sequence FROM state WHERE id=1", [], |row| Ok((row.get(0)?, row.get(1)?))).map_err(failure)?;
        let mut state: State = serde_json::from_str(&body).map_err(failure)?;
        if let Some((id, content)) = input {
            if content.is_empty() || content.len() > INPUT_LIMIT || digest(content.as_bytes()) != id { return Err("Invalid frozen input".into()); }
            tx.execute("INSERT OR IGNORE INTO inputs VALUES(?1,?2)", params![id, content]).map_err(failure)?;
            let stored: String = tx.query_row("SELECT content FROM inputs WHERE id=?1", [id], |row| row.get(0)).map_err(failure)?;
            if stored != content { return Err("Input identity conflict".into()); }
        }
        if let Some((id, snapshot)) = admission {
            tx.execute("INSERT INTO admissions VALUES(?1,?2)", params![id, snapshot.to_string()]).map_err(failure)?;
        }
        if let Some((id, receipt)) = observation {
            tx.execute("INSERT INTO observations(execution_id,body) VALUES(?1,?2)", params![id, receipt.to_string()]).map_err(failure)?;
        }
        let mut effects = Vec::new();
        let mut receipt = Receipt::Updated;
        for command in commands {
            if let Command::PublishSnapshot { candidate, .. } | Command::ManualInput { candidate, .. } = &command {
                let content: String = tx.query_row("SELECT content FROM inputs WHERE id=?1", [&candidate.content_ref], |row| row.get(0)).map_err(failure)?;
                if candidate.digest != candidate.content_ref || digest(content.as_bytes()) != candidate.digest {
                    return Err("Snapshot must reference intact immutable content".into());
                }
            }
            sequence = sequence.checked_add(1).ok_or("Automation sequence exhausted")?;
            let ids = Ids { acceptance_id: format!("{}-event-{sequence}", state.owner),
                request_ids: (0..state.limits.max_fanout).map(|i| format!("{}-request-{sequence}-{i}", state.owner)).collect() };
            let transition = domain::apply(&state, command, now, ids).map_err(|e| e.to_string())?;
            for (ordinal, effect) in transition.effects.iter().enumerate() {
                tx.execute("INSERT INTO effects VALUES(?1,?2,?3)", params![sequence, ordinal as i64, serde_json::to_string(effect).map_err(failure)?]).map_err(failure)?;
            }
            state = transition.state;
            receipt = transition.receipt;
            effects.extend(transition.effects);
        }
        let body = serde_json::to_string(&state).map_err(failure)?;
        let bytes: i64 = tx.query_row("SELECT COALESCE(sum(length(CAST(content AS BLOB))),0) FROM inputs", [], |row| row.get(0)).map_err(failure)?;
        if bytes + body.len() as i64 > STORE_LIMIT { return Err("Automation storage capacity reached; existing responsibility retained".into()); }
        tx.execute("UPDATE state SET body=?1,sequence=?2 WHERE id=1", params![body, sequence]).map_err(failure)?;
        tx.commit().map_err(failure)?;
        Ok(Commit { receipt, effects })
    }

    pub fn attention(&self) -> Result<std::collections::BTreeMap<String,String>,String> {
        let mut query=self.db.prepare("SELECT request_id,reason FROM attention").map_err(failure)?;
        query.query_map([],|row|Ok((row.get(0)?,row.get(1)?))).map_err(failure)?
            .map(|row|row.map_err(failure)).collect()
    }
    pub fn note_attention(&self, id:&str, reason:Option<&str>) -> Result<(),String> {
        if let Some(reason)=reason {
            self.db.execute("INSERT INTO attention VALUES(?1,?2) ON CONFLICT(request_id) DO UPDATE SET reason=excluded.reason",params![id,reason]).map_err(failure)?;
        } else { self.db.execute("DELETE FROM attention WHERE request_id=?1",[id]).map_err(failure)?; }
        Ok(())
    }

    pub fn evidence(&self) -> Result<Value, String> {
        fn rows(db: &Connection, table: &str) -> Result<Vec<Value>, String> {
            let mut query = db.prepare(&format!("SELECT execution_id,body FROM {table}")).map_err(failure)?;
            query.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))).map_err(failure)?
                .map(|row| { let (id, body) = row.map_err(failure)?; Ok(serde_json::json!({"execution_id":id,"record":serde_json::from_str::<Value>(&body).map_err(failure)?})) }).collect()
        }
        Ok(serde_json::json!({"admissions":rows(&self.db,"admissions")?,"observations":rows(&self.db,"observations")?}))
    }
}

#[cfg(test)]
#[path = "automation_store_test.rs"]
mod tests;
