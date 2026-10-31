//! Point owns RRULE/IANA interpretation. This core owns the durable cursor and
//! the accepted time intent; an external calendar decision never dispatches work.
use super::*;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CalendarSchedule {
    pub rule: String,
    pub timezone: String,
    pub first_slot: u64,
    pub max_lateness_seconds: u64,
}

pub(super) fn validate_trigger(
    schedule: &CalendarSchedule,
    subject: &str,
    exact: &Option<ExactRef>,
    input: InputContract,
) -> Result<(), Error> {
    if schedule.rule.trim().is_empty() || schedule.rule.len() > 4096
        || schedule.rule.chars().any(char::is_control) || !identifier(&schedule.timezone)
        || schedule.first_slot > MAX_SAFE_INTEGER || schedule.max_lateness_seconds > MAX_SAFE_INTEGER
        || !identifier(subject) || !exact_valid(exact)
        || (input == InputContract::ProcessExact && exact.is_none()) {
        return Err(Error::Invalid);
    }
    Ok(())
}

pub(super) fn valid_restored_intent(request: &RunRequest) -> bool {
    let (Intent::Time { slot }, Trigger::Calendar { schedule, subject, exact }) =
        (&request.intent, &request.definition.trigger) else { return false; };
    request.through_position == 0 && request.subject == *subject && request.exact == *exact
        && *slot >= schedule.first_slot && *slot <= request.created_at && *slot <= MAX_SAFE_INTEGER
}

impl State {
    pub(super) fn reset_calendar_cursor(&mut self, definition: &Definition) {
        if let Trigger::Calendar { schedule, .. } = &definition.trigger {
            self.calendar_slots.insert(definition.id.clone(), schedule.first_slot);
        } else {
            self.calendar_slots.remove(&definition.id);
        }
    }

    pub(super) fn validate_calendar_cursors(&self) -> Result<(), Error> {
        for (id, slot) in &self.calendar_slots {
            let definition = self.latest_definition(id).ok_or(Error::Invalid)?;
            let Trigger::Calendar { schedule, .. } = &definition.trigger else { return Err(Error::Invalid); };
            if *slot < schedule.first_slot || *slot > MAX_SAFE_INTEGER
                || self.requests.iter().any(|request| request.definition == *definition
                    && matches!(request.intent, Intent::Time { slot: accepted } if accepted >= *slot)) {
                return Err(Error::Invalid);
            }
        }
        Ok(())
    }

    pub(super) fn calendar_time(&mut self, id: &str, revision: u64, slot: u64,
        next_slot: Option<u64>, now: u64, ids: &Ids) -> Result<Receipt, Error> {
        if slot > MAX_SAFE_INTEGER || next_slot.is_some_and(|next| next <= slot || next > MAX_SAFE_INTEGER) {
            return Err(Error::Invalid);
        }
        let definition = self.latest_definition(id).ok_or(Error::NotFound)?.clone();
        if revision != definition.revision { return Ok(Receipt::Updated); }
        let Trigger::Calendar { schedule, subject, exact } = &definition.trigger else { return Err(Error::Invalid); };
        let Some(expected) = self.calendar_slots.get(id).copied() else { return Ok(Receipt::Updated); };
        if slot < expected { return Ok(Receipt::Updated); }
        if slot != expected || slot > now { return Err(Error::Invalid); }
        // A pause/revocation prevents execution, while the Host-supplied calendar
        // cursor still advances so resuming cannot replay paused wall-clock slots.
        let receipt = if authorized(self, &definition).is_err() { Receipt::Updated } else {
            create_intent(self, &definition, Intent::Time { slot }, subject.clone(), exact.clone(), now,
                ids, now - slot > schedule.max_lateness_seconds)?
        };
        if let Some(next) = next_slot { self.calendar_slots.insert(id.into(), next); }
        else { self.calendar_slots.remove(id); }
        Ok(receipt)
    }
}

#[cfg(test)]
#[path = "calendar_test.rs"]
mod tests;
