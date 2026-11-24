//! Read-only presentation of the selected conversation's authorized window.
use crate::native_connectors::NativeConnectors;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use gpui_kit::{component::Icon, prelude::*, *};
use pero_contracts::{
    computer_runtime::ComputerImageContent, computer_use::ComputerImageType, i18n::text,
};
use serde::Deserialize;
use std::{
    cell::Cell,
    collections::{HashMap, HashSet},
    rc::Rc,
    sync::{Arc, Weak},
    time::Duration,
};

#[derive(Clone, Deserialize, PartialEq, Eq)]
struct Target {
    id: String,
    title: String,
}

#[derive(Deserialize)]
struct Update {
    thread: String,
    target: Option<Target>,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum FrameReply {
    Waiting,
    Ended,
    PreviewFrame { image: Option<ComputerImageContent> },
}

enum Picture {
    Waiting,
    Unavailable,
    Frame(Arc<RenderImage>),
}

pub(crate) struct ComputerPreview {
    owner: Weak<NativeConnectors>,
    targets: HashMap<String, Target>,
    thread: Option<String>,
    visible: bool,
    hidden: HashSet<String>,
    floating_origin: Option<Point<Pixels>>,
    locale: String,
    picture: Picture,
    floating: Option<AnyWindowHandle>,
    poll: Option<Task<()>>,
}

impl ComputerPreview {
    pub(crate) fn new(locale: String) -> Self {
        Self {
            owner: Weak::new(),
            targets: HashMap::new(),
            thread: None,
            visible: false,
            hidden: HashSet::new(),
            floating_origin: None,
            locale,
            picture: Picture::Waiting,
            floating: None,
            poll: None,
        }
    }

    pub(crate) fn connect(&mut self, owner: &Arc<NativeConnectors>) {
        self.owner = Arc::downgrade(owner);
    }

    pub(crate) fn accept(&mut self, data: serde_json::Value, cx: &mut Context<Self>) {
        let Ok(update) = serde_json::from_value(data) else {
            return;
        };
        self.apply(update, cx);
    }

    fn apply(&mut self, Update { thread, target }: Update, cx: &mut Context<Self>) {
        if let Some(target) = target {
            self.targets.insert(thread.clone(), target);
        } else {
            self.targets.remove(&thread);
        }
        if self.thread.as_ref() == Some(&thread) {
            self.poll = None;
            self.set_picture(Picture::Waiting, cx);
            if self.target().is_none() {
                self.dock(cx);
            }
            self.refresh(cx);
            cx.notify();
        }
    }

    pub(crate) fn disconnect(&mut self, cx: &mut Context<Self>) {
        self.targets.clear();
        self.poll = None;
        self.set_picture(Picture::Waiting, cx);
        self.dock(cx);
        cx.notify();
    }

    pub(crate) fn select(
        &mut self,
        thread: Option<String>,
        visible: bool,
        locale: &str,
        cx: &mut Context<Self>,
    ) {
        if self.thread != thread {
            self.thread = thread;
            self.poll = None;
            self.set_picture(Picture::Waiting, cx);
            self.dock(cx);
        }
        if self.visible != visible || self.locale != locale {
            self.visible = visible;
            self.locale = locale.to_owned();
            cx.notify();
        }
        self.refresh(cx);
    }

    fn target(&self) -> Option<&Target> {
        self.targets.get(self.thread.as_ref()?)
    }

    fn set_picture(&mut self, picture: Picture, cx: &mut Context<Self>) {
        if let Picture::Frame(old) = std::mem::replace(&mut self.picture, picture) {
            cx.drop_image(old, None);
        }
        if let Some(window) = self.floating {
            cx.defer(move |cx| {
                let _ = window.update(cx, |_, window, _| window.refresh());
            });
        }
        cx.notify();
    }

    fn refresh(&mut self, cx: &mut Context<Self>) {
        if self.is_hidden() || (!self.visible && self.floating.is_none()) {
            if self.poll.take().is_some() {
                self.set_picture(Picture::Waiting, cx);
            }
            return;
        }
        if self.poll.is_some() {
            return;
        }
        let Some(target) = self.target().cloned() else {
            return;
        };
        let Some(thread) = self.thread.clone() else {
            return;
        };
        let Some(owner) = self.owner.upgrade() else {
            return;
        };
        let timer = cx.background_executor().clone();
        self.poll = Some(cx.spawn(async move |view, cx| {
            loop {
                let request = serde_json::json!({"operation":"computer-preview", "thread":thread, "preview_id":target.id});
                let owner = owner.clone();
                let reply = cx.background_spawn(async move {
                    let reply = owner.request(request).ok().and_then(|reply| serde_json::from_value::<FrameReply>(reply).ok());
                    match reply {
                        Some(FrameReply::Waiting) => Ok(None),
                        Some(FrameReply::PreviewFrame { image }) => Ok(Some(decode(image))),
                        _ => Err(()),
                    }
                }).await;
                let keep = view.update(cx, |this, cx| {
                    if this.thread.as_ref() != Some(&thread) || this.target() != Some(&target) {
                        return false;
                    }
                    match reply {
                    Ok(picture) => {
                        if let Some(picture) = picture {
                            this.set_picture(picture, cx);
                        }
                        true
                    }
                    Err(()) => {
                        this.apply(Update { thread: thread.clone(), target: None }, cx);
                        false
                    }
                    }
                }).unwrap_or(false);
                if !keep { break; }
                timer.timer(Duration::from_millis(500)).await;
            }
        }));
    }

    fn dock(&mut self, cx: &mut Context<Self>) {
        if let Some(window) = self.floating.take() {
            cx.defer(move |cx| {
                let _ = window.update(cx, |_, window, _| window.remove_window());
            });
            cx.notify();
        }
    }

    fn pop_out(&mut self, window: &Window, cx: &mut Context<Self>) {
        let view = cx.entity().downgrade();
        let main = window.bounds();
        let display = window.display(cx);
        cx.defer(move |cx| {
            let Ok(Some(previous)) = view.read_with(cx, |this, _| {
                (this.target().is_some() && this.floating.is_none()).then_some(this.floating_origin)
            }) else {
                return;
            };
            let panel = size(px(288.), px(202.));
            let usable = display
                .as_ref()
                .map_or(main, |display| display.visible_bounds());
            let origin = previous.unwrap_or_else(|| {
                point(main.right() - panel.width - px(16.), main.top() + px(48.))
            });
            let bounds = Bounds::new(
                point(
                    origin.x.clamp(
                        usable.left(),
                        (usable.right() - panel.width).max(usable.left()),
                    ),
                    origin.y.clamp(
                        usable.top(),
                        (usable.bottom() - panel.height).max(usable.top()),
                    ),
                ),
                panel,
            );
            let options = WindowOptions {
                titlebar: None,
                kind: WindowKind::PopUp,
                window_background: WindowBackgroundAppearance::Transparent,
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                window_min_size: Some(size(px(224.), px(152.))),
                display_id: display.as_ref().map(|display| display.id()),
                app_owns_titlebar_drag: true,
                focus: false,
                is_minimizable: false,
                ..WindowOptions::default()
            };
            let owner = view.clone();
            let result = gpui_kit::open_window(options, cx, |window, cx| {
                window.set_window_title(text(
                    &owner
                        .read_with(cx, |this, _| this.locale.clone())
                        .unwrap_or_default(),
                    "computer.preview",
                ));
                configure_floating_window(window);
                let closing = owner.clone();
                window.on_window_should_close(cx, move |_, cx| {
                    let _ = closing.update(cx, |this, cx| {
                        this.floating = None;
                        this.refresh(cx);
                        cx.notify();
                    });
                    true
                });
                cx.new(|_| FloatingPreview {
                    owner,
                    dragging: Rc::new(Cell::new(None)),
                })
            });
            if let Ok((window, _)) = result {
                let _ = view.update(cx, |this, cx| {
                    this.floating = Some(window);
                    this.refresh(cx);
                    cx.notify();
                });
            }
        });
    }

    fn is_hidden(&self) -> bool {
        self.thread
            .as_ref()
            .is_some_and(|thread| self.hidden.contains(thread))
    }

    fn set_hidden(&mut self, hidden: bool, cx: &mut Context<Self>) {
        let Some(thread) = &self.thread else { return };
        if hidden {
            self.hidden.insert(thread.clone());
            self.dock(cx);
        } else {
            self.hidden.remove(thread);
        }
        self.refresh(cx);
        cx.notify();
    }

    fn render_preview(
        &self,
        drag: Option<Rc<Cell<Option<Point<Pixels>>>>>,
        controls: Vec<AnyElement>,
        cx: &App,
    ) -> AnyElement {
        let floating = drag.is_some();
        let Some(target) = self.target() else {
            return div().into_any_element();
        };
        let chrome = pero_theme::Chrome::from_app(cx);
        let title = if target.title.is_empty() {
            text(&self.locale, "computer.preview")
        } else {
            &target.title
        };
        let picture = match &self.picture {
            Picture::Frame(frame) => {
                let frame = frame.clone();
                canvas(
                    |_, _, _| (),
                    move |bounds, _, window, _| {
                        let fit = ObjectFit::Contain.get_bounds(bounds, frame.size(0));
                        let _ =
                            window.paint_image(bounds, fit, Corners::default(), frame, 0, false);
                    },
                )
                .w_full()
                .when(floating, |el| el.flex_1().min_h_0())
                .when(!floating, |el| el.h(px(118.)))
                .into_any_element()
            }
            picture => div()
                .flex()
                .w_full()
                .when(floating, |el| el.flex_1().min_h_0())
                .when(!floating, |el| el.h(px(118.)))
                .items_center()
                .justify_center()
                .text_color(chrome.palette.text_muted)
                .child(text(
                    &self.locale,
                    match picture {
                        Picture::Waiting => "computer.preview_waiting",
                        _ => "computer.preview_unavailable",
                    },
                ))
                .into_any_element(),
        };
        let show_picture = floating || (!self.is_hidden() && self.floating.is_none());
        let title = div()
            .id("computer-preview-title")
            .flex_1()
            .min_w_0()
            .h_full()
            .flex()
            .items_center()
            .pl(chrome.geo(pero_theme::SPACE_12))
            .when_some(drag, |el, drag| {
                el.cursor(CursorStyle::OpenHand)
                    .on_mouse_down(MouseButton::Left, move |event, _, _| {
                        drag.set(Some(event.position))
                    })
            })
            .child(div().w_full().truncate().child(title.to_owned()));
        let preview = div()
            .id(if floating {
                "computer-preview-float"
            } else {
                "computer-preview-inline"
            })
            .min_w_0()
            .w_full()
            .flex()
            .flex_col()
            .overflow_hidden()
            .rounded(chrome.geo(pero_theme::RADIUS_PANEL))
            .border_1()
            .border_color(chrome.palette.border)
            .bg(chrome.palette.surface)
            .when(floating, |el| el.size_full())
            .when(!floating, |el| el.max_w(px(300.)))
            .child(
                div()
                    .flex()
                    .items_center()
                    .min_w_0()
                    .flex_shrink_0()
                    .h(chrome.control(36.))
                    .pr(chrome.geo(pero_theme::SPACE_4))
                    .gap(chrome.geo(pero_theme::SPACE_8))
                    .text_color(chrome.palette.text)
                    .text_size(chrome.text(pero_theme::TYPE_BODY))
                    .font_weight(FontWeight::MEDIUM)
                    .when(show_picture, |el| {
                        el.border_b_1().border_color(chrome.palette.border)
                    })
                    .child(title)
                    .child(div().flex().items_center().children(controls)),
            )
            .when(show_picture, |el| el.child(picture));
        if floating {
            preview.into_any_element()
        } else {
            div()
                .flex()
                .flex_shrink_0()
                .justify_center()
                .p(chrome.geo(pero_theme::SPACE_8))
                .child(preview)
                .into_any_element()
        }
    }
}

fn decode(image: Option<ComputerImageContent>) -> Picture {
    let Some(image) = image else {
        return Picture::Unavailable;
    };
    let format = match image.media_type {
        ComputerImageType::Jpeg => image::ImageFormat::Jpeg,
        ComputerImageType::Png => image::ImageFormat::Png,
    };
    let Ok(bytes) = STANDARD.decode(image.data) else {
        return Picture::Unavailable;
    };
    let Ok(data) = image::load_from_memory_with_format(&bytes, format) else {
        return Picture::Unavailable;
    };
    let mut pixels = data.into_rgba8();
    for pixel in pixels.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }
    Picture::Frame(Arc::new(RenderImage::new([image::Frame::new(pixels)])))
}

impl Render for ComputerPreview {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let mut controls = Vec::new();
        if self.floating.is_some() {
            controls.push(
                preview_button(
                    "computer.preview_dock",
                    "panel-right-open",
                    &self.locale,
                    cx,
                )
                .on_click(cx.listener(|this, _, _, cx| {
                    this.dock(cx);
                    this.refresh(cx);
                }))
                .into_any_element(),
            );
        } else {
            if !self.is_hidden() {
                controls.push(
                    preview_button(
                        "computer.preview_pop_out",
                        "external-link",
                        &self.locale,
                        cx,
                    )
                    .on_click(cx.listener(|this, _, window, cx| this.pop_out(window, cx)))
                    .into_any_element(),
                );
            }
            controls.push(
                preview_button(
                    if self.is_hidden() {
                        "computer.preview_show"
                    } else {
                        "computer.preview_hide"
                    },
                    if self.is_hidden() {
                        "chevron-down"
                    } else {
                        "minus"
                    },
                    &self.locale,
                    cx,
                )
                .on_click(cx.listener(|this, _, _, cx| {
                    this.set_hidden(!this.is_hidden(), cx);
                }))
                .into_any_element(),
            );
        }
        self.render_preview(None, controls, cx)
    }
}

fn preview_button(
    key: &'static str,
    icon: &str,
    locale: &str,
    cx: &App,
) -> gpui_kit::component::button::Button {
    let label = text(locale, key);
    pero_theme::ghost_icon_button(key, pero_theme::Chrome::from_app(cx), cx)
        .icon(Icon::default().path(format!("icons/{icon}.svg")))
        .accessibility_label(label)
        .tooltip(label)
}

struct FloatingPreview {
    owner: WeakEntity<ComputerPreview>,
    dragging: Rc<Cell<Option<Point<Pixels>>>>,
}
impl Render for FloatingPreview {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let dock_owner = self.owner.clone();
        let hide_owner = self.owner.clone();
        let owner = self.owner.clone();
        let dragging = self.dragging.clone();
        let drag_events = canvas(
            |_, _, _| (),
            move |_, _, window, _| {
                let anchor = dragging.clone();
                window.on_mouse_event(move |event: &MouseMoveEvent, phase, window, _| {
                    if phase.capture()
                        && event.dragging()
                        && let Some(start) = anchor.get()
                        && let Some(window) = appkit_window(window)
                    {
                        let delta = event.position - start;
                        let mut origin = window.frame().origin;
                        origin.x += f64::from(f32::from(delta.x));
                        origin.y -= f64::from(f32::from(delta.y));
                        window.setFrameOrigin(origin);
                    }
                });
                window.on_mouse_event(move |event: &MouseUpEvent, phase, window, cx| {
                    if phase.capture()
                        && event.button == MouseButton::Left
                        && dragging.take().is_some()
                    {
                        let _ = owner.update(cx, |preview, _| {
                            preview.floating_origin = Some(window.bounds().origin)
                        });
                    }
                });
            },
        )
        .absolute()
        .size_full();
        let content = self
            .owner
            .read_with(cx, |preview, cx| {
                let dock = preview_button(
                    "computer.preview_dock",
                    "panel-right-open",
                    &preview.locale,
                    cx,
                )
                .on_click(move |_, _, cx| {
                    let _ = dock_owner.update(cx, |preview, cx| {
                        preview.dock(cx);
                        preview.refresh(cx);
                    });
                });
                let hide = preview_button("computer.preview_hide", "x", &preview.locale, cx)
                    .on_click(move |_, _, cx| {
                        let _ = hide_owner.update(cx, |preview, cx| preview.set_hidden(true, cx));
                    });
                preview.render_preview(
                    Some(self.dragging.clone()),
                    vec![dock.into_any_element(), hide.into_any_element()],
                    cx,
                )
            })
            .unwrap_or_else(|_| div().into_any_element());
        div()
            .relative()
            .size_full()
            .child(drag_events)
            .child(content)
    }
}

fn configure_floating_window(window: &Window) {
    use objc2_app_kit::NSWindowCollectionBehavior;
    if let Some(window) = appkit_window(window) {
        window.setHidesOnDeactivate(false);
        window.setExcludedFromWindowsMenu(true);
        window.setHasShadow(true);
        let behavior =
            window.collectionBehavior() - NSWindowCollectionBehavior::ParticipatesInCycle;
        window.setCollectionBehavior(behavior | NSWindowCollectionBehavior::IgnoresCycle);
    }
}

fn appkit_window(window: &Window) -> Option<objc2::rc::Retained<objc2_app_kit::NSWindow>> {
    use objc2_app_kit::NSView;
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};

    let handle = HasWindowHandle::window_handle(window).ok()?;
    let RawWindowHandle::AppKit(handle) = handle.as_raw() else {
        return None;
    };
    // The view is owned by this GPUI window on the main thread.
    let view = unsafe { &*handle.ns_view.as_ptr().cast::<NSView>() };
    view.window()
}
