use super::*;
use computer_core::{ObservedControl, Window, WindowBounds};
use pero_contracts::{computer_runtime::*, computer_use::*};
use std::{cell::RefCell, rc::Rc};

// One fake at the native driver seam, with independently observable app effects.
struct App {
    bounds: WindowBounds,
    clicks: u32,
    fail_after_input: bool,
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
    fn open(&self, _: &str) -> Result<(Option<Window>, String), ComputerError> {
        Ok((Some(window()), String::new()))
    }
    fn bounds(&self, _: &Window) -> Option<WindowBounds> {
        Some(self.0.borrow().bounds)
    }
    fn observe(&self, _: &Window) -> Result<WindowObservation<Self::Snapshot>, ComputerError> {
        Ok(WindowObservation {
            source: AppSnapshot(self.0.borrow().clicks),
            bounds: Some(self.0.borrow().bounds),
            elements: vec![
                ObservedControl {
                    index: 1,
                    role: "Button".into(),
                    label: "Increment".into(),
                    value: String::new(),
                    depth: 0,
                    enabled: true,
                    secure: false,
                    invocable: true,
                }
                .into_element(),
            ],
            image: None,
            truncated: false,
        })
    }
    fn input(
        &self,
        _: &Window,
        basis: &AppSnapshot,
        _: ComputerAction,
    ) -> Result<(), ComputerError> {
        let mut app = self.0.borrow_mut();
        assert_eq!(
            basis.0, app.clicks,
            "The platform's opaque observation must reach input intact"
        );
        app.clicks += 1;
        if app.fail_after_input {
            Err(error(ComputerErrorCode::Failed, "Acknowledgement lost"))
        } else {
            Ok(())
        }
    }
}

#[test]
fn session_consumes_platform_observations_and_preserves_effect_uncertainty() {
    for (name, moved, stopped, fail_after_input, expected, clicks) in [
        ("acknowledged", false, false, false, "executed", 1),
        ("lost acknowledgement", false, false, true, "unknown", 1),
        ("window moved", true, false, false, "rejected", 0),
        (
            "stop revoked the observation",
            false,
            true,
            false,
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
                },
            )
            .unwrap()
        else {
            panic!()
        };
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
            target,
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
            ComputerActionOutcome::Executed {} => "executed",
            ComputerActionOutcome::Unknown { .. } => "unknown",
            ComputerActionOutcome::Rejected { .. } => "rejected",
        };
        assert_eq!(outcome, expected, "{name}");
        assert_eq!(app.borrow().clicks, clicks, "{name}");
        let ComputerResponse::Receipt { receipt } = runtime
            .call(thread, ComputerRequest::Act { action })
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
    }
}
