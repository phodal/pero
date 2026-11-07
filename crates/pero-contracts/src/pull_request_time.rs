//! Opened time is a pure function of an RFC3339 timestamp and a caller-supplied clock.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OpenedUnit {
    Minute,
    Hour,
    Day,
}
impl OpenedUnit {
    pub fn key(self) -> &'static str {
        match self {
            Self::Minute => "pr.minutes_ago",
            Self::Hour => "pr.hours_ago",
            Self::Day => "pr.days_ago",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OpenedAgo {
    pub count: u32,
    pub unit: OpenedUnit,
}

pub fn opened_ago(opened_at: &str, now_unix: i64) -> Option<OpenedAgo> {
    let opened = parse_rfc3339(opened_at)?;
    let elapsed = now_unix.saturating_sub(opened);
    let minutes = elapsed / 60;
    if minutes < 1 {
        return Some(OpenedAgo {
            count: 0,
            unit: OpenedUnit::Minute,
        });
    }
    if minutes < 60 {
        return Some(OpenedAgo {
            count: minutes as u32,
            unit: OpenedUnit::Minute,
        });
    }
    let hours = minutes / 60;
    if hours < 24 {
        return Some(OpenedAgo {
            count: hours as u32,
            unit: OpenedUnit::Hour,
        });
    }
    let days = hours / 24;
    if days <= 30 {
        return Some(OpenedAgo {
            count: days as u32,
            unit: OpenedUnit::Day,
        });
    }
    None
}

pub fn opened_day(opened_at: &str) -> Option<String> {
    let day = opened_at.get(0..10)?.to_owned();
    parse_rfc3339(opened_at).map(|_| day)
}

pub fn avatar_url(login: &str) -> Option<String> {
    if (1..=39).contains(&login.len())
        && !login.starts_with('-')
        && !login.ends_with('-')
        && login
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        Some(format!("https://github.com/{login}.png"))
    } else {
        None
    }
}

pub(crate) fn parse_rfc3339(text: &str) -> Option<i64> {
    let bytes = text.as_bytes();
    if bytes.len() < 20
        || bytes.get(4) != Some(&b'-')
        || bytes.get(7) != Some(&b'-')
        || bytes.get(10) != Some(&b'T')
        || bytes.get(13) != Some(&b':')
        || bytes.get(16) != Some(&b':')
    {
        return None;
    }
    let year: i32 = text.get(0..4)?.parse().ok()?;
    let month: u32 = text.get(5..7)?.parse().ok()?;
    let day: u32 = text.get(8..10)?.parse().ok()?;
    let hour: u32 = text.get(11..13)?.parse().ok()?;
    let minute: u32 = text.get(14..16)?.parse().ok()?;
    let second: u32 = text.get(17..19)?.parse().ok()?;
    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hour > 23
        || minute > 59
        || second > 60
    {
        return None;
    }
    let mut rest = text.get(19..)?;
    if let Some(fraction) = rest.strip_prefix('.') {
        let digits = fraction.chars().take_while(|c| c.is_ascii_digit()).count();
        rest = fraction.get(digits..)?;
    }
    let offset = if rest == "Z" {
        0
    } else if rest.len() == 6
        && (rest.starts_with('+') || rest.starts_with('-'))
        && rest.as_bytes().get(3) == Some(&b':')
    {
        let sign = if rest.starts_with('+') { 1 } else { -1 };
        let hours: i64 = rest.get(1..3)?.parse().ok()?;
        let minutes: i64 = rest.get(4..6)?.parse().ok()?;
        sign * (hours * 3600 + minutes * 60)
    } else {
        return None;
    };
    Some(
        days_from_civil(year, month, day)? * 86400
            + hour as i64 * 3600
            + minute as i64 * 60
            + second as i64
            - offset,
    )
}

fn days_from_civil(year: i32, month: u32, day: u32) -> Option<i64> {
    if !(1970..=9999).contains(&year) {
        return None;
    }
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let yoe = (year - era * 400) as u32;
    let month_prime = if month > 2 { month - 3 } else { month + 9 };
    let day_of_year = (153 * month_prime + 2) / 5 + day - 1;
    let day_of_era = yoe * 365 + yoe / 4 - yoe / 100 + day_of_year;
    Some(era as i64 * 146097 + day_of_era as i64 - 719468)
}
