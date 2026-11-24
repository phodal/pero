//! Computer Use transport values; the caller identity stays outside model arguments.
use crate::computer_use::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
pub enum ComputerRequest {
    Status {},
    Targets {},
    Open {
        application: ComputerApplicationSelector,
    },
    Observe {
        target: ComputerTargetRef,
        #[serde(default)]
        options: ComputerObserveOptions,
    },
    Screenshot {
        target: ComputerTargetRef,
        #[serde(default)]
        recognize_text: bool,
    },
    ReadOcr {
        screenshot_id: ComputerRef,
    },
    Act {
        action: ComputerAction,
    },
    Stop {},
    Receipt {
        request_id: ComputerRef,
    },
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ComputerPermissionState {
    Granted,
    NotDetected,
    Unsupported,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ComputerDriverStatus {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub environment: Option<ComputerEnvironment>,
    pub available: bool,
    pub accessibility: ComputerPermissionState,
    pub screen_recording: ComputerPermissionState,
    pub message: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ComputerUseState {
    pub enabled: bool,
    pub running: bool,
    pub status: ComputerDriverStatus,
    #[serde(default)]
    pub error: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ComputerImageContent {
    pub media_type: ComputerImageType,
    pub data: String,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ComputerCaptureStatus {
    Captured,
    NotRequested,
    Subtree,
    ScreenRecordingRequired,
    IncompleteScan,
    SecureContent,
    Unavailable,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ComputerOcrStatus {
    NotRequested,
    NoImage,
    Unsupported,
    Busy,
    Pending,
    Ready,
    NoText,
    Failed,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ComputerObservationDelta {
    pub base_observation_id: ComputerRef,
    pub removed_element_ids: Vec<ComputerRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub element_order: Option<Vec<ComputerRef>>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ComputerResponse {
    Status {
        status: ComputerDriverStatus,
    },
    Targets {
        capabilities: ComputerCapabilities,
        targets: Vec<ComputerTarget>,
    },
    Opened {
        target: Option<ComputerTarget>,
        message: String,
    },
    Observation {
        observation: ComputerObservation,
        image: Option<ComputerImageContent>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        capture_status: Option<ComputerCaptureStatus>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        ocr_status: Option<ComputerOcrStatus>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        recognized_text: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        delta: Option<ComputerObservationDelta>,
    },
    Ocr {
        screenshot_id: ComputerRef,
        ocr_status: ComputerOcrStatus,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        recognized_text: Option<String>,
    },
    Receipt {
        receipt: ComputerActionReceipt,
    },
    Stopped {},
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "action", deny_unknown_fields)]
pub enum ComputerControl {
    #[serde(rename = "computer_get")]
    Get {},
    #[serde(rename = "computer_set")]
    Set { enabled: bool },
    #[serde(rename = "computer_permissions")]
    Permissions {},
    #[serde(rename = "computer_stop")]
    Stop {},
}
#[derive(Deserialize)]
#[serde(tag = "method", deny_unknown_fields)]
pub enum ComputerSettingsRequest {
    #[serde(rename = "settings.computer.get")]
    Get {},
    #[serde(rename = "settings.computer")]
    Set { id: ComputerRef, enabled: bool },
}
