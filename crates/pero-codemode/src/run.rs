//! One workspace write at a time.
//!
//! The caller supplies paths, the interpreter identity, and the moment a
//! deadline or cancel happens. This module does not spawn processes or read
//! a clock.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    path::{Component, Path, PathBuf},
};

pub const OUTPUT_LIMIT: usize = 65_536;
const MAX_PROGRAM_CHARS: usize = 65_536;
pub const MAX_REQUEST_ID: usize = 128;
const MAX_ENV_ID: usize = 64;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Book {
    runs: BTreeMap<String, CodeRun>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct CodeRun {
    request_id: String,
    workspace: String,
    env_id: String,
    interpreter: String,
    program_digest: String,
    prefix: String,
    marker_digest: String,
    output_limit: usize,
    phase: Phase,
    intent: Option<Stop>,
    receipt: Option<Receipt>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
enum Phase {
    Accepted,
    Running,
    Terminal,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Stop {
    Exit,
    Cancel,
    Deadline,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Receipt {
    pub stop: Stop,
    pub exit_code: Option<i32>,
    pub program_digest: String,
    pub interpreter: String,
    pub prefix: String,
    pub marker_digest: String,
    pub stdout: String,
    pub stderr: String,
    pub truncated: bool,
}

pub struct Submit {
    pub request_id: String,
    pub workspace: String,
    pub runs_root: String,
    pub env_id: String,
    pub interpreter: String,
    pub program: String,
    pub prefix: String,
    pub marker_digest: String,
    pub output_limit: usize,
}

pub enum Input {
    Submit(Submit),
    Started {
        request_id: String,
    },
    Cancel {
        request_id: String,
    },
    Deadline {
        request_id: String,
    },
    Finish {
        request_id: String,
        exit_code: Option<i32>,
        stdout: String,
        stderr: String,
        streams_truncated: bool,
    },
    Interrupt {
        request_id: String,
    },
}

#[derive(Debug)]
pub struct Prepare {
    pub request_id: String,
    pub program_path: PathBuf,
    pub program: String,
    pub interpreter: PathBuf,
    pub cwd: PathBuf,
    pub output_limit: usize,
}

#[derive(Debug)]
pub enum Effect {
    Prepare(Prepare),
    Kill { request_id: String },
    Receipt(Receipt),
    None,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reject {
    RequestId,
    Program,
    Path,
    Conflict,
    Busy,
    InProgress,
    Missing,
}

impl Reject {
    pub fn text(self) -> &'static str {
        match self {
            Reject::RequestId | Reject::Program | Reject::Path => "invalid",
            Reject::Conflict => "conflict",
            Reject::Busy => "busy",
            Reject::InProgress => "in_progress",
            Reject::Missing => "missing",
        }
    }
}

/// A request or environment id is a short file-name-safe token.
///
/// The Host uses it to name a directory, so it must not be `.`, `..`, end with a
/// dot (Windows drops trailing dots, so `a.` and `a` would share a directory), or
/// be a Windows device name.
pub fn valid_ident(value: &str, max: usize) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= max
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
        && !value.ends_with('.')
        && !is_device_name(value)
}

fn is_device_name(value: &str) -> bool {
    let stem = value.split('.').next().unwrap_or(value).to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
}

/// The directory that holds one run's program. It is named by a digest of the
/// request id, so ids that differ only by case cannot share a directory on a
/// case-insensitive file system.
fn run_dir_name(request_id: &str) -> String {
    program_digest(request_id)[..32].to_string()
}

pub fn program_digest(program: &str) -> String {
    Sha256::digest(program.as_bytes())
        .iter()
        .fold(String::with_capacity(64), |mut out, byte| {
            const HEX: &[u8; 16] = b"0123456789abcdef";
            out.push(char::from(HEX[(byte >> 4) as usize]));
            out.push(char::from(HEX[(byte & 0xf) as usize]));
            out
        })
}

/// Return the stored receipt when the request id is already known.
/// A different program is a conflict. A run that has not finished is left running.
pub fn replay(book: &Book, request_id: &str, program: &str) -> Result<Effect, Reject> {
    if !valid_ident(request_id, MAX_REQUEST_ID) {
        return Err(Reject::RequestId);
    }
    if program.is_empty() || program.chars().count() > MAX_PROGRAM_CHARS {
        return Err(Reject::Program);
    }
    lookup_existing(book.runs.get(request_id).ok_or(Reject::Missing)?, program)
}

fn lookup_existing(run: &CodeRun, program: &str) -> Result<Effect, Reject> {
    if run.program_digest != program_digest(program) {
        return Err(Reject::Conflict);
    }
    if run.phase != Phase::Terminal {
        return Err(Reject::InProgress);
    }
    Ok(Effect::Receipt(
        run.receipt
            .clone()
            .expect("a finished run keeps its receipt"),
    ))
}

pub fn apply(book: &Book, input: Input) -> Result<(Book, Effect), Reject> {
    let mut next = book.clone();
    let effect = match input {
        Input::Submit(submit) => next.submit(submit)?,
        Input::Started { request_id } => next.started(&request_id)?,
        Input::Cancel { request_id } => next.stop(&request_id, Stop::Cancel)?,
        Input::Deadline { request_id } => next.stop(&request_id, Stop::Deadline)?,
        Input::Finish {
            request_id,
            exit_code,
            stdout,
            stderr,
            streams_truncated,
        } => next.finish(&request_id, exit_code, stdout, stderr, streams_truncated)?,
        Input::Interrupt { request_id } => next.interrupt(&request_id)?,
    };
    Ok((next, effect))
}

/// A process that was accepted or running when the Host stopped is unknown.
/// The same request id is not started again.
pub fn settle(mut book: Book) -> Book {
    let pending: Vec<String> = book
        .runs
        .iter()
        .filter(|(_, run)| run.phase != Phase::Terminal)
        .map(|(id, _)| id.clone())
        .collect();
    for id in pending {
        let _ = book.interrupt(&id);
    }
    book
}

impl Book {
    pub fn contains(&self, request_id: &str) -> bool {
        self.runs.contains_key(request_id)
    }

    fn submit(&mut self, submit: Submit) -> Result<Effect, Reject> {
        if !valid_ident(&submit.request_id, MAX_REQUEST_ID) {
            return Err(Reject::RequestId);
        }
        if submit.program.is_empty() || submit.program.chars().count() > MAX_PROGRAM_CHARS {
            return Err(Reject::Program);
        }
        if let Some(run) = self.runs.get(&submit.request_id) {
            return lookup_existing(run, &submit.program);
        }
        let digest = program_digest(&submit.program);
        if !valid_ident(&submit.env_id, MAX_ENV_ID) {
            return Err(Reject::RequestId);
        }
        if !is_rooted(&submit.workspace)
            || !is_rooted(&submit.runs_root)
            || !is_rooted(&submit.interpreter)
            || !is_rooted(&submit.prefix)
            || submit.marker_digest.len() > 64
            || !submit
                .marker_digest
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(Reject::Path);
        }
        if self
            .runs
            .values()
            .any(|run| run.workspace == submit.workspace && run.phase != Phase::Terminal)
        {
            return Err(Reject::Busy);
        }
        let runs_root = PathBuf::from(&submit.runs_root);
        let program_path = runs_root
            .join(run_dir_name(&submit.request_id))
            .join("program.py");
        if !program_path.starts_with(&runs_root) {
            return Err(Reject::Path);
        }
        let request_id = submit.request_id.clone();
        self.runs.insert(
            request_id.clone(),
            CodeRun {
                request_id: request_id.clone(),
                workspace: submit.workspace.clone(),
                env_id: submit.env_id,
                interpreter: submit.interpreter.clone(),
                program_digest: digest,
                prefix: submit.prefix,
                marker_digest: submit.marker_digest,
                output_limit: submit.output_limit,
                phase: Phase::Accepted,
                intent: None,
                receipt: None,
            },
        );
        Ok(Effect::Prepare(Prepare {
            request_id,
            program_path,
            program: submit.program,
            interpreter: PathBuf::from(submit.interpreter),
            cwd: PathBuf::from(submit.workspace),
            output_limit: submit.output_limit,
        }))
    }

    fn started(&mut self, id: &str) -> Result<Effect, Reject> {
        let run = self.runs.get_mut(id).ok_or(Reject::Missing)?;
        if run.phase == Phase::Accepted {
            run.phase = Phase::Running;
        }
        Ok(Effect::None)
    }

    fn stop(&mut self, id: &str, stop: Stop) -> Result<Effect, Reject> {
        let run = self.runs.get_mut(id).ok_or(Reject::Missing)?;
        match run.phase {
            Phase::Terminal if stop == Stop::Cancel => Ok(Effect::Receipt(
                run.receipt
                    .clone()
                    .expect("a finished run keeps its receipt"),
            )),
            Phase::Terminal => Ok(Effect::None),
            Phase::Accepted => {
                run.complete(stop, None, String::new(), String::new(), false);
                Ok(Effect::Receipt(run.receipt.clone().expect("receipt")))
            }
            Phase::Running if run.intent.is_some() => Ok(Effect::None),
            Phase::Running => {
                run.intent = Some(stop);
                Ok(Effect::Kill {
                    request_id: id.to_string(),
                })
            }
        }
    }

    fn finish(
        &mut self,
        id: &str,
        exit_code: Option<i32>,
        stdout: String,
        stderr: String,
        streams_truncated: bool,
    ) -> Result<Effect, Reject> {
        let run = self.runs.get_mut(id).ok_or(Reject::Missing)?;
        if run.phase == Phase::Terminal {
            return Ok(Effect::None);
        }
        let stop = run.intent.unwrap_or(Stop::Exit);
        let limit = run.output_limit;
        let (stdout, cut_out) = clip(stdout, limit);
        let (stderr, cut_err) = clip(stderr, limit);
        run.complete(
            stop,
            exit_code,
            stdout,
            stderr,
            streams_truncated || cut_out || cut_err,
        );
        Ok(Effect::Receipt(run.receipt.clone().expect("receipt")))
    }

    fn interrupt(&mut self, id: &str) -> Result<Effect, Reject> {
        let run = self.runs.get_mut(id).ok_or(Reject::Missing)?;
        if run.phase == Phase::Terminal {
            return Ok(Effect::None);
        }
        run.complete(Stop::Unknown, None, String::new(), String::new(), false);
        Ok(Effect::Receipt(run.receipt.clone().expect("receipt")))
    }
}

impl CodeRun {
    fn complete(
        &mut self,
        stop: Stop,
        exit_code: Option<i32>,
        stdout: String,
        stderr: String,
        truncated: bool,
    ) {
        self.phase = Phase::Terminal;
        self.intent = Some(stop);
        self.receipt = Some(Receipt {
            stop,
            exit_code,
            program_digest: self.program_digest.clone(),
            interpreter: self.interpreter.clone(),
            prefix: self.prefix.clone(),
            marker_digest: self.marker_digest.clone(),
            stdout,
            stderr,
            truncated,
        });
    }
}

pub(crate) fn is_rooted(value: &str) -> bool {
    let path = Path::new(value);
    path.is_absolute()
        && !path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
}

fn clip(text: String, limit: usize) -> (String, bool) {
    if text.chars().count() <= limit {
        return (text, false);
    }
    (text.chars().take(limit).collect(), true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root(name: &str) -> String {
        if cfg!(windows) {
            format!("C:\\{name}")
        } else {
            format!("/{name}")
        }
    }

    fn submission(id: &str, program: &str) -> Submit {
        Submit {
            request_id: id.into(),
            workspace: root("ws"),
            runs_root: root("runs"),
            env_id: "science".into(),
            interpreter: root("opt/science/bin/python"),
            program: program.into(),
            prefix: root("opt/science"),
            marker_digest: "abc".into(),
            output_limit: 8,
        }
    }

    fn receipt(effect: Effect) -> Receipt {
        match effect {
            Effect::Receipt(receipt) => receipt,
            _ => panic!("expected a receipt"),
        }
    }

    #[test]
    fn code_run_fold() {
        let book = Book::default();
        for bad in ["../x", ".", "..", "a.", "CON", "nul.txt", "Com1", "lpt9", "a b", ""] {
            assert_eq!(
                apply(&book, Input::Submit(submission(bad, "print(1)"))).unwrap_err(),
                Reject::RequestId,
                "{bad:?} must not name a run"
            );
        }
        for good in ["run-1", "a.b", "com0", "COM10", "console", "_x", ".hidden"] {
            assert!(valid_ident(good, MAX_REQUEST_ID), "{good:?} is a plain id");
        }
        assert_ne!(run_dir_name("A"), run_dir_name("a"));
        assert_eq!(
            apply(&book, Input::Submit(submission("run-1", ""))).unwrap_err(),
            Reject::Program
        );
        let mut relative = submission("run-1", "print(1)");
        relative.workspace = "relative".into();
        assert_eq!(
            apply(&book, Input::Submit(relative)).unwrap_err(),
            Reject::Path
        );

        let (book, effect) = apply(&book, Input::Submit(submission("run-1", "print(1)"))).unwrap();
        let Effect::Prepare(prepared) = effect else {
            panic!("expected prepare");
        };
        assert!(prepared.program_path.starts_with(root("runs")));
        assert!(prepared.program_path.ends_with(
            Path::new(&run_dir_name("run-1")).join("program.py")
        ));
        assert_eq!(
            apply(&book, Input::Submit(submission("run-2", "print(2)"))).unwrap_err(),
            Reject::Busy
        );
        let mut other = submission("run-2", "print(2)");
        other.workspace = root("other");
        assert!(matches!(
            apply(&book, Input::Submit(other)).unwrap().1,
            Effect::Prepare(_)
        ));

        let (book, effect) = apply(
            &book,
            Input::Cancel {
                request_id: "run-1".into(),
            },
        )
        .unwrap();
        assert_eq!(receipt(effect).stop, Stop::Cancel);
        let (book, effect) = apply(&book, Input::Submit(submission("run-1", "print(1)"))).unwrap();
        assert_eq!(receipt(effect).stop, Stop::Cancel);
        assert_eq!(
            apply(&book, Input::Submit(submission("run-1", "print(2)"))).unwrap_err(),
            Reject::Conflict
        );

        let (book, effect) = apply(&book, Input::Submit(submission("run-3", "print(3)"))).unwrap();
        assert!(matches!(effect, Effect::Prepare(_)));
        let (book, _) = apply(
            &book,
            Input::Started {
                request_id: "run-3".into(),
            },
        )
        .unwrap();
        assert_eq!(
            apply(&book, Input::Submit(submission("run-3", "print(3)"))).unwrap_err(),
            Reject::InProgress
        );
        let (book, effect) = apply(
            &book,
            Input::Cancel {
                request_id: "run-3".into(),
            },
        )
        .unwrap();
        assert!(matches!(effect, Effect::Kill { .. }));
        let (book, effect) = apply(
            &book,
            Input::Deadline {
                request_id: "run-3".into(),
            },
        )
        .unwrap();
        assert!(matches!(effect, Effect::None));
        let (book, effect) = apply(
            &book,
            Input::Finish {
                request_id: "run-3".into(),
                exit_code: Some(9),
                stdout: "123456789".into(),
                stderr: String::new(),
                streams_truncated: false,
            },
        )
        .unwrap();
        let finished = receipt(effect);
        assert_eq!(finished.stop, Stop::Cancel);
        assert_eq!(finished.exit_code, Some(9));
        assert_eq!(finished.stdout, "12345678");
        assert!(finished.truncated);
        assert_eq!(finished.program_digest, program_digest("print(3)"));
        let (book, effect) = apply(
            &book,
            Input::Finish {
                request_id: "run-3".into(),
                exit_code: Some(0),
                stdout: "again".into(),
                stderr: String::new(),
                streams_truncated: false,
            },
        )
        .unwrap();
        assert!(matches!(effect, Effect::None));

        let (running, _) = apply(&book, Input::Submit(submission("run-4", "print(4)"))).unwrap();
        let (running, _) = apply(
            &running,
            Input::Started {
                request_id: "run-4".into(),
            },
        )
        .unwrap();
        let (running, effect) = apply(
            &running,
            Input::Deadline {
                request_id: "run-4".into(),
            },
        )
        .unwrap();
        assert!(matches!(effect, Effect::Kill { .. }));
        let (_, effect) = apply(
            &running,
            Input::Finish {
                request_id: "run-4".into(),
                exit_code: None,
                stdout: String::new(),
                stderr: String::new(),
                streams_truncated: true,
            },
        )
        .unwrap();
        let finished = receipt(effect);
        assert_eq!(finished.stop, Stop::Deadline);
        assert!(finished.truncated);

        let (running, _) = apply(&book, Input::Submit(submission("run-5", "print(5)"))).unwrap();
        let settled = settle(running);
        let (_, effect) = apply(&settled, Input::Submit(submission("run-5", "print(5)"))).unwrap();
        assert_eq!(receipt(effect).stop, Stop::Unknown);
        assert_eq!(
            apply(&settled, Input::Submit(submission("run-5", "other"))).unwrap_err(),
            Reject::Conflict
        );
        assert_eq!(
            apply(
                &book,
                Input::Cancel {
                    request_id: "missing".into()
                }
            )
            .unwrap_err(),
            Reject::Missing
        );
    }
}
