#![cfg(feature = "native")]
use gpui_kit::{ImageSource, SharedUri};
use pero_chat_ui::inline_images::{ConversationImages, InlineImage};
use serde_json::json;

#[test]
fn conversation_images_deduplicate_replay_without_cross_chat_access() {
    const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9xkAAAAASUVORK5CYII=";
    let value =
        json!({"type":"content","content":{"type":"image","mimeType":"image/png","data":PNG}});
    let uri = SharedUri::from(InlineImage::from_content(&value["content"]).unwrap().uri);
    let images = ConversationImages::default();
    images.observe(&[value.clone()]);
    images.observe(&[value.clone()]);
    assert!(matches!(images.resolve(&uri), ImageSource::Image(_)));
    assert!(matches!(
        ConversationImages::default().resolve(&uri),
        ImageSource::Resource(_)
    ));
    let restored = ConversationImages::default();
    restored.observe(&[value]);
    assert!(matches!(restored.resolve(&uri), ImageSource::Image(_)));
    assert!(matches!(
        restored.resolve(&SharedUri::from(format!("data:image/png;base64,{PNG}"))),
        ImageSource::Image(_)
    ));
}
