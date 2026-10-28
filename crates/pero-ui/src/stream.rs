//! Retained Markdown documents for streamed ACP messages.
//!
//! Zed retains a Markdown entity per message and appends new content. GPUI Kit
//! exposes the equivalent through TextViewState::push_str: its parser handles
//! append-only tail reparsing and bounded background-update coalescing.

#[cfg(any(target_family = "wasm", feature = "native"))]
use gpui_kit::{
    component::text::{TextView, TextViewState, TextViewStyle},
    *,
};
#[cfg(any(target_family = "wasm", feature = "native"))]
use std::time::Duration;

/// As in Zed's StreamingTextBuffer, reveal a burst over roughly 200 ms while
/// updating at most once per frame. The conversation owns the complete source
/// immediately, independently of this presentation buffer.
#[cfg(any(target_family = "wasm", feature = "native"))]
const FLUSH_INTERVAL: Duration = Duration::from_millis(16);

/// Scheduling and byte preservation are independent of GPUI/GPU availability.
/// The exact same queue is used by the live renderer and the native tests.
#[derive(Default)]
#[cfg(any(target_family = "wasm", feature = "native", test))]
struct PendingText {
    text: String,
    offset: usize,
    scheduled: bool,
    generation: u64,
    bytes_per_tick: usize,
    chunks: u64,
    flushes: u64,
}

#[cfg(any(target_family = "wasm", feature = "native", test))]
impl PendingText {
    fn append(&mut self, delta: &str) -> bool {
        if delta.is_empty() {
            return false;
        }
        // Retain only a bounded consumed prefix during a continuously running
        // stream, rather than another complete copy of the conversation text.
        if self.offset > 64 * 1024 && self.offset > self.remaining() {
            self.text.drain(..self.offset);
            self.offset = 0;
        }
        self.text.push_str(delta);
        self.chunks += 1;
        self.bytes_per_tick = self.remaining().saturating_mul(16).div_ceil(200).max(1);
        if self.scheduled {
            return false;
        }
        self.scheduled = true;
        self.generation = self.generation.wrapping_add(1);
        true
    }

    fn remaining(&self) -> usize {
        self.text.len() - self.offset
    }

    /// A new timer generation invalidates one still waking after a terminal
    /// flush. This also prevents a replaced tool output from being appended by
    /// an older reveal task.
    fn revealing(&self, generation: u64) -> bool {
        self.scheduled && self.generation == generation
    }

    fn reveal(&mut self, generation: u64) -> Option<String> {
        if !self.revealing(generation) {
            return None;
        }
        let mut end = self.offset + self.bytes_per_tick.min(self.remaining());
        // ACP chunks are valid UTF-8 strings. A frame boundary must also be a
        // codepoint boundary, including when a burst mixes Chinese and emoji.
        while !self.text.is_char_boundary(end) {
            end += 1;
        }
        let delta = self.text[self.offset..end].to_string();
        self.offset = end;
        self.flushes += 1;
        if self.offset == self.text.len() {
            self.clear();
        }
        Some(delta)
    }

    fn clear(&mut self) {
        self.text.clear();
        self.offset = 0;
        self.scheduled = false;
    }

    fn take(&mut self) -> Option<String> {
        self.scheduled = false;
        if self.remaining() == 0 {
            return None;
        }
        self.flushes += 1;
        let text = if self.offset == 0 {
            std::mem::take(&mut self.text)
        } else {
            self.text.split_off(self.offset)
        };
        self.clear();
        Some(text)
    }
}

#[cfg(any(target_family = "wasm", feature = "native"))]
pub(crate) struct StreamText {
    document: Entity<TextViewState>,
    pending: PendingText,
    follow_scroll: Option<ScrollHandle>,
    observed_bytes: usize,
    _document_observer: Subscription,
}

#[cfg(any(target_family = "wasm", feature = "native"))]
impl StreamText {
    pub fn new(text: &str, cx: &mut Context<Self>) -> Self {
        let document = cx.new(|cx| TextViewState::markdown(text, cx));
        let observer = cx.observe(&document, |this, document, cx| {
            // push_str queues an asynchronous parse. Follow only when that
            // parsed source commits, so the next layout has its actual height.
            let committed_bytes = document.read(cx).rendered_text().source().len();
            if committed_bytes != this.observed_bytes {
                this.observed_bytes = committed_bytes;
                cx.notify();
            }
        });
        Self {
            document,
            pending: PendingText::default(),
            follow_scroll: None,
            observed_bytes: text.len(),
            _document_observer: observer,
        }
    }

    /// Attach only while this message belongs to the active conversation.
    pub fn set_scroll_handle(&mut self, scroll: Option<ScrollHandle>) {
        self.follow_scroll = scroll;
    }

    pub fn has_pending(&self) -> bool {
        self.pending.remaining() > 0
    }

    pub fn stats(&self) -> (u64, u64) {
        (self.pending.chunks, self.pending.flushes)
    }

    pub fn rendered_bytes(&self, cx: &App) -> usize {
        self.document.read(cx).rendered_text().source().len()
    }

    pub fn append(&mut self, delta: &str, cx: &mut Context<Self>) {
        if !self.pending.append(delta) {
            return;
        }
        let generation = self.pending.generation;
        // A weak entity is retained by the task; removing a conversation does
        // not keep its document alive just because a flush was scheduled.
        cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(FLUSH_INTERVAL).await;
                let keep_revealing = this
                    .update(cx, |this, cx| {
                        if let Some(delta) = this.pending.reveal(generation) {
                            this.document
                                .update(cx, |document, cx| document.push_str(&delta, cx));
                            cx.notify();
                        }
                        this.pending.revealing(generation)
                    })
                    .unwrap_or(false);
                if !keep_revealing {
                    break;
                }
            }
        })
        .detach();
    }

    pub fn flush(&mut self, cx: &mut Context<Self>) {
        let Some(delta) = self.pending.take() else {
            return;
        };
        self.document
            .update(cx, |document, cx| document.push_str(&delta, cx));
        cx.notify();
    }

    /// Tool updates may replace prior output. TextViewState recognizes prefix
    /// growth itself and uses its append path instead of replacing that source.
    pub fn replace(&mut self, text: &str, cx: &mut Context<Self>) {
        self.pending.clear();
        self.document
            .update(cx, |document, cx| document.set_text(text, cx));
        cx.notify();
    }
}

#[cfg(any(target_family = "wasm", feature = "native"))]
impl Render for StreamText {
    fn render(&mut self, window: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        if let Some(scroll) = &self.follow_scroll {
            if near_bottom(scroll) {
                scroll_after_layout(scroll, window);
            }
        }
        TextView::new(&self.document).selectable(true).style(
            TextViewStyle::default()
                .paragraph_gap(rems(0.4))
                .code_block(StyleRefinement::default().font_family("JetBrains Mono")),
        )
    }
}

/// Scroll offsets are negative toward the bottom; max_offset is a positive
/// extent. Do not pull readers back down while they inspect earlier output.
#[cfg(any(target_family = "wasm", feature = "native"))]
pub(crate) fn near_bottom(scroll: &ScrollHandle) -> bool {
    scroll.max_offset().y + scroll.offset().y <= px(48.)
}

/// GPUI's scroll_to_bottom is a flag consumed on a later layout; a wheel event
/// cannot revoke it. Apply a concrete offset after the new content is laid out,
/// and discard this follow request if the reader moved since it was requested.
#[cfg(any(target_family = "wasm", feature = "native"))]
pub(crate) fn scroll_after_layout(scroll: &ScrollHandle, window: &Window) {
    let scroll = scroll.clone();
    let previous = scroll.offset();
    window.on_next_frame(move |window, _| {
        if scroll.offset() == previous {
            // Frame callbacks run before drawing. Waiting a second frame also
            // covers a request made by an event before the new content lays out.
            window.on_next_frame(move |window, _| {
                if scroll.offset() == previous {
                    let target = point(previous.x, -scroll.max_offset().y);
                    if target != previous {
                        scroll.set_offset(target);
                        window.refresh();
                    }
                }
            });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::PendingText;

    #[test]
    fn long_unicode_stream_batches_document_updates_without_losing_text() {
        let mut queue = PendingText::default();
        let mut expected = String::new();
        let mut rendered = String::new();
        let mut schedules = 0;
        // Deterministic simulated frames: 80 chunks arrive before each flush.
        // This measures the real queue's document-update boundary, not wall
        // clock/GPU throughput or the Markdown parser's internal parse count.
        for i in 0..40_000 {
            let chunk = match i % 4 {
                0 => "中文",
                1 => "🧪",
                2 => "**bold**",
                _ => "\n",
            };
            expected.push_str(chunk);
            schedules += usize::from(queue.append(chunk));
            if (i + 1) % 80 == 0 {
                rendered.push_str(&queue.take().expect("queued text"));
            }
        }
        assert_eq!(rendered, expected);
        assert_eq!(queue.chunks, 40_000);
        assert_eq!(queue.flushes, 500);
        assert_eq!(schedules, 500);
        assert!(queue.take().is_none());
    }

    #[test]
    fn empty_chunks_do_not_schedule_and_terminal_flush_preserves_tail() {
        let mut queue = PendingText::default();
        assert!(!queue.append(""));
        assert!(queue.append("```rust\n"));
        assert!(!queue.append("let n = 1;\n"));
        assert!(!queue.append("```"));
        assert_eq!(queue.take().as_deref(), Some("```rust\nlet n = 1;\n```"));
        assert_eq!((queue.chunks, queue.flushes), (3, 1));
        assert!(queue.append("尾"));
        assert_eq!(queue.take().as_deref(), Some("尾"));
    }

    #[test]
    fn adaptive_frames_preserve_chinese_emoji_and_chunk_boundaries() {
        let mut queue = PendingText::default();
        let first = "中文🧪**alpha**\n".repeat(80);
        assert!(queue.append(&first));
        let generation = queue.generation;
        let mut actual = queue.reveal(generation).expect("first frame");
        let second = "尾🙂```rust\nlet n = 1;\n```";
        assert!(!queue.append(second));
        let mut frames = 1;
        while let Some(frame) = queue.reveal(generation) {
            assert!(!frame.is_empty());
            actual.push_str(&frame);
            frames += 1;
        }
        assert_eq!(actual, first + second);
        // Ceil-to-codepoint rounding may finish slightly before 200 ms.
        assert!((10..=14).contains(&frames));
        assert_eq!(queue.flushes, frames);
        assert!(!queue.revealing(generation));
    }

    #[test]
    fn terminal_flush_reveals_tail_and_stale_tasks_cannot_consume_next_burst() {
        let mut queue = PendingText::default();
        let expected = "中文🙂".repeat(100);
        assert!(queue.append(&expected));
        let old_generation = queue.generation;
        let mut actual = queue.reveal(old_generation).expect("first frame");
        actual.push_str(&queue.take().expect("immediate terminal tail"));
        assert_eq!(actual, expected);
        assert!(queue.append("new turn🧪"));
        assert!(queue.reveal(old_generation).is_none());
        assert_eq!(queue.take().as_deref(), Some("new turn🧪"));
        assert!(queue.take().is_none());
    }

    #[test]
    fn replacement_cancels_scheduled_reveal() {
        let mut queue = PendingText::default();
        queue.append("discarded pending output");
        let old_generation = queue.generation;
        queue.clear();
        assert!(queue.reveal(old_generation).is_none());
        assert!(queue.append("replacement suffix"));
        assert!(queue.reveal(old_generation).is_none());
        assert_eq!(queue.take().as_deref(), Some("replacement suffix"));
    }
}
