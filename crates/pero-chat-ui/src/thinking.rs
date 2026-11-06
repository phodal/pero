//! Independent reasoning disclosure and stable, deterministic one-line previews.
use std::collections::HashSet;
#[derive(Clone, Default)]
pub struct ThinkingState {
    active: Option<usize>,
    choices: HashSet<usize>,
}
impl ThinkingState {
    pub fn streaming(&mut self, thought: Option<usize>) {
        self.active = thought;
    }
    pub fn active(&self, index: usize) -> bool {
        self.active == Some(index)
    }
    pub fn open(&self, index: usize) -> bool {
        self.choices.contains(&index)
    }
    pub fn toggle(&mut self, index: usize) {
        if !self.choices.remove(&index) {
            self.choices.insert(index);
        }
    }
}

/// Running previews advance only after a paragraph's first line is complete.
pub fn reasoning_preview(text: &str, running: bool) -> String {
    let line = if running {
        let mut first = true;
        let mut summary = "";
        for line in text.split_inclusive('\n') {
            if !line.ends_with('\n') {
                break;
            }
            if line.trim().is_empty() {
                first = true;
            } else if first {
                summary = line.trim();
                first = false;
            }
        }
        summary
    } else {
        text.lines()
            .find(|line| !line.trim().is_empty())
            .unwrap_or_default()
    };
    crate::tool_activity::preview(&line.replace("**", ""), 160)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reasoning_disclosure_and_preview() {
        let mut state = ThinkingState::default();
        for active in [Some(0), None, Some(1)] {
            state.streaming(active);
            assert!(!state.open(0));
        }
        state.toggle(0);
        state.streaming(None);
        assert!(state.open(0));
        state.toggle(0);
        assert!(!state.open(0));
        for (text, running, expected) in [
            ("unfinished", true, ""),
            ("First\n\nPending", true, "First"),
            ("First\r\n\r\nSecond\r\n", true, "Second"),
            ("**Read files**\nInspect", true, "Read files"),
            ("First\nDetails\n\nSecond", true, "First"),
            ("First\nDetails\n\nSecond\nMore", true, "Second"),
            ("First\nDetails\n\nSecond\nMore", false, "First"),
            ("\n  \n", false, ""),
        ] {
            assert_eq!(reasoning_preview(text, running), expected);
        }
    }
}
