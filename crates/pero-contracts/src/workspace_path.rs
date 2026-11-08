//! Workspace spelling compatibility, without filesystem access or path rewriting.

/// A saved or observed workspace path. Ordinary Windows paths and their legacy
/// verbatim spellings identify the same directory, including in a Wasm renderer.
/// This is not an authorization or filesystem canonicalization operation.
pub struct WorkspacePath<'a>(pub &'a str);

impl WorkspacePath<'_> {
    /// Compare canonical spellings while preserving paths that need verbatim
    /// semantics. Do not fold case, resolve symlinks, or change POSIX separators.
    pub fn matches(&self, other: &str) -> bool {
        self.0 == other || ordinary(self.0) == ordinary(other)
    }
}

fn ordinary(path: &str) -> &str {
    let Some(drive) = path.strip_prefix(r"\\?\") else {
        return path;
    };
    let bytes = drive.as_bytes();
    if bytes.len() < 3 || !bytes[0].is_ascii_alphabetic() || &bytes[1..3] != b":\\" {
        return path;
    }
    // Only reconcile paths that can use ordinary Win32 syntax. Verbatim names
    // such as `name.`, `NUL`, or literal `..` must remain distinct.
    if drive.encode_utf16().count() >= 260
        || drive[3..].split('\\').any(|part| {
            let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
            part.ends_with(['.', ' '])
                || part
                    .chars()
                    .any(|c| c.is_control() || "<>:\"/|?*".contains(c))
                || matches!(
                    stem.as_str(),
                    "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
                )
                || ["COM", "LPT"].iter().any(|prefix| {
                    stem.strip_prefix(prefix).is_some_and(|suffix| {
                        matches!(
                            suffix,
                            "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                        )
                    })
                })
        })
    {
        return path;
    }
    drive
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_identity_reconciles_only_equivalent_spellings() {
        for (saved, observed, same) in [
            (r"\\?\C:\work\pero", r"C:\work\pero", true),
            (r"\\?\F:\research folder", r"F:\research folder", true),
            (r"\\?\C:\", r"C:\", true),
            (r"C:\work\pero", r"C:\work\pero", true),
            (r"\\?\C:\work\pero", r"D:\work\pero", false),
            (r"\\?\C:\work\pero", r"C:\other\pero", false),
            (r"\\?\C:\name.", r"C:\name.", false),
            (r"\\?\C:\name ", r"C:\name ", false),
            (r"\\?\C:\NUL.txt", r"C:\NUL.txt", false),
            (r"\\?\C:\COM1", r"C:\COM1", false),
            (r"\\?\C:\CONIN$", r"C:\CONIN$", false),
            (r"\\?\C:\CONOUT$", r"C:\CONOUT$", false),
            (r"\\?\C:\a\..\b", r"C:\a\..\b", false),
            (r"\\?\C:\a/b", r"C:\a/b", false),
            (r"\\?\UNC\server\share", r"\\server\share", false),
            (r"\\?\Volume{test}\", r"Volume{test}\", false),
            ("/work/pero", "/work/pero", true),
            ("/work/pero", "/work/Pero", false),
            (r"/work/a\b", "/work/a/b", false),
        ] {
            assert_eq!(WorkspacePath(saved).matches(observed), same, "{saved}");
            assert_eq!(WorkspacePath(observed).matches(saved), same, "{observed}");
        }
        for (path, units, same) in [
            (format!("C:\\x\\{}", "a".repeat(254)), 259, true),
            (format!("C:\\x\\{}", "a".repeat(255)), 260, false),
            (format!("C:\\x\\{}", "😀".repeat(127)), 259, true),
            (format!("C:\\x\\{}a", "😀".repeat(127)), 260, false),
        ] {
            assert_eq!(path.encode_utf16().count(), units);
            let verbatim = format!(r"\\?\{path}");
            assert_eq!(WorkspacePath(&verbatim).matches(&path), same, "{units} UTF-16 units");
            assert_eq!(WorkspacePath(&path).matches(&verbatim), same, "{units} UTF-16 units");
        }
    }
}
