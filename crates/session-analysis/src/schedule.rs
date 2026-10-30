//! Async shell. Classification stays synchronous. This module only joins
//! those futures, then reduces in transcript order.

use futures_util::future::join_all;

use crate::checkpoint::Checkpoint;
use crate::classify::classify_turn;
use crate::reduce::{finish, prepare, reduce};
use crate::types::{Analysis, Error, Input, Transcript, Turn, TurnFacts};

/// How many not-yet-reduced turns the shell may schedule.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Budget {
    stop_after: Option<u32>,
}

impl Budget {
    pub fn all() -> Self {
        Self { stop_after: None }
    }

    /// Stop after `turns` newly scheduled turns and return the checkpoint.
    /// Zero schedules nothing.
    pub fn stop_after(turns: u32) -> Self {
        Self {
            stop_after: Some(turns),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Step {
    Partial(Checkpoint),
    Done {
        analysis: Analysis,
        checkpoint: Checkpoint,
    },
}

pub async fn analyze_concurrent(
    transcript: &Transcript,
    input: &Input,
    budget: Budget,
) -> Result<Step, Error> {
    let prepared = prepare(transcript, input)?;
    resume(
        Checkpoint::from_state(prepared.state),
        &prepared.turns,
        budget,
    )
    .await
}

pub async fn resume(checkpoint: Checkpoint, turns: &[Turn], budget: Budget) -> Result<Step, Error> {
    let mut ordered: Vec<&Turn> = turns.iter().collect();
    ordered.sort_by_key(|turn| turn.index);
    let pending: Vec<&Turn> = ordered
        .into_iter()
        .filter(|turn| !checkpoint.covers(turn.index))
        .collect();
    let take = match budget.stop_after {
        Some(limit) => pending.len().min(limit as usize),
        None => pending.len(),
    };
    let facts = join_all(pending.iter().take(take).map(|turn| classify_later(turn))).await;
    let mut state = checkpoint.into_state();
    for fact in facts {
        state = reduce(state, fact)?;
    }
    if take == pending.len() {
        let analysis = finish(state.clone());
        Ok(Step::Done {
            analysis,
            checkpoint: Checkpoint::from_state(state),
        })
    } else {
        Ok(Step::Partial(Checkpoint::from_state(state)))
    }
}

async fn classify_later(turn: &Turn) -> TurnFacts {
    // One pending poll so the joined turns are actually scheduled, not just
    // called in a loop. The waker is the local executor's.
    let mut yielded = false;
    std::future::poll_fn(|context| {
        if yielded {
            std::task::Poll::Ready(())
        } else {
            yielded = true;
            context.waker().wake_by_ref();
            std::task::Poll::Pending
        }
    })
    .await;
    classify_turn(turn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reduce::analyze;
    use crate::test_support::{assistant, input, session, user};
    use crate::types::Transcript;
    use futures_executor::block_on;

    fn many(count: usize) -> Transcript {
        let mut records = Vec::new();
        let mut seq = 1u64;
        for index in 0..count {
            records.push(user(seq, index as i64 * 2, &format!("q{index}")));
            seq += 1;
            records.push(assistant(seq, index as i64 * 2 + 1, &format!("a{index}")));
            seq += 1;
        }
        Transcript {
            session: session(),
            records,
        }
    }

    #[test]
    fn concurrent_join_matches_the_sync_fold() {
        let transcript = many(8);
        let input = input();
        let sync = analyze(&transcript, &input).unwrap();
        let step = block_on(analyze_concurrent(&transcript, &input, Budget::all())).unwrap();
        let Step::Done {
            analysis,
            checkpoint,
        } = step
        else {
            panic!("full budget finishes");
        };
        assert_eq!(analysis, sync);
        assert_eq!(checkpoint.cursor(), Some(7));
    }

    #[test]
    fn stop_after_k_resumes_without_replaying_the_prefix() {
        let transcript = many(8);
        let input = input();
        let sync = analyze(&transcript, &input).unwrap();
        let partial = block_on(analyze_concurrent(
            &transcript,
            &input,
            Budget::stop_after(3),
        ))
        .unwrap();
        let Step::Partial(checkpoint) = partial else {
            panic!("budget must stop at a turn boundary");
        };
        assert_eq!(checkpoint.cursor(), Some(2));

        let prepared = crate::prepare(&transcript, &input).unwrap();
        let held = checkpoint.clone();
        let again = block_on(resume(held, &prepared.turns, Budget::stop_after(0))).unwrap();
        let Step::Partial(unchanged) = again else {
            panic!("a zero budget schedules nothing");
        };
        assert_eq!(unchanged.cursor(), Some(2));

        let done = block_on(resume(checkpoint, &prepared.turns, Budget::all())).unwrap();
        let Step::Done { analysis, .. } = done else {
            panic!("resume finishes the transcript");
        };
        assert_eq!(analysis, sync);
    }
}
