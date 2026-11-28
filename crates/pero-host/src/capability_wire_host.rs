//! The canonical fixtures must follow the Host parsers that actually run.
//! Linux core runs this with `cargo test -p pero-host`.
use crate::research_assets::ResearchAssetsRequest;
use pero_runtime::apps::agent_run::{self, Request};
use serde_json::Value;
use std::{collections::BTreeSet, fs, path::PathBuf};

fn fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../protocol/fixtures/capability-wire")
}

fn document(dir: &PathBuf, case: &Value) -> Value {
    match case.get("file") {
        Some(file) => {
            serde_json::from_str(&fs::read_to_string(dir.join(file.as_str().unwrap())).unwrap())
                .unwrap()
        }
        None => case["document"].clone(),
    }
}

#[test]
fn production_parsers_follow_the_canonical_request_corpus() {
    let dir = fixture_dir();
    let cases: Value =
        serde_json::from_str(&fs::read_to_string(dir.join("cases.json")).unwrap()).unwrap();
    for case in cases["wires"].as_array().unwrap() {
        let schema = case["schema"].as_str().unwrap();
        let expect_ok = case["parse"] == "accept";
        let value = document(&dir, case);
        match schema {
            "AgentStatusRequest" => {
                let parsed = serde_json::from_value::<Request>(value);
                assert_eq!(parsed.is_ok(), expect_ok, "{}", case["id"]);
                if expect_ok {
                    assert!(
                        matches!(parsed.unwrap(), Request::Status { .. }),
                        "{}",
                        case["id"]
                    );
                }
            }
            "ResearchAssetsQueriesRequest" => {
                let parsed = serde_json::from_value::<ResearchAssetsRequest>(value);
                assert_eq!(parsed.is_ok(), expect_ok, "{}", case["id"]);
                if expect_ok {
                    assert!(
                        matches!(parsed.unwrap(), ResearchAssetsRequest::Queries { .. }),
                        "{}",
                        case["id"]
                    );
                }
            }
            _ => {}
        }
    }

    let run = agent_run::Run {
        id: "app:paper-agent:0123456789abcdef0123456789abcdef".into(),
        session_id: "app:paper-agent:0123456789abcdef0123456789abcdef".into(),
        scope: agent_run::Scope {
            workspace_id: "ws_0123456789abcdef0123456789abcdef".into(),
        },
        status: "running".into(),
        attempt: 1,
        request_id: "request-1".into(),
        updated_at: "2026-11-28T00:00:00Z".into(),
        error: None,
        stop_reason: None,
    };
    let serialized = serde_json::to_value(&run).unwrap();
    pero_contracts::capability_wire::parse_document("AgentStatusResponse", &serialized)
        .expect("production Run must stay inside AgentStatusResponse");

    // Data evidence() returns this object. definition must stay a QueryDefinition.parse document.
    let evidence: Value = serde_json::from_str(
        &fs::read_to_string(dir.join("research-assets-queries.response.json")).unwrap(),
    )
    .unwrap();
    let keys: BTreeSet<_> = evidence["definition"]
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect();
    let required = [
        "name",
        "sql",
        "parameters",
        "unit",
        "grain",
        "denominator",
        "joins",
        "missing",
        "seedPolicy",
        "reviewer",
        "reviewed",
        "check",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect();
    assert_eq!(keys, required);
    assert!(evidence["definition"]["check"].is_null());
    assert_eq!(evidence["definition"]["reviewed"], true);
    pero_contracts::capability_wire::parse_document("ResearchAssetsQueriesResponse", &evidence)
        .expect("Data evidence must stay inside ResearchAssetsQueriesResponse");
}
