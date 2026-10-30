//! Models, execution nodes and the GitHub connector live in Settings.
use crate::settings_view::{SettingsPanel, SettingsSection};
use gpui_kit::{component::tree::TreeItem, prelude::*, *};

pub(crate) fn navigation_roots(panel: &SettingsPanel, cx: &App) -> Vec<TreeItem> {
    let sections = panel.matching_sections(cx);
    let mut roots = Vec::new();
    if sections.contains(&SettingsSection::General) {
        roots.push(TreeItem::new(
            SettingsSection::General.key(),
            panel.t(SettingsSection::General.key()),
        ));
    }
    let children = sections
        .iter()
        .copied()
        .filter(|section| !section.exclusive())
        .map(|section| TreeItem::new(section.key(), panel.t(section.key())))
        .collect::<Vec<_>>();
    if !children.is_empty() {
        roots.push(
            TreeItem::new("settings.appearance", panel.t("settings.appearance"))
                .children(children)
                .expanded(true),
        );
    }
    for section in [
        SettingsSection::Agents,
        SettingsSection::Harness,
        SettingsSection::Workers,
        SettingsSection::Connections,
        SettingsSection::Mcp,
        SettingsSection::Computer,
    ] {
        if sections.contains(&section) {
            roots.push(TreeItem::new(section.key(), panel.t(section.key())));
        }
    }
    roots
}

impl SettingsPanel {
    pub(crate) fn category_page(
        &self,
        section: SettingsSection,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let Some(workbench) = self.workbench.as_ref().and_then(|host| host.upgrade()) else {
            return div().into_any_element();
        };
        workbench.update(cx, |workbench, cx| match section {
            SettingsSection::Agents => workbench.agent_settings(cx),
            SettingsSection::Workers => workbench.workers_view(cx).into_any_element(),
            SettingsSection::Connections => workbench.remote_connection_view(cx).into_any_element(),
            _ => div().into_any_element(),
        })
    }
}
