use super::*;

/// An action admitted against values supplied by the Host. The Host must still
/// authorize the caller and re-check runtime/target liveness before native I/O.
#[derive(Debug)]
pub struct PreparedComputerAction(ComputerAction);
impl PreparedComputerAction {
    pub fn into_action(self) -> ComputerAction {
        self.0
    }
}

impl ComputerAction {
    pub fn prepare(
        self,
        observation: &ComputerObservation,
        capabilities: &ComputerCapabilities,
    ) -> Result<PreparedComputerAction, ComputerError> {
        use ComputerErrorCode::*;
        if self.target.runtime_id != capabilities.runtime_id {
            return Err(ComputerError::new(
                TargetUnavailable,
                "The runtime instance changed",
            ));
        }
        if self.target != observation.target || self.observation_id != observation.id {
            return Err(ComputerError::new(
                StaleObservation,
                "Observe the current target before acting",
            ));
        }
        let kind = self.input.kind();
        if !capabilities.actions.iter().any(|support| {
            support.action == kind
                && support.delivery == self.delivery
                && support.addressing.contains(&self.input.addressing())
        }) {
            return Err(ComputerError::new(
                Unsupported,
                "The requested action, delivery and addressing combination is not supported",
            ));
        }
        match &self.input {
            ComputerInput::Click { anchor, .. }
            | ComputerInput::TypeText { anchor, .. }
            | ComputerInput::PressKey { anchor, .. }
            | ComputerInput::Scroll { anchor, .. }
            | ComputerInput::Move { anchor, .. }
            | ComputerInput::LongPress { anchor, .. } => {
                observation.check_anchor(anchor, kind, capabilities)?
            }
            ComputerInput::SetValue { element_id, .. }
            | ComputerInput::PerformAction { element_id, .. } => {
                observation.check_anchor(
                    &ComputerAnchor::Element {
                        element_id: element_id.clone(),
                    },
                    kind,
                    capabilities,
                )?;
                if let ComputerInput::PerformAction { action, .. } = &self.input {
                    if !observation
                        .elements
                        .iter()
                        .any(|e| &e.id == element_id && e.semantic_actions.contains(action))
                    {
                        return Err(ComputerError::new(
                            Unsupported,
                            "The element does not advertise this semantic action",
                        ));
                    }
                }
            }
            ComputerInput::FocusWindow {} => {}
            ComputerInput::Drag {
                screenshot_id,
                from,
                to,
            } => {
                for point in [from, to] {
                    observation.check_pixel(screenshot_id, *point, capabilities)?;
                }
            }
        }
        if matches!(
            &self.input,
            ComputerInput::Scroll {
                delta_x: 0,
                delta_y: 0,
                ..
            }
        ) {
            return Err(ComputerError::new(
                InvalidRequest,
                "A scroll requires a nonzero delta",
            ));
        }
        Ok(PreparedComputerAction(self))
    }
}
impl ComputerInput {
    pub fn addressing(&self) -> ComputerAddressing {
        match self {
            Self::Click { anchor, .. }
            | Self::TypeText { anchor, .. }
            | Self::PressKey { anchor, .. }
            | Self::Scroll { anchor, .. }
            | Self::Move { anchor, .. }
            | Self::LongPress { anchor, .. } => match anchor {
                ComputerAnchor::Element { .. } => ComputerAddressing::Element,
                ComputerAnchor::Pixel { .. } => ComputerAddressing::Pixel,
            },
            Self::SetValue { .. } | Self::PerformAction { .. } => ComputerAddressing::Element,
            Self::FocusWindow {} => ComputerAddressing::Target,
            Self::Drag { .. } => ComputerAddressing::Pixel,
        }
    }
}
impl ComputerObservation {
    fn check_anchor(
        &self,
        anchor: &ComputerAnchor,
        kind: ComputerActionKind,
        capabilities: &ComputerCapabilities,
    ) -> Result<(), ComputerError> {
        use ComputerErrorCode::*;
        match anchor {
            ComputerAnchor::Element { element_id } => {
                if !capabilities
                    .observations
                    .contains(&ComputerObservationKind::Accessibility)
                {
                    return Err(ComputerError::new(
                        Unsupported,
                        "Accessibility observations are not supported",
                    ));
                }
                let mut found = self
                    .elements
                    .iter()
                    .filter(|element| &element.id == element_id);
                let Some(element) = found.next() else {
                    return Err(ComputerError::new(
                        StaleObservation,
                        "The element is absent from this observation",
                    ));
                };
                if found.next().is_some() {
                    return Err(ComputerError::new(
                        InvalidRequest,
                        "The observation contains an ambiguous element reference",
                    ));
                }
                if element.state.as_ref().is_some_and(|s| {
                    s.secure
                        || !s.enabled
                        || (kind == ComputerActionKind::SetValue && !s.value_settable)
                }) {
                    return Err(ComputerError::new(
                        Unsupported,
                        "The observed control is secure, disabled, or read-only",
                    ));
                }
                if !element.actions.contains(&kind) {
                    return Err(ComputerError::new(
                        Unsupported,
                        "The element does not support this action",
                    ));
                }
                Ok(())
            }
            ComputerAnchor::Pixel {
                screenshot_id,
                point,
            } => self.check_pixel(screenshot_id, *point, capabilities),
        }
    }
    fn check_pixel(
        &self,
        id: &ComputerRef,
        point: ComputerPoint,
        capabilities: &ComputerCapabilities,
    ) -> Result<(), ComputerError> {
        use ComputerErrorCode::*;
        if !capabilities
            .observations
            .contains(&ComputerObservationKind::Screenshot)
        {
            return Err(ComputerError::new(
                Unsupported,
                "Screenshot observations are not supported",
            ));
        }
        let Some(image) = self.screenshot.as_ref().filter(|image| &image.id == id) else {
            return Err(ComputerError::new(
                StaleObservation,
                "Observe the current screenshot before acting",
            ));
        };
        if point.x >= image.width.get() || point.y >= image.height.get() {
            return Err(ComputerError::new(
                InvalidRequest,
                "The point is outside the observed screenshot",
            ));
        }
        Ok(())
    }
}
