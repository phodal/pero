//! Inline Scientific Viewer molecule receipt. Drawing bytes come from RDKit; this view does not depict them again.
use crate::{panel::ChatPanel, stream::{StreamAppearance, StreamText}};
use gpui_kit::{prelude::*, *};
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

const KIND: &str = "pero.molecule-conversation.v1";

#[derive(Clone, Serialize)]
pub struct MoleculeResult {
    pub status: String,
    pub version: String,
    pub citation: String,
    pub title: String,
    #[serde(skip)]
    explanation: String,
    #[serde(skip)]
    rows: Vec<MoleculeRow>,
    #[serde(skip)]
    view: Entity<StreamText>,
}

#[derive(Clone)]
struct MoleculeRow {
    input: String,
    status: String,
    error: Option<String>,
    svg: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Receipt {
    kind: String,
    version: String,
    citation: String,
    status: String,
    inherited_check: bool,
    format: String,
    engine: Option<Engine>,
    method: String,
    scope: String,
    explanation: String,
    rows: Vec<Row>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Engine {
    name: String,
    version: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Row {
    input: String,
    status: String,
    error: Option<String>,
    svg: Option<String>,
    svg_sha256: Option<String>,
    descriptors: Option<serde_json::Map<String, Value>>,
}

struct Parsed {
    status: String,
    version: String,
    citation: String,
    explanation: String,
    markdown: String,
    rows: Vec<MoleculeRow>,
}

fn parse(text: &str) -> Result<Parsed, String> {
    let value: Value = serde_json::from_str(text).map_err(|_| "Molecule receipt is not JSON".to_string())?;
    let receipt_value = if value.get("kind").and_then(Value::as_str) == Some(KIND) { &value } else { return Err("Molecule receipt is missing".into()); };
    let receipt: Receipt = serde_json::from_value(receipt_value.clone()).map_err(|error| error.to_string())?;
    if receipt.kind != KIND || receipt.inherited_check {
        return Err("A molecule receipt cannot inherit another structure".into());
    }
    if receipt.citation != format!("scientific-viewer:{}", receipt.version) || receipt.version.len() != 64 {
        return Err("Molecule citation does not match its version".into());
    }
    if !matches!(receipt.status.as_str(), "depicted" | "partial" | "failed" | "unavailable") || receipt.rows.is_empty() || receipt.rows.len() > 4 {
        return Err("Molecule status is not a known result".into());
    }
    if receipt.explanation.is_empty() || receipt.method.is_empty() || receipt.scope.is_empty() {
        return Err("Molecule check scope is missing".into());
    }
    let mut depicted = 0;
    let mut rows = Vec::new();
    let mut markdown = String::from("| Record | Descriptor | Value | Unit |\n| --- | --- | ---: | --- |\n");
    for row in &receipt.rows {
        if row.input.is_empty() || row.input.len() > 32 * 1024 {
            return Err("Molecule record is empty".into());
        }
        match row.status.as_str() {
            "depicted" => {
                depicted += 1;
                let svg = row.svg.as_deref().ok_or("Depicted molecule has no drawing")?;
                let digest = row.svg_sha256.as_deref().ok_or("Depicted molecule has no drawing identity")?;
                if format!("{:x}", Sha256::digest(svg.as_bytes())) != digest || !safe_svg(svg) {
                    return Err("Molecule drawing does not match its saved bytes".into());
                }
                let descriptors = row.descriptors.as_ref().ok_or("Depicted molecule has no descriptors")?;
                if descriptors.is_empty() {
                    return Err("Depicted molecule has no descriptors".into());
                }
                for (name, value) in descriptors {
                    let number = value.get("value").and_then(Value::as_number).filter(|item| item.as_f64().is_some_and(f64::is_finite)).ok_or("Descriptor value must be a finite number")?;
                    let unit = value.get("unit").and_then(Value::as_str).unwrap_or("");
                    markdown.push_str(&format!("| {} | {name} | {} | {unit} |\n", literal(&row.input), number));
                }
                rows.push(MoleculeRow { input: row.input.clone(), status: row.status.clone(), error: None, svg: Some(svg.to_owned()) });
            }
            "invalid" | "unavailable" => {
                if row.svg.is_some() || row.descriptors.is_some() {
                    return Err("A failed molecule must not carry a drawing or descriptors".into());
                }
                let error = row.error.clone().filter(|text| !text.is_empty()).ok_or("Failed molecule has no error")?;
                markdown.push_str(&format!("| {} | — | — | — |\n", literal(&row.input)));
                rows.push(MoleculeRow { input: row.input.clone(), status: row.status.clone(), error: Some(error), svg: None });
            }
            _ => return Err("Molecule row status is unknown".into()),
        }
    }
    let expected = if receipt.status == "unavailable" {
        "unavailable"
    } else if depicted == receipt.rows.len() {
        "depicted"
    } else if depicted > 0 {
        "partial"
    } else {
        "failed"
    };
    if receipt.status != expected {
        return Err("Molecule status does not match its rows".into());
    }
    if receipt.status != "unavailable" {
        let engine = receipt.engine.as_ref().ok_or("Molecule engine is missing")?;
        if engine.name != "RDKit" || engine.version.is_empty() {
            return Err("Molecule engine must be RDKit".into());
        }
    }
    let _ = receipt.format;
    Ok(Parsed { status: receipt.status, version: receipt.version, citation: receipt.citation, explanation: receipt.explanation, markdown, rows })
}

fn safe_svg(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains("<svg") && !lower.contains("<script") && !lower.contains("javascript:") && !lower.contains("<foreignobject")
}

fn literal(text: &str) -> String {
    text.replace(['\n', '\r', '|'], " ")
}

impl MoleculeResult {
    pub fn from_content(text: &str, cx: &mut App) -> Result<Self, String> {
        let parsed = parse(text)?;
        let markdown = parsed.markdown.clone();
        Ok(Self {
            status: parsed.status,
            version: parsed.version,
            citation: parsed.citation,
            title: "Molecular structure".into(),
            explanation: parsed.explanation,
            rows: parsed.rows,
            view: cx.new(|cx| {
                let mut view = StreamText::new(&markdown, cx);
                view.appearance = StreamAppearance::ScientificTable;
                view
            }),
        })
    }
}

fn status_label(status: &str, zh: bool) -> &'static str {
    match (status, zh) {
        ("unavailable", false) => "RDKit unavailable",
        ("unavailable", true) => "RDKit 不可用",
        ("failed", false) => "No structure depicted",
        ("failed", true) => "没有绘出结构",
        ("partial", false) => "Partial structure result",
        ("partial", true) => "部分结构已绘出",
        ("depicted", false) => "Structure depicted",
        ("depicted", true) => "已绘出结构",
        _ => "Not checked",
    }
}

impl ChatPanel {
    pub(crate) fn inline_molecule(&self, thread: &str, tool: &str, result: &MoleculeResult, cx: &mut Context<Self>) -> AnyElement {
        let chrome = pero_theme::Chrome::from_app(cx);
        let zh = self.locale.starts_with("zh");
        let citation = result.citation.clone();
        let status_color = if matches!(result.status.as_str(), "failed" | "unavailable") { chrome.palette.error } else { chrome.palette.text };
        pero_theme::research_result(result.title.clone(), chrome)
            .id(SharedString::from(format!("molecule-{thread}-{tool}")))
            .child(div().text_sm().text_color(status_color).child(status_label(&result.status, zh)))
            .child(pero_theme::research_note(chrome).child(result.explanation.clone()))
            .children(result.rows.iter().enumerate().map(|(index, row)| {
                div().min_w_0().flex().flex_col().gap_1()
                    .child(div().text_sm().child(row.input.clone()))
                    .when_some(row.svg.clone(), |el, drawing| el.child(div().w(px(360.)).h(px(260.)).overflow_hidden().child(svg().data(drawing.as_bytes()))))
                    .when_some(row.error.clone(), |el, error| el.child(div().text_sm().text_color(chrome.palette.error).child(error)))
                    .id(SharedString::from(format!("molecule-row-{tool}-{index}")))
            }))
            .child(result.view.clone())
            .child(pero_theme::action_button(SharedString::from(format!("molecule-cite-{tool}")), if zh { "复制引用" } else { "Copy citation" }, pero_theme::ActionKind::Ghost, chrome, cx)
                .on_click(move |_, _, cx| cx.write_to_clipboard(ClipboardItem::new_string(citation.clone()))))
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::{parse, KIND};
    use serde_json::json;
    use sha2::{Digest, Sha256};

    fn id(byte: char) -> String { std::iter::repeat(byte).take(64).collect() }

    #[test]
    fn invalid_row_cannot_inherit_a_drawing_or_a_zero_descriptor() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>"#;
        let digest = format!("{:x}", Sha256::digest(svg.as_bytes()));
        let version = id('a');
        let receipt = json!({
            "kind": KIND, "version": version, "citation": format!("scientific-viewer:{version}"),
            "status": "partial", "inheritedCheck": false, "format": "smiles",
            "engine": {"name": "RDKit", "version": "2026.09.1"},
            "method": "RDKit depiction", "scope": "Calculated descriptors only.",
            "explanation": "One record failed.",
            "rows": [
                {"input": "CCO", "status": "depicted", "svg": svg, "svgSha256": digest, "descriptors": {"MolWt": {"value": 46.069, "unit": "g/mol"}}},
                {"input": "invalid@@", "status": "invalid", "error": "Invalid molecule"}
            ]
        });
        let parsed = parse(&receipt.to_string()).unwrap();
        assert_eq!(parsed.status, "partial");
        assert!(parsed.markdown.contains("46.069"));
        assert!(parsed.markdown.contains("| invalid@@ | — | — | — |"));
        assert!(!parsed.markdown.contains("| invalid@@ | MolWt | 0 |"));
        let mut forged = receipt;
        forged["rows"][1]["svg"] = json!(svg);
        assert!(parse(&forged.to_string()).is_err());
        forged["rows"][1]["svg"] = json!(null);
        forged["inheritedCheck"] = json!(true);
        assert!(parse(&forged.to_string()).is_err());
    }
}
