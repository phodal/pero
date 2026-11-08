//! Workspace names shown by the composer, independent of the rendering platform.
pub(super) fn label(path: &str) -> &str {
    path.rsplit(['/', '\\'])
        .find(|part| !part.is_empty())
        .unwrap_or(if path.is_empty() { "Workspace" } else { path })
}

#[cfg(test)]
mod tests {
    #[test]
    fn workspace_labels() {
        for (path, expected) in [
            ("", "Workspace"),
            ("/", "/"),
            ("/home/project/", "project"),
            ("project", "project"),
            (r"C:\", "C:"),
            ("C:/", "C:"),
            (r"C:\projects\pero", "pero"),
            (r"C:\projects\pero\", "pero"),
            (r"\\?\C:\", "C:"),
            (r"\\server\share\", "share"),
            (r"\\?\UNC\server\share\project\", "project"),
        ] {
            assert_eq!(super::label(path), expected, "{path:?}");
        }
    }
}
