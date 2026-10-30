//! Installed vector glyphs and associations. Admission is the only SVG parser.
use crate::content_icon::{
    ContentIcon, ContentIconAssociation, ContentIconInput, ContentIconRegistry,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug)]
pub struct IconSvg {
    source: String,
    digest: u64,
}
impl IconSvg {
    fn admit(source: String) -> Result<Self, String> {
        let document = roxmltree::Document::parse(&source)
            .map_err(|error| format!("Invalid icon SVG: {error}"))?;
        let root = document.root_element();
        if document.descendants().any(|node| node.is_pi()) {
            return Err("SVG processing instructions are unsupported".into());
        }
        if root.tag_name().name() != "svg"
            || root.tag_name().namespace() != Some("http://www.w3.org/2000/svg")
        {
            return Err("An icon must be an SVG document with the SVG namespace".into());
        }
        const TAGS: &[&str] = &[
            "svg",
            "g",
            "path",
            "rect",
            "circle",
            "ellipse",
            "line",
            "polyline",
            "polygon",
            "defs",
            "linearGradient",
            "radialGradient",
            "stop",
            "clipPath",
            "mask",
            "use",
            "title",
            "desc",
        ];
        const ATTRIBUTES: &[&str] = &[
            "id",
            "viewBox",
            "width",
            "height",
            "x",
            "y",
            "x1",
            "x2",
            "y1",
            "y2",
            "cx",
            "cy",
            "r",
            "rx",
            "ry",
            "d",
            "points",
            "fill",
            "stroke",
            "stroke-width",
            "stroke-linecap",
            "stroke-linejoin",
            "stroke-miterlimit",
            "stroke-dasharray",
            "stroke-dashoffset",
            "fill-opacity",
            "stroke-opacity",
            "opacity",
            "fill-rule",
            "clip-rule",
            "clip-path",
            "mask",
            "transform",
            "gradientTransform",
            "gradientUnits",
            "spreadMethod",
            "offset",
            "stop-color",
            "stop-opacity",
            "preserveAspectRatio",
            "vector-effect",
            "color",
            "href",
            "maskUnits",
            "maskContentUnits",
            "clipPathUnits",
            "focusable",
            "aria-hidden",
            "role",
        ];
        for node in document.descendants().filter(roxmltree::Node::is_element) {
            if node.tag_name().namespace() != Some("http://www.w3.org/2000/svg")
                || !TAGS.contains(&node.tag_name().name())
            {
                return Err(format!(
                    "Unsupported SVG element: {}",
                    node.tag_name().name()
                ));
            }
            for attribute in node.attributes() {
                if !ATTRIBUTES.contains(&attribute.name()) {
                    return Err(format!("Unsupported SVG attribute: {}", attribute.name()));
                }
                let value = attribute.value();
                let lower = value.to_ascii_lowercase();
                if attribute.name() == "href" && !value.starts_with('#') {
                    return Err("SVG references must stay inside the icon".into());
                }
                if lower.contains("://")
                    || lower.contains("javascript:")
                    || lower.contains("data:")
                    || lower.contains("expression(")
                    || value.contains('\\')
                {
                    return Err("SVG cannot contain scripts or external resources".into());
                }
                if lower.contains("url(")
                    && !(value.starts_with("url(#")
                        && value.ends_with(')')
                        && value[5..value.len() - 1]
                            .chars()
                            .all(|ch| ch.is_ascii_alphanumeric() || "_-:.".contains(ch)))
                {
                    return Err("SVG URL references must be local fragments".into());
                }
            }
        }
        Ok(Self {
            digest: digest(source.as_bytes()),
            source,
        })
    }
    pub fn source(&self) -> &str {
        &self.source
    }
}
impl Serialize for IconSvg {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.source)
    }
}
impl<'de> Deserialize<'de> for IconSvg {
    // Wire snapshots are emitted by the Host after admission. Importers use parse().
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let source = String::deserialize(deserializer)?;
        Ok(Self {
            digest: digest(source.as_bytes()),
            source,
        })
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IconVariants {
    pub light: IconSvg,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dark: Option<IconSvg>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IconTheme {
    version: u8,
    pub id: String,
    pub name: String,
    pub icons: BTreeMap<String, IconVariants>,
    pub associations: BTreeMap<String, BTreeMap<String, String>>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Package {
    version: u8,
    id: String,
    name: String,
    icons: BTreeMap<String, RawVariants>,
    #[serde(default)]
    associations: BTreeMap<String, BTreeMap<String, String>>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawVariants {
    light: String,
    #[serde(default)]
    dark: Option<String>,
}
impl IconTheme {
    fn admit(package: Package) -> Result<Self, String> {
        let valid_id = |id: &str| {
            !id.is_empty()
                && id.len() <= 64
                && id
                    .chars()
                    .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || "_-".contains(ch))
        };
        if package.version != 1
            || !valid_id(&package.id)
            || package.name.trim().is_empty()
            || package.name.len() > 128
        {
            return Err("Icon theme needs version 1, a lowercase id and a readable name".into());
        }
        if package.icons.keys().any(|id| !valid_id(id)) {
            return Err(
                "Icon glyph ids must contain only lowercase letters, numbers, - or _".into(),
            );
        }
        let mut associations: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
        for (section, entries) in package.associations {
            for (selector, icon) in entries {
                let (section, selector) =
                    ContentIconAssociation::from_parts(&section, &selector)?.key()?;
                if !package.icons.contains_key(&icon) && ContentIcon::parse(&icon).is_err() {
                    return Err(format!("Unknown theme glyph: {icon}"));
                }
                if associations
                    .entry(section)
                    .or_default()
                    .insert(selector, icon)
                    .is_some()
                {
                    return Err("Duplicate normalized icon association".into());
                }
            }
        }
        let icons = package
            .icons
            .into_iter()
            .map(|(key, value)| {
                Ok((
                    key,
                    IconVariants {
                        light: IconSvg::admit(value.light)?,
                        dark: value.dark.map(IconSvg::admit).transpose()?,
                    },
                ))
            })
            .collect::<Result<_, String>>()?;
        Ok(Self {
            version: 1,
            id: package.id,
            name: package.name,
            icons,
            associations,
        })
    }
    pub fn parse(json: &str) -> Result<Self, String> {
        Self::admit(serde_json::from_str(json).map_err(|error| error.to_string())?)
    }
    /// A glyph may be bundled or theme-owned. The digest is the renderer cache identity.
    pub fn resolve(&self, input: ContentIconInput<'_>) -> Option<String> {
        ContentIconRegistry::resolve_with(input, |section, value, dark| {
            let key = value.trim().to_lowercase();
            let glyph = self.associations.get(section)?.get(&key)?;
            if let Some(variants) = self.icons.get(glyph) {
                let svg = if dark {
                    variants.dark.as_ref().unwrap_or(&variants.light)
                } else {
                    &variants.light
                };
                Some(format!(
                    "icon-themes/{}/{}/{:016x}.svg",
                    self.id, glyph, svg.digest
                ))
            } else {
                ContentIcon::parse(glyph)
                    .ok()
                    .map(|icon| format!("icons/{}.svg", icon.name()))
            }
        })
    }
    pub fn asset(&self, path: &str) -> Option<&str> {
        let mut parts = path.strip_prefix("icon-themes/")?.split('/');
        if parts.next()? != self.id {
            return None;
        }
        let variants = self.icons.get(parts.next()?)?;
        let hash = parts.next()?.strip_suffix(".svg")?;
        if parts.next().is_some() {
            return None;
        }
        let hash = u64::from_str_radix(hash, 16).ok()?;
        [
            &variants.light,
            variants.dark.as_ref().unwrap_or(&variants.light),
        ]
        .into_iter()
        .find(|svg| svg.digest == hash)
        .map(|svg| svg.source())
    }
}
fn digest(source: &[u8]) -> u64 {
    source.iter().fold(0xcbf29ce484222325, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
    })
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IconThemeInfo {
    pub id: String,
    pub name: String,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IconThemeState {
    pub installed: Vec<IconThemeInfo>,
    pub selected: Option<String>,
    pub theme: Option<IconTheme>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IconMethod {
    Icons,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum IconThemeCommand {
    Get {
        method: IconMethod,
        request_id: String,
    },
    Install {
        method: IconMethod,
        request_id: String,
        path: String,
    },
    Select {
        method: IconMethod,
        request_id: String,
        id: Option<String>,
    },
    Remove {
        method: IconMethod,
        request_id: String,
        id: String,
    },
}
impl IconThemeCommand {
    pub fn request_id(&self) -> &str {
        match self {
            Self::Get { request_id, .. }
            | Self::Install { request_id, .. }
            | Self::Select { request_id, .. }
            | Self::Remove { request_id, .. } => request_id,
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn vector_packages_are_local_safe_and_resolve_using_source_semantics() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs><path d="M0 0L24 24" fill="url(#g)"/></svg>"##;
        let json=serde_json::json!({"version":1,"id":"test","name":"Test","icons":{"rust":{"light":svg,"dark":svg.replace("red","blue")}},"associations":{"languages":{" Rust ":"rust"},"kinds":{"app":"layout-grid"}}}).to_string();
        let theme = IconTheme::parse(&json).unwrap();
        let input = ContentIconInput {
            language: Some("rust"),
            ..Default::default()
        };
        let light = theme.resolve(input).unwrap();
        let dark = theme
            .resolve(ContentIconInput {
                dark: true,
                ..input
            })
            .unwrap();
        assert_ne!(light, dark);
        assert_eq!(theme.asset(&light), Some(svg));
        assert!(theme.asset("icon-themes/other/rust/x.svg").is_none());
        assert!(
            theme
                .resolve(ContentIconInput {
                    language: Some("unknown"),
                    ..Default::default()
                })
                .is_none()
        );
        for svg in [
            "<svg/>",
            r#"<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>"#,
            r#"<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>"#,
            r#"<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.org/a.svg"/></svg>"#,
            r#"<svg xmlns="http://www.w3.org/2000/svg"><use href="https://example.org/a.svg#x"/></svg>"#,
            r#"<svg xmlns="http://www.w3.org/2000/svg"><path fill="url(https://example.org/)"/></svg>"#,
            r#"<!DOCTYPE svg [<!ENTITY a "test">]><svg xmlns="http://www.w3.org/2000/svg"/>"#,
        ] {
            assert!(IconSvg::admit(svg.into()).is_err(), "{svg}");
        }
        for (field, value) in [
            ("id", serde_json::json!("../bad")),
            ("version", serde_json::json!(2)),
            (
                "associations",
                serde_json::json!({"languages":{"rust":"missing"}}),
            ),
        ] {
            let mut broken: serde_json::Value = serde_json::from_str(&json).unwrap();
            broken[field] = value;
            assert!(IconTheme::parse(&broken.to_string()).is_err());
        }
    }
}
