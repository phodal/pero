//! Sequential reduce. The same facts in the same order always yield the same state.
//! A fact at or behind the cursor is a no-op.

use serde::{Deserialize, Serialize};

use crate::classify::classify_turn;
use crate::partition::{Partition, partition};
use crate::types::{
    Analysis, AnalysisId, Coverage, Error, Identity, Input, Metrics, Session, Source, TimeMs,
    TokenSource, TokenUsage, Transcript, TurnFacts, TurnStatus, Window, account_from_usage,
    add_tokens, add_tool,
};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReduceState {
    pub analysis_id: AnalysisId,
    pub at: TimeMs,
    pub window: Option<Window>,
    pub session: Identity,
    pub source: Source,
    pub coverage: Coverage,
    pub metrics: Metrics,
    pub turns: Vec<TurnFacts>,
    pub cursor: Option<u32>,
    pub reported_tokens: TokenUsage,
    pub saw_record_tokens: bool,
    pub accumulated_tokens: TokenUsage,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Prepared {
    pub state: ReduceState,
    pub turns: Vec<crate::Turn>,
}

pub fn prepare(transcript: &Transcript, input: &Input) -> Result<Prepared, Error> {
    let partitioned = partition(transcript, input.window)?;
    Ok(Prepared {
        state: initial(transcript, input, &partitioned),
        turns: partitioned.turns,
    })
}

pub fn reduce(mut state: ReduceState, facts: TurnFacts) -> Result<ReduceState, Error> {
    let expected = state.cursor.map(|cursor| cursor + 1).unwrap_or(0);
    if facts.index < expected {
        return Ok(state);
    }
    if facts.index > expected {
        return Err(Error::TURN_GAP);
    }
    apply(&mut state, facts);
    Ok(state)
}

pub fn analyze(transcript: &Transcript, input: &Input) -> Result<Analysis, Error> {
    let prepared = prepare(transcript, input)?;
    let mut state = prepared.state;
    for turn in prepared.turns {
        state = reduce(state, classify_turn(&turn))?;
    }
    Ok(finish(state))
}

pub fn finish(mut state: ReduceState) -> Analysis {
    if !state.saw_record_tokens && !state.reported_tokens.is_empty() {
        state.metrics.tokens = account_from_usage(state.reported_tokens, TokenSource::Reported);
    }
    state.coverage.complete = state.coverage.unknown == 0;
    Analysis {
        id: state.analysis_id,
        at: state.at,
        window: state.window,
        session: state.session,
        source: state.source,
        turns: state.turns,
        metrics: state.metrics,
        coverage: state.coverage,
    }
}

pub(crate) fn check(state: &ReduceState) -> Result<(), Error> {
    if state.analysis_id.as_str().trim().is_empty() || state.session.id.as_str().trim().is_empty() {
        return Err(Error::CHECKPOINT);
    }
    if let Some(window) = state.window
        && window.end.get() <= window.start.get()
    {
        return Err(Error::CHECKPOINT);
    }
    if !state.accumulated_tokens.is_valid() || !state.reported_tokens.is_valid() {
        return Err(Error::CHECKPOINT);
    }
    let mut previous = None;
    for turn in &state.turns {
        if !turn.counts_as_turn || previous.is_some_and(|index| turn.index <= index) {
            return Err(Error::CHECKPOINT);
        }
        match state.cursor {
            Some(cursor) if turn.index <= cursor => {}
            _ => return Err(Error::CHECKPOINT),
        }
        previous = Some(turn.index);
    }
    Ok(())
}

fn initial(transcript: &Transcript, input: &Input, partitioned: &Partition) -> ReduceState {
    ReduceState {
        analysis_id: input.id.clone(),
        at: input.at,
        window: input.window,
        session: identity(&transcript.session),
        source: partitioned.source.clone(),
        coverage: partitioned.coverage.clone(),
        metrics: Metrics::default(),
        turns: Vec::new(),
        cursor: None,
        reported_tokens: transcript.session.reported_tokens,
        saw_record_tokens: false,
        accumulated_tokens: TokenUsage::default(),
    }
}

fn identity(session: &Session) -> Identity {
    Identity {
        id: session.id.clone(),
        title: session.title.clone(),
        agent: session.agent.clone(),
        model: session.model.clone(),
        models: Vec::new(),
        project_path: session.project_path.clone(),
        git_branch: session.git_branch.clone(),
        repository: session.repository.clone(),
        project_id: session.project_id.clone(),
        task_id: session.task_id.clone(),
        run_id: session.run_id.clone(),
        spawned: session.spawned,
        parent: session.parent.clone(),
    }
}

fn apply(state: &mut ReduceState, facts: TurnFacts) {
    state.cursor = Some(facts.index);
    state.metrics.user_messages += facts.user_messages;
    state.metrics.assistant_messages += facts.assistant_messages;
    state.metrics.system_messages += facts.system_messages;
    state.metrics.meta_messages += facts.meta_messages;
    state.metrics.compact_summaries += facts.compact_summaries;
    state.metrics.tool_calls += facts.tool_calls;
    state.metrics.tool_errors += facts.tool_errors;
    for tool in &facts.tools {
        add_tool(
            &mut state.metrics.tools,
            tool.name.clone(),
            tool.calls,
            tool.errors,
            tool.children,
        );
    }
    for child in &facts.children {
        if !state.metrics.children.contains(child) {
            state.metrics.children.push(child.clone());
        }
    }
    for model in &facts.models {
        if let Some(existing) = state
            .session
            .models
            .iter_mut()
            .find(|item| item.model == model.model)
        {
            existing.messages += model.messages;
        } else {
            state.session.models.push(model.clone());
        }
    }
    if !facts.model_end.is_empty() {
        state.session.model = facts.model_end.clone();
    }
    if facts.saw_tokens {
        state.saw_record_tokens = true;
        add_tokens(&mut state.accumulated_tokens, facts.tokens);
        state.metrics.tokens = account_from_usage(state.accumulated_tokens, TokenSource::Records);
    }
    if facts.counts_as_turn {
        match facts.status {
            TurnStatus::Completed => state.metrics.completed += 1,
            TurnStatus::Failed => state.metrics.failed += 1,
            TurnStatus::Stopped => state.metrics.stopped += 1,
            TurnStatus::Unfinished => state.metrics.unfinished += 1,
            TurnStatus::Unknown => state.metrics.unknown += 1,
        }
        state.metrics.turns += 1;
        state.turns.push(facts);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{assistant, input, session, user};
    use crate::types::{TokenSource, TokenUsage, Transcript};

    fn transcript(records: Vec<crate::Record>, reported: TokenUsage) -> Transcript {
        let mut session = session();
        session.reported_tokens = reported;
        Transcript { session, records }
    }

    #[test]
    fn reduce_aggregates_in_order_and_skips_a_replay() {
        let prepared = prepare(
            &transcript(
                vec![
                    user(1, 10, "one"),
                    assistant(2, 11, "a").with_tokens(TokenUsage {
                        input: 2,
                        output: 3,
                        ..TokenUsage::default()
                    }),
                    user(3, 12, "two"),
                    assistant(4, 13, "b").with_tokens(TokenUsage {
                        input: 4,
                        ..TokenUsage::default()
                    }),
                ],
                TokenUsage {
                    reported: 100,
                    ..TokenUsage::default()
                },
            ),
            &input(),
        )
        .unwrap();
        let mut state = prepared.state;
        let first = classify_turn(&prepared.turns[0]);
        state = reduce(state, first.clone()).unwrap();
        let replayed = reduce(state.clone(), first).unwrap();
        assert_eq!(replayed, state);
        assert_eq!(replayed.metrics.user_messages, 1);
        state = reduce(replayed, classify_turn(&prepared.turns[1])).unwrap();
        let analysis = finish(state);
        assert_eq!(analysis.metrics.turns, 2);
        assert_eq!(analysis.metrics.completed, 2);
        assert_eq!(analysis.metrics.user_messages, 2);
        assert_eq!(analysis.metrics.tokens.input, 6);
        assert_eq!(analysis.metrics.tokens.output, 3);
        assert_eq!(analysis.metrics.tokens.total, 9);
        assert_eq!(analysis.metrics.tokens.source, TokenSource::Records);
        assert_eq!(analysis.session.git_branch, "main");
        assert_eq!(analysis.session.repository, "github.com/org/pero");
        assert!(analysis.session.spawned);
        assert_eq!(analysis.session.parent.unwrap().as_str(), "parent");
        assert_eq!(analysis.session.model.as_str(), "session-model");
    }

    #[test]
    fn reported_tokens_apply_only_when_no_record_has_any() {
        let analysis = analyze(
            &transcript(
                vec![user(1, 10, "ask"), assistant(2, 11, "yes")],
                TokenUsage {
                    reported: 40,
                    ..TokenUsage::default()
                },
            ),
            &input(),
        )
        .unwrap();
        assert_eq!(analysis.metrics.tokens.total, 40);
        assert_eq!(analysis.metrics.tokens.source, TokenSource::Reported);
        assert_eq!(analysis.metrics.tokens.input, 0);
    }

    #[test]
    fn a_gap_in_the_turn_index_is_rejected() {
        let prepared = prepare(
            &transcript(
                vec![user(1, 10, "ask"), assistant(2, 11, "yes")],
                TokenUsage::default(),
            ),
            &input(),
        )
        .unwrap();
        let mut facts = classify_turn(&prepared.turns[0]);
        facts.index = 2;
        let error = reduce(prepared.state, facts).unwrap_err();
        assert_eq!(error, Error::TURN_GAP);
    }
}
