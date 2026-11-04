//! Trusted GPUI confirmation, separate from the Paper WebView and Agent tools.
use crate::native_docling::Prompt;
use gpui_kit::{
    component::{WindowExt, button::Button, dialog::DialogFooter},
    prelude::*,
    *,
};
use std::cell::Cell;

thread_local! { static OPEN: Cell<Option<u64>> = const { Cell::new(None) }; }

fn answer(id: u64, allowed: bool, window: &mut Window, cx: &mut App) {
    crate::native::apps().docling.answer(id, allowed);
    dismiss(id, window, cx);
}

pub(crate) fn cancel(window: &mut Window, cx: &mut App) {
    crate::native::apps().cancel_docling_confirmation();
    if let Some(id) = OPEN.with(Cell::get) { dismiss(id, window, cx); }
}

pub(crate) fn dismiss(id: u64, window: &mut Window, cx: &mut App) {
    if OPEN.with(|open| open.get() == Some(id)) {
        OPEN.with(|open| open.set(None));
        window.close_dialog(cx);
    }
}

pub(crate) fn show(prompt: Prompt, window: &mut Window, cx: &mut App) {
    let apps = crate::native::apps();
    if !apps.docling.pending(prompt.id) {
        return;
    }
    if window.has_active_dialog(cx) {
        apps.docling.answer(prompt.id, false);
        return;
    }
    let id = prompt.id;
    OPEN.with(|open| open.set(Some(id)));
    window.open_dialog(cx, move |dialog, window, _| {
        dialog
            .title(if prompt.revoke { "Disable optional OCR?" } else { "Install this optional Docling component?" })
            .w((window.viewport_size().width - px(48.)).min(px(680.)))
            .overlay_closable(false)
            .child(div().id("docling-confirmation-detail").max_h(px(420.)).overflow_y_scroll().child(prompt.summary.clone()))
            .child(if prompt.revoke { "Downloaded files are retained." } else { "Cancel to continue selecting values manually. Software and model downloads require separate approval." })
            // Enter on the dialog, Escape, and its close button all deny. Only
            // activating the explicitly labelled footer action grants consent.
            .on_ok(move |_, window, cx| { answer(id, false, window, cx); false })
            .on_cancel(move |_, window, cx| { answer(id, false, window, cx); false })
            .on_close(move |_, _, _| {
                OPEN.with(|open| { if open.get() == Some(id) { open.set(None); } });
                crate::native::apps().docling.answer(id, false);
            })
            .footer(DialogFooter::new().child(
                Button::new("docling-cancel").label("Cancel").on_click(move |_, window, cx| answer(id, false, window, cx))
            ).child(
                Button::new("docling-confirm").label(if prompt.revoke { "Disable OCR" } else { "Install component" })
                    .on_click(move |_, window, cx| answer(id, true, window, cx))
            ))
    });
}
