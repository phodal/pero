//! Shared value-based platform admission catalogue, not native execution evidence.
use pero_contracts::computer_use::*;
use serde::Deserialize;

#[derive(Deserialize)]
struct Corpus {
    capabilities: ComputerCapabilities,
    observation: ComputerObservation,
    actions: Vec<ComputerAction>,
}
#[derive(Deserialize)]
struct Matrix {
    cases: Vec<Case>,
}
#[derive(Deserialize)]
struct Case {
    name: String,
    request_id: ComputerRef,
    delivery: ComputerDelivery,
    supported: Vec<ComputerPlatform>,
}

pub fn assert_profile_admission(
    environment: ComputerEnvironment,
    observations: Vec<ComputerObservationKind>,
    actions: Vec<ComputerActionSupport>,
) {
    let corpus: Corpus = serde_json::from_str(include_str!(
        "../../../../../tests/contracts/computer-use.json"
    ))
    .unwrap();
    let matrix: Matrix = serde_json::from_str(include_str!(
        "../../../../../tests/contracts/computer-platforms.json"
    ))
    .unwrap();
    let platform = environment.platform;
    let capabilities = ComputerCapabilities {
        environment,
        observations,
        actions,
        ..corpus.capabilities
    };
    for case in matrix.cases {
        let mut action = corpus
            .actions
            .iter()
            .find(|action| action.request_id == case.request_id)
            .unwrap()
            .clone();
        action.delivery = case.delivery;
        let result = action.prepare(&corpus.observation, &capabilities);
        let expected = if case.supported.contains(&platform) {
            None
        } else {
            Some(ComputerErrorCode::Unsupported)
        };
        assert_eq!(
            result.err().map(|error| error.code),
            expected,
            "{} on {platform:?}",
            case.name
        );
    }
}
