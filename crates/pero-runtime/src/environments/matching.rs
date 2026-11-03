use super::*;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EnvironmentMatch {
    pub preferred_satisfied: usize,
}

/// Required conditions first, then preferences. Ties retain caller-supplied order.
pub fn select_profile<'a>(
    requirements: &EnvironmentRequirements,
    candidates: &'a [EnvironmentBinding],
    now_ms: u64,
    max_age_ms: u64,
) -> Result<&'a EnvironmentBinding, Vec<EnvironmentError>> {
    let mut selected: Option<(&EnvironmentBinding, usize)> = None;
    let mut failures = Vec::new();
    for binding in candidates {
        match match_profile(requirements, binding, now_ms, max_age_ms) {
            Ok(matched)
                if selected.is_none_or(|(_, score)| matched.preferred_satisfied > score) =>
            {
                selected = Some((binding, matched.preferred_satisfied));
            }
            Ok(_) => (),
            Err(error) => failures.push(error),
        }
    }
    selected.map(|(binding, _)| binding).ok_or_else(|| {
        if failures.is_empty() {
            vec![EnvironmentError::ObservationMissing]
        } else {
            failures
        }
    })
}

/// Match facts only. No resource acquisition, import, preparation or fallback.
pub fn match_profile(
    requirements: &EnvironmentRequirements,
    binding: &EnvironmentBinding,
    now_ms: u64,
    max_age_ms: u64,
) -> Result<EnvironmentMatch, EnvironmentError> {
    if max_age_ms == 0
        || binding.observed_at_ms > now_ms
        || now_ms - binding.observed_at_ms > max_age_ms
    {
        return Err(EnvironmentError::ObservationMissing);
    }
    let profile = binding.profile.observation();
    let satisfied = |rule: &Requirement| match rule {
        Requirement::Profile { digest } => binding.profile.id() == digest,
        Requirement::Python {
            major,
            minor,
            patch,
        } => {
            profile.python.major == *major
                && profile.python.minor == *minor
                && patch.is_none_or(|patch| profile.python.patch == patch)
        }
        Requirement::Package { name, version } => profile
            .packages
            .get(name)
            .and_then(Option::as_ref)
            .is_some_and(|actual| version.as_ref().is_none_or(|expected| expected == actual)),
        Requirement::Native { name, sha256 } => profile.native.get(name).is_some_and(|actual| {
            actual.status == NativeStatus::Observed
                && actual.version.is_some()
                && actual.sha256.is_some()
                && sha256
                    .as_ref()
                    .is_none_or(|expected| actual.sha256.as_ref() == Some(expected))
        }),
        Requirement::Platform { system, machine } => {
            profile.system == *system && profile.machine == *machine
        }
    };
    let missing: Vec<_> = requirements
        .required()
        .iter()
        .filter(|r| !satisfied(r))
        .cloned()
        .collect();
    if !missing.is_empty() {
        return Err(EnvironmentError::RequirementUnsatisfied(missing));
    }
    Ok(EnvironmentMatch {
        preferred_satisfied: requirements
            .preferred()
            .iter()
            .filter(|r| satisfied(r))
            .count(),
    })
}
