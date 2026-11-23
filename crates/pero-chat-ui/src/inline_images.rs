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
    media_type: String,
}
impl InlineImage {
    pub fn from_content(value: &Value) -> Option<Self> {
        #[derive(Deserialize)]
        struct Content<'a> {
            #[serde(rename = "type")]
            kind: &'a str,
            #[serde(rename = "mimeType")]
            mime_type: &'a str,
            data: &'a str,
        }
        let image = Content::deserialize(value).ok()?;
        if image.kind != "image" || image.data.len() > MAX_IMAGE_BYTES.div_ceil(3) * 4 {
            return None;
        }
        let format = match image.mime_type {
            "image/png" => image::ImageFormat::Png,
            "image/jpeg" => image::ImageFormat::Jpeg,
            _ => return None,
        };
        let bytes = STANDARD.decode(image.data).ok()?;
        if bytes.len() > MAX_IMAGE_BYTES {
            return None;
        }
        let (width, height) = image::ImageReader::with_format(std::io::Cursor::new(&bytes), format)
            .into_dimensions()
            .ok()?;
        if !(1..=2048).contains(&width) || !(1..=2048).contains(&height) {
            return None;
        }
        Some(Self {
            uri: format!("pero-image://{:x}", Sha256::digest(&bytes)),
            bytes,
            media_type: image.mime_type.to_owned(),
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
    pub struct ConversationImages(Arc<Mutex<ImageSet>>);
    #[derive(Default)]
    struct ImageSet {
        images: HashMap<String, Arc<Image>>,
        references: crate::image_references::ImageReferences,
    }
    impl ConversationImages {
        pub fn observe(&self, output: &[Value]) -> Vec<Arc<Image>> {
            let mut registry = self.0.lock().expect("conversation images");
            let mut uris = Vec::new();
            let mut images = Vec::new();
            for item in output {
                // Only actual ACP image content is eligible. JSON prose and
                // arbitrary document URLs cannot register a conversation image.
                if item["type"] != "content" {
                    continue;
                }
                if let Some(image) = InlineImage::from_content(&item["content"]) {
                    let format = ImageFormat::from_mime_type(&image.media_type).unwrap();
                    uris.push(image.uri.clone());
                    let rendered = registry
                        .images
                        .entry(image.uri)
                        .or_insert_with(|| Arc::new(Image::from_bytes(format, image.bytes)));
                    images.push(rendered.clone());
                }
            }
            registry.references.observe(output, &uris);
            images
        }
        pub fn link_markdown(&self, source: &str) -> String {
            self.0
                .lock()
                .expect("conversation images")
                .references
                .link_markdown(source)
        }
        pub fn resolve(&self, uri: &SharedUri) -> ImageSource {
            let mut registry = self.0.lock().expect("conversation images");
            let images = &mut registry.images;
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
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new(&mut jpeg)
            .encode(&[0, 0, 0], 1, 1, image::ExtendedColorType::Rgb8)
            .unwrap();
        let valid_jpeg =
            json!({"type":"image","mimeType":"image/jpeg","data":STANDARD.encode(&jpeg)});
        let preview = InlineImage::from_content(&valid_jpeg).unwrap();
        assert_eq!(preview.bytes, jpeg);
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
