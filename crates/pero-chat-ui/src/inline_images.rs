//! Conversation-local images delivered through ACP, addressed by their actual bytes.
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

const MAX_IMAGE_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone)]
pub struct InlineImage {
    pub uri: String,
    pub bytes: Vec<u8>,
}
impl InlineImage {
    pub fn from_content(value: &Value) -> Option<Self> {
        #[derive(Deserialize)]
        struct Content {
            #[serde(rename = "type")]
            kind: String,
            #[serde(rename = "mimeType")]
            mime_type: String,
            data: String,
        }
        let image: Content = serde_json::from_value(value.clone()).ok()?;
        if image.kind != "image"
            || image.mime_type != "image/png"
            || image.data.len() > MAX_IMAGE_BYTES.div_ceil(3) * 4
        {
            return None;
        }
        let bytes = STANDARD.decode(&image.data).ok()?;
        if bytes.len() < 45
            || bytes.len() > MAX_IMAGE_BYTES
            || &bytes[..8] != b"\x89PNG\r\n\x1a\n"
            || &bytes[12..16] != b"IHDR"
        {
            return None;
        }
        let width = u32::from_be_bytes(bytes[16..20].try_into().ok()?);
        let height = u32::from_be_bytes(bytes[20..24].try_into().ok()?);
        if !(1..=2048).contains(&width) || !(1..=2048).contains(&height) {
            return None;
        }
        Some(Self {
            uri: format!("pero-image://{:x}", Sha256::digest(&bytes)),
            bytes,
        })
    }
}

#[cfg(any(target_family = "wasm", feature = "native"))]
mod view {
    use super::*;
    use gpui_kit::{Image, ImageFormat, ImageSource, SharedUri};
    use std::{
        collections::HashMap,
        sync::{Arc, Mutex},
    };

    #[derive(Clone, Default)]
    pub struct ConversationImages(Arc<Mutex<HashMap<String, Arc<Image>>>>);
    impl ConversationImages {
        pub fn observe(&self, output: &[Value]) {
            let mut images = self.0.lock().expect("conversation images");
            for item in output {
                // Only actual ACP image content is eligible. JSON prose and
                // arbitrary document URLs cannot register a conversation image.
                if item["type"] != "content" {
                    continue;
                }
                if let Some(image) = InlineImage::from_content(&item["content"]) {
                    images.entry(image.uri).or_insert_with(|| {
                        Arc::new(Image::from_bytes(ImageFormat::Png, image.bytes))
                    });
                }
            }
        }
        pub fn resolve(&self, uri: &SharedUri) -> ImageSource {
            let mut images = self.0.lock().expect("conversation images");
            if let Some(image) = images.get(uri.as_ref()) {
                return image.clone().into();
            }
            // Preserve Base's existing embedded-data behavior when installing
            // the conversation resolver. Other URIs keep the normal loader.
            if let Some(image) = data_url::DataUrl::process(uri.as_ref())
                .ok()
                .and_then(|url| {
                    let mime = url.mime_type();
                    let format =
                        ImageFormat::from_mime_type(&format!("{}/{}", mime.type_, mime.subtype))?;
                    let (bytes, _) = url.decode_to_vec().ok()?;
                    Some(Arc::new(Image::from_bytes(format, bytes)))
                })
            {
                images.insert(uri.to_string(), image.clone());
                return image.into();
            }
            uri.clone().into()
        }
    }
}
#[cfg(any(target_family = "wasm", feature = "native"))]
pub use view::ConversationImages;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9xkAAAAASUVORK5CYII=";
    #[test]
    fn references_bind_actual_image_content_not_text_or_claimed_urls() {
        let valid = json!({"type":"image","mimeType":"image/png","data":PNG});
        let image = InlineImage::from_content(&valid).unwrap();
        assert_eq!(
            image.uri,
            format!(
                "pero-image://{:x}",
                Sha256::digest(STANDARD.decode(PNG).unwrap())
            )
        );
        for value in [
            json!({"type":"text","text":valid.to_string()}),
            json!({"type":"image","mimeType":"image/jpeg","data":PNG}),
            json!({"type":"image","mimeType":"image/png","data":"https://example.org/image"}),
            json!({"type":"image","mimeType":"image/png","data":"AQID"}),
        ] {
            assert!(InlineImage::from_content(&value).is_none());
        }
    }
}
