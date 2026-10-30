//! Pure classification of one already bounded turn. It does not read other turns.

use crate::types::{
    Boundary, Finish, MessageClass, ModelId, ModelUse, Outcome, Record, RecordKind, ResponseKind,
    TokenUsage, ToolCallId, ToolName, Turn, TurnFacts, TurnStatus, add_tool, clip_excerpt,
};

pub fn classify_turn(turn: &Turn) -> TurnFacts {
    let mut facts = blank(turn);
    if turn.boundary == Boundary::Aside {
        for record in &turn.records {
            note_record(&mut facts, record);
        }
        facts.counts_as_turn = false;
        facts.status = TurnStatus::Unknown;
        return facts;
    }

    let mut saw_request = turn.prior_request;
    let mut response_kind = ResponseKind::Unknown;
    let mut response_seq = 0u64;
    let mut names: Vec<(ToolCallId, ToolName)> = Vec::new();
    let mut errored: Vec<ToolCallId> = Vec::new();

    for record in &turn.records {
        note_record(&mut facts, record);
        match &record.kind {
            RecordKind::User { class, text } if *class == MessageClass::Text => {
                let (excerpt, clipped) = clip_excerpt(text);
                facts.request = excerpt;
                facts.request_seq = record.seq;
                facts.response.clear();
                facts.response_seq = 0;
                response_seq = 0;
                response_kind = ResponseKind::Unknown;
                facts.truncated |= clipped;
                saw_request = true;
            }
            RecordKind::Assistant {
                class,
                text,
                finish,
                interrupted,
            } if *class == MessageClass::Text => {
                let (excerpt, clipped) = clip_excerpt(text);
                facts.truncated |= clipped;
                if excerpt.is_empty() {
                    if (*interrupted || *finish == Finish::ToolCalls) && response_seq != 0 {
                        response_kind = ResponseKind::Intermediate;
                    }
                    continue;
                }
                facts.response = excerpt;
                facts.response_seq = record.seq;
                response_seq = record.seq;
                response_kind = if *interrupted || *finish == Finish::ToolCalls {
                    ResponseKind::Intermediate
                } else {
                    ResponseKind::Final
                };
            }
            RecordKind::ToolCall {
                id,
                name,
                error,
                child,
            } => {
                facts.tool_calls += 1;
                let spawned = u32::from(child.is_some());
                add_tool(&mut facts.tools, name.clone(), 1, 0, spawned);
                if !id.is_empty() {
                    names.push((id.clone(), name.clone()));
                }
                if let Some(child) = child
                    && !facts.children.iter().any(|seen| seen == child)
                {
                    facts.children.push(child.clone());
                }
                if response_seq != 0 {
                    response_kind = ResponseKind::Intermediate;
                }
                if *error {
                    mark_error(&mut facts, &mut errored, id, Some(name));
                }
            }
            RecordKind::ToolResult { id, name, error } if *error => {
                let resolved = name.clone().or_else(|| lookup_name(&names, id));
                mark_error(&mut facts, &mut errored, id, resolved.as_ref());
            }
            _ => {}
        }
    }

    let (status, outcome, response_kind) = settle(turn, saw_request, response_kind, response_seq);
    facts.status = status;
    facts.outcome = outcome;
    facts.response_kind = response_kind;
    facts
}

fn blank(turn: &Turn) -> TurnFacts {
    let seq_start = turn
        .records
        .first()
        .map(|record| record.seq)
        .unwrap_or(turn.origin_seq);
    let seq_end = turn
        .records
        .last()
        .map(|record| record.seq)
        .unwrap_or(turn.origin_seq);
    TurnFacts {
        index: turn.index,
        id: turn.id.clone(),
        counts_as_turn: true,
        boundary: turn.boundary,
        number: turn.number,
        status: TurnStatus::Unknown,
        outcome: None,
        started_before_window: turn.started_before_window,
        request: String::new(),
        response: String::new(),
        request_seq: 0,
        response_seq: 0,
        response_kind: ResponseKind::Unknown,
        seq_start,
        seq_end,
        start: turn.records.iter().find_map(|record| record.at),
        end: turn.records.iter().rev().find_map(|record| record.at),
        tool_calls: 0,
        tool_errors: 0,
        tools: Vec::new(),
        user_messages: 0,
        assistant_messages: 0,
        system_messages: 0,
        meta_messages: 0,
        compact_summaries: 0,
        children: Vec::new(),
        models: Vec::new(),
        model_end: ModelId::new(""),
        tokens: TokenUsage::default(),
        saw_tokens: false,
        truncated: turn.started_before_window,
    }
}

fn note_record(facts: &mut TurnFacts, record: &Record) {
    match &record.kind {
        RecordKind::User { class, .. } => count_class(facts, *class, true, false, false),
        RecordKind::Assistant { class, .. } => count_class(facts, *class, false, true, false),
        RecordKind::System { class, .. } => count_class(facts, *class, false, false, true),
        _ => {}
    }
    if !record.model.is_empty() && is_text(&record.kind) {
        facts.model_end = record.model.clone();
        if let Some(existing) = facts
            .models
            .iter_mut()
            .find(|item| item.model == record.model)
        {
            existing.messages += 1;
        } else {
            facts.models.push(ModelUse {
                model: record.model.clone(),
                messages: 1,
            });
        }
    }
    if !record.tokens.is_empty() {
        facts.saw_tokens = true;
        absorb_tokens(&mut facts.tokens, record.tokens);
    }
}

fn is_text(kind: &RecordKind) -> bool {
    matches!(
        kind,
        RecordKind::User {
            class: MessageClass::Text,
            ..
        } | RecordKind::Assistant {
            class: MessageClass::Text,
            ..
        } | RecordKind::System {
            class: MessageClass::Text,
            ..
        }
    )
}

fn count_class(
    facts: &mut TurnFacts,
    class: MessageClass,
    user: bool,
    assistant: bool,
    system: bool,
) {
    match class {
        MessageClass::Text if user => facts.user_messages += 1,
        MessageClass::Text if assistant => facts.assistant_messages += 1,
        MessageClass::Text if system => facts.system_messages += 1,
        MessageClass::Meta => facts.meta_messages += 1,
        MessageClass::Compact => facts.compact_summaries += 1,
        MessageClass::Text => {}
    }
}

fn absorb_tokens(total: &mut TokenUsage, extra: TokenUsage) {
    if extra.has_components() {
        total.input += extra.input;
        total.output += extra.output;
        total.reasoning += extra.reasoning;
        total.cache_read += extra.cache_read;
        total.cache_write += extra.cache_write;
    } else {
        total.reported += extra.reported;
    }
}

fn lookup_name(names: &[(ToolCallId, ToolName)], id: &ToolCallId) -> Option<ToolName> {
    names
        .iter()
        .rev()
        .find(|(seen, _)| seen == id)
        .map(|(_, name)| name.clone())
}

fn mark_error(
    facts: &mut TurnFacts,
    errored: &mut Vec<ToolCallId>,
    id: &ToolCallId,
    name: Option<&ToolName>,
) {
    if !id.is_empty() {
        if errored.iter().any(|seen| seen == id) {
            return;
        }
        errored.push(id.clone());
    }
    facts.tool_errors += 1;
    if let Some(name) = name {
        add_tool(&mut facts.tools, name.clone(), 0, 1, 0);
    }
}

fn settle(
    turn: &Turn,
    saw_request: bool,
    mut response_kind: ResponseKind,
    response_seq: u64,
) -> (TurnStatus, Option<Outcome>, ResponseKind) {
    let Some(finish) = turn.end else {
        if turn.boundary == Boundary::Explicit {
            return (TurnStatus::Unfinished, None, response_kind);
        }
        if !saw_request {
            return (TurnStatus::Unknown, None, response_kind);
        }
        if response_kind == ResponseKind::Final {
            return (TurnStatus::Completed, Some(Outcome::Ended), response_kind);
        }
        return (TurnStatus::Unfinished, None, response_kind);
    };
    let (status, outcome) = match finish {
        Finish::Error => (TurnStatus::Failed, Some(Outcome::Failed)),
        Finish::Aborted => (TurnStatus::Stopped, Some(Outcome::Stopped)),
        Finish::Stop
        | Finish::Completed
        | Finish::MaxTokens
        | Finish::Refusal
        | Finish::ToolCalls => (TurnStatus::Completed, Some(Outcome::Ended)),
        Finish::None | Finish::Other => (TurnStatus::Unknown, None),
    };
    if turn.boundary == Boundary::Inferred && !saw_request {
        return (TurnStatus::Unknown, None, response_kind);
    }
    if status == TurnStatus::Completed
        && response_seq != 0
        && response_kind == ResponseKind::Unknown
    {
        response_kind = ResponseKind::Final;
    }
    (status, outcome, response_kind)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{
        assistant, child_session, compact, meta, system, tool_call, tool_call_child, tool_result,
        user,
    };
    use crate::types::{Boundary, Finish, TokenUsage, Turn, TurnId};

    fn conversation(end: Option<Finish>, records: Vec<Record>) -> Turn {
        Turn {
            index: 0,
            id: TurnId::new("inferred:1").unwrap(),
            boundary: Boundary::Inferred,
            number: 0,
            started_before_window: false,
            prior_request: false,
            end,
            origin_seq: 1,
            records,
        }
    }

    #[test]
    fn classification_reads_one_turn() {
        let long = "a".repeat(801);
        let multibyte = format!("{}测", "b".repeat(799));
        let cases = [
            (
                "explicit error keeps the tool and the excerpts",
                {
                    let mut turn = conversation(
                        Some(Finish::Error),
                        vec![
                            user(2, 11, "Review"),
                            tool_call(3, 12, "1", "Read", false),
                            assistant(4, 13, "tests passed"),
                        ],
                    );
                    turn.boundary = Boundary::Explicit;
                    turn.number = 1;
                    turn
                },
                TurnStatus::Failed,
                Some(Outcome::Failed),
                "Review",
                "tests passed",
                1,
                0,
            ),
            (
                "abort is its own stopped outcome",
                conversation(
                    Some(Finish::Aborted),
                    vec![user(1, 10, "stop"), assistant(2, 11, "ok")],
                ),
                TurnStatus::Stopped,
                Some(Outcome::Stopped),
                "stop",
                "ok",
                0,
                0,
            ),
            (
                "inferred final text completes without a turn end",
                conversation(None, vec![user(1, 10, "ask"), assistant(2, 11, "yes")]),
                TurnStatus::Completed,
                Some(Outcome::Ended),
                "ask",
                "yes",
                0,
                0,
            ),
            (
                "explicit text without an end stays unfinished",
                {
                    let mut turn =
                        conversation(None, vec![user(1, 10, "ask"), assistant(2, 11, "yes")]);
                    turn.boundary = Boundary::Explicit;
                    turn
                },
                TurnStatus::Unfinished,
                None,
                "ask",
                "yes",
                0,
                0,
            ),
            (
                "tool error is counted once and the child is kept",
                conversation(
                    None,
                    vec![
                        user(1, 10, "run"),
                        tool_call_child(2, 11, "bash-1", "Bash", child_session()),
                        tool_result(3, 12, "bash-1", true),
                        tool_result(4, 13, "bash-1", true),
                    ],
                ),
                TurnStatus::Unfinished,
                None,
                "run",
                "",
                1,
                1,
            ),
        ];
        for (name, turn, status, outcome, request, response, calls, errors) in cases {
            let facts = classify_turn(&turn);
            assert_eq!(facts.status, status, "{name}");
            assert_eq!(facts.outcome, outcome, "{name}");
            assert_eq!(facts.request, request, "{name}");
            assert_eq!(facts.response, response, "{name}");
            assert_eq!(facts.tool_calls, calls, "{name}");
            assert_eq!(facts.tool_errors, errors, "{name}");
        }

        let errored = classify_turn(&conversation(
            None,
            vec![
                user(1, 10, "run"),
                tool_call_child(2, 11, "bash-1", "Bash", child_session()),
                tool_result(3, 12, "bash-1", true),
            ],
        ));
        assert_eq!(errored.tools[0].name.as_str(), "Bash");
        assert_eq!(errored.tools[0].errors, 1);
        assert_eq!(errored.children.len(), 1);
        assert_eq!(errored.response_kind, ResponseKind::Unknown);

        let clipped = classify_turn(&conversation(
            None,
            vec![user(1, 10, &long), assistant(2, 11, &multibyte)],
        ));
        assert!(clipped.truncated);
        assert!(clipped.request.ends_with('…'));
        assert!(clipped.response.ends_with('…'));
        assert!(!clipped.response.contains('测'));

        let wake = classify_turn(&conversation(
            None,
            vec![
                meta(1, 10, "keepalive"),
                compact(2, 11, "summary"),
                system(3, 12, "policy"),
                user(4, 13, "ask").with_model(crate::ModelId::new("a")),
                assistant(5, 14, "yes")
                    .with_model(crate::ModelId::new("b"))
                    .with_tokens(TokenUsage {
                        input: 3,
                        output: 5,
                        cache_read: 1,
                        ..TokenUsage::default()
                    }),
            ],
        ));
        assert_eq!(wake.user_messages, 1);
        assert_eq!(wake.meta_messages, 1);
        assert_eq!(wake.compact_summaries, 1);
        assert_eq!(wake.system_messages, 1);
        assert_eq!(wake.tokens.input, 3);
        assert_eq!(wake.tokens.output, 5);
        assert_eq!(wake.tokens.cache_read, 1);
        assert_eq!(wake.model_end.as_str(), "b");
        assert_eq!(wake.models.len(), 2);
    }
}
