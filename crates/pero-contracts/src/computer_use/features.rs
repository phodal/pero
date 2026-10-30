use super::*;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(try_from = "String", into = "String")]
pub struct ComputerValue(String);
impl TryFrom<String> for ComputerValue {
    type Error = &'static str;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.chars().count() > 10000 {
            return Err("Replacement exceeds 10000 characters");
        }
        Ok(Self(value))
    }
}
impl From<ComputerValue> for String {
    fn from(value: ComputerValue) -> Self {
        value.0
    }
}
impl ComputerValue {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ComputerSemanticAction {
    Press,
    Open,
    Confirm,
    Cancel,
    ShowMenu,
    ScrollToVisible,
    Increment,
    Decrement,
}
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ComputerElementState {
    pub enabled: bool,
    pub secure: bool,
    pub focused: bool,
    pub value_settable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expanded: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(untagged)]
pub enum ComputerApplicationSelector {
    Name(ComputerApplication),
    Bundle(ComputerBundleSelector),
}
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ComputerBundleSelector {
    BundleId { bundle_id: ComputerApplication },
}
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ComputerSubtree {
    pub observation_id: ComputerRef,
    pub element_id: ComputerRef,
}

macro_rules! budget {
    ($name:ident, $max:literal) => {
        #[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
        #[serde(try_from = "u16", into = "u16")]
        pub struct $name(u16);
        impl TryFrom<u16> for $name {
            type Error = &'static str;
            fn try_from(value: u16) -> Result<Self, Self::Error> {
                if value == 0 || value > $max {
                    return Err("Invalid observation budget");
                }
                Ok(Self(value))
            }
        }
        impl From<$name> for u16 {
            fn from(value: $name) -> u16 {
                value.0
            }
        }
    };
}
budget!(ComputerNodeBudget, 4096);
budget!(ComputerDepthBudget, 64);

macro_rules! computer_millis {
    ($name:ident, $min:expr, $max:expr, $message:expr) => {
        #[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
        #[serde(try_from = "u16", into = "u16")]
        pub struct $name(u16);
        impl TryFrom<u16> for $name {
            type Error = &'static str;
            fn try_from(value: u16) -> Result<Self, Self::Error> {
                if !($min..=$max).contains(&value) {
                    return Err($message);
                }
                Ok(Self(value))
            }
        }
        impl From<$name> for u16 {
            fn from(value: $name) -> Self {
                value.0
            }
        }
        impl $name {
            pub fn duration(self) -> std::time::Duration {
                std::time::Duration::from_millis(u64::from(self.0))
            }
        }
    };
}
computer_millis!(ComputerDwellMs, 0, 5000, "A hover dwell is 0–5000 ms");
computer_millis!(ComputerHoldMs, 1, 10000, "A hold lasts 1–10000 ms");
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ComputerObserveOptions {
    #[serde(default = "want_image")]
    pub want_image: bool,
    #[serde(default = "node_budget")]
    pub max_nodes: ComputerNodeBudget,
    #[serde(default = "depth_budget")]
    pub max_depth: ComputerDepthBudget,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root: Option<ComputerSubtree>,
}
fn want_image() -> bool {
    true
}
fn node_budget() -> ComputerNodeBudget {
    ComputerNodeBudget(1200)
}
fn depth_budget() -> ComputerDepthBudget {
    ComputerDepthBudget(32)
}
impl Default for ComputerObserveOptions {
    fn default() -> Self {
        Self {
            want_image: true,
            max_nodes: node_budget(),
            max_depth: depth_budget(),
            root: None,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ComputerExecutionRoute {
    Semantic,
    WindowEvent,
    ForegroundEvent,
}
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ComputerExecution {
    pub route: ComputerExecutionRoute,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub semantic_action: Option<ComputerSemanticAction>,
}
