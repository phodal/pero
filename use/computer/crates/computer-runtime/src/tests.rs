use super::*;
use computer_core::{ControlId, ObservedControl, Window, WindowBounds};
use pero_contracts::{computer_runtime::*, computer_use::*};
use std::{cell::RefCell, rc::Rc};

// One fake at the native driver seam, with independently observable app effects.
struct App {
    bounds: WindowBounds,
    clicks: u32,
    fail_after_input: bool,
    refuse_before_input: bool,
}
struct OwnedDesktop(Rc<RefCell<App>>);
struct AppSnapshot(u32);

fn window() -> Window {
    Window {
        pid: 42,
        window_id: 1,
        application_id: "owned".into(),
        name: "Owned app".into(),
        title: "Counter".into(),
    }
}

impl DesktopDriver for OwnedDesktop {
    type Snapshot = AppSnapshot;
    fn environment(&self) -> ComputerEnvironment {
        UnsupportedDesktop::connect().environment()
    }
    fn observations(&self) -> Vec<ComputerObservationKind> {
        vec![ComputerObservationKind::Accessibility]
    }
    fn actions(&self) -> Vec<ComputerActionSupport> {
        vec![ComputerActionSupport {
            action: ComputerActionKind::Click,
            delivery: ComputerDelivery::Background,
            addressing: vec![ComputerAddressing::Element],
        }]
    }
    fn status(&self) -> ComputerDriverStatus {
        ComputerDriverStatus {
            environment: Some(self.environment()),
            available: true,
            accessibility: ComputerPermissionState::Granted,
            screen_recording: ComputerPermissionState::Granted,
            message: "Owned app".into(),
        }
    }
    fn targets(&self) -> Result<Vec<Window>, ComputerError> {
        Ok(vec![window()])
    }
    fn open(
        &self,
        _: &ComputerApplicationSelector,
    ) -> Result<(Option<Window>, String), ComputerError> {
        Ok((Some(window()), String::new()))
    }
    fn bounds(&self, _: &Window) -> Option<WindowBounds> {
        Some(self.0.borrow().bounds)
    }
    fn observe(
        &self,
        _: &Window,
        _: &ComputerObserveOptions,
        _: Option<&AppSnapshot>,
    ) -> Result<WindowObservation<Self::Snapshot>, ComputerError> {
        let clicks = self.0.borrow().clicks;
        let mut elements = vec![
            ObservedControl {
                index: ControlId(1),
                role: "Button".into(),
                label: "Increment".into(),
                value: clicks.to_string(),
                depth: 0,
                enabled: true,
                secure: false,
                invocable: true,
            }
            .into_element(),
        ];
        if clicks == 0 {
            elements.push(
                ObservedControl {
                    index: ControlId(2),
                    role: "Text".into(),
                    label: "Pending".into(),
                    value: String::new(),
                    depth: 1,
                    enabled: true,
                    secure: false,
                    invocable: false,
                }
                .into_element(),
            );
        }
        Ok(WindowObservation {
            source: AppSnapshot(clicks),
            bounds: Some(self.0.borrow().bounds),
            elements,
            image: Err(ComputerCaptureStatus::Unavailable),
            truncated: false,
        })
    }
    fn admit(&self, _: &AppSnapshot, _: &ComputerAction) -> Result<(), ComputerError> {
        if self.0.borrow().refuse_before_input {
            return Err(error(ComputerErrorCode::Unsupported, "Not expressible"));
        }
        Ok(())
    }
    fn input(
        &self,
        _: &Window,
        basis: &AppSnapshot,
        _: ComputerAction,
        _: &crate::Cancellation,
    ) -> Result<Option<ComputerExecution>, ComputerError> {
        let mut app = self.0.borrow_mut();
        assert_eq!(
            basis.0, app.clicks,
            "The platform's opaque observation must reach input intact"
        );
        app.clicks += 1;
        if app.fail_after_input {
            Err(error(ComputerErrorCode::Failed, "Acknowledgement lost"))
        } else {
            Ok(None)
        }
    }
}

#[test]
fn session_consumes_platform_observations_and_preserves_effect_uncertainty() {
    for (name, moved, stopped, fail_after_input, refuse_before_input, expand, expected, clicks) in [
        (
            "acknowledged",
            false,
            false,
            false,
            false,
            false,
            "executed",
            1,
        ),
        (
            "lost acknowledgement",
            false,
            false,
            true,
            false,
            false,
            "unknown",
            1,
        ),
        (
            "adapter refusal before input",
            false,
            false,
            false,
            true,
            false,
            "rejected",
            0,
        ),
        (
            "window moved",
            true,
            false,
            false,
            false,
            false,
            "rejected",
            0,
        ),
        (
            "stop revoked the observation",
            false,
            true,
            false,
            false,
            false,
            "rejected",
            0,
        ),
        (
            "latest subtree only for input",
            false,
            false,
            false,
            false,
            true,
            "rejected",
            0,
        ),
    ] {
        let app = Rc::new(RefCell::new(App {
            bounds: WindowBounds {
                x: 0.,
                y: 0.,
                w: 600.,
                h: 400.,
            },
            clicks: 0,
            fail_after_input,
            refuse_before_input,
        }));
        let mut runtime = ComputerRuntime::new(OwnedDesktop(app.clone()), 99);
        let thread: ComputerRef = "thread-1".to_owned().try_into().unwrap();
        let ComputerResponse::Targets { targets, .. } = runtime
            .call(thread.clone(), ComputerRequest::Targets {})
            .unwrap()
        else {
            panic!()
        };
        let target = targets[0].reference.clone();
        let ComputerResponse::Observation { observation, .. } = runtime
            .call(
                thread.clone(),
                ComputerRequest::Observe {
                    target: target.clone(),
                    options: ComputerObserveOptions::default(),
                },
            )
            .unwrap()
        else {
            panic!()
        };
        let root = ComputerSubtree {
            observation_id: observation.id.clone(),
            element_id: observation.elements[0].id.clone(),
        };
        let expand_root = |runtime: &mut ComputerRuntime<OwnedDesktop>, root: ComputerSubtree| {
            runtime.call(
                thread.clone(),
                ComputerRequest::Observe {
                    target: target.clone(),
                    options: ComputerObserveOptions {
                        want_image: false,
                        root: Some(root),
                        ..ComputerObserveOptions::default()
                    },
                },
            )
        };
        if expand {
            assert!(expand_root(&mut runtime, root.clone()).is_ok());
            let mut invalid = root.clone();
            invalid.element_id = "missing".to_owned().try_into().unwrap();
            assert_eq!(
                expand_root(&mut runtime, invalid).unwrap_err().code,
                ComputerErrorCode::StaleObservation
            );
            assert!(expand_root(&mut runtime, root.clone()).is_ok());
        }
        if moved {
            app.borrow_mut().bounds.x = 10.;
        }
        if stopped {
            runtime
                .call(thread.clone(), ComputerRequest::Stop {})
                .unwrap();
        }
        let action = ComputerAction {
            request_id: "input-1".to_owned().try_into().unwrap(),
            target: target.clone(),
            observation_id: observation.id,
            delivery: ComputerDelivery::Background,
            input: ComputerInput::Click {
                anchor: ComputerAnchor::Element {
                    element_id: observation.elements[0].id.clone(),
                },
                button: ComputerMouseButton::Left,
                count: 1.try_into().unwrap(),
            },
        };
        let ComputerResponse::Receipt { receipt } = runtime
            .call(
                thread.clone(),
                ComputerRequest::Act {
                    action: action.clone(),
                },
            )
            .unwrap()
        else {
            panic!()
        };
        let outcome = match receipt.outcome {
            ComputerActionOutcome::Executed { .. } => "executed",
            ComputerActionOutcome::Unknown { .. } => "unknown",
            ComputerActionOutcome::Rejected { .. } => "rejected",
        };
        assert_eq!(outcome, expected, "{name}");
        assert_eq!(app.borrow().clicks, clicks, "{name}");
        assert_eq!(
            expand_root(&mut runtime, root).unwrap_err().code,
            ComputerErrorCode::StaleObservation
        );
        let ComputerResponse::Receipt { receipt } = runtime
            .call(
                thread.clone(),
                ComputerRequest::Act {
                    action: action.clone(),
                },
            )
            .unwrap()
        else {
            panic!()
        };
        assert!(
            matches!(
                receipt.outcome,
                ComputerActionOutcome::Rejected {
                    error: ComputerError {
                        code: ComputerErrorCode::StaleObservation,
                        ..
                    }
                }
            ),
            "{name}"
        );
        assert_eq!(
            app.borrow().clicks,
            clicks,
            "Consumed observations cannot repeat an effect"
        );
        let ComputerResponse::Observation {
            observation: current,
            delta,
            ..
        } = runtime
            .call(
                thread,
                ComputerRequest::Observe {
                    target,
                    options: ComputerObserveOptions {
                        since_observation_id: Some(action.observation_id.clone()),
                        ..ComputerObserveOptions::default()
                    },
                },
            )
            .unwrap()
        else {
            panic!()
        };
        if stopped {
            assert!(delta.is_none(), "Stop also clears the read baseline");
            assert_eq!(current.elements.len(), 2);
        } else {
            let delta = delta.expect("Latest complete window is a valid baseline after input");
            assert_eq!(delta.base_observation_id, action.observation_id);
            assert_ne!(current.id, delta.base_observation_id);
            if clicks == 0 {
                assert!(current.elements.is_empty());
                assert!(delta.removed_element_ids.is_empty());
            } else {
                assert_eq!(current.elements.len(), 1);
                assert_eq!(current.elements[0].value.as_deref(), Some("1"));
                assert_eq!(
                    delta.removed_element_ids,
                    vec![observation.elements[1].id.clone()]
                );
            }
        }
    }
}

#[test]
fn application_authority_applies_to_existing_window_references() {
    use crate::access::ApplicationAccess;
    let app = Rc::new(RefCell::new(App {
        bounds: WindowBounds {
            x: 0.,
            y: 0.,
            w: 600.,
            h: 400.,
        },
        clicks: 0,
        fail_after_input: false,
        refuse_before_input: false,
    }));
    let mut runtime = ComputerRuntime::new(OwnedDesktop(app.clone()), 99);
    let thread: ComputerRef = "thread".to_owned().try_into().unwrap();
    let owned: ComputerRef = "owned".to_owned().try_into().unwrap();
    let granted = ApplicationAccess::Allowed(std::slice::from_ref(&owned));
    let denied = ApplicationAccess::Allowed(&[]);
    let ComputerResponse::Targets { targets, .. } = runtime
        .call_with_access(thread.clone(), ComputerRequest::Targets {}, granted)
        .unwrap()
    else {
        panic!()
    };
    let target = targets[0].reference.clone();
    let observe = ComputerRequest::Observe {
        target: target.clone(),
        options: ComputerObserveOptions::default(),
    };
    let ComputerResponse::Observation { observation, .. } = runtime
        .call_with_access(thread.clone(), observe.clone(), granted)
        .unwrap()
    else {
        panic!()
    };

    for request in [
        observe,
        ComputerRequest::Screenshot {
            target: target.clone(),
            recognize_text: true,
        },
    ] {
        assert_eq!(
            runtime
                .call_with_access(thread.clone(), request, denied)
                .unwrap_err()
                .code,
            ComputerErrorCode::PermissionRequired,
        );
    }
    let input = serde_json::from_value::<ComputerInput>(serde_json::json!({
        "kind": "click", "anchor": { "kind": "element", "element_id": observation.elements[0].id },
        "button": "left", "count": 1,
    }))
    .unwrap();
    let action = ComputerAction {
        request_id: "click".to_owned().try_into().unwrap(),
        target,
        observation_id: observation.id,
        delivery: ComputerDelivery::Background,
        input,
    };
    let ComputerResponse::Receipt { receipt, .. } = runtime
        .call_with_access(thread, ComputerRequest::Act { action }, denied)
        .unwrap()
    else {
        panic!()
    };
    assert!(
        matches!(receipt.outcome, ComputerActionOutcome::Rejected { error } if error.code == ComputerErrorCode::PermissionRequired)
    );
    assert_eq!(app.borrow().clicks, 0);
}
