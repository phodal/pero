use super::*;

#[derive(Deserialize)]
struct InvalidMessage {
    name: String,
    r#type: String,
    value: serde_json::Value,
}
#[derive(Deserialize)]
struct Corpus {
    capabilities: ComputerCapabilities,
    #[serde(rename = "target")]
    _target: ComputerTarget,
    observation: ComputerObservation,
    actions: Vec<ComputerAction>,
    #[serde(rename = "receipts")]
    _receipts: Vec<ComputerActionReceipt>,
    invalid: Vec<InvalidMessage>,
}
fn corpus() -> Corpus {
    serde_json::from_str(include_str!(
        "../../../../tests/contracts/computer-use.json"
    ))
    .unwrap()
}

#[test]
fn action_admission_uses_the_current_observation_and_explicit_delivery() {
    use ComputerErrorCode::*;
    let data = corpus();
    for action in &data.actions {
        action
            .clone()
            .prepare(&data.observation, &data.capabilities)
            .unwrap();
    }
    type Change = fn(&mut ComputerAction, &mut ComputerObservation, &mut ComputerCapabilities);
    let cases: &[(&str, &str, Change, Option<ComputerErrorCode>)] = &[
        (
            "runtime restarted",
            "request-1",
            |_, _, caps| caps.runtime_id = "runtime-2".to_owned().try_into().unwrap(),
            Some(TargetUnavailable),
        ),
        (
            "another window",
            "request-1",
            |action, _, _| action.target.target_id = "window-2".to_owned().try_into().unwrap(),
            Some(StaleObservation),
        ),
        (
            "old observation",
            "request-1",
            |action, _, _| action.observation_id = "observation-old".to_owned().try_into().unwrap(),
            Some(StaleObservation),
        ),
        (
            "foreground requires support; no automatic escalation",
            "request-1",
            |action, _, _| action.delivery = ComputerDelivery::Foreground,
            Some(Unsupported),
        ),
        (
            "action is not advertised",
            "request-1",
            |_, _, caps| caps.actions.clear(),
            Some(Unsupported),
        ),
        (
            "element disappeared",
            "request-1",
            |_, obs, _| obs.elements.clear(),
            Some(StaleObservation),
        ),
        (
            "ambiguous element",
            "request-1",
            |_, obs, _| obs.elements.push(obs.elements[0].clone()),
            Some(InvalidRequest),
        ),
        (
            "element cannot perform this action",
            "request-1",
            |_, obs, _| obs.elements[0].actions.clear(),
            Some(Unsupported),
        ),
        (
            "accessibility unavailable",
            "request-1",
            |_, _, caps| {
                caps.observations
                    .retain(|kind| *kind != ComputerObservationKind::Accessibility)
            },
            Some(Unsupported),
        ),
        (
            "screenshot unavailable",
            "request-6",
            |_, obs, _| obs.screenshot = None,
            Some(StaleObservation),
        ),
        (
            "screenshot replaced",
            "request-6",
            |_, obs, _| {
                obs.screenshot.as_mut().unwrap().id = "image-2".to_owned().try_into().unwrap()
            },
            Some(StaleObservation),
        ),
        (
            "pixel channel unavailable",
            "request-6",
            |_, _, caps| {
                caps.observations
                    .retain(|kind| *kind != ComputerObservationKind::Screenshot)
            },
            Some(Unsupported),
        ),
        (
            "right edge is outside the image",
            "request-6",
            |action, _, _| {
                if let ComputerInput::Click {
                    anchor: ComputerAnchor::Pixel { point, .. },
                    ..
                } = &mut action.input
                {
                    point.x = 320;
                }
            },
            Some(InvalidRequest),
        ),
        (
            "drag endpoint is outside the image",
            "request-5",
            |action, _, _| {
                if let ComputerInput::Drag { to, .. } = &mut action.input {
                    to.y = 200;
                }
            },
            Some(InvalidRequest),
        ),
        (
            "zero scroll has no effect",
            "request-4",
            |action, _, _| {
                if let ComputerInput::Scroll { delta_y, .. } = &mut action.input {
                    *delta_y = 0;
                }
            },
            Some(InvalidRequest),
        ),
        (
            "observed elements in a truncated tree remain usable",
            "request-1",
            |_, obs, _| obs.truncated = true,
            None,
        ),
    ];
    for (name, request_id, change, expected) in cases {
        let mut action = data
            .actions
            .iter()
            .find(|action| action.request_id.as_str() == *request_id)
            .expect(name)
            .clone();
        let mut observation = data.observation.clone();
        let mut capabilities = data.capabilities.clone();
        change(&mut action, &mut observation, &mut capabilities);
        let error = action
            .prepare(&observation, &capabilities)
            .err()
            .map(|error| error.code);
        assert_eq!(error, *expected, "{name}");
    }
}

#[test]
fn wire_boundary_matches_the_shared_v1_corpus() {
    let data = corpus();
    for case in data.invalid {
        let admitted = match case.r#type.as_str() {
            "ComputerAction" => serde_json::from_value::<ComputerAction>(case.value).is_ok(),
            "ComputerInput" => serde_json::from_value::<ComputerInput>(case.value).is_ok(),
            "ComputerCapabilities" => {
                serde_json::from_value::<ComputerCapabilities>(case.value).is_ok()
            }
            "ComputerObservation" => {
                serde_json::from_value::<ComputerObservation>(case.value).is_ok()
            }
            "ComputerActionReceipt" => {
                serde_json::from_value::<ComputerActionReceipt>(case.value).is_ok()
            }
            other => panic!("Unrecognized corpus type: {other}"),
        };
        assert!(!admitted, "{}", case.name);
    }
}
