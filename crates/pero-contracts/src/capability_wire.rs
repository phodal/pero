//! Typed documents for the capability wire. Parsing grants nothing.
#![allow(dead_code)]
use serde::Deserialize;
use serde_json::{Map, Value};
use std::collections::BTreeSet;

/// Reference outcome for a future shell. No current carrier calls [`admit`].
/// P0.2 and P0.3 may adopt it. `Accepted` is not a grant.
#[derive(Debug, PartialEq, Eq)]
pub enum Admission {
    Accepted,
    MissingVersion,
    VersionMismatch,
    UnknownOperation,
    InvalidInput,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AgentWorkspaceScope {
    #[allow(dead_code)]
    #[serde(rename = "workspaceId")]
    workspace_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum StatusWord {
    #[serde(rename = "status")]
    Status,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AgentStatusRequest {
    operation: StatusWord,
    scope: AgentWorkspaceScope,
    #[allow(dead_code)]
    #[serde(rename = "runId")]
    run_id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AgentStatusInput {
    scope: AgentWorkspaceScope,
    #[allow(dead_code)]
    #[serde(rename = "runId")]
    run_id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AgentStatusCall {
    capability: AgentWord,
    operation: StatusWord,
    input: AgentStatusInput,
}

#[derive(Deserialize)]
enum AgentWord {
    #[serde(rename = "agent")]
    Agent,
}

#[derive(Deserialize)]
enum RunStatus {
    #[serde(rename = "running")]
    Running,
    #[serde(rename = "needs_input")]
    NeedsInput,
    #[serde(rename = "cancelling")]
    Cancelling,
    #[serde(rename = "completed")]
    Completed,
    #[serde(rename = "failed")]
    Failed,
    #[serde(rename = "cancelled")]
    Cancelled,
    #[serde(rename = "interrupted")]
    Interrupted,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AgentStatusResponse {
    #[allow(dead_code)]
    id: String,
    #[allow(dead_code)]
    #[serde(rename = "sessionId")]
    session_id: String,
    scope: AgentWorkspaceScope,
    status: RunStatus,
    #[allow(dead_code)]
    attempt: u32,
    #[allow(dead_code)]
    #[serde(rename = "requestId")]
    request_id: String,
    #[allow(dead_code)]
    #[serde(rename = "updatedAt")]
    updated_at: String,
    #[serde(default, deserialize_with = "absent_string")]
    #[allow(dead_code)]
    error: Option<String>,
    #[serde(default, rename = "stopReason", deserialize_with = "absent_string")]
    #[allow(dead_code)]
    stop_reason: Option<String>,
}

#[derive(Debug)]
struct ResearchId(String);

impl<'de> Deserialize<'de> for ResearchId {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = String::deserialize(deserializer)?;
        if value.len() == 64
            && value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            Ok(Self(value))
        } else {
            Err(serde::de::Error::custom("research id"))
        }
    }
}

#[derive(Deserialize)]
enum QueriesWord {
    #[serde(rename = "queries")]
    Queries,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ResearchAssetsQueriesRequest {
    operation: QueriesWord,
    #[serde(default, rename = "queryId", deserialize_with = "absent_research_id")]
    #[allow(dead_code)]
    query_id: Option<ResearchId>,
}

#[derive(Deserialize)]
enum ReceiptStatus {
    #[serde(rename = "completed")]
    Completed,
    #[serde(rename = "failed")]
    Failed,
    #[serde(rename = "cancelled")]
    Cancelled,
    #[serde(rename = "running")]
    Running,
    #[serde(rename = "interrupted")]
    Interrupted,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ResearchQueryReceipt {
    #[allow(dead_code)]
    #[serde(rename = "queryId")]
    query_id: ResearchId,
    #[allow(dead_code)]
    status: ReceiptStatus,
    #[allow(dead_code)]
    reason: String,
    #[allow(dead_code)]
    rows: Vec<Value>,
    #[allow(dead_code)]
    #[serde(rename = "rowCount")]
    row_count: Option<u32>,
    #[allow(dead_code)]
    truncated: bool,
    #[serde(default, rename = "elapsedSeconds")]
    #[allow(dead_code)]
    elapsed_seconds: Option<f64>,
    #[serde(default, rename = "resultId", deserialize_with = "absent_research_id")]
    #[allow(dead_code)]
    result_id: Option<ResearchId>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ResearchAssetsQueriesResponse {
    #[allow(dead_code)]
    id: ResearchId,
    intent: Map<String, Value>,
    receipt: ResearchQueryReceipt,
    snapshot: Map<String, Value>,
    definition: ResearchQueryDefinition,
    acceptance: NeedsReview,
}

#[derive(Deserialize)]
struct ResearchQueryDefinition {
    #[allow(dead_code)]
    sql: String,
    #[allow(dead_code)]
    unit: String,
    #[allow(dead_code)]
    denominator: String,
    #[serde(flatten)]
    #[allow(dead_code)]
    rest: Map<String, Value>,
}

#[derive(Deserialize)]
enum NeedsReview {
    #[serde(rename = "needs_review")]
    NeedsReview,
}

#[derive(Deserialize)]
enum ErrorCode {
    #[serde(rename = "missing_version")]
    MissingVersion,
    #[serde(rename = "version_mismatch")]
    VersionMismatch,
    #[serde(rename = "unknown_operation")]
    UnknownOperation,
    #[serde(rename = "invalid_input")]
    InvalidInput,
    #[serde(rename = "unavailable")]
    Unavailable,
    #[serde(rename = "denied")]
    Denied,
    #[serde(rename = "failed")]
    Failed,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CapabilityError {
    #[allow(dead_code)]
    code: ErrorCode,
    #[allow(dead_code)]
    message: String,
    #[serde(default, deserialize_with = "absent_bounded")]
    #[allow(dead_code)]
    capability: Option<String>,
    #[serde(default, deserialize_with = "absent_bounded")]
    #[allow(dead_code)]
    operation: Option<String>,
}

#[derive(Deserialize)]
enum Effect {
    #[serde(rename = "read")]
    Read,
    #[serde(rename = "write")]
    Write,
    #[serde(rename = "control")]
    Control,
    #[serde(rename = "observe")]
    Observe,
}

#[derive(Deserialize)]
enum Exposure {
    #[serde(rename = "local_only")]
    LocalOnly,
    #[serde(rename = "transport_neutral")]
    TransportNeutral,
    #[serde(rename = "remotely_exposable")]
    RemotelyExposable,
    #[serde(rename = "privileged")]
    Privileged,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OperationDescriptor {
    #[allow(dead_code)]
    name: String,
    #[serde(deserialize_with = "nonzero_u32")]
    #[allow(dead_code)]
    version: u32,
    #[allow(dead_code)]
    effect: Effect,
    #[allow(dead_code)]
    exposure: Exposure,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProviderIdentity {
    #[allow(dead_code)]
    id: String,
    #[allow(dead_code)]
    incarnation: String,
}

#[derive(Deserialize)]
enum ScopeKind {
    #[serde(rename = "workspace")]
    Workspace,
    #[serde(rename = "project")]
    Project,
    #[serde(rename = "app")]
    App,
    #[serde(rename = "device")]
    Device,
    #[serde(rename = "unscoped")]
    Unscoped,
}

#[derive(Deserialize)]
enum AvailabilityState {
    #[serde(rename = "advertised")]
    Advertised,
    #[serde(rename = "unavailable")]
    Unavailable,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ScopedAvailability {
    #[allow(dead_code)]
    #[serde(rename = "scopeKind")]
    scope_kind: ScopeKind,
    #[serde(default, rename = "scopeId", deserialize_with = "absent_string")]
    #[allow(dead_code)]
    scope_id: Option<String>,
    #[allow(dead_code)]
    state: AvailabilityState,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CapabilityDescriptor {
    #[allow(dead_code)]
    id: String,
    #[allow(dead_code)]
    #[serde(rename = "protocolVersion")]
    protocol_version: u32,
    #[allow(dead_code)]
    operations: Vec<OperationDescriptor>,
    #[allow(dead_code)]
    provider: ProviderIdentity,
    #[allow(dead_code)]
    availability: ScopedAvailability,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CapabilityNegotiation {
    #[allow(dead_code)]
    #[serde(rename = "protocolVersion")]
    protocol_version: u32,
    #[allow(dead_code)]
    capability: String,
    #[allow(dead_code)]
    operation: String,
    #[allow(dead_code)]
    #[serde(rename = "declaredHost")]
    declared_host: Vec<String>,
    #[allow(dead_code)]
    advertised: bool,
}

#[derive(Deserialize)]
struct AcceptedWord {
    #[allow(dead_code)]
    outcome: AcceptedOutcome,
    grant: GrantDenied,
}

#[derive(Deserialize)]
enum AcceptedOutcome {
    #[serde(rename = "accepted")]
    Accepted,
}

struct GrantDenied;

impl<'de> Deserialize<'de> for GrantDenied {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        if bool::deserialize(deserializer)? {
            return Err(serde::de::Error::custom("grant"));
        }
        Ok(Self)
    }
}

fn absent_string<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    match Option::<String>::deserialize(deserializer)? {
        Some(value) => Ok(Some(value)),
        None => Err(serde::de::Error::custom("null")),
    }
}

fn absent_bounded<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    let value = absent_string(deserializer)?;
    if value
        .as_ref()
        .is_some_and(|text| text.is_empty() || text.len() > 64)
    {
        return Err(serde::de::Error::custom("bounded"));
    }
    Ok(value)
}

fn absent_research_id<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<ResearchId>, D::Error> {
    match Option::<ResearchId>::deserialize(deserializer)? {
        Some(value) => Ok(Some(value)),
        None => Err(serde::de::Error::custom("null")),
    }
}

fn nonzero_u32<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<u32, D::Error> {
    let value = u32::deserialize(deserializer)?;
    if value == 0 {
        return Err(serde::de::Error::custom("version"));
    }
    Ok(value)
}

/// Parse one canonical wire document. Parsing does not admit or grant the call.
pub fn parse_document(schema: &str, value: &Value) -> Result<(), String> {
    typed(schema, value)
}

fn typed(schema: &str, value: &Value) -> Result<(), String> {
    let parsed = match schema {
        "AgentStatusRequest" => {
            serde_json::from_value::<AgentStatusRequest>(value.clone()).map(|_| ())
        }
        "AgentStatusCall" => serde_json::from_value::<AgentStatusCall>(value.clone()).map(|_| ()),
        "AgentStatusResponse" => {
            serde_json::from_value::<AgentStatusResponse>(value.clone()).map(|_| ())
        }
        "ResearchAssetsQueriesRequest" => {
            serde_json::from_value::<ResearchAssetsQueriesRequest>(value.clone()).map(|_| ())
        }
        "ResearchAssetsQueriesResponse" => {
            serde_json::from_value::<ResearchAssetsQueriesResponse>(value.clone()).map(|_| ())
        }
        "CapabilityError" => serde_json::from_value::<CapabilityError>(value.clone()).map(|_| ()),
        "CapabilityDescriptor" => {
            serde_json::from_value::<CapabilityDescriptor>(value.clone()).map(|_| ())
        }
        "CapabilityNegotiation" => {
            serde_json::from_value::<CapabilityNegotiation>(value.clone()).map(|_| ())
        }
        "CapabilityAdmission" => serde_json::from_value::<AcceptedWord>(value.clone()).map(|_| ()),
        other => return Err(format!("unknown schema {other}")),
    };
    parsed.map_err(|error| error.to_string())
}

/// Reference fail-closed check for P0.2 and P0.3.
///
/// Electron, Native, the Host, and the App SDK do not call this. `Accepted`
/// means the negotiation document names a known operation at protocol version
/// 1. It does not grant that operation. Declaration and advertisement are not grants.
pub fn admit(value: &Value, known: &BTreeSet<(String, String)>) -> Admission {
    let Some(object) = value.as_object() else {
        return Admission::InvalidInput;
    };
    let allowed = [
        "protocolVersion",
        "capability",
        "operation",
        "declaredHost",
        "advertised",
    ];
    if object.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Admission::InvalidInput;
    }
    let Some(version) = object.get("protocolVersion") else {
        return Admission::MissingVersion;
    };
    let Some(version) = version.as_u64().filter(|number| {
        *number <= u32::MAX as u64
            && version
                .as_f64()
                .is_some_and(|exact| exact == *number as f64)
    }) else {
        return Admission::InvalidInput;
    };
    if version != 1 {
        return Admission::VersionMismatch;
    }
    let Some(capability) = object.get("capability").and_then(Value::as_str) else {
        return Admission::InvalidInput;
    };
    let Some(operation) = object.get("operation").and_then(Value::as_str) else {
        return Admission::InvalidInput;
    };
    if capability.is_empty()
        || capability.len() > 64
        || operation.is_empty()
        || operation.len() > 64
    {
        return Admission::InvalidInput;
    }
    match object.get("declaredHost") {
        Some(Value::Array(items)) if items.iter().all(Value::is_string) => {}
        _ => return Admission::InvalidInput,
    }
    if !matches!(object.get("advertised"), Some(Value::Bool(_))) {
        return Admission::InvalidInput;
    }
    if known.contains(&(capability.to_owned(), operation.to_owned())) {
        Admission::Accepted
    } else {
        Admission::UnknownOperation
    }
}

pub fn known_operations(inventory: &Value) -> BTreeSet<(String, String)> {
    inventory["families"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|family| {
            let id = family["id"].as_str().unwrap_or_default().to_owned();
            family["operations"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(move |operation| {
                    operation["name"]
                        .as_str()
                        .map(|name| (id.clone(), name.to_owned()))
                })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    fn root() -> std::path::PathBuf {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
    }

    #[test]
    fn shared_fixtures_match_the_typed_wire_and_fail_closed() {
        let root = root();
        let fixture = root.join("protocol/fixtures/capability-wire");
        let inventory: Value = serde_json::from_str(
            &fs::read_to_string(root.join("protocol/inventory/capabilities.json")).unwrap(),
        )
        .unwrap();
        let families: Vec<_> = inventory["families"]
            .as_array()
            .unwrap()
            .iter()
            .map(|family| family["id"].as_str().unwrap())
            .collect();
        assert_eq!(
            families,
            [
                "agent",
                "insights",
                "connectors",
                "automation",
                "research-assets",
                "skills"
            ]
        );
        assert_eq!(
            inventory["sciencePath"]["operations"],
            json!(["science", "science_sessions"])
        );
        assert!(
            inventory["drift"]
                .as_array()
                .unwrap()
                .iter()
                .any(|item| item["id"] == "research-assets-operations")
        );
        assert!(
            inventory["drift"]
                .as_array()
                .unwrap()
                .iter()
                .any(|item| item["id"] == "agent-scope-project-id")
        );
        let known = known_operations(&inventory);
        let cases: Value =
            serde_json::from_str(&fs::read_to_string(fixture.join("cases.json")).unwrap()).unwrap();
        for case in cases["wires"].as_array().unwrap() {
            let document = match case.get("file") {
                Some(file) => serde_json::from_str(
                    &fs::read_to_string(fixture.join(file.as_str().unwrap())).unwrap(),
                )
                .unwrap(),
                None => case["document"].clone(),
            };
            let parsed = typed(case["schema"].as_str().unwrap(), &document);
            assert_eq!(
                parsed.is_ok(),
                case["parse"] == "accept",
                "{}: {parsed:?}",
                case["id"]
            );
        }
        for case in cases["negotiations"].as_array().unwrap() {
            let document = match case.get("file") {
                Some(file) => serde_json::from_str(
                    &fs::read_to_string(fixture.join(file.as_str().unwrap())).unwrap(),
                )
                .unwrap(),
                None => case["document"].clone(),
            };
            let result = admit(&document, &known);
            let expected = match case["result"].as_str().unwrap() {
                "accepted" => Admission::Accepted,
                "missing_version" => Admission::MissingVersion,
                "version_mismatch" => Admission::VersionMismatch,
                "unknown_operation" => Admission::UnknownOperation,
                "invalid_input" => Admission::InvalidInput,
                other => panic!("{other}"),
            };
            assert_eq!(result, expected, "{}", case["id"]);
            if result == Admission::Accepted {
                assert_eq!(case["grant"], false);
                typed("CapabilityNegotiation", &document).unwrap();
                typed(
                    "CapabilityAdmission",
                    &json!({"outcome": "accepted", "grant": false}),
                )
                .unwrap();
            }
        }
    }
}
