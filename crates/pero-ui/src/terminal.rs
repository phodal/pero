//! Interactive PTY presentation shared by native and WASM Workbench.
use crate::app::{Workbench, session_command};
use gpui_kit::{component::Icon, prelude::*, *};
use pero_contracts::{
    HostEvent,
    terminal::{TerminalEvent, TerminalRequest, TerminalSize},
};
use std::ops::Range;

#[derive(Default)]
pub(crate) struct TerminalDock {
    pub visible: bool,
    pub tabs: Vec<Entity<TerminalView>>,
    active: usize,
    next_id: u32,
    closing: Option<u32>,
}
pub(crate) struct TerminalView {
    id: u32,
    cwd: String,
    parser: vt100::Parser,
    focus: FocusHandle,
    marked: String,
    bounds: Bounds<Pixels>,
    char_width: f32,
    pub status: String,
    closed: bool,
}
fn send(request: TerminalRequest) -> Result<(), String> {
    let mut value = serde_json::to_value(request).expect("terminal command");
    value["method"] = "terminal".into();
    session_command(&value.to_string()).map_err(|_| "Local terminal is unavailable".into())
}
impl TerminalDock {
    pub(crate) fn snapshot(&self, cx: &App) -> serde_json::Value {
        serde_json::json!({"visible":self.visible,"active":self.active,"tabs":self.tabs.iter().map(|view|{let v=view.read(cx);serde_json::json!({"id":v.id,"cwd":v.cwd,"text":v.parser.screen().contents(),"size":v.parser.screen().size(),"closed":v.closed,"status":v.status,"bounds":{"x":f32::from(v.bounds.origin.x),"y":f32::from(v.bounds.origin.y),"width":f32::from(v.bounds.size.width),"height":f32::from(v.bounds.size.height)}})}).collect::<Vec<_>>()})
    }
}
impl Workbench {
    pub(crate) fn toggle_terminal(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.terminal.visible = !self.terminal.visible;
        if self.terminal.visible {
            if self.terminal.tabs.is_empty() {
                self.new_terminal(window, cx);
            }
            if let Some(view) = self.terminal.tabs.get(self.terminal.active) {
                view.read(cx).focus.clone().focus(window, cx);
            }
        }
        cx.notify();
    }
    fn close_terminal(&mut self, id: u32, window: &mut Window, cx: &mut Context<Self>) {
        let active_id = self
            .terminal
            .tabs
            .get(self.terminal.active)
            .map(|view| view.read(cx).id);
        let _ = send(TerminalRequest::Close { id });
        self.terminal.tabs.retain(|view| view.read(cx).id != id);
        self.terminal.active = active_id
            .and_then(|active| {
                self.terminal
                    .tabs
                    .iter()
                    .position(|view| view.read(cx).id == active)
            })
            .unwrap_or_else(|| {
                self.terminal
                    .active
                    .min(self.terminal.tabs.len().saturating_sub(1))
            });
        self.terminal.closing = None;
        if let Some(view) = self.terminal.tabs.get(self.terminal.active) {
            view.read(cx).focus.clone().focus(window, cx);
        } else {
            self.terminal.visible = false;
            self.workspace_focus.focus(window, cx);
        }
        cx.notify();
    }
    fn new_terminal(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.terminal.next_id += 1;
        let id = self.terminal.next_id;
        let cwd = self.chat.read(cx).workspace.clone();
        let view = cx.new(|cx| TerminalView {
            id,
            cwd: cwd.clone(),
            parser: vt100::Parser::new(12, 80, 5000),
            focus: cx.focus_handle(),
            marked: String::new(),
            bounds: Bounds::default(),
            char_width: 7.8,
            status: self.t("terminal.starting").into(),
            closed: false,
        });
        view.read(cx).focus.clone().focus(window, cx);
        self.terminal.tabs.push(view);
        self.terminal.active = self.terminal.tabs.len() - 1;
        let result = if self.connected {
            send(TerminalRequest::Open {
                id,
                cwd,
                size: TerminalSize::new(12, 80).unwrap(),
            })
        } else {
            Err(self.t("status.disconnected").to_string())
        };
        if let Err(error) = result {
            self.terminal.tabs.last().unwrap().update(cx, |view, cx| {
                view.status = error;
                view.closed = true;
                cx.notify();
            });
        }
        cx.notify();
    }
    pub(crate) fn receive_terminal(&mut self, event: &HostEvent, cx: &mut Context<Self>) -> bool {
        if event.kind == "disconnected" {
            let status = self.t("status.disconnected").to_string();
            for view in &self.terminal.tabs {
                view.update(cx, |view, cx| {
                    view.closed = true;
                    view.status = status.clone();
                    cx.notify();
                });
            }
        }
        if event.kind != "terminal" {
            return false;
        }
        if let Ok(event) = serde_json::from_value::<TerminalEvent>(event.data.clone()) {
            if let Some(view) = self
                .terminal
                .tabs
                .iter()
                .find(|view| view.read(cx).id == event.id())
            {
                view.update(cx, |view, cx| {
                    match event {
                        TerminalEvent::Output { bytes, .. } => view.parser.process(&bytes),
                        TerminalEvent::Opened { cwd, .. } => {
                            view.cwd = cwd;
                            view.status.clear();
                        }
                        TerminalEvent::Exited { code, .. } => {
                            view.closed = true;
                            view.status = format!(
                                "{} ({code})",
                                pero_contracts::i18n::text(&self.locale, "terminal.exited")
                            );
                        }
                        TerminalEvent::Error { message, .. } => {
                            view.status = message;
                            view.closed = true;
                        }
                    }
                    cx.notify();
                });
            }
        }
        cx.notify();
        true
    }
    pub(crate) fn terminal_panel(&self, height: f32, cx: &mut Context<Self>) -> impl IntoElement {
        let ui = self.ui(cx);
        let chrome = ui.chrome();
        let p = ui.palette;
        let tabs = self
            .terminal
            .tabs
            .iter()
            .enumerate()
            .map(|(index, view)| {
                let current = view.read(cx);
                let id = current.id;
                let title = std::path::Path::new(&current.cwd)
                    .file_name()
                    .and_then(|v| v.to_str())
                    .unwrap_or("shell");
                div()
                    .id(("terminal-tab", id as usize))
                    .flex()
                    .items_center()
                    .gap(px(4.))
                    .px(px(8.))
                    .h(px(30.))
                    .when(index == self.terminal.active, |el| el.bg(p.surface_muted))
                    .cursor_pointer()
                    .child(ui.icon("terminal"))
                    .child(format!("{title} {id}"))
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.terminal.active = index;
                        this.terminal.tabs[index]
                            .read(cx)
                            .focus
                            .clone()
                            .focus(window, cx);
                        cx.notify();
                    }))
                    .child(
                        pero_theme::ghost_icon_button(("terminal-close", id as usize), chrome, cx)
                            .icon(Icon::default().path("icons/x.svg"))
                            .tooltip(ui.t("terminal.close"))
                            .accessibility_label(format!("{} {id}", ui.t("terminal.close")))
                            .relative()
                            .child(self.view_bounds.terminal.probe(format!("close-{id}")))
                            .on_click(cx.listener(move |this, _, window, cx| {
                                cx.stop_propagation();
                                if this
                                    .terminal
                                    .tabs
                                    .iter()
                                    .find(|view| view.read(cx).id == id)
                                    .is_some_and(|view| !view.read(cx).closed)
                                {
                                    this.terminal.closing = Some(id);
                                } else {
                                    this.close_terminal(id, window, cx);
                                }
                                cx.notify();
                            })),
                    )
            })
            .collect::<Vec<_>>();
        div()
            .id("terminal-dock")
            .h(px(height))
            .flex_shrink_0()
            .min_w_0()
            .flex()
            .flex_col()
            .bg(p.bg)
            .border_t_1()
            .border_color(p.border)
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(4.))
                    .px(px(8.))
                    .text_size(px(12.))
                    .child(
                        div()
                            .id("terminal-tabs")
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .overflow_x_scroll()
                            .children(tabs),
                    )
                    .child(
                        pero_theme::ghost_icon_button("terminal-new", chrome, cx)
                            .icon(Icon::default().path("icons/plus.svg"))
                            .tooltip(ui.t("terminal.new"))
                            .accessibility_label(ui.t("terminal.new"))
                            .relative()
                            .child(self.view_bounds.terminal.probe("new".into()))
                            .on_click(
                                cx.listener(|this, _, window, cx| this.new_terminal(window, cx)),
                            ),
                    )
                    .child(
                        pero_theme::ghost_icon_button("terminal-copy", chrome, cx)
                            .icon(Icon::default().path("icons/copy.svg"))
                            .tooltip(ui.t("terminal.copy"))
                            .accessibility_label(ui.t("terminal.copy"))
                            .on_click(cx.listener(|this, _, _, cx| {
                                if let Some(view) = this.terminal.tabs.get(this.terminal.active) {
                                    cx.write_to_clipboard(ClipboardItem::new_string(
                                        view.read(cx).parser.screen().contents(),
                                    ));
                                }
                            })),
                    )
                    .child(
                        pero_theme::ghost_icon_button("terminal-hide", chrome, cx)
                            .icon(Icon::default().path("icons/chevron-down.svg"))
                            .tooltip(ui.t("terminal.hide"))
                            .accessibility_label(ui.t("terminal.hide"))
                            .relative()
                            .child(self.view_bounds.terminal.probe("hide".into()))
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.terminal.visible = false;
                                this.workspace_focus.focus(window, cx);
                                cx.notify();
                            })),
                    ),
            )
            .when_some(self.terminal.closing, |el, id| {
                el.child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .px(px(8.))
                        .text_size(px(12.))
                        .text_color(p.warning)
                        .child(ui.t("terminal.close_confirm"))
                        .child(
                            pero_theme::action_button(
                                "terminal-confirm-close",
                                ui.t("terminal.close"),
                                pero_theme::ActionKind::Danger,
                                chrome,
                                cx,
                            )
                            .relative()
                            .child(self.view_bounds.terminal.probe("confirm-close".into()))
                            .on_click(cx.listener(
                                move |this, _, window, cx| this.close_terminal(id, window, cx),
                            )),
                        )
                        .child(
                            pero_theme::action_button(
                                "terminal-cancel-close",
                                ui.t("apps.cancel"),
                                pero_theme::ActionKind::Ghost,
                                chrome,
                                cx,
                            )
                            .relative()
                            .child(self.view_bounds.terminal.probe("cancel-close".into()))
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.terminal.closing = None;
                                cx.notify();
                            })),
                        ),
                )
            })
            .children(self.terminal.tabs.get(self.terminal.active).cloned())
    }
}
impl TerminalView {
    fn write(&mut self, text: &[u8], cx: &mut Context<Self>) {
        if self.closed {
            return;
        }
        self.parser.screen_mut().set_scrollback(0);
        if let Err(error) = send(TerminalRequest::Write {
            id: self.id,
            bytes: text.to_vec(),
        }) {
            self.status = error;
        }
        cx.notify();
    }
    fn paste_text(&mut self, text: &str, cx: &mut Context<Self>) {
        let text = if self.parser.screen().bracketed_paste() {
            format!("\x1b[200~{text}\x1b[201~")
        } else {
            text.into()
        };
        self.write(text.as_bytes(), cx);
    }
    fn key(&mut self, event: &KeyDownEvent, cx: &mut Context<Self>) {
        let key = &event.keystroke.key;
        let m = event.keystroke.modifiers;
        let shortcut = m.platform || (m.control && m.shift);
        if shortcut && key == "v" {
            let clipboard = cx.read_from_clipboard_async();
            cx.spawn(async move |this, cx| {
                if let Ok(Some(item)) = clipboard.await {
                    if let Some(text) = item.text() {
                        let _ = this.update(cx, |this, cx| this.paste_text(&text, cx));
                    }
                }
            })
            .detach();
        } else if shortcut && key == "c" {
            cx.write_to_clipboard(ClipboardItem::new_string(self.parser.screen().contents()));
        } else if m.control && key.len() == 1 && key.as_bytes()[0].is_ascii_alphabetic() {
            self.write(&[key.as_bytes()[0].to_ascii_lowercase() - b'a' + 1], cx);
        } else {
            let app = self.parser.screen().application_cursor();
            let text = match key.as_str() {
                "enter" => "\r",
                "backspace" => "\x7f",
                "tab" => "\t",
                "escape" => "\x1b",
                "up" => {
                    if app {
                        "\x1bOA"
                    } else {
                        "\x1b[A"
                    }
                }
                "down" => {
                    if app {
                        "\x1bOB"
                    } else {
                        "\x1b[B"
                    }
                }
                "right" => {
                    if app {
                        "\x1bOC"
                    } else {
                        "\x1b[C"
                    }
                }
                "left" => {
                    if app {
                        "\x1bOD"
                    } else {
                        "\x1b[D"
                    }
                }
                "home" => "\x1b[H",
                "end" => "\x1b[F",
                "delete" => "\x1b[3~",
                "pageup" => "\x1b[5~",
                "pagedown" => "\x1b[6~",
                _ => return,
            };
            self.write(text.as_bytes(), cx);
        }
        cx.stop_propagation();
    }
}
fn color(value: vt100::Color, default: Hsla) -> Hsla {
    match value {
        vt100::Color::Default => default,
        vt100::Color::Rgb(r, g, b) => {
            rgb((u32::from(r) << 16) | (u32::from(g) << 8) | u32::from(b)).into()
        }
        vt100::Color::Idx(i) => {
            let palette = [
                0x3b4252, 0xbf616a, 0x78a66a, 0xb68a38, 0x5e81ac, 0xb48ead, 0x4d9b9b, 0xd8dee9,
                0x6b7280, 0xf38b93, 0xa3be8c, 0xebcb8b, 0x81a1c1, 0xd6a8d0, 0x8fbcbb, 0xeceff4,
            ];
            let value = if i < 16 {
                palette[i as usize]
            } else if i >= 232 {
                let c = 8 + 10 * u32::from(i - 232);
                c * 0x010101
            } else {
                let i = u32::from(i - 16);
                let c = |v| if v == 0 { 0 } else { 55 + 40 * v };
                (c(i / 36) << 16) | (c(i / 6 % 6) << 8) | c(i % 6)
            };
            rgb(value).into()
        }
    }
}
impl Render for TerminalView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = pero_theme::UiAppearance::global(cx).palette.clone();
        let font = Font {
            family: "JetBrains Mono".into(),
            ..Default::default()
        };
        self.char_width = window
            .text_system()
            .advance(window.text_system().resolve_font(&font), px(13.), 'M')
            .map(|size| f32::from(size.width))
            .unwrap_or(7.8);
        let char_width = self.char_width;
        let screen = self.parser.screen();
        let (rows, cols) = screen.size();
        let cursor = screen.cursor_position();
        let focused = self.focus.is_focused(window);
        let mut lines = Vec::new();
        for row in 0..rows {
            let mut text = String::new();
            let mut highlights = Vec::new();
            for col in 0..cols {
                let cell = screen.cell(row, col).unwrap();
                if cell.is_wide_continuation() {
                    continue;
                }
                let start = text.len();
                text.push_str(if cell.contents().is_empty() {
                    " "
                } else {
                    cell.contents()
                });
                let mut fg = color(cell.fgcolor(), p.text);
                let mut bg = color(cell.bgcolor(), p.bg);
                if cell.inverse() {
                    std::mem::swap(&mut fg, &mut bg);
                }
                if focused
                    && !screen.hide_cursor()
                    && screen.scrollback() == 0
                    && (row, col) == cursor
                {
                    std::mem::swap(&mut fg, &mut bg);
                }
                highlights.push((
                    start..text.len(),
                    HighlightStyle {
                        color: Some(fg),
                        background_color: Some(bg),
                        font_weight: cell.bold().then_some(FontWeight::BOLD),
                        ..Default::default()
                    },
                ));
            }
            lines.push(
                div()
                    .h(px(18.))
                    .flex_shrink_0()
                    .child(StyledText::new(text).with_highlights(highlights)),
            );
        }
        let view = cx.entity();
        let input_view = view.clone();
        let focus = self.focus.clone();
        div()
            .id("terminal-screen")
            .relative()
            .flex_1()
            .min_h_0()
            .min_w_0()
            .overflow_hidden()
            .p(px(8.))
            .font_family("JetBrains Mono")
            .text_size(px(13.))
            .line_height(px(18.))
            .text_color(p.text)
            .role(Role::Terminal)
            .aria_label("Terminal")
            .track_focus(&self.focus)
            .key_context("Terminal")
            .cursor_text()
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, _, window, cx| this.focus.clone().focus(window, cx)),
            )
            .on_key_down(cx.listener(|this, event, _, cx| this.key(event, cx)))
            .on_scroll(cx.listener(|this, event: &ScrollEvent, _, cx| {
                let offset = this.parser.screen().scrollback() as i64
                    + (f32::from(event.delta.pixel_delta(px(18.)).y) / 18.).round() as i64;
                this.parser
                    .screen_mut()
                    .set_scrollback(offset.max(0) as usize);
                cx.notify();
                cx.stop_propagation();
            }))
            .children(lines)
            .when(!self.status.is_empty(), |el| {
                el.child(
                    div()
                        .absolute()
                        .bottom(px(4.))
                        .left(px(8.))
                        .bg(p.bg)
                        .text_color(p.text_muted)
                        .child(self.status.clone()),
                )
            })
            .when(!self.marked.is_empty(), |el| {
                el.child(
                    div()
                        .absolute()
                        .top(px(8. + f32::from(cursor.0) * 18.))
                        .left(px(8. + f32::from(cursor.1) * char_width))
                        .bg(p.bg)
                        .child(self.marked.clone()),
                )
            })
            .child(
                canvas(
                    move |bounds, _, cx| {
                        view.update(cx, |this, cx| {
                            this.bounds = bounds;
                            let rows = ((f32::from(bounds.size.height) - 16.) / 18.)
                                .floor()
                                .clamp(1., 1000.) as u16;
                            let cols = ((f32::from(bounds.size.width) - 16.) / char_width)
                                .floor()
                                .clamp(1., 1000.) as u16;
                            if this.parser.screen().size() != (rows, cols) {
                                this.parser.screen_mut().set_size(rows, cols);
                                if !this.closed {
                                    let _ = send(TerminalRequest::Resize {
                                        id: this.id,
                                        size: TerminalSize::new(rows, cols).unwrap(),
                                    });
                                }
                                cx.notify();
                            }
                        });
                    },
                    move |bounds, _, window, cx| {
                        window.handle_input(
                            &focus,
                            ElementInputHandler::new(bounds, input_view),
                            cx,
                        )
                    },
                )
                .absolute()
                .top_0()
                .left_0()
                .size_full(),
            )
    }
}
impl EntityInputHandler for TerminalView {
    fn paste(&mut self, item: ClipboardItem, _: &mut Window, cx: &mut Context<Self>) {
        if let Some(text) = item.text() {
            self.paste_text(&text, cx);
        }
    }

    fn text_for_range(
        &mut self,
        _: Range<usize>,
        actual: &mut Option<Range<usize>>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<String> {
        *actual = Some(0..self.marked.encode_utf16().count());
        Some(self.marked.clone())
    }
    fn selected_text_range(
        &mut self,
        _: bool,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        let end = self.marked.encode_utf16().count();
        Some(UTF16Selection {
            range: end..end,
            reversed: false,
        })
    }
    fn marked_text_range(&self, _: &mut Window, _: &mut Context<Self>) -> Option<Range<usize>> {
        (!self.marked.is_empty()).then(|| 0..self.marked.encode_utf16().count())
    }
    fn unmark_text(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        self.marked.clear();
        cx.notify();
    }
    fn replace_text_in_range(
        &mut self,
        _: Option<Range<usize>>,
        text: &str,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.marked.clear();
        self.write(text.as_bytes(), cx);
    }
    fn replace_and_mark_text_in_range(
        &mut self,
        _: Option<Range<usize>>,
        text: &str,
        _: Option<Range<usize>>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.marked = text.into();
        cx.notify();
    }
    fn bounds_for_range(
        &mut self,
        _: Range<usize>,
        _: Bounds<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        let (row, col) = self.parser.screen().cursor_position();
        Some(Bounds::new(
            self.bounds.origin
                + point(
                    px(8. + f32::from(col) * self.char_width),
                    px(8. + f32::from(row) * 18.),
                ),
            size(px(self.char_width), px(18.)),
        ))
    }
    fn character_index_for_point(
        &mut self,
        _: Point<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<usize> {
        Some(0)
    }
}
