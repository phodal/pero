//! Retain structured answers until the live session accepts or cancels them.
use crate::panel::ChatPanel;
use gpui_kit::{
    component::{
        button::*,
        input::{Input, InputEvent, InputState},
        *,
    },
    prelude::*,
    *,
};
use pero_contracts::{
    HostCommand,
    user_questions::{PendingQuestions, QuestionAnswer, QuestionReply},
};
use serde::Serialize;
use std::{cell::OnceCell, rc::Rc};

#[derive(Clone, Serialize)]
pub(crate) struct QuestionForm {
    pub batch: PendingQuestions,
    pub selected: Vec<Vec<usize>>,
    pub submitted: bool,
    pub error: Option<String>,
    #[serde(skip)]
    controls: Rc<OnceCell<QuestionControls>>,
}

struct QuestionControls {
    inputs: Vec<Entity<InputState>>,
    options: Vec<Vec<crate::view_bounds::ViewBounds>>,
    input_bounds: Vec<crate::view_bounds::ViewBounds>,
    submit: crate::view_bounds::ViewBounds,
    cancel: crate::view_bounds::ViewBounds,
    _subscriptions: Vec<Subscription>,
}

impl QuestionForm {
    pub fn new(batch: PendingQuestions) -> Self {
        Self {
            selected: vec![vec![]; batch.request.questions.len()],
            batch,
            submitted: false,
            error: None,
            controls: Rc::new(OnceCell::new()),
        }
    }

    fn controls(
        &self,
        thread: &str,
        locale: &str,
        window: &mut Window,
        cx: &mut Context<ChatPanel>,
    ) -> &QuestionControls {
        self.controls.get_or_init(|| {
            let mut inputs = Vec::new();
            let mut subscriptions = Vec::new();
            for (index, question) in self.batch.request.questions.iter().enumerate() {
                let input = cx.new(|cx| {
                    InputState::new(window, cx)
                        .placeholder(pero_contracts::i18n::text(locale, "chat.question_other"))
                });
                let thread = thread.to_owned();
                let request = self.batch.request_id.clone();
                let multiple = question.multi_select;
                subscriptions.push(cx.subscribe(
                    &input,
                    move |this, input, event: &InputEvent, cx| {
                        if matches!(event, InputEvent::PressEnter { .. }) {
                            this.answer_user_questions(&thread, &request, false, cx);
                            return;
                        }
                        if !matches!(event, InputEvent::Change) {
                            return;
                        }
                        let text = input.read(cx).value().to_string();
                        if let Some(form) = this
                            .chats
                            .iter_mut()
                            .find(|chat| chat.id == thread)
                            .and_then(|chat| {
                                chat.user_questions
                                    .iter_mut()
                                    .find(|form| form.batch.request_id == request)
                            })
                        {
                            if !multiple && !text.trim().is_empty() {
                                form.selected[index].clear();
                            }
                            form.error = None;
                        }
                        cx.notify();
                    },
                ));
                inputs.push(input);
            }
            QuestionControls {
                inputs,
                options: self
                    .batch
                    .request
                    .questions
                    .iter()
                    .map(|question| {
                        question
                            .options
                            .iter()
                            .map(|_| Default::default())
                            .collect()
                    })
                    .collect(),
                input_bounds: self
                    .batch
                    .request
                    .questions
                    .iter()
                    .map(|_| Default::default())
                    .collect(),
                submit: Default::default(),
                cancel: Default::default(),
                _subscriptions: subscriptions,
            }
        })
    }

    fn reply(&self, cx: &App) -> QuestionReply {
        QuestionReply::Answered {
            answers: self
                .selected
                .iter()
                .enumerate()
                .map(|(index, selected)| QuestionAnswer {
                    question_index: index,
                    selected_options: selected.clone(),
                    text: self
                        .controls
                        .get()
                        .map(|controls| controls.inputs[index].read(cx).value().to_string())
                        .unwrap_or_default(),
                })
                .collect(),
        }
    }

    pub fn bounds(&self) -> serde_json::Value {
        self.controls.get().map(|controls|serde_json::json!({
            "request_id":self.batch.request_id,
            "options":controls.options.iter().map(|question|question.iter().map(|bounds|bounds.snapshot()).collect::<Vec<_>>()).collect::<Vec<_>>(),
            "inputs":controls.input_bounds.iter().map(|bounds|bounds.snapshot()).collect::<Vec<_>>(),
            "submit":controls.submit.snapshot(),"cancel":controls.cancel.snapshot(),
        })).unwrap_or_default()
    }
}

impl ChatPanel {
    pub(crate) fn user_questions(
        &self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let chat = self.active_chat.and_then(|index| self.chats.get(index))?;
        let form = chat.user_questions.first()?;
        let controls = form.controls(&chat.id, &self.locale, window, cx);
        let valid = form.reply(cx).validate(&form.batch.request).is_ok();
        let p = pero_theme::UiAppearance::global(cx).palette.clone();
        let thread = chat.id.clone();
        let request = form.batch.request_id.clone();
        let mut questions = div()
            .id("user-question-list")
            .max_h(px(360.))
            .overflow_y_scroll()
            .flex()
            .flex_col()
            .gap(px(12.));
        for (index, question) in form.batch.request.questions.iter().enumerate() {
            let mut choices = div().flex().flex_col().gap(px(4.));
            for (option_index, option) in question.options.iter().enumerate() {
                let thread = thread.clone();
                let request = request.clone();
                let selected = form.selected[index].contains(&option_index);
                let mut choice = div()
                    .flex()
                    .flex_col()
                    .gap(px(4.))
                    .child(
                        Button::new(("question-option", index * 4 + option_index))
                            .outline()
                            .small()
                            .w_full()
                            .relative()
                            .child(controls.options[index][option_index].probe())
                            .toggled(selected)
                            .disabled(form.submitted)
                            .when(selected, |button| button.icon(IconName::Check))
                            .label(option.label.clone())
                            .accessibility_label(format!("{}: {}", question.question, option.label))
                            .on_click(cx.listener(move |this, _, window, cx| {
                                let Some(form) = this
                                    .chats
                                    .iter_mut()
                                    .find(|chat| chat.id == thread)
                                    .and_then(|chat| {
                                        chat.user_questions
                                            .iter_mut()
                                            .find(|form| form.batch.request_id == request)
                                    })
                                else {
                                    return;
                                };
                                if form.submitted {
                                    return;
                                }
                                if form.batch.request.questions[index].multi_select {
                                    if form.selected[index].contains(&option_index) {
                                        form.selected[index]
                                            .retain(|choice| *choice != option_index);
                                    } else {
                                        form.selected[index].push(option_index);
                                    }
                                } else {
                                    form.selected[index] = vec![option_index];
                                    if let Some(controls) = form.controls.get() {
                                        controls.inputs[index].update(cx, |input, cx| {
                                            input.set_value("", window, cx)
                                        });
                                    }
                                }
                                form.error = None;
                                cx.notify();
                            })),
                    )
                    .child(
                        div()
                            .text_size(px(12.))
                            .text_color(p.text_muted)
                            .child(option.description.clone()),
                    );
                if selected && !option.preview.is_empty() {
                    choice = choice.child(
                        div()
                            .p(px(8.))
                            .bg(p.surface_muted)
                            .font_family("monospace")
                            .text_size(px(12.))
                            .child(option.preview.clone()),
                    );
                }
                choices = choices.child(choice);
            }
            questions = questions.child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(6.))
                    .child(
                        div()
                            .text_size(px(14.))
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(question.question.clone()),
                    )
                    .when(question.multi_select, |el| {
                        el.child(
                            div()
                                .text_size(px(12.))
                                .text_color(p.text_muted)
                                .child(self.t("chat.question_multiple")),
                        )
                    })
                    .child(choices)
                    .child(
                        div()
                            .relative()
                            .child(controls.input_bounds[index].probe())
                            .child(
                                Input::new(&controls.inputs[index])
                                    .small()
                                    .disabled(form.submitted)
                                    .aria_label(format!(
                                        "{}: {}",
                                        question.question,
                                        self.t("chat.question_other")
                                    )),
                            ),
                    ),
            );
        }
        let submit_thread = thread.clone();
        let submit_request = request.clone();
        Some(
            div()
                .id("user-questions")
                .w_full()
                .max_w(px(pero_theme::COMPOSER_MAX))
                .min_w_0()
                .mx_auto()
                .px(px(12.))
                .py(px(8.))
                .child(questions)
                .when_some(form.error.clone(), |el, error| {
                    el.child(
                        div()
                            .mt(px(6.))
                            .text_size(px(12.))
                            .text_color(p.error)
                            .child(error),
                    )
                })
                .child(
                    div()
                        .mt(px(8.))
                        .flex()
                        .gap(px(8.))
                        .child(
                            Button::new("submit-user-questions")
                                .primary()
                                .small()
                                .label(self.t("chat.question_submit"))
                                .relative()
                                .child(controls.submit.probe())
                                .disabled(form.submitted || !valid)
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.answer_user_questions(
                                        &submit_thread,
                                        &submit_request,
                                        false,
                                        cx,
                                    )
                                })),
                        )
                        .child(
                            Button::new("cancel-user-questions")
                                .ghost()
                                .small()
                                .label(self.t("chat.question_cancel"))
                                .relative()
                                .child(controls.cancel.probe())
                                .disabled(form.submitted)
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.answer_user_questions(&thread, &request, true, cx)
                                })),
                        ),
                )
                .into_any_element(),
        )
    }

    fn answer_user_questions(
        &mut self,
        thread: &str,
        request: &str,
        cancel: bool,
        cx: &mut Context<Self>,
    ) {
        let Some(form) = self
            .chats
            .iter_mut()
            .find(|chat| chat.id == thread)
            .and_then(|chat| {
                chat.user_questions
                    .iter_mut()
                    .find(|form| form.batch.request_id == request)
            })
        else {
            return;
        };
        if form.submitted {
            return;
        }
        let reply = if cancel {
            QuestionReply::Cancelled {}
        } else {
            form.reply(cx)
        };
        if reply.validate(&form.batch.request).is_err() {
            return;
        }
        form.submitted = true;
        form.error = None;
        cx.emit(crate::ChatAction::Command(
            HostCommand::AnswerUserQuestions {
                thread_id: thread.into(),
                request_id: request.into(),
                reply,
            },
        ));
        cx.notify();
    }
}
