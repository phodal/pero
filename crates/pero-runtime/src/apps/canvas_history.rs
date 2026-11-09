//! Bounded recovery records, not persistent authorization. Tickets are never written to disk.
use super::{AppName, AppStore, canvas::CanvasSource};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs, io::Write};

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CanvasOperationRecord {
    pub source: CanvasSource,
    pub operation: String,
    pub action: AppName,
    pub document: Value,
    pub resolved: bool,
}
impl CanvasOperationRecord {
    pub fn belongs_to(&self, source: &CanvasSource) -> bool {
        self.source.entry_id == source.entry_id && self.source.block_id == source.block_id && self.source.binding == source.binding
    }
}
impl AppStore {
    pub fn canvas_history(&self) -> Result<Vec<CanvasOperationRecord>, String> {
        let path = self.root.join(".canvas-operations.json");
        if !path.exists() { return Ok(Vec::new()); }
        let bytes = fs::read(path).map_err(|e| e.to_string())?;
        if bytes.len() > 20 * 1024 * 1024 { return Err("Canvas recovery journal exceeds its limit".into()); }
        let records: Vec<CanvasOperationRecord> = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        if records.len() > 128 { return Err("Canvas recovery journal exceeds its limit".into()); }
        Ok(records)
    }
    pub fn record_canvas_operation(&self, record: CanvasOperationRecord) -> Result<(), String> {
        let mut records = self.canvas_history()?;
        if let Some(previous) = records.iter_mut().find(|item| item.operation == record.operation) {
            if !previous.belongs_to(&record.source) || previous.action != record.action || previous.document != record.document {
                return Err("Operation identity belongs to another saved source or action".into());
            }
            previous.resolved |= record.resolved;
        } else {
            if records.len() == 128 {
                let index = records.iter().position(|record| record.resolved).ok_or("Inspect unresolved Canvas operations before starting another")?;
                records.remove(index);
            }
            records.push(record);
        }
        let bytes = serde_json::to_vec(&records).map_err(|e| e.to_string())?;
        let pending = self.root.join(".canvas-operations.pending");
        let mut file = fs::File::create(&pending).map_err(|e| e.to_string())?;
        file.write_all(&bytes).and_then(|_|file.sync_all()).map_err(|e|e.to_string())?;
        fs::rename(pending,self.root.join(".canvas-operations.json")).map_err(|e|e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::apps::PythonEnvironments;
    use serde_json::json;
    #[test]
    fn restart_keeps_exact_source_and_envelope_but_never_private_consent() {
        let root=std::env::temp_dir().join(format!("pero-canvas-history-{}",uuid::Uuid::new_v4()));
        let source: CanvasSource=serde_json::from_value(json!({"entryId":"a".repeat(32),"revision":2,"blockId":"canvas","readOnly":false,
            "binding":{"id":"binding","app":"data","panel":"main","view":"dataset-inspector","declaration":"b".repeat(64),"inputs":{"datasetId":"ds-1"}}})).unwrap();
        let record=CanvasOperationRecord {source:source.clone(),operation:"op".into(),action:AppName::try_from("canvas-archive".to_owned()).unwrap(),document:json!({"operationId":"op","inputs":{"datasetId":"ds-1"},"params":{"archived":true}}),resolved:false};
        let store=AppStore::open(root.join("apps"),PythonEnvironments::default()).unwrap();
        store.record_canvas_operation(record.clone()).unwrap(); drop(store);
        let store=AppStore::open(root.join("apps"),PythonEnvironments::default()).unwrap();
        let retained=store.canvas_history().unwrap().remove(0);
        assert_eq!(retained.document,record.document); assert_eq!(retained.source,record.source);
        let mut readonly=source.clone();readonly.read_only=true;readonly.revision=3;
        assert!(retained.belongs_to(&readonly));
        readonly.binding.inputs=json!({"datasetId":"other"}); assert!(!retained.belongs_to(&readonly));
        let mut changed=record.clone();changed.document["params"]["archived"]=json!(false);
        assert!(store.record_canvas_operation(changed).is_err());
        let bytes=fs::read_to_string(root.join("apps/.canvas-operations.json")).unwrap();
        assert!(!bytes.contains("ticket")); assert!(!bytes.contains("allow"));
        drop(store);fs::remove_dir_all(root).unwrap();
    }
}
