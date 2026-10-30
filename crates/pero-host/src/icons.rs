//! The Host imports packages and publishes one admitted theme state to every renderer.
use pero_contracts::{
    HostEvent,
    icon_theme::{IconThemeCommand, IconThemeState},
};
use pero_runtime::icon_themes::IconThemes;
use std::path::Path;
pub struct Icons {
    store: Option<IconThemes>,
    error: Option<String>,
}
impl Icons {
    pub fn new(path: Option<&Path>) -> Self {
        match path.map(IconThemes::load) {
            Some(Ok(store)) => Self {
                store: Some(store),
                error: None,
            },
            Some(Err(error)) => Self {
                store: None,
                error: Some(error),
            },
            None => Self {
                store: None,
                error: Some("Icon themes require a runtime settings path".into()),
            },
        }
    }
    pub fn snapshot(&self, request_id: Option<String>) -> HostEvent {
        let mut event = HostEvent::new(
            if self.error.is_some() {
                "icon_themes_error"
            } else {
                "icon_themes"
            },
            request_id,
            self.error.clone().unwrap_or_default(),
        );
        event.data = serde_json::to_value(
            self.store
                .as_ref()
                .map(IconThemes::state)
                .unwrap_or_default(),
        )
        .expect("icon theme snapshot");
        event
    }
    pub fn dispatch(&mut self, value: serde_json::Value) -> HostEvent {
        let command = match serde_json::from_value::<IconThemeCommand>(value) {
            Ok(command)
                if !command.request_id().is_empty() && command.request_id().len() <= 128 =>
            {
                command
            }
            _ => {
                let mut event = HostEvent::new(
                    "icon_themes_error",
                    None,
                    "Invalid icon theme request".into(),
                );
                event.data = serde_json::to_value(IconThemeState::default()).unwrap();
                return event;
            }
        };
        let request = Some(command.request_id().to_owned());
        if let Some(store) = &mut self.store {
            self.error = store.apply(command).err();
        }
        self.snapshot(request)
    }
}
