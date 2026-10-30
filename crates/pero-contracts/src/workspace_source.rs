//! Bounded source transport advances one admitted byte cursor.
use serde::{Deserialize, Serialize};
pub const SOURCE_CHUNK_BYTES: usize = 256 * 1024;
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SourceChunk {
    pub offset: u64,
    pub text: String,
    pub done: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SourceUploadProgress {
    pub received: u64,
    pub total: u64,
    pub complete: bool,
}
impl SourceUploadProgress {
    pub fn new(total: u64) -> Self {
        Self {
            received: 0,
            total,
            complete: false,
        }
    }
    pub fn advance(self, chunk: &SourceChunk) -> Result<Self, &'static str> {
        if self.complete
            || chunk.offset != self.received
            || chunk.text.len() > SOURCE_CHUNK_BYTES
            || chunk.text.len() as u64 > self.total.saturating_sub(self.received)
        {
            return Err("Invalid source upload chunk");
        }
        let received = self.received + chunk.text.len() as u64;
        if chunk.done && received != self.total {
            return Err("The source upload is incomplete");
        }
        Ok(Self {
            received,
            total: self.total,
            complete: chunk.done,
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn source_uploads_require_complete_ordered_bounded_utf8_chunks() {
        let first = SourceChunk {
            offset: 0,
            text: "中文".into(),
            done: false,
        };
        let progress = SourceUploadProgress::new(7).advance(&first).unwrap();
        assert_eq!(progress.received, 6);
        for chunk in [
            SourceChunk {
                offset: 0,
                text: "x".into(),
                done: true,
            },
            SourceChunk {
                offset: 6,
                text: "".into(),
                done: true,
            },
            SourceChunk {
                offset: 6,
                text: "xx".into(),
                done: true,
            },
        ] {
            assert!(progress.advance(&chunk).is_err());
        }
        assert!(
            progress
                .advance(&SourceChunk {
                    offset: 6,
                    text: "x".into(),
                    done: true
                })
                .unwrap()
                .complete
        );
        assert!(
            SourceUploadProgress::new(0)
                .advance(&SourceChunk {
                    offset: 0,
                    text: "".into(),
                    done: true
                })
                .unwrap()
                .complete
        );
    }
}
