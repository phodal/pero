//! Bounded, pure wall-clock interpretation. The core owns durable slot acceptance.
//! Whole-minute HOURLY/DAILY/WEEKLY/MONTHLY RRULEs; ASCII case-insensitive tokens.
//! Lists expand every distinct value. COUNT, UNTIL and ordinal weekdays are refused.
use chrono::{DateTime, Datelike, Days, LocalResult, NaiveDate, NaiveDateTime, TimeZone, Timelike};
use chrono_tz::Tz;
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug)]
enum Frequency { Hourly, Daily, Weekly, Monthly }
#[derive(Debug)]
pub(super) struct Calendar {
    frequency: Frequency, hours: Vec<u32>, minutes: Vec<u32>, days: Vec<u32>,
    month_days: Vec<u32>, interval: i64, zone: Tz, anchor: NaiveDateTime,
}
const WEEKDAYS: [&str; 7] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
impl Calendar {
    pub fn parse(rule: &str, zone: &str, anchor: u64) -> Result<Self, String> {
        if rule.is_empty() || rule.len()>4096 || rule.chars().any(char::is_control) { return Err("Invalid calendar rule".into()); }
        let zone=zone.parse::<Tz>().map_err(|_| "Unknown IANA time zone")?;
        let rule=rule.to_ascii_uppercase();
        let mut fields=BTreeMap::new();
        for field in rule.strip_prefix("RRULE:").unwrap_or(&rule).split(';') {
            let (key,value)=field.split_once('=').ok_or("Expected RRULE KEY=VALUE")?;
            if !["FREQ","BYHOUR","BYMINUTE","BYDAY","BYMONTHDAY","BYSECOND","INTERVAL"].contains(&key) { return Err(format!("Unsupported RRULE field: {key}")); }
            if fields.insert(key,value).is_some() { return Err(format!("Duplicate RRULE field: {key}")); }
        }
        let interval=fields.get("INTERVAL").copied().unwrap_or("1").parse::<i64>().map_err(|_| "Invalid INTERVAL")?;
        if !(1..=366).contains(&interval) { return Err("INTERVAL must be between 1 and 366".into()); }
        if fields.get("BYSECOND").is_some_and(|value| *value!="0") { return Err("Only BYSECOND=0 is supported".into()); }
        let frequency=match fields.get("FREQ").copied() {
            Some("HOURLY")=>Frequency::Hourly, Some("DAILY")=>Frequency::Daily,
            Some("WEEKLY")=>Frequency::Weekly, Some("MONTHLY")=>Frequency::Monthly,
            _=>return Err("Only HOURLY, DAILY, WEEKLY and MONTHLY calendar rules are supported".into()),
        };
        let numbers=|name:&str,limit:u32|->Result<Vec<u32>,String>{
            let value=fields.get(name).ok_or_else(||format!("{name} is required"))?;
            let mut values=Vec::new();
            for part in value.split(',') {
                if part.is_empty() || !part.bytes().all(|b|b.is_ascii_digit()) { return Err(format!("Invalid {name}")); }
                let number=part.parse::<u32>().map_err(|_|format!("Invalid {name}"))?;
                if number>=limit { return Err(format!("{name} is out of range")); }
                values.push(number);
            }
            values.sort_unstable(); values.dedup(); Ok(values)
        };
        let hours=if matches!(frequency,Frequency::Hourly)&&!fields.contains_key("BYHOUR") {(0..24).collect()}else{numbers("BYHOUR",24)?};
        let minutes=numbers("BYMINUTE",60)?;
        let mut days=Vec::new();
        if let Some(value)=fields.get("BYDAY") {
            for day in value.split(',') { days.push(WEEKDAYS.iter().position(|v|*v==day).ok_or("BYDAY must contain unnumbered weekdays MO through SU")? as u32); }
            days.sort_unstable(); days.dedup();
        }
        if matches!(frequency,Frequency::Weekly)&&days.is_empty() { return Err("WEEKLY requires BYDAY".into()); }
        let month_days=if fields.contains_key("BYMONTHDAY") {
            let values=numbers("BYMONTHDAY",32)?;
            if values.contains(&0) { return Err("BYMONTHDAY must be between 1 and 31".into()); } values
        }else{vec![]};
        if matches!(frequency,Frequency::Monthly)&&month_days.is_empty() { return Err("MONTHLY requires BYMONTHDAY".into()); }
        if !month_days.is_empty()&&(!matches!(frequency,Frequency::Monthly)||!days.is_empty()) { return Err("BYMONTHDAY is supported only for MONTHLY without BYDAY".into()); }
        let anchor=DateTime::from_timestamp(i64::try_from(anchor).map_err(|_|"Timestamp out of range")?,0).ok_or("Timestamp out of range")?.with_timezone(&zone).naive_local();
        Ok(Self{frequency,hours,minutes,days,month_days,interval,zone,anchor})
    }
    pub fn timezone(&self)->String { self.zone.name().into() }
    pub fn rule(&self)->String {
        let list=|v:&[u32]|v.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
        let mut rule=format!("FREQ={}",match self.frequency {Frequency::Hourly=>"HOURLY",Frequency::Daily=>"DAILY",Frequency::Weekly=>"WEEKLY",Frequency::Monthly=>"MONTHLY"});
        if !matches!(self.frequency,Frequency::Hourly)||self.hours.len()!=24 {rule.push_str(&format!(";BYHOUR={}",list(&self.hours)));}
        rule.push_str(&format!(";BYMINUTE={}",list(&self.minutes)));
        if !self.days.is_empty() {rule.push_str(&format!(";BYDAY={}",self.days.iter().map(|d|WEEKDAYS[*d as usize]).collect::<Vec<_>>().join(",")));}
        if self.interval!=1 {rule.push_str(&format!(";INTERVAL={}",self.interval));}
        if !self.month_days.is_empty() {rule.push_str(&format!(";BYMONTHDAY={}",list(&self.month_days)));}
        rule
    }
    fn date(&self,at:u64)->Result<NaiveDate,String> {
        Ok(DateTime::from_timestamp(i64::try_from(at).map_err(|_|"Timestamp out of range")?,0).ok_or("Timestamp out of range")?.with_timezone(&self.zone).date_naive())
    }
    fn slots(&self,date:NaiveDate)->Vec<u64> {
        if !self.days.is_empty()&&!self.days.contains(&date.weekday().num_days_from_monday()) {return vec![];}
        let anchor=self.anchor.date();
        let eligible=match self.frequency {
            Frequency::Hourly=>true,
            Frequency::Daily=>(date-anchor).num_days().rem_euclid(self.interval)==0,
            Frequency::Weekly=>{
                let week=date-chrono::Duration::days(date.weekday().num_days_from_monday() as i64);
                let start=anchor-chrono::Duration::days(anchor.weekday().num_days_from_monday() as i64);
                (week-start).num_days().div_euclid(7).rem_euclid(self.interval)==0
            },
            Frequency::Monthly=>{
                let months=i64::from(date.year()-anchor.year())*12+i64::from(date.month())-i64::from(anchor.month());
                months.rem_euclid(self.interval)==0&&self.month_days.contains(&date.day())
            },
        };
        if !eligible{return vec![];}
        let mut slots=Vec::new();
        for hour in &self.hours { for minute in &self.minutes {
            if matches!(self.frequency,Frequency::Hourly) {
                let hours=(date-anchor).num_days()*24+i64::from(*hour)-i64::from(self.anchor.hour());
                if hours.rem_euclid(self.interval)!=0 {continue;}
            }
            let wall=date.and_hms_opt(*hour,*minute,0).expect("validated hour/minute");
            // Gaps have no occurrence; folds select only the earlier instant.
            let instant=match self.zone.from_local_datetime(&wall) {LocalResult::Single(v)=>Some(v),LocalResult::Ambiguous(a,b)=>Some(a.min(b)),LocalResult::None=>None};
            if let Some(slot)=instant.and_then(|v|u64::try_from(v.timestamp()).ok()){slots.push(slot);}
        }}
        slots.sort_unstable();slots
    }
    pub fn next(&self,after:u64)->Result<u64,String> {
        let date=self.date(after)?;
        // Explicitly bound pathological/impossible calendars; never guess a slot.
        for offset in 0..=14610 {
            let day=date.checked_add_days(Days::new(offset)).ok_or("Calendar date out of range")?;
            if let Some(slot)=self.slots(day).into_iter().find(|slot|*slot>after){return Ok(slot);}
        }
        Err("No calendar occurrence within the supported 40-year search horizon".into())
    }
    pub fn recent(&self,at:u64,max_lateness:u64)->Result<Option<u64>,String> {
        if max_lateness>3600{return Err("Calendar catch-up is limited to one hour".into());}
        let date=self.date(at)?;let mut slots=self.slots(date);
        if let Some(previous)=date.pred_opt(){slots.extend(self.slots(previous));}
        Ok(slots.into_iter().filter(|slot|*slot<=at&&at-slot<=max_lateness).max())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn at(value:&str)->u64 {DateTime::parse_from_rfc3339(value).unwrap().timestamp() as u64}
    #[test]
    fn daily_weekly_and_boundary() {
        for (rule,zone,input,output) in [
            ("FREQ=DAILY;BYHOUR=9;BYMINUTE=0","Asia/Shanghai","2026-10-31T00:59:59Z","2026-10-31T01:00:00Z"),
            ("FREQ=DAILY;BYHOUR=9;BYMINUTE=0","Asia/Shanghai","2026-10-31T01:00:00Z","2026-11-01T01:00:00Z"),
            ("FREQ=WEEKLY;BYDAY=MO,FR;BYHOUR=9;BYMINUTE=15","UTC","2026-10-31T00:00:00Z","2026-11-02T09:15:00Z"),
        ] {assert_eq!(Calendar::parse(rule,zone,at(input)).unwrap().next(at(input)).unwrap(),at(output));}
    }
    #[test]
    fn dst_gap_and_fold_run_once() {
        for (hour,input,output) in [
            (2,"2026-03-08T06:00:00Z","2026-03-09T06:30:00Z"),
            (1,"2026-11-01T05:00:00Z","2026-11-01T05:30:00Z"),
            (1,"2026-11-01T05:30:00Z","2026-11-02T06:30:00Z"),
            (1,"2026-11-01T06:00:00Z","2026-11-02T06:30:00Z"),
        ] {assert_eq!(Calendar::parse(&format!("FREQ=DAILY;BYHOUR={hour};BYMINUTE=30"),"America/New_York",at(input)).unwrap().next(at(input)).unwrap(),at(output));}
    }
    #[test]
    fn intervals_keep_first_slot_phase_on_restart() {
        for (rule,created,first,next) in [
            ("FREQ=HOURLY;INTERVAL=3;BYMINUTE=15;BYSECOND=0","2026-10-31T10:20:00Z","2026-10-31T13:15:00Z","2026-10-31T16:15:00Z"),
            ("FREQ=DAILY;INTERVAL=2;BYHOUR=9;BYMINUTE=0","2026-10-31T10:00:00Z","2026-11-02T09:00:00Z","2026-11-04T09:00:00Z"),
            ("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;BYHOUR=9;BYMINUTE=0","2026-10-31T10:00:00Z","2026-11-09T09:00:00Z","2026-11-23T09:00:00Z"),
            ("FREQ=MONTHLY;BYMONTHDAY=31;BYHOUR=9;BYMINUTE=0","2026-01-31T10:00:00Z","2026-03-31T09:00:00Z","2026-05-31T09:00:00Z"),
            ("FREQ=MONTHLY;INTERVAL=12;BYMONTHDAY=29;BYHOUR=9;BYMINUTE=0","2026-02-01T10:00:00Z","2028-02-29T09:00:00Z","2032-02-29T09:00:00Z"),
        ] {
            let initial=Calendar::parse(rule,"UTC",at(created)).unwrap();
            assert_eq!(initial.next(at(created)).unwrap(),at(first),"{rule}");
            assert_eq!(Calendar::parse(&initial.rule(),"UTC",at(first)).unwrap().next(at(first)).unwrap(),at(next),"{rule}");
        }
    }
    #[test]
    fn catchup_is_bounded_and_fold_is_not_a_second_occurrence() {
        let rule=Calendar::parse("FREQ=DAILY;BYHOUR=23;BYMINUTE=30","UTC",0).unwrap();let slot=at("2026-10-30T23:30:00Z");
        assert_eq!(rule.recent(slot,3600).unwrap(),Some(slot));
        assert_eq!(rule.recent(slot+3600,3600).unwrap(),Some(slot));assert_eq!(rule.recent(slot+3601,3600).unwrap(),None);
        let fold=Calendar::parse("FREQ=DAILY;BYHOUR=1;BYMINUTE=30","America/New_York",0).unwrap();
        assert_eq!(fold.recent(at("2026-11-01T06:30:00Z"),3600).unwrap(),Some(at("2026-11-01T05:30:00Z")));
        assert_eq!(fold.recent(at("2026-11-01T06:30:01Z"),3600).unwrap(),None);
    }
    #[test]
    fn unsupported_rules_fail_explicitly() {
        for rule in ["FREQ=YEARLY;BYHOUR=9;BYMINUTE=0","FREQ=WEEKLY;BYHOUR=9;BYMINUTE=0","FREQ=DAILY;BYHOUR=9","FREQ=DAILY;BYHOUR=24;BYMINUTE=0","FREQ=DAILY;BYHOUR=9;BYMINUTE=0;COUNT=3","FREQ=DAILY;BYHOUR=9;BYMINUTE=0;INTERVAL=0","FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYDAY=1MO","FREQ=DAILY;FREQ=DAILY;BYHOUR=9;BYMINUTE=0","FREQ=HOURLY;BYMINUTE=5;BYSECOND=30"] {assert!(Calendar::parse(rule,"UTC",0).is_err(),"{rule}");}
        assert!(Calendar::parse("FREQ=DAILY;BYHOUR=9;BYMINUTE=0","Not/AZone",0).is_err());
    }
    #[test]
    fn case_insensitive_lists_preserve_each_occurrence() {
        let rule=Calendar::parse("rrule:freq=hourly;interval=1;byminute=5,35;bysecond=0","UTC",0).unwrap();
        let first=rule.next(at("2026-10-31T10:00:00Z")).unwrap();let second=rule.next(first).unwrap();let third=rule.next(second).unwrap();
        assert_eq!([first,second,third],[at("2026-10-31T10:05:00Z"),at("2026-10-31T10:35:00Z"),at("2026-10-31T11:05:00Z")]);
        assert_eq!(rule.rule(),"FREQ=HOURLY;BYMINUTE=5,35");
    }
    #[test]
    fn normalization_roundtrips() {
        let rule=Calendar::parse("RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=FR,MO,MO;BYMINUTE=00;BYHOUR=09","Asia/Shanghai",0).unwrap();
        assert_eq!(rule.rule(),"FREQ=WEEKLY;BYHOUR=9;BYMINUTE=0;BYDAY=MO,FR");
        assert_eq!(Calendar::parse(&rule.rule(),&rule.timezone(),0).unwrap().next(0).unwrap(),rule.next(0).unwrap());
    }
}
