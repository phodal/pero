//! ACP input, structured output and fallback output have separate identities.
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Value, json};

#[derive(Default, Deserialize)]
pub struct ToolTranscriptPatch {
    #[serde(rename = "rawInput", default)]
    input: Field<Value>,
    #[serde(rename = "rawOutput", default)]
    output: Field<Value>,
    #[serde(default)]
    content: Field<Vec<Value>>,
}
#[derive(Default)]
enum Field<T> {
    #[default]
    Absent,
    Present(Option<T>),
}
impl<'de, T: Deserialize<'de>> Deserialize<'de> for Field<T> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Option::<T>::deserialize(d).map(Self::Present)
    }
}
#[derive(Clone, Default, Serialize)]
pub struct ToolTranscript {
    pub input: Option<Value>,
    pub raw_output: Option<Value>,
    #[serde(skip)]
    content: Vec<Value>,
}
impl ToolTranscript {
    pub fn apply(&mut self, patch: ToolTranscriptPatch) {
        if let Field::Present(value) = patch.input {
            self.input = value;
        }
        if let Field::Present(value) = patch.output {
            self.raw_output = value;
        }
        if let Field::Present(value) = patch.content {
            self.content = value.unwrap_or_default();
        }
    }
    pub fn output(&self) -> Vec<Value> {
        let content = self
            .content
            .iter()
            .filter(|block| {
                let Some(input) = &self.input else {
                    return true;
                };
                if block["type"] != "content" || block["content"]["type"] != "text" {
                    return true;
                }
                block["content"]["text"]
                    .as_str()
                    .and_then(|text| serde_json::from_str::<Value>(text).ok())
                    .as_ref()
                    != Some(input)
            })
            .cloned()
            .collect::<Vec<_>>();
        if !content.is_empty() {
            return content;
        }
        self.raw_output
            .as_ref()
            .filter(|value| {
                !value.is_null()
                    && !(value.as_object().is_some_and(|object| object.len() == 1)
                        && value["cancelled"] == true)
            })
            .map(|value| {
                let text = match value {
                    Value::String(text) => text.clone(),
                    value => format!(
                        "```json\n{}\n```",
                        serde_json::to_string_pretty(value).expect("JSON value")
                    ),
                };
                vec![json!({"type":"content","content":{"type":"text","text":text}})]
            })
            .unwrap_or_default()
    }
    pub fn input_text(&self) -> Option<String> {
        self.input.as_ref().map(|value| match value {
            Value::String(text) => text.clone(),
            value => serde_json::to_string_pretty(value).expect("JSON value"),
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn input_mirrors_results_and_incremental_updates_remain_distinct() {
        let mut transcript = ToolTranscript::default();
        for (patch, input, text) in [
            (
                json!({"rawInput":{"url":"https://example.test"},"content":[{"type":"content","content":{"type":"text","text":"{\"url\":\"https://example.test\"}"}}]}),
                true,
                "",
            ),
            (json!({"status":"in_progress"}), true, ""),
            (
                json!({"content":[{"type":"content","content":{"type":"text","text":"Fetched evidence"}}],"rawOutput":"duplicate fallback"}),
                true,
                "Fetched evidence",
            ),
            (
                json!({"content":null,"rawOutput":"fallback evidence"}),
                true,
                "fallback evidence",
            ),
            (json!({"rawInput":null,"rawOutput":null}), false, ""),
            (json!({"content":null,"rawOutput":{"cancelled":true}}), false, ""),
            (
                json!({"content":[{"type":"content","content":{"type":"text","text":"{\"url\":\"legitimate JSON result\"}"}}]}),
                false,
                "{\"url\":\"legitimate JSON result\"}",
            ),
        ] {
            transcript.apply(serde_json::from_value(patch).unwrap());
            assert_eq!(transcript.input.is_some(), input);
            assert_eq!(
                transcript
                    .output()
                    .first()
                    .and_then(|v| v["content"]["text"].as_str())
                    .unwrap_or_default(),
                text
            );
        }
    }
}
