use computer_core::{ControlId, ObservedControl, WindowBounds};

/// Upper bounds for one observation; exceeding either marks the tree truncated.
pub const NODE_BUDGET: usize = 400;
pub const DEPTH_BUDGET: u16 = 32;

// AT-SPI `AtspiStateType` bit positions in the two-word state set.
const STATE_DEFUNCT: u32 = 6;
const STATE_ENABLED: u32 = 8;
const STATE_SENSITIVE: u32 = 24;
const STATE_SHOWING: u32 = 25;
const STATE_VISIBLE: u32 = 30;
// AT-SPI `AtspiRole` values that never expose their contents.
const ROLE_PASSWORD_TEXT: u32 = 40;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct States(pub [u32; 2]);
impl States {
    fn has(self, state: u32) -> bool {
        let word = (state / 32) as usize;
        word < 2 && self.0[word] & (1 << (state % 32)) != 0
    }
    pub fn defunct(self) -> bool {
        self.has(STATE_DEFUNCT)
    }
    pub fn rendered(self) -> bool {
        self.has(STATE_SHOWING) && self.has(STATE_VISIBLE)
    }
    pub fn actionable(self) -> bool {
        !self.defunct() && self.has(STATE_ENABLED) && self.has(STATE_SENSITIVE)
    }
}

/// Native facts of one accessible object, read before the shared projection.
#[derive(Clone, Debug)]
pub struct NodeFacts {
    pub role: u32,
    pub role_name: String,
    pub name: String,
    pub states: States,
    pub actions: Vec<String>,
}

/// Only an Action whose name invokes the control counts as a click. Activate,
/// expand or menu actions keep their own semantics and are not projected.
pub fn click_action(actions: &[String]) -> Option<i32> {
    ["click", "press"].iter().find_map(|wanted| {
        actions
            .iter()
            .position(|name| name.eq_ignore_ascii_case(wanted))
            .and_then(|index| i32::try_from(index).ok())
    })
}

impl NodeFacts {
    pub fn secure(&self) -> bool {
        self.role == ROLE_PASSWORD_TEXT || self.role_name.eq_ignore_ascii_case("password text")
    }
    /// Projects through the shared core. The role keeps the AT-SPI spelling so no
    /// other platform's role-name heuristics apply; only real Actions are invocable.
    pub fn control(&self, index: ControlId, depth: u16) -> (ObservedControl, Option<i32>) {
        let click = click_action(&self.actions).filter(|_| self.states.actionable());
        let label = if self.name.is_empty() {
            self.role_name.clone()
        } else {
            self.name.clone()
        };
        (
            ObservedControl {
                index,
                role: self.role_name.clone(),
                label,
                value: String::new(),
                depth,
                enabled: self.states.actionable(),
                secure: self.secure(),
                invocable: click.is_some(),
            },
            click,
        )
    }
}

/// Screen extents of an accessible frame.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Extents {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}
impl Extents {
    pub fn matches(self, bounds: WindowBounds) -> bool {
        const SLACK: f64 = 2.0;
        [
            (self.x, bounds.x),
            (self.y, bounds.y),
            (self.w, bounds.w),
            (self.h, bounds.h),
        ]
        .iter()
        .all(|(a, b)| (f64::from(*a) - b).abs() <= SLACK)
    }
}

/// Why a window has no accessible tree in an observation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Binding<T> {
    Bound(T),
    NoApplication,
    NoWindow,
    Ambiguous,
}

/// Binds an X11 window to exactly one accessible frame of the same process.
/// Two frames with matching geometry are refused instead of guessed.
pub fn bind<T: Clone>(
    candidates: &[(i32, Extents, T)],
    pid: i32,
    bounds: WindowBounds,
) -> Binding<T> {
    let owned: Vec<_> = candidates
        .iter()
        .filter(|(owner, ..)| *owner == pid)
        .collect();
    if owned.is_empty() {
        return Binding::NoApplication;
    }
    let mut hits = owned
        .iter()
        .filter(|(_, extents, _)| extents.matches(bounds));
    match (hits.next(), hits.next()) {
        (Some((.., value)), None) => Binding::Bound(value.clone()),
        (None, _) => Binding::NoWindow,
        _ => Binding::Ambiguous,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pero_contracts::computer_use::ComputerActionKind;

    fn states(bits: &[u32]) -> States {
        let mut words = [0u32; 2];
        for bit in bits {
            words[(*bit / 32) as usize] |= 1 << (bit % 32);
        }
        States(words)
    }
    fn live() -> States {
        states(&[STATE_ENABLED, STATE_SENSITIVE, STATE_SHOWING, STATE_VISIBLE])
    }
    fn node(role: u32, role_name: &str, states: States, actions: &[&str]) -> NodeFacts {
        NodeFacts {
            role,
            role_name: role_name.into(),
            name: "Owned".into(),
            states,
            actions: actions.iter().map(|a| a.to_string()).collect(),
        }
    }

    #[test]
    fn only_real_invoking_actions_project_to_click() {
        for (facts, clickable) in [
            (node(43, "push button", live(), &["click"]), true),
            (node(44, "check box", live(), &["Press"]), true),
            (node(43, "push button", live(), &[]), false),
            (node(36, "menu", live(), &["expand or contract"]), false),
            (
                node(43, "push button", states(&[STATE_SHOWING]), &["click"]),
                false,
            ),
            (
                node(
                    43,
                    "push button",
                    states(&[STATE_ENABLED, STATE_SENSITIVE, STATE_DEFUNCT]),
                    &["click"],
                ),
                false,
            ),
            (
                node(ROLE_PASSWORD_TEXT, "password text", live(), &["click"]),
                false,
            ),
        ] {
            let (control, action) = facts.control(ControlId(3), 1);
            let element = control.into_element();
            assert_eq!(
                element.actions.contains(&ComputerActionKind::Click),
                clickable,
                "{facts:?}"
            );
            assert!(element.value.is_none());
            if !clickable {
                assert!(element.actions.is_empty(), "{facts:?}");
            }
            assert_eq!(
                action.is_some(),
                facts.states.actionable() && click_action(&facts.actions).is_some()
            );
        }
    }

    #[test]
    fn text_roles_are_not_promoted_to_text_input() {
        // `activate` on an entry submits it; it is not projected as a click.
        let (control, action) = node(61, "text", live(), &["activate"]).control(ControlId(1), 0);
        let element = control.into_element();
        assert!(element.actions.is_empty());
        assert!(action.is_none());
        assert_eq!(element.role, "text");
    }

    #[test]
    fn binding_requires_one_frame_of_the_same_process() {
        let bounds = WindowBounds {
            x: 100.0,
            y: 100.0,
            w: 400.0,
            h: 300.0,
        };
        let at = |x| Extents {
            x,
            y: 101,
            w: 400,
            h: 299,
        };
        assert_eq!(
            bind(&[(7, at(100), "a"), (7, at(600), "b")], 7, bounds),
            Binding::Bound("a")
        );
        assert_eq!(
            bind(&[(8, at(100), "a")], 7, bounds),
            Binding::NoApplication
        );
        assert_eq!(bind(&[(7, at(600), "b")], 7, bounds), Binding::NoWindow);
        assert_eq!(
            bind(&[(7, at(100), "a"), (7, at(101), "b")], 7, bounds),
            Binding::Ambiguous
        );
        assert_eq!(
            bind::<&str>(&[(7, at(110), "a")], 7, bounds),
            Binding::NoWindow
        );
    }
}
