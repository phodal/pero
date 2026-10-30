//! Platform-neutral Computer Use values. No clock, files, processes or native API.
//! Observation admission is not a Host authorization grant or an execution result.
use serde::{Deserialize, Serialize};
use std::num::NonZeroU32;

#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(try_from = "String", into = "String")]
pub struct ComputerRef(String);

impl TryFrom<String> for ComputerRef {
    type Error = &'static str;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.is_empty()
            || value.len() > 128
            || !value.as_bytes()[0].is_ascii_alphanumeric()
            || !value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
        {
            return Err("Invalid Computer Use reference");
        }
        Ok(Self(value))
    }
}
impl From<ComputerRef> for String {
    fn from(value: ComputerRef) -> Self {
        value.0
    }
}
impl ComputerRef {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

// Both text entry and logical key names have bounded, nonempty Unicode values.
macro_rules! computer_text {
    ($name:ident, $limit:literal) => {
        #[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
        #[serde(try_from = "String", into = "String")]
        pub struct $name(String);
        impl TryFrom<String> for $name {
            type Error = &'static str;
            fn try_from(value: String) -> Result<Self, Self::Error> {
                if value.is_empty() || value.chars().count() > $limit {
                    return Err("Invalid Computer Use text length");
                }
                Ok(Self(value))
            }
        }
        impl From<$name> for String {
            fn from(value: $name) -> Self {
                value.0
            }
        }
        impl $name {
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }
    };
}
computer_text!(ComputerText, 10000);
computer_text!(ComputerKey, 64);
computer_text!(ComputerApplication, 128);

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(try_from = "Vec<ComputerKey>", into = "Vec<ComputerKey>")]
pub struct ComputerKeyChord(Vec<ComputerKey>);
impl TryFrom<Vec<ComputerKey>> for ComputerKeyChord {
    type Error = &'static str;
    fn try_from(value: Vec<ComputerKey>) -> Result<Self, Self::Error> {
        if value.is_empty() || value.len() > 8 {
            return Err("A key chord requires 1–8 keys");
        }
        Ok(Self(value))
    }
}
impl From<ComputerKeyChord> for Vec<ComputerKey> {
    fn from(value: ComputerKeyChord) -> Self {
        value.0
    }
}
impl ComputerKeyChord {
    pub fn keys(&self) -> &[ComputerKey] {
        &self.0
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(try_from = "u8", into = "u8")]
pub struct ComputerClickCount(u8);
impl TryFrom<u8> for ComputerClickCount {
    type Error = &'static str;
    fn try_from(value: u8) -> Result<Self, Self::Error> {
        if !(1..=3).contains(&value) {
            return Err("A click requires 1–3 presses");
        }
        Ok(Self(value))
    }
}
impl From<ComputerClickCount> for u8 {
    fn from(value: ComputerClickCount) -> Self {
        value.0
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum ComputerProtocol {
    #[serde(rename = "pero.computer-use.v1")]
    V1,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ComputerActionKind {
    Click,
    TypeText,
    PressKey,
    Scroll,
    Drag,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ComputerDelivery {
    Background,
    Foreground,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ComputerAddressing {
    Element,
    Pixel,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ComputerPlatform {
    Macos,
    Windows,
    Linux,
    Other,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ComputerDisplay {
    Native,
    X11,
    Xwayland,
    Wayland,
    Unavailable,
}
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ComputerEnvironment {
    pub platform: ComputerPlatform,
    pub display: ComputerDisplay,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub desktop: Option<String>,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ComputerObservationKind {
    Accessibility,
    Screenshot,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ComputerTargetKind {
    Window,
    Desktop,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ComputerMouseButton {
    Left,
    Right,
    Middle,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum ComputerImageType {
    #[serde(rename = "image/png")]
    Png,
    #[serde(rename = "image/jpeg")]
    Jpeg,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ComputerTargetRef {
    pub runtime_id: ComputerRef,
    pub target_id: ComputerRef,
}
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ComputerTarget {
    pub reference: ComputerTargetRef,
    pub kind: ComputerTargetKind,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub application: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ComputerActionSupport {
    pub action: ComputerActionKind,
    pub delivery: ComputerDelivery,
    pub addressing: Vec<ComputerAddressing>,
}
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ComputerCapabilities {
    pub protocol: ComputerProtocol,
    pub runtime_id: ComputerRef,
    pub environment: ComputerEnvironment,
    pub observations: Vec<ComputerObservationKind>,
    pub actions: Vec<ComputerActionSupport>,
}
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ComputerElement {
    pub id: ComputerRef,
    pub role: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    pub depth: u16,
    pub actions: Vec<ComputerActionKind>,
}
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ComputerScreenshot {
    pub id: ComputerRef,
    pub media_type: ComputerImageType,
    pub width: NonZeroU32,
    pub height: NonZeroU32,
}
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ComputerObservation {
    pub id: ComputerRef,
    pub target: ComputerTargetRef,
    pub elements: Vec<ComputerElement>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screenshot: Option<ComputerScreenshot>,
    pub truncated: bool,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ComputerPoint {
    pub x: u32,
    pub y: u32,
}
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ComputerAnchor {
    Element {
        element_id: ComputerRef,
    },
    Pixel {
        screenshot_id: ComputerRef,
        point: ComputerPoint,
    },
}
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ComputerInput {
    Click {
        anchor: ComputerAnchor,
        button: ComputerMouseButton,
        count: ComputerClickCount,
    },
    TypeText {
        anchor: ComputerAnchor,
        text: ComputerText,
    },
    PressKey {
        anchor: ComputerAnchor,
        keys: ComputerKeyChord,
    },
    Scroll {
        anchor: ComputerAnchor,
        delta_x: i32,
        delta_y: i32,
    },
    Drag {
        screenshot_id: ComputerRef,
        from: ComputerPoint,
        to: ComputerPoint,
    },
}
impl ComputerInput {
    pub fn kind(&self) -> ComputerActionKind {
        match self {
            Self::Click { .. } => ComputerActionKind::Click,
            Self::TypeText { .. } => ComputerActionKind::TypeText,
            Self::PressKey { .. } => ComputerActionKind::PressKey,
            Self::Scroll { .. } => ComputerActionKind::Scroll,
            Self::Drag { .. } => ComputerActionKind::Drag,
        }
    }
}
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ComputerAction {
    pub request_id: ComputerRef,
    pub target: ComputerTargetRef,
    pub observation_id: ComputerRef,
    pub delivery: ComputerDelivery,
    pub input: ComputerInput,
}

/// An action admitted against values supplied by the Host. The Host must still
/// authorize the caller and re-check runtime/target liveness before native I/O.
#[derive(Debug)]
pub struct PreparedComputerAction(ComputerAction);
impl PreparedComputerAction {
    pub fn into_action(self) -> ComputerAction {
        self.0
    }
}

impl ComputerAction {
    pub fn prepare(
        self,
        observation: &ComputerObservation,
        capabilities: &ComputerCapabilities,
    ) -> Result<PreparedComputerAction, ComputerError> {
        use ComputerErrorCode::*;
        if self.target.runtime_id != capabilities.runtime_id {
            return Err(ComputerError::new(
                TargetUnavailable,
                "The runtime instance changed",
            ));
        }
        if self.target != observation.target || self.observation_id != observation.id {
            return Err(ComputerError::new(
                StaleObservation,
                "Observe the current target before acting",
            ));
        }
        let kind = self.input.kind();
        if !capabilities.actions.iter().any(|support| {
            support.action == kind
                && support.delivery == self.delivery
                && support.addressing.contains(&self.input.addressing())
        }) {
            return Err(ComputerError::new(
                Unsupported,
                "The requested action, delivery and addressing combination is not supported",
            ));
        }
        match &self.input {
            ComputerInput::Click { anchor, .. }
            | ComputerInput::TypeText { anchor, .. }
            | ComputerInput::PressKey { anchor, .. }
            | ComputerInput::Scroll { anchor, .. } => {
                observation.check_anchor(anchor, kind, capabilities)?
            }
            ComputerInput::Drag {
                screenshot_id,
                from,
                to,
            } => {
                for point in [from, to] {
                    observation.check_pixel(screenshot_id, *point, capabilities)?;
                }
            }
        }
        if matches!(
            &self.input,
            ComputerInput::Scroll {
                delta_x: 0,
                delta_y: 0,
                ..
            }
        ) {
            return Err(ComputerError::new(
                InvalidRequest,
                "A scroll requires a nonzero delta",
            ));
        }
        Ok(PreparedComputerAction(self))
    }
}
impl ComputerInput {
    pub fn addressing(&self) -> ComputerAddressing {
        match self {
            Self::Click { anchor, .. }
            | Self::TypeText { anchor, .. }
            | Self::PressKey { anchor, .. }
            | Self::Scroll { anchor, .. } => match anchor {
                ComputerAnchor::Element { .. } => ComputerAddressing::Element,
                ComputerAnchor::Pixel { .. } => ComputerAddressing::Pixel,
            },
            Self::Drag { .. } => ComputerAddressing::Pixel,
        }
    }
}
impl ComputerObservation {
    fn check_anchor(
        &self,
        anchor: &ComputerAnchor,
        kind: ComputerActionKind,
        capabilities: &ComputerCapabilities,
    ) -> Result<(), ComputerError> {
        use ComputerErrorCode::*;
        match anchor {
            ComputerAnchor::Element { element_id } => {
                if !capabilities
                    .observations
                    .contains(&ComputerObservationKind::Accessibility)
                {
                    return Err(ComputerError::new(
                        Unsupported,
                        "Accessibility observations are not supported",
                    ));
                }
                let mut found = self
                    .elements
                    .iter()
                    .filter(|element| &element.id == element_id);
                let Some(element) = found.next() else {
                    return Err(ComputerError::new(
                        StaleObservation,
                        "The element is absent from this observation",
                    ));
                };
                if found.next().is_some() {
                    return Err(ComputerError::new(
                        InvalidRequest,
                        "The observation contains an ambiguous element reference",
                    ));
                }
                if !element.actions.contains(&kind) {
                    return Err(ComputerError::new(
                        Unsupported,
                        "The element does not support this action",
                    ));
                }
                Ok(())
            }
            ComputerAnchor::Pixel {
                screenshot_id,
                point,
            } => self.check_pixel(screenshot_id, *point, capabilities),
        }
    }
    fn check_pixel(
        &self,
        id: &ComputerRef,
        point: ComputerPoint,
        capabilities: &ComputerCapabilities,
    ) -> Result<(), ComputerError> {
        use ComputerErrorCode::*;
        if !capabilities
            .observations
            .contains(&ComputerObservationKind::Screenshot)
        {
            return Err(ComputerError::new(
                Unsupported,
                "Screenshot observations are not supported",
            ));
        }
        let Some(image) = self.screenshot.as_ref().filter(|image| &image.id == id) else {
            return Err(ComputerError::new(
                StaleObservation,
                "Observe the current screenshot before acting",
            ));
        };
        if point.x >= image.width.get() || point.y >= image.height.get() {
            return Err(ComputerError::new(
                InvalidRequest,
                "The point is outside the observed screenshot",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ComputerErrorCode {
    Unsupported,
    PermissionRequired,
    TargetUnavailable,
    StaleObservation,
    InvalidRequest,
    Cancelled,
    Timeout,
    Failed,
}
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ComputerError {
    pub code: ComputerErrorCode,
    pub message: String,
}
impl ComputerError {
    fn new(code: ComputerErrorCode, message: &str) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub enum ComputerActionOutcome {
    Executed {},
    Rejected { error: ComputerError },
    Unknown { error: ComputerError },
}
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ComputerActionReceipt {
    pub request_id: ComputerRef,
    pub target: ComputerTargetRef,
    pub observation_id: ComputerRef,
    pub outcome: ComputerActionOutcome,
}

#[cfg(test)]
mod tests {
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
        serde_json::from_str(include_str!("../../../tests/contracts/computer-use.json")).unwrap()
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
                |action, _, _| {
                    action.observation_id = "observation-old".to_owned().try_into().unwrap()
                },
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
}
