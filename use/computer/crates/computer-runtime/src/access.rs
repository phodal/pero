//! The host's per-request application authority, independent of window handles.
use crate::error;
use pero_contracts::computer_use::{
    ComputerApplicationSelector, ComputerBundleSelector, ComputerError, ComputerErrorCode,
    ComputerRef,
};

#[derive(Clone, Copy)]
pub(crate) enum ApplicationAccess<'a> {
    Unrestricted,
    Allowed(&'a [ComputerRef]),
}

impl ApplicationAccess<'_> {
    pub(crate) fn allows(self, application_id: &str) -> bool {
        match self {
            Self::Unrestricted => true,
            Self::Allowed(applications) => {
                applications.iter().any(|id| id.as_str() == application_id)
            }
        }
    }

    pub(crate) fn require(self, application_id: &str) -> Result<(), ComputerError> {
        if self.allows(application_id) {
            return Ok(());
        }
        Err(error(
            ComputerErrorCode::PermissionRequired,
            "Allow this application in Pero Settings → Computer Use.",
        ))
    }

    pub(crate) fn require_open(
        self,
        application: &ComputerApplicationSelector,
    ) -> Result<(), ComputerError> {
        match application {
            ComputerApplicationSelector::Bundle(ComputerBundleSelector::BundleId { bundle_id }) => {
                self.require(bundle_id.as_str())
            }
            ComputerApplicationSelector::Name(_) if matches!(self, Self::Unrestricted) => Ok(()),
            ComputerApplicationSelector::Name(_) => Err(error(
                ComputerErrorCode::PermissionRequired,
                "Open an allowed application by its exact bundle_id. Manage access in Pero Settings → Computer Use.",
            )),
        }
    }
}
