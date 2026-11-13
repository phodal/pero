//! Check outcomes for both check runs and legacy commit statuses.
use super::PullRequestCheck;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CheckOutcome {
    Attention,
    Running,
    Passed,
    Skipped,
    Neutral,
    Unknown,
}

impl CheckOutcome {
    pub const ALL: [Self; 6] = [
        Self::Attention,
        Self::Running,
        Self::Passed,
        Self::Skipped,
        Self::Neutral,
        Self::Unknown,
    ];

    pub fn index(self) -> usize {
        match self {
            Self::Attention => 0,
            Self::Running => 1,
            Self::Passed => 2,
            Self::Skipped => 3,
            Self::Neutral => 4,
            Self::Unknown => 5,
        }
    }

    pub fn key(self) -> &'static str {
        match self {
            Self::Attention => "pr.check_attention",
            Self::Running => "pr.check_running",
            Self::Passed => "pr.check_passed",
            Self::Skipped => "pr.check_skipped",
            Self::Neutral => "pr.check_neutral",
            Self::Unknown => "pr.check_unknown",
        }
    }
}

impl PullRequestCheck {
    pub fn outcome(&self) -> CheckOutcome {
        match self.status.as_str() {
            "queued" | "in_progress" | "pending" | "requested" | "waiting" => CheckOutcome::Running,
            "success" => CheckOutcome::Passed,
            "failure" | "error" => CheckOutcome::Attention,
            "completed" => match self.conclusion.as_deref() {
                Some("success") => CheckOutcome::Passed,
                Some("skipped") => CheckOutcome::Skipped,
                Some("neutral") => CheckOutcome::Neutral,
                Some(
                    "failure" | "timed_out" | "cancelled" | "action_required" | "startup_failure"
                    | "stale",
                ) => CheckOutcome::Attention,
                _ => CheckOutcome::Unknown,
            },
            _ => CheckOutcome::Unknown,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CheckSummary {
    counts: [usize; 6],
}

impl CheckSummary {
    pub fn from_checks(checks: &[PullRequestCheck]) -> Self {
        let mut summary = Self::default();
        for check in checks {
            summary.counts[check.outcome().index()] += 1;
        }
        summary
    }

    pub fn count(self, outcome: CheckOutcome) -> usize {
        self.counts[outcome.index()]
    }

    pub fn total(self) -> usize {
        self.counts.into_iter().sum()
    }

    /// Skipped and neutral checks stay in the denominator and never become passes.
    pub fn key(self) -> &'static str {
        if self.count(CheckOutcome::Attention) > 0 {
            "pr.checks_attention"
        } else if self.count(CheckOutcome::Running) > 0 {
            "pr.checks_running"
        } else if self.count(CheckOutcome::Unknown) > 0 || self.total() == 0 {
            "pr.checks_unknown"
        } else if self.count(CheckOutcome::Passed) == self.total() {
            "pr.checks_passed"
        } else {
            "pr.checks_completed"
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_outcomes_preserve_observed_results() {
        use CheckOutcome::*;
        let cases = [
            ("completed", Some("success"), Passed),
            ("success", None, Passed),
            ("failure", None, Attention),
            ("error", None, Attention),
            ("pending", None, Running),
            ("queued", None, Running),
            ("in_progress", Some("success"), Running),
            ("requested", None, Running),
            ("waiting", None, Running),
            ("completed", Some("failure"), Attention),
            ("completed", Some("timed_out"), Attention),
            ("completed", Some("cancelled"), Attention),
            ("completed", Some("action_required"), Attention),
            ("completed", Some("startup_failure"), Attention),
            ("completed", Some("stale"), Attention),
            ("completed", Some("skipped"), Skipped),
            ("completed", Some("neutral"), Neutral),
            ("completed", None, Unknown),
            ("completed", Some("new_conclusion"), Unknown),
            ("new_status", Some("success"), Unknown),
        ];
        for (status, conclusion, expected) in cases {
            let check = PullRequestCheck {
                name: String::new(),
                status: status.into(),
                conclusion: conclusion.map(str::to_owned),
                url: None,
            };
            assert_eq!(check.outcome(), expected, "{status}: {conclusion:?}");
        }
        for (outcomes, expected_key) in [
            (vec![], "pr.checks_unknown"),
            (vec![Passed, Passed], "pr.checks_passed"),
            (vec![Passed, Skipped, Neutral], "pr.checks_completed"),
            (vec![Passed, Unknown], "pr.checks_unknown"),
            (vec![Passed, Running], "pr.checks_running"),
            (vec![Running, Attention], "pr.checks_attention"),
        ] {
            let mut summary = CheckSummary::default();
            for outcome in &outcomes {
                summary.counts[outcome.index()] += 1;
            }
            assert_eq!(summary.total(), outcomes.len());
            assert_eq!(summary.key(), expected_key);
        }
    }
}
