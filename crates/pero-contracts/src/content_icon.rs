//! Content meaning resolves to a bundled glyph independently of either renderer.
use crate::content_document::ContentFormat;
use std::collections::BTreeMap;
mod data {
    include!("content_icon_data.rs");
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ContentIconKind {
    #[default]
    File,
    Text,
    Code,
    Markdown,
    Json,
    JsonLines,
    App,
    Web,
    Image,
}
impl ContentIconKind {
    fn parse(value: &str) -> Option<Self> {
        [
            Self::File,
            Self::Text,
            Self::Code,
            Self::Markdown,
            Self::Json,
            Self::JsonLines,
            Self::App,
            Self::Web,
            Self::Image,
        ]
        .into_iter()
        .find(|kind| kind.key() == value)
    }
    fn key(self) -> &'static str {
        match self {
            Self::File => "file",
            Self::Text => "text",
            Self::Code => "code",
            Self::Markdown => "markdown",
            Self::Json => "json",
            Self::JsonLines => "json_lines",
            Self::App => "app",
            Self::Web => "web",
            Self::Image => "image",
        }
    }
}
#[derive(Clone, Copy, Debug, Default)]
pub struct ContentIconInput<'a> {
    pub kind: ContentIconKind,
    pub language: Option<&'a str>,
    pub path: Option<&'a str>,
    pub app: Option<&'a str>,
    pub dark: bool,
}
impl<'a> ContentIconInput<'a> {
    pub fn document(format: &'a ContentFormat, path: &'a str, dark: bool) -> Self {
        let (kind, language) = match format {
            ContentFormat::Json => (ContentIconKind::Json, None),
            ContentFormat::JsonLines => (ContentIconKind::JsonLines, None),
            ContentFormat::Markdown => (ContentIconKind::Markdown, None),
            ContentFormat::Code(language) => (ContentIconKind::Code, Some(language.as_str())),
            ContentFormat::Text => (ContentIconKind::Text, None),
        };
        Self {
            kind,
            language,
            path: Some(path),
            dark,
            ..Default::default()
        }
    }
}

/// A validated catalog name; extensions cannot load arbitrary SVG or URLs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ContentIcon(&'static str);
impl ContentIcon {
    pub fn parse(name: &str) -> Result<Self, String> {
        data::canonical(name)
            .map(Self)
            .ok_or_else(|| "Content icons must use a bundled glyph".into())
    }
    pub fn name(self) -> &'static str {
        self.0
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ContentIconAssociation {
    Kind(ContentIconKind),
    Language(String),
    Filename(String),
    Extension(String),
    App(String),
}
impl ContentIconAssociation {
    pub fn from_parts(section: &str, value: &str) -> Result<Self, String> {
        let value = value.trim().to_lowercase();
        match section {
            "kinds" => ContentIconKind::parse(&value)
                .map(Self::Kind)
                .ok_or_else(|| "Unknown content icon kind".into()),
            "languages" => Ok(Self::Language(value)),
            "filenames" => Ok(Self::Filename(value)),
            "extensions" => Ok(Self::Extension(value)),
            "apps" => Ok(Self::App(value)),
            _ => Err("Unknown content icon association section".into()),
        }
    }
    pub(crate) fn key(self) -> Result<(String, String), String> {
        let (section, value) = match self {
            Self::Kind(kind) => ("kinds", kind.key().to_owned()),
            Self::Language(value) => ("languages", value),
            Self::Filename(value) => ("filenames", value),
            Self::Extension(value) => ("extensions", value),
            Self::App(value) => ("apps", value),
        };
        let value = value.trim().to_lowercase();
        let value = if section == "extensions" {
            value.strip_prefix('.').unwrap_or(&value).to_owned()
        } else {
            value
        };
        if value.is_empty() {
            return Err("A content icon association needs a value".into());
        }
        Ok((section.into(), value))
    }
}
#[derive(Clone, Copy)]
struct ThemeIcon {
    light: ContentIcon,
    dark: ContentIcon,
}
#[derive(Default)]
pub struct ContentIconRegistry {
    overrides: BTreeMap<(String, String), ThemeIcon>,
}
impl ContentIconRegistry {
    pub fn register(
        &mut self,
        association: ContentIconAssociation,
        light: ContentIcon,
        dark: Option<ContentIcon>,
    ) -> Result<(), String> {
        self.overrides.insert(
            association.key()?,
            ThemeIcon {
                light,
                dark: dark.unwrap_or(light),
            },
        );
        Ok(())
    }
    pub fn remove(&mut self, association: ContentIconAssociation) -> Result<bool, String> {
        Ok(self.overrides.remove(&association.key()?).is_some())
    }
    fn lookup(&self, section: &str, value: &str, dark: bool) -> Option<ContentIcon> {
        let value = value.trim().to_lowercase();
        self.overrides
            .get(&(section.into(), value.clone()))
            .map(|icon| if dark { icon.dark } else { icon.light })
            .or_else(|| data::lookup(section, &value).map(ContentIcon))
    }
    pub fn resolve(&self, input: ContentIconInput<'_>) -> ContentIcon {
        Self::resolve_with(input, |section, value, dark| {
            self.lookup(section, value, dark)
        })
        .unwrap_or(ContentIcon("file"))
    }
    /// One source precedence rule is shared by built-in and installed glyphs.
    pub fn resolve_with<T>(
        input: ContentIconInput<'_>,
        mut lookup: impl FnMut(&str, &str, bool) -> Option<T>,
    ) -> Option<T> {
        if input.kind == ContentIconKind::App || input.app.is_some() {
            return lookup("apps", input.app.unwrap_or_default(), input.dark)
                .or_else(|| lookup("kinds", "app", input.dark));
        }
        if let Some(language) = input.language {
            if let Some(icon) = lookup("languages", language, input.dark) {
                return Some(icon);
            }
        }
        if !matches!(
            input.kind,
            ContentIconKind::File | ContentIconKind::Text | ContentIconKind::Code
        ) {
            return lookup("kinds", input.kind.key(), input.dark);
        }
        let filename = input
            .path
            .unwrap_or_default()
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or_default()
            .to_lowercase();
        if let Some(icon) = lookup("filenames", &filename, input.dark) {
            return Some(icon);
        }
        for (dot, _) in filename.match_indices('.') {
            if let Some(icon) = lookup("extensions", &filename[dot + 1..], input.dark) {
                return Some(icon);
            }
        }
        lookup("kinds", input.kind.key(), input.dark)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn content_associations_keep_format_authority_and_reversible_theme_overrides() {
        let mut registry = ContentIconRegistry::default();
        for (input, expected) in [
            (
                ContentIconInput::document(&ContentFormat::Code("Rust".into()), "script.py", false),
                "file-cog",
            ),
            (
                ContentIconInput::document(&ContentFormat::Json, "misnamed.rs", false),
                "file-braces",
            ),
            (
                ContentIconInput::document(&ContentFormat::JsonLines, "records", false),
                "file-spreadsheet",
            ),
            (
                ContentIconInput::document(&ContentFormat::Markdown, "README", false),
                "book-open-text",
            ),
            (
                ContentIconInput {
                    path: Some("C:\\Work\\TYPES.D.TS"),
                    ..Default::default()
                },
                "file-type",
            ),
            (
                ContentIconInput {
                    path: Some("/work/.gitignore"),
                    ..Default::default()
                },
                "git-branch",
            ),
            (
                ContentIconInput {
                    kind: ContentIconKind::Code,
                    language: Some("new-language"),
                    ..Default::default()
                },
                "file-code",
            ),
            (
                ContentIconInput {
                    path: Some("/work/unknown.suffix"),
                    ..Default::default()
                },
                "file",
            ),
            (
                ContentIconInput {
                    kind: ContentIconKind::App,
                    app: Some("paper-agent"),
                    ..Default::default()
                },
                "book-open-text",
            ),
            (
                ContentIconInput {
                    kind: ContentIconKind::App,
                    app: Some("third-party"),
                    ..Default::default()
                },
                "layout-grid",
            ),
        ] {
            assert_eq!(registry.resolve(input).name(), expected);
        }
        registry
            .register(
                ContentIconAssociation::Extension(" .RESULT.JSON ".into()),
                ContentIcon::parse("database").unwrap(),
                Some(ContentIcon::parse("network").unwrap()),
            )
            .unwrap();
        let input = ContentIconInput {
            path: Some("/work/run.RESULT.JSON"),
            ..Default::default()
        };
        assert_eq!(registry.resolve(input).name(), "database");
        assert_eq!(
            registry
                .resolve(ContentIconInput {
                    dark: true,
                    ..input
                })
                .name(),
            "network"
        );
        registry
            .remove(ContentIconAssociation::Extension("result.json".into()))
            .unwrap();
        assert_eq!(registry.resolve(input).name(), "file-braces");
        assert!(
            registry
                .register(
                    ContentIconAssociation::Language(" ".into()),
                    ContentIcon::parse("code").unwrap(),
                    None
                )
                .is_err()
        );
        assert!(ContentIcon::parse("https://example.test/icon.svg").is_err());
    }
}
