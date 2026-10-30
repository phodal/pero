use pero_contracts::computer_use::*;

/// Native control facts, before Pero's shared public action projection.
pub struct ObservedControl {
    pub index: u32,
    pub role: String,
    pub label: String,
    pub value: String,
    pub depth: u16,
    pub enabled: bool,
    pub secure: bool,
    pub invocable: bool,
}

impl ObservedControl {
    pub fn into_element(self) -> ComputerElement {
        let mut actions = Vec::new();
        if self.enabled && !self.secure {
            if self.invocable || self.role.contains("Button") {
                actions.push(ComputerActionKind::Click);
            }
            if self.role.contains("TextField")
                || self.role == "Edit"
                || self.role.contains("TextArea")
                || self.role.contains("ComboBox")
            {
                actions.extend([ComputerActionKind::TypeText, ComputerActionKind::PressKey]);
            }
            if self.role.contains("Scroll") {
                actions.push(ComputerActionKind::Scroll);
            }
        }
        ComputerElement {
            id: format!("element-{}", self.index).try_into().unwrap(),
            role: self.role,
            label: self.label,
            value: (!self.secure && !self.value.is_empty()).then_some(self.value),
            depth: self.depth,
            actions,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn control_actions_and_secure_values() {
        use ComputerActionKind::*;
        for (role, enabled, secure, expected) in [
            ("AXButton", true, false, vec![Click]),
            ("Edit", true, false, vec![TypeText, PressKey]),
            ("AXScrollArea", true, false, vec![Scroll]),
            ("Edit", true, true, vec![]),
            ("AXButton", false, false, vec![]),
        ] {
            let element = ObservedControl {
                index: 1,
                role: role.into(),
                label: "Owned control".into(),
                value: "secret".into(),
                depth: 0,
                enabled,
                secure,
                invocable: false,
            }
            .into_element();
            assert_eq!(
                element.actions, expected,
                "{role}: enabled={enabled}, secure={secure}"
            );
            assert_eq!(element.value.is_none(), secure);
        }
    }
}
