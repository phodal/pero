//! Local interactive shells, separate from Agent sessions and their history.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(try_from = "RawSize")]
pub struct TerminalSize {
    pub rows: u16,
    pub cols: u16,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawSize {
    rows: u16,
    cols: u16,
}
impl TerminalSize {
    pub fn new(rows: u16, cols: u16) -> Result<Self, &'static str> {
        if rows == 0 || cols == 0 || rows > 1000 || cols > 1000 {
            return Err("Invalid terminal dimensions");
        }
        Ok(Self { rows, cols })
    }
}
impl TryFrom<RawSize> for TerminalSize {
    type Error = &'static str;
    fn try_from(size: RawSize) -> Result<Self, Self::Error> {
        Self::new(size.rows, size.cols)
    }
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum TerminalRequest {
    Open {
        id: u32,
        cwd: String,
        size: TerminalSize,
    },
    Write {
        id: u32,
        bytes: Vec<u8>,
    },
    Resize {
        id: u32,
        size: TerminalSize,
    },
    Close {
        id: u32,
    },
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TerminalEvent {
    Opened { id: u32, cwd: String },
    Output { id: u32, bytes: Vec<u8> },
    Exited { id: u32, code: u32 },
    Error { id: u32, message: String },
}
impl TerminalEvent {
    pub fn id(&self) -> u32 {
        match self {
            Self::Opened { id, .. }
            | Self::Output { id, .. }
            | Self::Exited { id, .. }
            | Self::Error { id, .. } => *id,
        }
    }
}
