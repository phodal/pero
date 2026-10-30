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

mod admission;
pub use admission::PreparedComputerAction;
#[cfg(test)]
mod tests;
