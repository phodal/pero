//! Durable decisions about which trusted builtin identities have been offered.
use super::AppName;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct BuiltinDiscovery {
    seen: BTreeSet<AppName>,
}

impl BuiltinDiscovery {
    pub fn migrate(legacy_seeded: bool, installed: impl Iterator<Item = AppName>) -> Self {
        let mut seen: BTreeSet<_> = installed.collect();
        if legacy_seeded {
            // The first one-time catalog shipped Virtual Cell. Preserve an old
            // removal even when its installed directory no longer exists.
            seen.insert(AppName::try_from("virtual-cell".to_owned()).unwrap());
        }
        Self { seen }
    }

    pub fn should_install(&self, name: &AppName, installed: bool) -> bool {
        !installed && !self.seen.contains(name)
    }

    pub fn record(&mut self, name: AppName) -> bool {
        self.seen.insert(name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_discovery_decisions() {
        for (legacy, installed, recorded, candidate, expected) in [
            (false, false, false, "paper-agent", true),
            (true, false, false, "paper-agent", true),
            (true, false, false, "virtual-cell", false),
            (false, true, false, "paper-agent", false),
            (false, false, true, "paper-agent", false),
        ] {
            let name = AppName::try_from(candidate.to_owned()).unwrap();
            let mut discovery = BuiltinDiscovery::migrate(legacy, std::iter::empty());
            if recorded {
                discovery.record(name.clone());
            }
            assert_eq!(
                discovery.should_install(&name, installed),
                expected,
                "{legacy}/{installed}/{recorded}/{candidate}"
            );
        }
    }
}
