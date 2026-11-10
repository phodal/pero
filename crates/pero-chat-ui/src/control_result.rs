//! Inline Control Lab receipt. The App owns the check; this view does not recompute it.
use crate::{
    chart::Chart,
    panel::ChatPanel,
    stream::{StreamAppearance, StreamText},
};
use gpui_kit::{prelude::*, *};
use pero_contracts::{
    content_document::{ContentDocument, ContentFormat, DocumentSource},
    content_origin::ContentOrigin,
};
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;

const KIND: &str = "pero.control-conversation.v1";

#[derive(Clone, Serialize)]
pub struct ControlResult {
    pub status: String,
    pub version: String,
    pub citation: String,
    pub candidate_id: String,
    pub title: String,
    #[serde(skip)]
    chart: Option<Chart>,
    #[serde(skip)]
    receipt: String,
    #[serde(skip)]
    explanation: String,
    #[serde(skip)]
    curve_note: Option<String>,
    #[serde(skip)]
    view: Entity<StreamText>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Receipt {
    kind: String,
    version: String,
    citation: String,
    experiment_id: String,
    spec_hash: String,
    candidate_id: String,
    title: String,
    parameters: serde_json::Map<String, Value>,
    status: String,
    inherited_check: bool,
    method: String,
    scope: String,
    explanation: String,
    curve: Option<Curve>,
    checks: Vec<Check>,
    scenarios: Vec<Scenario>,
    #[allow(dead_code)]
    not_applicable: Vec<Rejected>,
    #[allow(dead_code)]
    links: Vec<Link>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Curve {
    observation_id: String,
    input_digest: String,
    #[allow(dead_code)]
    trial_id: Option<String>,
    signal: String,
    x_unit: String,
    y_unit: String,
    sample_count: usize,
    displayed: usize,
    document: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Check {
    scenario: String,
    name: String,
    verdict: String,
    actual: Value,
    limit: Value,
    unit: String,
    message: String,
    report_id: Option<String>,
    input_digest: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Scenario {
    id: String,
    label: String,
    status: String,
    input_digest: String,
    observation_id: Option<String>,
    report_id: Option<String>,
    detail: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Rejected {
    #[allow(dead_code)]
    report_id: Option<String>,
    #[allow(dead_code)]
    input_digest: Option<String>,
    #[allow(dead_code)]
    reason: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Link {
    #[allow(dead_code)]
    label: String,
    #[allow(dead_code)]
    location: String,
}

struct Parsed {
    status: String,
    version: String,
    citation: String,
    candidate_id: String,
    title: String,
    markdown: String,
    chart: Option<Chart>,
    receipt: String,
    explanation: String,
    curve_note: Option<String>,
}

fn parse(text: &str) -> Result<Parsed, String> {
    let value: Value = serde_json::from_str(text).map_err(|_| "Control receipt is not JSON".to_string())?;
    let receipt_value = if value.get("kind").and_then(Value::as_str) == Some(KIND) {
        &value
    } else if value.get("result").and_then(|item| item.get("kind")).and_then(Value::as_str) == Some(KIND) {
        &value["result"]
    } else {
        return Err("Control receipt is missing".into());
    };
    let receipt: Receipt = serde_json::from_value(receipt_value.clone()).map_err(|error| error.to_string())?;
    if receipt.kind != KIND || receipt.inherited_check {
        return Err("A Control receipt cannot inherit another input's check".into());
    }
    if !hex(&receipt.version, 64) || !hex(&receipt.experiment_id, 32) || !hex(&receipt.spec_hash, 64) {
        return Err("Control version is not bound to an experiment".into());
    }
    if receipt.citation != format!("control-lab:{}@{}", receipt.experiment_id, receipt.version) {
        return Err("Control citation does not match its version".into());
    }
    if receipt.candidate_id.is_empty() || receipt.candidate_id.len() > 128 || receipt.title.is_empty() || receipt.title.len() > 200 {
        return Err("Control candidate identity is invalid".into());
    }
    if receipt.explanation.is_empty() || receipt.explanation.len() > 4000 || receipt.method.is_empty() || receipt.scope.is_empty() {
        return Err("Control check scope is missing".into());
    }
    if receipt.parameters.is_empty() || receipt.parameters.len() > 16 || receipt.parameters.iter().any(|(key, value)| {
        key.is_empty() || key.len() > 32 || value.as_f64().is_none_or(|number| !number.is_finite())
    }) {
        return Err("Control parameters are not finite inputs".into());
    }
    let statuses: Vec<&str> = receipt.scenarios.iter().map(|item| item.status.as_str()).collect();
    let expected = expected_status(&statuses).ok_or("Control scenario status is incomplete")?;
    if receipt.status != expected || receipt.scenarios.len() > 16 || receipt.checks.is_empty() || receipt.checks.len() > 80 {
        return Err("Control status does not match the saved scenarios".into());
    }
    for scenario in &receipt.scenarios {
        if scenario.id.is_empty() || scenario.label.is_empty() || !hex(&scenario.input_digest, 64) {
            return Err("Control scenario is not bound to an input".into());
        }
        if scenario.observation_id.as_ref().is_some_and(|value| !hex(value, 64)) || scenario.report_id.as_ref().is_some_and(|value| !hex(value, 64)) {
            return Err("Control observation identity is invalid".into());
        }
        if scenario.detail.len() > 500 {
            return Err("Control scenario detail is too long".into());
        }
    }
    for check in &receipt.checks {
        if !matches!(check.verdict.as_str(), "PASS" | "FAIL" | "INCONCLUSIVE" | "NOT_CHECKED" | "SOLVER_UNAVAILABLE" | "COMPUTATION_FAILED") {
            return Err("Control verdict is not a known result".into());
        }
        if matches!(receipt.status.as_str(), "pass" | "check_failed" | "inconclusive")
            && matches!(check.verdict.as_str(), "NOT_CHECKED" | "SOLVER_UNAVAILABLE" | "COMPUTATION_FAILED")
        {
            return Err("A completed check still contains an unchecked scenario".into());
        }
        if receipt.status == "pass" && check.verdict != "PASS" {
            return Err("Pass does not cover every saved check".into());
        }
        if !hex(&check.input_digest, 64) || check.report_id.as_ref().is_some_and(|value| !hex(value, 64)) {
            return Err("Control check is not bound to an input".into());
        }
        if check.message.len() > 240 || check.name.is_empty() || check.scenario.is_empty() {
            return Err("Control check text is invalid".into());
        }
        number_token(&check.actual)?;
        number_token(&check.limit)?;
    }
    let chart = match &receipt.curve {
        None => None,
        Some(curve) => {
            if !hex(&curve.observation_id, 64) || !hex(&curve.input_digest, 64) || curve.displayed < 2 || curve.sample_count < curve.displayed {
                return Err("Control curve is not a saved sample subset".into());
            }
            if !receipt.scenarios.iter().any(|item| item.observation_id.as_deref() == Some(curve.observation_id.as_str())) {
                return Err("Control curve is not one of this candidate's observations".into());
            }
            if curve.document.get("rows").and_then(Value::as_array).map(Vec::len) != Some(curve.displayed) {
                return Err("Control curve does not show the stated saved samples".into());
            }
            let document = serde_json::to_string(&curve.document).map_err(|error| error.to_string())?;
            let geometry = Chart::parse(&document)?;
            Some((geometry, format!("Displayed {} of {} saved {} samples ({} over {}); omitted samples are not drawn as zero.", curve.displayed, curve.sample_count, curve.signal, curve.y_unit, curve.x_unit)))
        }
    };
    let (chart, curve_note) = match chart {
        Some((geometry, note)) => (Some(geometry), Some(note)),
        None => (None, None),
    };
    Ok(Parsed {
        markdown: table(&receipt.checks),
        chart,
        receipt: serde_json::to_string_pretty(receipt_value).map_err(|error| error.to_string())?,
        explanation: receipt.explanation,
        curve_note,
        status: receipt.status,
        version: receipt.version,
        citation: receipt.citation,
        candidate_id: receipt.candidate_id,
        title: receipt.title,
    })
}

fn expected_status(scenarios: &[&str]) -> Option<&'static str> {
    if scenarios.is_empty() {
        return None;
    }
    if scenarios.contains(&"failed") { return Some("failed"); }
    if scenarios.contains(&"unavailable") { return Some("unavailable"); }
    if scenarios.contains(&"unchecked") { return Some("unchecked"); }
    if scenarios.contains(&"check_failed") { return Some("check_failed"); }
    if scenarios.contains(&"inconclusive") { return Some("inconclusive"); }
    if scenarios.iter().all(|status| *status == "pass") { return Some("pass"); }
    None
}

fn number_token(value: &Value) -> Result<Option<String>, String> {
    if value.is_null() {
        return Ok(None);
    }
    let number = value.as_number().filter(|item| item.as_f64().is_some_and(|number| number.is_finite())).ok_or("Check values must be finite JSON numbers or null")?;
    Ok(Some(number.to_string()))
}

fn table(checks: &[Check]) -> String {
    let mut markdown = String::from("| Scenario | Check | Verdict | Actual | Limit | Unit | Note |\n| --- | --- | --- | ---: | ---: | --- | --- |\n");
    for check in checks {
        let actual = number_token(&check.actual).ok().flatten().unwrap_or_else(|| "—".into());
        let limit = number_token(&check.limit).ok().flatten().unwrap_or_else(|| "—".into());
        markdown.push_str(&format!("| {} | {} | {} | {actual} | {limit} | {} | {} |\n", literal(&check.scenario), literal(&check.name), literal(&check.verdict), literal(&check.unit), literal(&check.message)));
    }
    markdown
}

fn literal(text: &str) -> String {
    text.replace(['\n', '\r', '|'], " ")
}

fn hex(value: &str, length: usize) -> bool {
    value.len() == length && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

impl ControlResult {
    pub fn from_content(text: &str, cx: &mut App) -> Result<Self, String> {
        let parsed = parse(text)?;
        let markdown = parsed.markdown.clone();
        Ok(Self {
            status: parsed.status,
            version: parsed.version,
            citation: parsed.citation,
            candidate_id: parsed.candidate_id,
            title: parsed.title,
            chart: parsed.chart,
            receipt: parsed.receipt,
            explanation: parsed.explanation,
            curve_note: parsed.curve_note,
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
        ("unavailable", false) => "Solver unavailable",
        ("unavailable", true) => "求解器不可用",
        ("failed", false) => "Computation failed",
        ("failed", true) => "计算失败",
        ("unchecked", false) => "Not checked",
        ("unchecked", true) => "尚未检查",
        ("check_failed", false) => "Check failed",
        ("check_failed", true) => "检查未通过",
        ("inconclusive", false) => "Inconclusive",
        ("inconclusive", true) => "尚无结论",
        ("pass", false) => "Check passed within the stated scope",
        ("pass", true) => "检查在所述范围内通过",
        _ => "Not checked",
    }
}

impl ChatPanel {
    pub(crate) fn inline_control(&self, thread: &str, tool: &str, result: &ControlResult, cx: &mut Context<Self>) -> AnyElement {
        let chrome = pero_theme::Chrome::from_app(cx);
        let zh = self.locale.starts_with("zh");
        let citation = result.citation.clone();
        let receipt = ContentDocument::new(
            DocumentSource { id: format!("control/{}", result.version), title: format!("{}.json", result.title), origin: ContentOrigin::Conversation { thread_id: thread.into() } },
            1, result.receipt.clone(), ContentFormat::Json,
        );
        let thread_id = thread.to_owned();
        let tool_id = tool.to_owned();
        let note = result.curve_note.clone();
        let status_color = if matches!(result.status.as_str(), "failed" | "check_failed") { chrome.palette.error } else { chrome.palette.text };
        pero_theme::research_result(result.title.clone(), chrome)
            .id(SharedString::from(format!("control-{thread}-{tool}")))
            .child(div().text_sm().text_color(status_color).child(status_label(&result.status, zh)))
            .child(pero_theme::research_note(chrome).child(result.explanation.clone()))
            .child(result.view.clone())
            .when_some(result.chart.clone(), |el, chart| el.child(div().w_full().h(px(240.)).min_w_0().child(chart.render(cx))))
            .when_some(note, |el, note| el.child(div().text_sm().text_color(chrome.palette.text_muted).child(note)))
            .child(div().flex().flex_wrap().gap_2().min_w_0()
                .child(pero_theme::action_button(SharedString::from(format!("control-cite-{tool}")), if zh { "复制引用" } else { "Copy citation" }, pero_theme::ActionKind::Ghost, chrome, cx)
                    .on_click(move |_, _, cx| cx.write_to_clipboard(ClipboardItem::new_string(citation.clone()))))
                .child(pero_theme::action_button(SharedString::from(format!("control-receipt-{tool}")), if zh { "结果引用" } else { "Result reference" }, pero_theme::ActionKind::Ghost, chrome, cx)
                    .on_click(cx.listener(move |this, _, window, cx| this.open_result_document(&thread_id, &tool_id, receipt.clone(), window, cx)))))
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::{parse, table, Check, KIND};
    use serde_json::{json, Value};

    fn id(byte: char, length: usize) -> String { std::iter::repeat(byte).take(length).collect() }

    fn receipt(status: &str, scenario_status: &str, verdict: &str, actual: Value) -> Value {
        let experiment = id('a', 32);
        let version = id('b', 64);
        let observation = id('c', 64);
        let digest = id('d', 64);
        let report = id('e', 64);
        let mut value = json!({
            "kind": KIND, "version": version, "citation": format!("control-lab:{experiment}@{version}"),
            "experimentId": experiment, "specHash": id('f', 64), "candidateId": "proposal-1",
            "title": "Robust filtered PID · Proposal", "parameters": {"kp": 1}, "status": status,
            "inheritedCheck": false, "method": "python-control 0.10.2; verifier control-lab-verifier-v1",
            "scope": "Search scenarios only.", "explanation": "Status is bound to this input.",
            "curve": null, "notApplicable": [], "links": [],
            "scenarios": [{"id": "nominal", "label": "Nominal", "status": scenario_status, "inputDigest": digest, "observationId": null, "reportId": null, "detail": "saved"}],
            "checks": [{"scenario": "Nominal", "name": "Final-window target error", "verdict": verdict, "actual": actual, "limit": 0.01, "unit": "1", "message": "Finite window only.", "reportId": null, "inputDigest": digest}]
        });
        if matches!(status, "pass" | "check_failed" | "inconclusive") {
            value["scenarios"][0]["observationId"] = json!(observation);
            value["scenarios"][0]["reportId"] = json!(report);
            value["checks"][0]["reportId"] = json!(report);
            value["curve"] = json!({"observationId": observation, "inputDigest": digest, "trialId": null, "signal": "reference", "xUnit": "s", "yUnit": "1", "sampleCount": 201, "displayed": 2,
                "document": {"schemaVersion": 1, "chart": {"type": "line", "x": "t", "y": "y", "series": "signal", "xLabel": "t (s)", "yLabel": "reference (1)"}, "rows": [
                    {"t": "0", "y": 0.0, "signal": "reference"}, {"t": "2", "y": 0.2594973325520875, "signal": "reference"}]}});
        }
        value
    }

    #[test]
    fn statuses_stay_distinct_and_null_is_not_zero() {
        let failed = parse(&receipt("check_failed", "check_failed", "FAIL", json!(0.2594973325520875)).to_string()).unwrap();
        assert_eq!(failed.status, "check_failed");
        assert!(failed.markdown.contains("FAIL"));
        assert!(!failed.markdown.contains("| 0 |"));
        let missing = parse(&receipt("unchecked", "unchecked", "NOT_CHECKED", Value::Null).to_string()).unwrap();
        assert_eq!(missing.status, "unchecked");
        assert!(missing.chart.is_none());
        assert!(missing.markdown.contains("—"));
        assert!(missing.markdown.contains("NOT_CHECKED"));
        let wrapped = json!({"app": "control-lab", "tool": "project-result", "result": receipt("unavailable", "unavailable", "SOLVER_UNAVAILABLE", Value::Null)});
        assert_eq!(parse(&wrapped.to_string()).unwrap().status, "unavailable");
    }

    #[test]
    fn old_checks_and_false_pass_do_not_render() {
        let mut inherited = receipt("unchecked", "unchecked", "NOT_CHECKED", Value::Null);
        inherited["inheritedCheck"] = json!(true);
        assert!(parse(&inherited.to_string()).is_err());
        let mut forged = receipt("pass", "unchecked", "PASS", json!(1));
        forged["checks"][0]["verdict"] = json!("PASS");
        assert!(parse(&forged.to_string()).is_err());
        let passed = parse(&receipt("pass", "pass", "PASS", json!(0.001)).to_string()).unwrap();
        assert_eq!(passed.version, id('b', 64));
        assert!(passed.chart.is_some());
        assert_eq!(parse(&receipt("pass", "pass", "PASS", json!(0.001)).to_string()).unwrap().citation, passed.citation);
    }

    #[test]
    fn null_limit_stays_blank() {
        let checks = vec![Check { scenario: "Nominal".into(), name: "Gain margin".into(), verdict: "PASS".into(), actual: Value::Null, limit: json!(6), unit: "dB".into(), message: "Unbounded margin is not a finite measurement.".into(), report_id: None, input_digest: id('d', 64) }];
        let markdown = table(&checks);
        assert!(markdown.contains("| — | 6 |"));
        assert!(!markdown.contains("| 0 | 6 |"));
    }
}
