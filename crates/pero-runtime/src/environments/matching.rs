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
    match_software(requirements, &binding.profile)
}

/// Match software metadata without fabricating a resource binding or a Use.
/// This result does not assert importability, allocation or execution permission.
pub fn match_software(
    requirements: &EnvironmentRequirements,
    software: &SoftwareProfile,
) -> Result<EnvironmentMatch, EnvironmentError> {
    let satisfied = |rule: &Requirement| software.satisfies(rule);
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
