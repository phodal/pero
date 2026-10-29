//! Follow the current streamed thought while preserving deliberate user choices.
use std::collections::HashMap;
#[derive(Clone, Default)]
pub struct ThinkingState {
    active: Option<usize>,
    choices: HashMap<usize, bool>,
}
impl ThinkingState {
    pub fn streaming(&mut self, thought: Option<usize>) {
        self.active = thought;
    }
    pub fn open(&self, index: usize) -> bool {
        self.choices
            .get(&index)
            .copied()
            .unwrap_or(self.active == Some(index))
    }
    pub fn toggle(&mut self, index: usize) {
        self.choices.insert(index, !self.open(index));
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn automatic_expansion_respects_manual_choices() {
        let mut state = ThinkingState::default();
        for (active, toggle, expected) in [
            (Some(0), None, true),
            (None, None, false),
            (None, Some(0), true),
            (Some(1), None, true),
            (Some(1), Some(1), false),
            (Some(1), None, false),
        ] {
            state.streaming(active);
            if let Some(index) = toggle {
                state.toggle(index);
            }
            let index = active.unwrap_or(0);
            assert_eq!(state.open(index), expected);
        }
        state.streaming(None);
        assert!(state.open(0));
        assert!(!state.open(1));
    }
}
