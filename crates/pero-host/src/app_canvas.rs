//! Host admission for data-only App views and privately confirmed declared writes.
use pero_runtime::apps::{AppName, AppStore, BackendAccess, canvas::{ActionState, CanvasInstances, CanvasSource}, canvas_history::CanvasOperationRecord};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{io::Read, sync::{Arc, Mutex}, time::{Duration, SystemTime, UNIX_EPOCH}};

#[derive(Clone, Deserialize)]
#[serde(tag="operation", rename_all="kebab-case", rename_all_fields="camelCase", deny_unknown_fields)]
pub(crate) enum Request {
    Mount { source: CanvasSource },
    Read { instance: String },
    Release { instance: String },
    Prepare { instance: String, operation_id: String, action: AppName, params: Value },
    Decide { instance: String, operation_id: String, ticket: String, allow: bool },
    Status { instance: String, operation_id: String },
    Cancel { instance: String, operation_id: String },
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Field { label: String, value: String }
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Action { name: AppName, label: String, params: Value, #[serde(default,skip_serializing_if="Vec::is_empty")] inputs: Vec<ActionInput> }
#[derive(Deserialize, Serialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct ActionInput { name: String, label: String, max_length: usize }
impl Action {
    fn valid_inputs(&self) -> bool {
        self.inputs.len() <= 8 && self.inputs.iter().enumerate().all(|(index, input)| {
            !input.name.is_empty() && input.name.len() <= 64 && input.name.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_') &&
            !self.inputs[..index].iter().any(|previous| previous.name == input.name) &&
            !input.label.is_empty() && input.label.len() <= 200 && (1..=2000).contains(&input.max_length) &&
            self.params.get(&input.name).and_then(Value::as_str).is_some_and(|value| value.chars().count() <= input.max_length)
        })
    }
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Projection { title: String, fields: Vec<Field>, columns: Vec<String>, rows: Vec<Vec<String>>, notice: String, actions: Vec<Action> }
type Store = Arc<Mutex<Result<AppStore, String>>>;
type Instances = Arc<Mutex<CanvasInstances>>;
fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }
fn with_store<T>(store: &Store, apply: impl FnOnce(&mut AppStore) -> Result<T, String>) -> Result<T, String> {
    let mut guard = store.lock().map_err(|e|e.to_string())?;
    apply(guard.as_mut().map_err(|e|e.clone())?)
}
fn backend(store: &Store, app: &AppName) -> Result<BackendAccess, String> {
    with_store(store, |store| store.resolve(app)?.backend.ok_or("App backend is unavailable".into()))
}
fn request(access: &BackendAccess, path: &str, body: Option<&Value>, limit: usize) -> Result<Value, String> {
    let client = reqwest::blocking::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15)).build().map_err(|e|e.to_string())?;
    let url = format!("{}{}", access.url, path);
    let mut call = if let Some(value) = body { client.post(url).json(value) } else { client.get(url) };
    call = call.header("X-Pero-App-Token", &access.token);
    let response = call.send().map_err(|_|"App response interrupted; inspect the operation before repeating".to_owned())?;
    if !response.status().is_success() { return Err(format!("App refused the scoped request ({})", response.status())); }
    let mut bytes = Vec::new(); response.take(limit as u64 + 1).read_to_end(&mut bytes).map_err(|e|e.to_string())?;
    if bytes.len() > limit { return Err("App response exceeds its declared limit".into()); }
    serde_json::from_slice(&bytes).map_err(|_|"App returned invalid JSON".into())
}
fn current_source(store: &Store, source: &CanvasSource, write: bool) -> Result<(), String> {
    source.validate()?;
    let notebook = AppName::try_from("notebook".to_owned())?;
    let access = backend(store, &notebook)?;
    let mut check = serde_json::to_value(source).map_err(|e| e.to_string())?;
    check["write"] = json!(write);
    if request(&access, "/internal/canvas/source", Some(&check), 1024)? != json!({"valid":true}) {
        return Err("Notebook did not verify the saved Canvas binding".into());
    }
    with_store(store, |store| store.canvas_view(&source.binding).map(|_| ()))
}
fn read_view(store: &Store, source: &CanvasSource) -> Result<Value, String> {
    current_source(store, source, false)?;
    let view = with_store(store, |store| store.canvas_view(&source.binding))?;
    let access = backend(store, &source.binding.app)?;
    let value = request(&access, &view.read, Some(&source.binding.inputs), 65536)?;
    let projection: Projection = serde_json::from_value(value).map_err(|_|"App returned an invalid declared view")?;
    if projection.title.len() > 200 || projection.notice.len() > 2000 || projection.fields.len() > 32 || projection.columns.len() > 16 || projection.rows.len() > 100 || projection.actions.len() > 8 ||
        projection.fields.iter().any(|field|field.label.len()>200 || field.value.len()>2000) ||
        projection.columns.iter().any(|label|label.len()>200) || projection.rows.iter().any(|row|row.len()!=projection.columns.len() || row.iter().any(|cell|cell.len()>2000)) ||
        projection.actions.iter().any(|action| action.label.len()>200 || !action.valid_inputs() || !view.actions.contains(&action.name)) {
        return Err("App view exceeds its declared display limits".into());
    }
    for action in &projection.actions {
        let document = json!({"operationId":"validation","inputs":source.binding.inputs,"params":action.params});
        with_store(store, |store| store.canvas_action(&source.binding,&action.name,&document).map(|_|()))?;
    }
    serde_json::to_value(projection).map_err(|e|e.to_string())
}
fn operation_digest(document: &Value) -> Result<String, String> {
    // Feature unification can enable serde_json/preserve_order. Hash canonical
    // object order explicitly, including nested inputs and action parameters.
    let mut canonical = document.clone();
    canonical.sort_all_objects();
    Ok(format!("{:x}", Sha256::digest(serde_json::to_vec(&canonical).map_err(|error| error.to_string())?)))
}
fn receipt(source: &CanvasSource, operation: &str, prepared: &pero_runtime::apps::canvas::CanvasAction, result: &Value) -> Result<Value, String> {
    let digest = operation_digest(&prepared.document)?;
    if result["operationId"] != operation || result["inputDigest"] != digest || result["status"] != "completed" {
        return Err("App result does not match the exact approved operation; outcome remains unknown".into());
    }
    Ok(json!({"operationId":operation,"app":source.binding.app,"view":source.binding.view,
        "declaration":source.binding.declaration,"bindingId":source.binding.id,"entryId":source.entry_id,
        "revision":source.revision,"action":prepared.name,"inputDigest":digest,"result":result}))
}
fn history(store: &Store, source: &CanvasSource) -> Result<Value, String> {
    with_store(store, |store| Ok(json!(store.canvas_history()?.into_iter().filter(|item| item.belongs_to(source)).map(|item|
        json!({"operationId":item.operation,"action":item.action,"state":if item.resolved {"retained"} else {"outcome-unknown"}})).collect::<Vec<_>>())))
}
pub(crate) fn execute(store: Store, instances: Instances, caller: &AppName, input: Request) -> Result<Value, String> {
    if caller.as_str() != "notebook" { return Err("Canvas admission is reserved for Notebook".into()); }
    with_store(&store, |store| store.sdk_context(caller).map(|_|()))?;
    let instance_id = match &input {
        Request::Mount {..} => None,
        Request::Read {instance} | Request::Release {instance} | Request::Prepare {instance,..} | Request::Decide {instance,..} |
        Request::Status {instance,..} | Request::Cancel {instance,..} => Some(instance.clone()),
    };
    if let Request::Release {instance} = &input { instances.lock().map_err(|e|e.to_string())?.release(instance); return Ok(json!({"state":"released"})); }
    let source = instance_id.as_deref().map(|id| instances.lock().map_err(|e|e.to_string())?.get(id,now()).map(|instance|instance.source)).transpose()?;
    match input {
        Request::Mount {source} => {
            let projection = read_view(&store,&source)?;
            let history=history(&store,&source)?;
            let id = instances.lock().map_err(|e|e.to_string())?.mount(source.clone(),now())?;
            Ok(json!({"instance":id,"source":source,"projection":projection,"history":history}))
        }
        Request::Read {instance} => Ok(json!({"instance":instance,"source":source,"projection":read_view(&store,source.as_ref().unwrap())?,"history":history(&store,source.as_ref().unwrap())?})),
        Request::Prepare {instance,operation_id,action,params} => {
            let source=source.unwrap(); current_source(&store,&source,true)?;
            let document=json!({"operationId":operation_id,"inputs":source.binding.inputs,"params":params});
            let route=with_store(&store,|store|store.canvas_action(&source.binding,&action,&document))?;
            if let Some(record) = with_store(&store, |store| Ok(store.canvas_history()?.into_iter().find(|record|record.operation==operation_id)))? {
                if !record.belongs_to(&source) || record.action != action || record.document != document { return Err("Operation identity belongs to different saved inputs".into()); }
                return Ok(json!({"state":"outcome-unknown","message":"Inspect the retained owner receipt; this operation will not execute again."}));
            }
            if with_store(&store, |store| Ok(store.canvas_history()?.iter().any(|record| record.belongs_to(&source) && !record.resolved)))? {
                return Err("Inspect the unresolved action on this saved binding before starting another".into());
            }
            let prepared=instances.lock().map_err(|e|e.to_string())?.prepare(&instance,&operation_id,action,document.clone())?;
            if prepared.state != ActionState::Awaiting { return Ok(instances.lock().map_err(|e|e.to_string())?.status(&instance,&operation_id)); }
            Ok(json!({"state":"requires-approval","ticket":prepared.ticket,
                "summary":format!("App: {}\nView: {}\nNotebook: {} · revision {}\nAction: {}\n{}\nInputs: {}",source.binding.app.as_str(),source.binding.view.as_str(),source.entry_id,source.revision,route.name.as_str(),route.description,document)}))
        }
        Request::Decide {instance,operation_id,ticket,allow} => {
            let source=source.unwrap(); current_source(&store,&source,true)?;
            let prepared=instances.lock().map_err(|e|e.to_string())?.decide(&instance,&operation_id,&ticket,allow)?;
            if !allow { return Ok(json!({"state":"cancelled"})); }
            let route=with_store(&store,|store|store.canvas_action(&source.binding,&prepared.name,&prepared.document))?;
            let access=backend(&store,&source.binding.app)?;
            let mut record = CanvasOperationRecord { source:source.clone(), operation:operation_id.clone(), action:prepared.name.clone(), document:prepared.document.clone(), resolved:false };
            // Persist the exact recovery handle before dispatch. This never stores approval.
            with_store(&store, |store| store.record_canvas_operation(record.clone()))?;
            // The owning App's existing declared write performs the mutation and retains its receipt.
            let result=request(&access,&route.path,Some(&prepared.document),65536)?;
            let receipt=receipt(&source,&operation_id,&prepared,&result)?;
            record.resolved=true; with_store(&store, |store| store.record_canvas_operation(record))?;
            instances.lock().map_err(|e|e.to_string())?.complete(&instance,&operation_id,receipt.clone());
            Ok(json!({"state":"completed","receipt":receipt}))
        }
        Request::Status {instance,operation_id} => {
            let source=source.unwrap(); current_source(&store,&source,false)?;
            let record=with_store(&store, |store| Ok(store.canvas_history()?.into_iter().find(|record|record.operation==operation_id)))?;
            if let Some(mut record)=record {
                if !record.belongs_to(&source) { return Err("Operation belongs to another saved binding".into()); }
                // Recovery may read an older immutable revision, but never upgrades it to write access.
                current_source(&store,&record.source,false)?;
                let view=with_store(&store,|store|store.canvas_view(&record.source.binding))?;
                let access=backend(&store,&record.source.binding.app)?;
                let observed=request(&access,&view.status,Some(&record.document),65536)?;
                if observed["state"]=="completed" {
                    let prepared=pero_runtime::apps::canvas::CanvasAction { name:record.action.clone(), document:record.document.clone(), ticket:String::new(), state:ActionState::Dispatched };
                    let receipt=receipt(&record.source,&operation_id,&prepared,&observed["result"])?;
                    record.resolved=true; with_store(&store, |store|store.record_canvas_operation(record))?;
                    instances.lock().map_err(|e|e.to_string())?.complete(&instance,&operation_id,receipt.clone());
                    return Ok(json!({"state":"completed","receipt":receipt}));
                }
                return Ok(json!({"state":"outcome-unknown","message":"The owner has no completed receipt yet. This does not prove cancellation."}));
            }
            Ok(instances.lock().map_err(|e|e.to_string())?.status(&instance,&operation_id))
        }
        Request::Cancel {instance,operation_id} => {
            let source=source.unwrap();
            if let Some(record)=with_store(&store, |store| Ok(store.canvas_history()?.into_iter().find(|record|record.operation==operation_id)))? {
                if !record.belongs_to(&source) { return Err("Operation belongs to another saved binding".into()); }
                return Ok(json!({"state":"outcome-unknown","message":"Dispatch already began. Cancellation cannot undo it; inspect the owner's retained receipt."}));
            }
            Ok(instances.lock().map_err(|e|e.to_string())?.cancel(&instance,&operation_id))
        },
        Request::Release {..} => unreachable!(),
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn operation_digest_matches_data_owner_independent_of_object_order() {
        // Fixed Python owner vectors, not a digest produced by the implementation under test.
        let archive: Value = serde_json::from_str(r#"{"operationId":"op","params":{"archived":true},"inputs":{"datasetId":"ds-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}"#).unwrap();
        assert_eq!(operation_digest(&archive).unwrap(), "67ef93858a0e02d1993cadaa74771da4013e0d06bd49a06a8da489fa8991bccf");
        let rename: Value = serde_json::from_str(r#"{"operationId":"rename","params":{"name":"样品 A","expectedProjectRef":"","projectRef":"","expectedArchived":false,"expectedName":"Dataset"},"inputs":{"datasetId":"ds-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}"#).unwrap();
        assert_eq!(operation_digest(&rename).unwrap(), "7e0261cb95a569e0eb800415f4ff9fe5c9deca721dad3c473bdeb06519d5c958");
        let original = rename.clone();
        operation_digest(&rename).unwrap();
        assert_eq!(rename, original, "Digesting must not rewrite the approved input");
    }

    #[test]
    fn owner_receipts_must_match_the_approved_envelope_not_just_operation_identity() {
        let source: CanvasSource=serde_json::from_value(json!({"entryId":"a".repeat(32),"revision":1,"blockId":"canvas","readOnly":false,
            "binding":{"id":"binding","app":"data","panel":"main","view":"dataset-inspector","declaration":"b".repeat(64),"inputs":{"datasetId":"ds-1"}}})).unwrap();
        let prepared=pero_runtime::apps::canvas::CanvasAction {name:AppName::try_from("canvas-archive".to_owned()).unwrap(),document:json!({"operationId":"op","inputs":{"datasetId":"ds-1"},"params":{"archived":true}}),ticket:"private".into(),state:ActionState::Dispatched};
        let digest=operation_digest(&prepared.document).unwrap();
        let result=json!({"operationId":"op","inputDigest":digest,"status":"completed","dataset":{"archived":true}});
        let returned=receipt(&source,"op",&prepared,&result).unwrap();
        assert_eq!(returned["result"],result);assert_eq!(returned["revision"],1);
        let mut changed=prepared.clone();changed.document["params"]["archived"]=json!(false);
        assert!(receipt(&source,"op",&changed,&result).is_err());
        assert!(receipt(&source,"other",&prepared,&result).is_err());
        assert!(receipt(&source,"op",&prepared,&json!({"status":"completed"})).is_err());
    }
}
