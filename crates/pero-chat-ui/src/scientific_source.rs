//! Original dataset bytes bound to a scientific result by the harness identity.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SourceFormat {
    Json,
    JsonLines,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ScientificSource {
    pub title: String,
    pub text: String,
    pub format: SourceFormat,
}

impl ScientificSource {
    /// Match `Dataset.identity` from the harness without reserializing its data.
    pub fn matches_dataset(&self, expected: &str) -> bool {
        let prefix = match self.format {
            SourceFormat::Json => "json\n",
            SourceFormat::JsonLines => "jsonl\n",
        };
        let mut digest = Sha256::new();
        digest.update(prefix.as_bytes());
        digest.update(self.text.as_bytes());
        format!("{:x}", digest.finalize()) == expected
    }
}

#[cfg(test)]
mod tests {
    use super::{ScientificSource, SourceFormat};

    #[test]
    fn dataset_identity_binds_format_and_exact_source_bytes() {
        // Fixtures generated with Python hashlib, matching harness Dataset.identity.
        let json_id = "2c244c194050447d898bd7c14df2f24b1759f911a43e5c52262af98452fa43ce";
        let json_lines_id = "0f1f109139d2c287ebe6987d5e8a1b98516a1a7a23725dc5f86b3f5229717c29";
        let wrong_prefix_id = "f6efbe0c7971d2ce64ae2bca79206f3aab4d19bb2c2e87f1006b88af210dca9c";
        for (name, format, text, expected, valid) in [
            (
                "json",
                SourceFormat::Json,
                "[{\"value\":2,\"label\":\"水\"}]",
                json_id,
                true,
            ),
            (
                "json lines",
                SourceFormat::JsonLines,
                "{\"value\":2,\"label\":\"水\"}\n",
                json_lines_id,
                true,
            ),
            (
                "wire name is not hash prefix",
                SourceFormat::JsonLines,
                "{\"value\":2,\"label\":\"水\"}\n",
                wrong_prefix_id,
                false,
            ),
            (
                "modified content",
                SourceFormat::Json,
                "[{\"value\":3,\"label\":\"水\"}]",
                json_id,
                false,
            ),
            (
                "removed newline",
                SourceFormat::JsonLines,
                "{\"value\":2,\"label\":\"水\"}",
                json_lines_id,
                false,
            ),
        ] {
            let source = ScientificSource {
                title: "Measurements".into(),
                text: text.into(),
                format,
            };
            assert_eq!(source.matches_dataset(expected), valid, "{name}");
        }
    }
}
