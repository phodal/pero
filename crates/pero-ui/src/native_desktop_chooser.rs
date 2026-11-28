use crate::{
    app::Workbench, native_run_desktop::RunDesktopTarget, projects::ProjectTab,
    workspace::WorkbenchPage,
};
use gpui_kit::{
    component::{Disableable, Icon, Sizable, button::*},
    prelude::*,
    *,
};
use serde_json::json;

struct DesktopChooser {
    owner: WeakEntity<Workbench>,
}

pub(crate) fn install(workbench: &Entity<Workbench>, cx: &mut App) {
    let chooser = cx.new(|cx| {
        cx.observe(workbench, |_, _, cx| cx.notify()).detach();
        DesktopChooser {
            owner: workbench.downgrade(),
        }
    });
    workbench.read(cx).chat.clone().update(cx, |chat, cx| {
        chat.native_desktop_pane = Some(AnyView::from(chooser));
        cx.notify();
    });
}

impl Render for DesktopChooser {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(owner) = self.owner.upgrade() else {
            return div().id("native-desktop-chooser");
        };
        let workbench = owner.read(cx);
        let palette = &pero_theme::UiAppearance::global(cx).palette;
        let remote = &workbench.remote;
        let body = div().id("native-desktop-chooser").size_full();
        if let Some(attached) = &remote.run_desktop.attached {
            let view = remote.run_desktop.view.clone();
            let back = self.owner.clone();
            let open = self.owner.clone();
            let task = attached.target.task_id.clone();
            let watch = attached.watch(remote);
            let status = if let Some(error) = watch.and_then(|watch| watch["error"].as_str()) {
                error
            } else if watch.is_some_and(|watch| watch["detail"].is_object()) {
                workbench.t("run_desktop.ended")
            } else {
                workbench.t("linux_desktop.connecting")
            };
            return body
                .flex()
                .flex_col()
                .min_h_0()
                .child(
                    div()
                        .flex()
                        .flex_shrink_0()
                        .items_center()
                        .justify_between()
                        .gap_2()
                        .px_3()
                        .py_2()
                        .border_b_1()
                        .border_color(palette.border)
                        .child(
                            Button::new("back-to-running-desktops")
                                .ghost()
                                .small()
                                .icon(Icon::default().path("icons/arrow-left.svg"))
                                .label(workbench.t("run_desktop.running_desktops"))
                                .on_click(move |_, _, cx| {
                                    let _ = back
                                        .update(cx, |this, cx| this.close_conversation_desktop(cx));
                                }),
                        )
                        .child(
                            Button::new("view-desktop-run")
                                .ghost()
                                .small()
                                .label(workbench.t("run_desktop.view_run"))
                                .on_click(move |_, _, cx| {
                                    let _ = open.update(cx, |this, cx| {
                                        this.close_conversation_desktop(cx);
                                        this.open_task(task.clone(), cx);
                                    });
                                }),
                        ),
                )
                .when(view.is_none(), |el| {
                    el.child(
                        div()
                            .p_3()
                            .text_sm()
                            .text_color(palette.text_muted)
                            .child(status.to_owned()),
                    )
                })
                .children(view);
        }
        let body = body.overflow_y_scroll().p_4();
        let connected = remote.configured();
        let loading = remote.loading();
        let sessions = remote
            .tasks()
            .iter()
            .filter_map(|task| {
                let target = RunDesktopTarget::from_summary(remote, task)?;
                let title = task["title"].as_str()?.to_owned();
                let worker = remote
                    .workers()
                    .iter()
                    .find(|worker| worker["current_run_id"] == target.run_id)
                    .and_then(|worker| worker["name"].as_str())
                    .map(str::to_owned);
                Some((target, title, worker))
            })
            .collect::<Vec<_>>();
        let empty = sessions.is_empty();
        let refresh = self.owner.clone();
        let configure = self.owner.clone();
        let browse = self.owner.clone();

        body.child(
            div()
                .flex()
                .flex_col()
                .gap_3()
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .child(
                            div()
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(workbench.t("run_desktop.running_desktops")),
                        )
                        .when(connected, |el| {
                            el.child(
                                Button::new("refresh-running-desktops")
                                    .ghost()
                                    .small()
                                    .icon(Icon::default().path("icons/refresh.svg"))
                                    .tooltip(workbench.t("remote.refresh"))
                                    .accessibility_label(workbench.t("remote.refresh"))
                                    .disabled(loading)
                                    .on_click(move |_, _, cx| {
                                        let _ = refresh.update(cx, |this, cx| {
                                            this.command(json!({"action":"remote_refresh"}), cx)
                                        });
                                    }),
                            )
                        }),
                )
                .when(!connected, |el| {
                    el.child(
                        div()
                            .text_sm()
                            .text_color(palette.text_muted)
                            .child(workbench.t("run_desktop.connect_hint")),
                    )
                    .child(
                        div().child(
                            Button::new("connect-desktop-service")
                                .outline()
                                .small()
                                .label(workbench.t("run_desktop.connect_service"))
                                .on_click(move |_, window, cx| {
                                    let _ = configure.update(cx, |this, cx| {
                                        this.show_settings_page(
                                            WorkbenchPage::Connections,
                                            window,
                                            cx,
                                        )
                                    });
                                }),
                        ),
                    )
                })
                .when_some(
                    remote.data["error"].as_str().map(str::to_owned),
                    |el, error| {
                        el.child(div().text_sm().text_color(palette.text_muted).child(error))
                    },
                )
                .when(connected && loading && empty, |el| {
                    el.child(
                        div()
                            .text_sm()
                            .text_color(palette.text_muted)
                            .child(workbench.t("remote.refreshing")),
                    )
                })
                .when(
                    connected && !loading && empty && remote.data["error"].is_null(),
                    |el| {
                        el.child(
                            div()
                                .text_sm()
                                .text_color(palette.text_muted)
                                .child(workbench.t("run_desktop.no_active_desktops")),
                        )
                        .child(
                            div().child(
                                Button::new("browse-desktop-tasks")
                                    .outline()
                                    .small()
                                    .label(workbench.t("run_desktop.open_tasks"))
                                    .on_click(move |_, _, cx| {
                                        let _ = browse.update(cx, |this, cx| {
                                            this.selected_project = None;
                                            this.project_tab = ProjectTab::Tasks;
                                            this.remote.creating = false;
                                            this.command(
                                                json!({"action":"remote_select","task_id":null}),
                                                cx,
                                            );
                                            this.navigate(WorkbenchPage::Tasks, cx);
                                        });
                                    }),
                            ),
                        )
                    },
                )
                .children(sessions.into_iter().map(|(target, title, worker)| {
                    let owner = self.owner.clone();
                    let label = worker
                        .as_ref()
                        .map_or_else(|| title.clone(), |worker| format!("{title} · {worker}"));
                    Button::new(SharedString::from(format!(
                        "open-desktop-{}",
                        target.run_id
                    )))
                    .outline()
                    .w_full()
                    .h(px(52.))
                    .accessibility_label(label)
                    .child(
                        div()
                            .w_full()
                            .flex()
                            .items_center()
                            .gap_2()
                            .child(
                                svg()
                                    .path("icons/devices.svg")
                                    .size(px(16.))
                                    .text_color(palette.text),
                            )
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .flex()
                                    .flex_col()
                                    .items_start()
                                    .child(div().w_full().truncate().child(title))
                                    .when_some(worker, |el, worker| {
                                        el.child(
                                            div()
                                                .w_full()
                                                .truncate()
                                                .text_sm()
                                                .text_color(palette.text_muted)
                                                .child(worker),
                                        )
                                    }),
                            ),
                    )
                    .on_click(move |_, _, cx| {
                        let _ = owner.update(cx, |this, cx| {
                            this.open_run_desktop_target(target.clone(), cx)
                        });
                    })
                })),
        )
    }
}
