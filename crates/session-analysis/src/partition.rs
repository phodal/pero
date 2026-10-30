//! Sequential turn boundaries. An inferred turn depends on earlier records,
//! so this walk is not the parallel map.

use sha2::{Digest, Sha256};

use crate::types::{
    Boundary, Coverage, Error, Finish, MessageClass, Record, RecordKind, Session, Source, TimeMs,
    ToolName, Transcript, Turn, TurnId, Window,
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Partition {
    pub turns: Vec<Turn>,
    pub coverage: Coverage,
    pub source: Source,
}

#[derive(Clone, Copy)]
enum Place {
    Before,
    Inside,
    After,
    Unplaced,
}

struct Open {
    boundary: Boundary,
    number: u32,
    seq: u64,
    started_before: bool,
    saw_request: bool,
    saw_response: bool,
    prior_request: bool,
    end: Option<Finish>,
    records: Vec<Record>,
}

impl Open {
    fn start(boundary: Boundary, number: u32, seq: u64, before: bool) -> Self {
        Self {
            boundary,
            number,
            seq,
            started_before: before,
            saw_request: false,
            saw_response: false,
            prior_request: false,
            end: None,
            records: Vec::new(),
        }
    }

    fn into_turn(self, index: u32) -> Turn {
        Turn {
            index,
            id: turn_id(self.boundary, self.seq),
            boundary: self.boundary,
            number: self.number,
            started_before_window: self.started_before,
            prior_request: self.prior_request,
            end: self.end,
            origin_seq: self.seq,
            records: self.records,
        }
    }
}

pub fn partition(transcript: &Transcript, window: Option<Window>) -> Result<Partition, Error> {
    validate(transcript, window)?;
    let mut turns = Vec::new();
    let mut next_index = 0u32;
    let mut open = None;
    let mut coverage = Coverage {
        complete: true,
        ..Coverage::default()
    };
    let mut source = Source::default();
    let mut hasher = Sha256::new();
    if let Some(last) = transcript.records.last() {
        source.as_of_seq = last.seq;
    }
    for record in &transcript.records {
        match place(record.at, window) {
            Place::Before => {
                coverage.before_window += 1;
                open = observe(open, record, false, &mut turns, &mut next_index);
            }
            Place::After => {
                coverage.after_window += 1;
            }
            Place::Unplaced => {
                coverage.unknown += 1;
                coverage.complete = false;
            }
            Place::Inside => {
                hash_record(&mut hasher, record);
                note_span(&mut source, record.seq);
                source.records += 1;
                if matches!(record.kind, RecordKind::Unknown) {
                    coverage.unknown += 1;
                    coverage.complete = false;
                    continue;
                }
                coverage.in_window += 1;
                open = observe(open, record, true, &mut turns, &mut next_index);
            }
        }
    }
    close(&mut open, &mut turns, &mut next_index);
    source.digest = format!("sha256:{}", hex_encode(hasher.finalize().as_slice()));
    Ok(Partition {
        turns,
        coverage,
        source,
    })
}

pub(crate) fn validate_session_tokens(session: &Session) -> Result<(), Error> {
    if session.reported_tokens.is_valid() {
        Ok(())
    } else {
        Err(Error::TOKENS)
    }
}

fn validate(transcript: &Transcript, window: Option<Window>) -> Result<(), Error> {
    if let Some(window) = window
        && window.end.get() <= window.start.get()
    {
        return Err(Error::WINDOW);
    }
    validate_session_tokens(&transcript.session)?;
    let mut previous = 0u64;
    for record in &transcript.records {
        if record.seq == 0 || record.seq <= previous {
            return Err(Error::SEQUENCE);
        }
        previous = record.seq;
        if !record.tokens.is_valid() {
            return Err(Error::TOKENS);
        }
    }
    Ok(())
}

fn place(at: Option<TimeMs>, window: Option<Window>) -> Place {
    let Some(window) = window else {
        return Place::Inside;
    };
    let Some(at) = at else {
        return Place::Unplaced;
    };
    if at.get() < window.start.get() {
        Place::Before
    } else if at.get() >= window.end.get() {
        Place::After
    } else {
        Place::Inside
    }
}

fn observe(
    mut open: Option<Open>,
    record: &Record,
    visible: bool,
    turns: &mut Vec<Turn>,
    next_index: &mut u32,
) -> Option<Open> {
    match &record.kind {
        RecordKind::TurnStart { turn } => {
            close(&mut open, turns, next_index);
            Some(Open::start(Boundary::Explicit, *turn, record.seq, !visible))
        }
        RecordKind::TurnEnd { turn, finish } => {
            if open
                .as_ref()
                .is_some_and(|current| current.number != 0 && *turn != 0 && current.number != *turn)
            {
                close(&mut open, turns, next_index);
            }
            if open.is_none() {
                open = Some(Open::start(Boundary::Inferred, *turn, record.seq, !visible));
            }
            if visible {
                open.as_mut().unwrap().end = Some(*finish);
            }
            let finished = open.take().unwrap();
            if visible || !finished.records.is_empty() {
                emit(finished, turns, next_index);
            }
            None
        }
        RecordKind::User { class, .. } if *class == MessageClass::Text => {
            let split = open.as_ref().is_some_and(|current| {
                current.boundary == Boundary::Inferred
                    && (current.saw_request || current.saw_response)
            });
            if split {
                close(&mut open, turns, next_index);
            }
            if open.is_none() {
                open = Some(Open::start(Boundary::Inferred, 0, record.seq, !visible));
            }
            let current = open.as_mut().unwrap();
            current.saw_request = true;
            current.saw_response = false;
            if visible {
                current.records.push(record.clone());
            } else {
                current.prior_request = true;
            }
            open
        }
        RecordKind::Assistant { class, .. } if *class == MessageClass::Text => {
            if open.is_none() {
                open = Some(Open::start(Boundary::Inferred, 0, record.seq, !visible));
            }
            let current = open.as_mut().unwrap();
            current.saw_response = true;
            if visible {
                current.records.push(record.clone());
            }
            open
        }
        RecordKind::ToolCall { .. } | RecordKind::ToolResult { .. } => {
            if open.is_none() {
                open = Some(Open::start(Boundary::Inferred, 0, record.seq, !visible));
            }
            if visible {
                open.as_mut().unwrap().records.push(record.clone());
            }
            open
        }
        RecordKind::User { .. } | RecordKind::Assistant { .. } | RecordKind::System { .. } => {
            if !visible {
                return open;
            }
            if let Some(current) = open.as_mut() {
                current.records.push(record.clone());
                return open;
            }
            emit(
                Open {
                    boundary: Boundary::Aside,
                    number: 0,
                    seq: record.seq,
                    started_before: false,
                    saw_request: false,
                    saw_response: false,
                    prior_request: false,
                    end: None,
                    records: vec![record.clone()],
                },
                turns,
                next_index,
            );
            open
        }
        RecordKind::Unknown => open,
    }
}

fn close(open: &mut Option<Open>, turns: &mut Vec<Turn>, next_index: &mut u32) {
    if let Some(finished) = open.take() {
        emit(finished, turns, next_index);
    }
}

fn emit(finished: Open, turns: &mut Vec<Turn>, next_index: &mut u32) {
    if finished.records.is_empty() && finished.end.is_none() {
        return;
    }
    let index = *next_index;
    *next_index += 1;
    turns.push(finished.into_turn(index));
}

fn note_span(source: &mut Source, seq: u64) {
    if source.records == 0 {
        source.start_seq = seq;
    }
    source.end_seq = seq;
}

fn turn_id(boundary: Boundary, seq: u64) -> TurnId {
    let name = match boundary {
        Boundary::Explicit => "explicit",
        Boundary::Inferred => "inferred",
        Boundary::Aside => "aside",
    };
    TurnId::new(format!("{name}:{seq}")).expect("turn id is non-empty")
}

fn hash_record(hasher: &mut Sha256, record: &Record) {
    hasher.update(canonical(record).as_bytes());
    hasher.update(b"\n");
}

fn canonical(record: &Record) -> String {
    let at = record
        .at
        .map(|time| time.get().to_string())
        .unwrap_or_default();
    let body = match &record.kind {
        RecordKind::User { class, text } => format!("user:{class:?}:{text}"),
        RecordKind::Assistant {
            class,
            text,
            finish,
            interrupted,
        } => format!("assistant:{class:?}:{finish:?}:{interrupted}:{text}"),
        RecordKind::System { class, text } => format!("system:{class:?}:{text}"),
        RecordKind::ToolCall {
            id,
            name,
            error,
            child,
        } => format!(
            "tool-call:{}:{}:{error}:{}",
            id.as_str(),
            name.as_str(),
            child.as_ref().map(crate::SessionId::as_str).unwrap_or("")
        ),
        RecordKind::ToolResult { id, name, error } => format!(
            "tool-result:{}:{}:{error}",
            id.as_str(),
            name.as_ref().map(ToolName::as_str).unwrap_or("")
        ),
        RecordKind::TurnStart { turn } => format!("turn-start:{turn}"),
        RecordKind::TurnEnd { turn, finish } => format!("turn-end:{turn}:{finish:?}"),
        RecordKind::Unknown => "unknown".to_string(),
    };
    format!("{}\t{at}\t{body}", record.seq)
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{
        assistant, at, meta, session, tool_call, turn_end, turn_start, user,
    };
    use crate::types::{Record, RecordKind, TokenUsage, Transcript};

    fn run(records: Vec<Record>, window: Option<Window>) -> Partition {
        partition(
            &Transcript {
                session: session(),
                records,
            },
            window,
        )
        .unwrap()
    }

    fn seqs(turn: &Turn) -> Vec<u64> {
        turn.records.iter().map(|record| record.seq).collect()
    }

    #[test]
    fn boundaries_follow_explicit_and_inferred_turns() {
        let cases = [
            (
                "explicit brackets stay one turn",
                vec![
                    turn_start(1, 10, 1),
                    user(2, 11, "Review"),
                    tool_call(3, 12, "1", "Read", false),
                    assistant(4, 13, "done"),
                    turn_end(5, 14, 1, Finish::Error),
                ],
                None,
                vec![(0, Boundary::Explicit, vec![2, 3, 4], Some(Finish::Error))],
            ),
            (
                "inferred user text opens the next turn",
                vec![
                    user(1, 10, "first"),
                    assistant(2, 11, "one"),
                    user(3, 12, "second"),
                    assistant(4, 13, "two"),
                ],
                None,
                vec![
                    (0, Boundary::Inferred, vec![1, 2], None),
                    (1, Boundary::Inferred, vec![3, 4], None),
                ],
            ),
            (
                "explicit second request stays in the turn",
                vec![
                    turn_start(1, 10, 1),
                    user(2, 11, "first"),
                    assistant(3, 12, "partial"),
                    user(4, 13, "second"),
                    turn_end(5, 14, 1, Finish::Stop),
                ],
                None,
                vec![(0, Boundary::Explicit, vec![2, 3, 4], Some(Finish::Stop))],
            ),
            (
                "meta inside a turn does not split it",
                vec![
                    user(1, 10, "ask"),
                    meta(2, 11, "keepalive"),
                    assistant(3, 12, "yes"),
                ],
                None,
                vec![(0, Boundary::Inferred, vec![1, 2, 3], None)],
            ),
        ];
        for (name, records, window, expect) in cases {
            let partitioned = run(records, window);
            let got: Vec<_> = partitioned
                .turns
                .iter()
                .map(|turn| (turn.index, turn.boundary, seqs(turn), turn.end))
                .collect();
            assert_eq!(got, expect, "{name}");
        }
    }

    #[test]
    fn window_keeps_context_and_drops_the_far_side() {
        let window = Window {
            start: at(100),
            end: at(200),
        };
        let partitioned = run(
            vec![
                turn_start(1, 50, 1),
                user(2, 60, "old"),
                user(3, 100, "new"),
                assistant(4, 150, "answer"),
                turn_end(5, 200, 1, Finish::Stop),
                user(6, 250, "later"),
            ],
            Some(window),
        );
        assert_eq!(partitioned.turns.len(), 1);
        let turn = &partitioned.turns[0];
        assert_eq!(seqs(turn), vec![3, 4]);
        assert!(turn.started_before_window);
        assert!(turn.prior_request);
        assert_eq!(turn.end, None, "an end at the exclusive bound is outside");
        assert_eq!(partitioned.coverage.before_window, 2);
        assert_eq!(partitioned.coverage.after_window, 2);
        assert!(partitioned.coverage.complete);
        assert_eq!(partitioned.source.start_seq, 3);
        assert_eq!(partitioned.source.end_seq, 4);
        assert_eq!(partitioned.source.as_of_seq, 6);
        let inside_only = run(
            vec![
                turn_start(1, 50, 1),
                user(2, 60, "old"),
                user(3, 100, "new"),
                assistant(4, 150, "answer"),
            ],
            Some(window),
        );
        assert_eq!(partitioned.source.digest, inside_only.source.digest);
        assert!(partitioned.source.digest.starts_with("sha256:"));
    }

    #[test]
    fn leading_meta_is_an_aside_and_unknown_is_coverage() {
        let partitioned = run(
            vec![
                meta(1, 10, "keepalive"),
                user(2, 11, "ask"),
                Record::new(3, Some(at(12)), RecordKind::Unknown),
            ],
            None,
        );
        assert_eq!(partitioned.turns.len(), 2);
        assert_eq!(partitioned.turns[0].boundary, Boundary::Aside);
        assert_eq!(seqs(&partitioned.turns[0]), vec![1]);
        assert_eq!(partitioned.turns[1].boundary, Boundary::Inferred);
        assert_eq!(partitioned.coverage.unknown, 1);
        assert!(!partitioned.coverage.complete);
        assert_eq!(partitioned.coverage.in_window, 2);
    }

    #[test]
    fn entry_validation_rejects_a_broken_transcript() {
        let cases: &[(&str, Vec<Record>, Option<Window>, Error)] = &[
            ("zero seq", vec![user(0, 1, "x")], None, Error::SEQUENCE),
            (
                "repeated seq",
                vec![user(1, 1, "a"), user(1, 2, "b")],
                None,
                Error::SEQUENCE,
            ),
            (
                "negative tokens",
                vec![user(1, 1, "a").with_tokens(TokenUsage {
                    input: -1,
                    ..TokenUsage::default()
                })],
                None,
                Error::TOKENS,
            ),
            (
                "empty window",
                vec![user(1, 1, "a")],
                Some(Window {
                    start: at(5),
                    end: at(5),
                }),
                Error::WINDOW,
            ),
        ];
        for (name, records, window, expect) in cases {
            let error = partition(
                &Transcript {
                    session: session(),
                    records: records.clone(),
                },
                *window,
            )
            .unwrap_err();
            assert_eq!(error, *expect, "{name}");
        }
    }
}
