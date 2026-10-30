//! A published chart is conversation content, independent of any App panel.
use crate::{chart::Chart, panel::{ChatAction, ChatPanel}};
use gpui_kit::{component::{button::*, Sizable}, prelude::*, *};
use pero_contracts::{content_document::{ContentDocument, ContentFormat, DocumentSource}, content_origin::ContentOrigin};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct SourceDocument { title: String, text: String, format: String }

#[derive(Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
struct Receipt { kind: String, artifact_id: String, content: String, source_document: Option<SourceDocument> }

#[derive(Clone, Serialize)]
pub struct ChartView {
    pub artifact_id: String,
    #[serde(skip)]
    pub(crate) data_bounds: crate::view_bounds::ViewBounds,
    #[serde(skip)]
    pub(crate) source_bounds: crate::view_bounds::ViewBounds,
    pub title: String,
    pub document: Value,
    #[serde(skip)]
    content: String,
    #[serde(skip)]
    source: Option<SourceDocument>,
    #[serde(skip)]
    geometry: Chart,
}
impl ChartView {
    pub fn from_content(text: &str) -> Result<Self, String> {
        if text.len() > 4*1024*1024 { return Err("Chart receipt is too large".into()); }
        let receipt: Receipt = serde_json::from_str(text).map_err(|e|e.to_string())?;
        if receipt.kind != "pero.chart.v1" || format!("{:x}",Sha256::digest(receipt.content.as_bytes())) != receipt.artifact_id { return Err("Chart identity does not match its content".into()); }
        let geometry = Chart::parse(&receipt.content)?.with_id(SharedString::from(receipt.artifact_id.clone()));
        let document:Value = serde_json::from_str(&receipt.content).map_err(|e|e.to_string())?;
        let title = document["title"].as_str().ok_or("Chart title is missing")?.to_string();
        if let Some(source) = &receipt.source_document {
            let prefix = match source.format.as_str() {"json" => "json\n", "json_lines" => "jsonl\n", _ => return Err("Unsupported chart source format".into())};
            let mut digest = Sha256::new(); digest.update(prefix.as_bytes()); digest.update(source.text.as_bytes());
            let digest = format!("{:x}",digest.finalize());
            if document["source"]["dataset"].as_str() != Some(digest.as_str()) { return Err("Chart source identity does not match".into()); }
        }
        Ok(Self {data_bounds:Default::default(),source_bounds:Default::default(),artifact_id:receipt.artifact_id,title,document,geometry,content:receipt.content,source:receipt.source_document})
    }
    fn document(&self, thread:&str, source:bool) -> ContentDocument {
        let (title,text,format)=if let Some(source)=self.source.as_ref().filter(|_|source) {
            (source.title.clone(),source.text.clone(),if source.format=="json_lines" {ContentFormat::JsonLines} else {ContentFormat::Json})
        } else {(format!("{}.json",self.title),self.content.clone(),ContentFormat::Json)};
        ContentDocument::new(DocumentSource{id:format!("chart/{}/{source}",self.artifact_id),title,origin:ContentOrigin::Conversation{thread_id:thread.into()}},1,text,format)
    }
}
impl ChatPanel {
    fn open_chart_document(&mut self, thread: &str, tool: &str, document: ContentDocument, window: &mut Window, cx: &mut Context<Self>) {
        if self.can_open_documents { cx.emit(ChatAction::OpenDocument(document)); return; }
        let locale = self.locale.clone();
        if let Some(tool) = self.chats.iter_mut().find(|chat| chat.id == thread).and_then(|chat|chat.tools.iter_mut().find(|item|item.id == tool)) {
            tool.chart_reader = Some(cx.new(|cx|crate::content_reader::ContentReader::new(document,locale,window,cx)));
            cx.notify();
        }
    }
    pub(crate) fn inline_chart(&self, thread:&str, tool:&str, chart:&ChartView, cx:&mut Context<Self>)->AnyElement {
        let palette = &pero_theme::UiAppearance::global(cx).palette;
        let data = chart.document(thread,false);
        let source = chart.document(thread,true);
        let zh = self.locale.starts_with("zh");
        let thread_id = thread.to_owned(); let tool_id = tool.to_owned();
        let source_thread = thread_id.clone(); let source_tool = tool_id.clone();
        let reader = self.chats.iter().find(|chat|chat.id == thread).and_then(|chat|chat.tools.iter().find(|item|item.id == tool)).and_then(|tool|tool.chart_reader.clone());
        div().id(SharedString::from(format!("chart-{thread}-{tool}"))).w_full().min_w_0().py_3()
            .child(div().font_weight(FontWeight::SEMIBOLD).child(chart.title.clone()))
            .when_some(chart.document["description"].as_str().filter(|s|!s.is_empty()),|el,text|el.child(div().text_sm().child(text.to_string())))
            .when(chart.document["chart"]["xLabel"].is_string() || chart.document["chart"]["yLabel"].is_string(), |el| el.child(div().text_sm().child([chart.document["chart"]["xLabel"].as_str(),chart.document["chart"]["yLabel"].as_str()].into_iter().flatten().collect::<Vec<_>>().join(" / "))))
            .child(div().w_full().h(px(280.)).child(chart.geometry.render(cx)))
            .child(div().text_sm().text_color(palette.text_muted).child(chart.document["source"]["label"].as_str().unwrap_or_default().to_string()))
            .children(chart.document["source"]["caveats"].as_array().into_iter().flatten().filter_map(Value::as_str).map(|text|div().text_sm().text_color(palette.text_muted).child(text.to_string())))
            .child(div().flex().gap_2()
                .child(Button::new(SharedString::from(format!("chart-data-{tool}"))).small().ghost().relative().child(chart.data_bounds.probe()).label(if zh {"数据与来源"} else {"Data and sources"}).on_click(cx.listener(move |this,_,window,cx|this.open_chart_document(&thread_id,&tool_id,data.clone(),window,cx))))
                .when(chart.source.is_some(),|el|el.child(Button::new(SharedString::from(format!("chart-source-{tool}"))).small().ghost().relative().child(chart.source_bounds.probe()).label(if zh {"原始记录"} else {"Original records"}).on_click(cx.listener(move |this,_,window,cx|this.open_chart_document(&source_thread,&source_tool,source.clone(),window,cx))))))
            .when_some(reader, |el,reader|el.child(reader))
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::ChartView;
    use sha2::{Digest,Sha256};
    use serde_json::{json,Value};
    #[test]
    fn receipt_identity_binds_chart_and_original_source() {
        let text = r#"[{"month":"Jan","value":2}]"#;
        let source_id = format!("{:x}",Sha256::digest(format!("json\n{text}").as_bytes()));
        let document=json!({"schemaVersion":1,"id":"test","title":"Test","chart":{"type":"bar","x":"month","y":"value"},"rows":[{"month":"Jan","value":2}],"source":{"label":"test","dataset":source_id}}).to_string();
        let digest=format!("{:x}",Sha256::digest(document.as_bytes()));
        let receipt=json!({"kind":"pero.chart.v1","artifactId":digest,"content":document,"sourceDocument":{"title":"rows.json","text":text,"format":"json"}});
        for (name, value, valid) in [
            ("valid",receipt.clone(),true),
            ("chart changed",{let mut v=receipt.clone();v["content"]=Value::String(document.replace("Test","Changed"));v},false),
            ("source changed",{let mut v=receipt.clone();v["sourceDocument"]["text"]=json!("[]");v},false),
        ] { assert_eq!(ChartView::from_content(&value.to_string()).is_ok(),valid,"{name}"); }
    }
}
