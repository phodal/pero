//! Structured answers are user input, independent of operation permissions.
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionOption {
    pub label: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub preview: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Question {
    pub question: String,
    pub header: String,
    pub options: Vec<QuestionOption>,
    #[serde(default)]
    pub multi_select: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionRequest {
    pub session_id: String,
    pub tool_call_id: String,
    pub questions: Vec<Question>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PendingQuestions {
    pub request_id: String,
    #[serde(flatten)]
    pub request: QuestionRequest,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionAnswer {
    pub question_index: usize,
    #[serde(default)]
    pub selected_options: Vec<usize>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "outcome", rename_all = "lowercase", deny_unknown_fields)]
pub enum QuestionReply {
    Answered { answers: Vec<QuestionAnswer> },
    Cancelled {},
}

impl QuestionRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.session_id.is_empty()
            || self.tool_call_id.is_empty()
            || !(1..=4).contains(&self.questions.len())
        {
            return Err("A question batch requires a session, tool call and one to four questions");
        }
        let mut questions = HashSet::new();
        for question in &self.questions {
            if question.question.trim().is_empty()
                || question.question.len() > 4096
                || !questions.insert(&question.question)
                || question.header.trim().is_empty()
                || question.header.chars().count() > 12
                || !(2..=4).contains(&question.options.len())
            {
                return Err("Invalid question text, header or option count");
            }
            let mut labels = HashSet::new();
            for option in &question.options {
                if option.label.trim().is_empty()
                    || option.label.len() > 512
                    || option.description.len() > 4096
                    || option.preview.len() > 16384
                    || !labels.insert(&option.label)
                {
                    return Err("Question options require unique labels");
                }
            }
        }
        Ok(())
    }
}

impl QuestionReply {
    pub fn validate(&self, request: &QuestionRequest) -> Result<(), &'static str> {
        let Self::Answered { answers } = self else {
            return Ok(());
        };
        if answers.len() != request.questions.len() {
            return Err("Answer every question before submitting");
        }
        let mut answered = HashSet::new();
        for answer in answers {
            if answer.text.len() > 16384 {
                return Err("Custom answer exceeds 16384 bytes");
            }
            let Some(question) = request.questions.get(answer.question_index) else {
                return Err("Unknown question index");
            };
            if !answered.insert(answer.question_index) {
                return Err("A question can only be answered once");
            }
            let mut choices = HashSet::new();
            if answer
                .selected_options
                .iter()
                .any(|index| *index >= question.options.len() || !choices.insert(index))
            {
                return Err("Unknown or repeated answer option");
            }
            let custom = !answer.text.trim().is_empty();
            if question.multi_select {
                if choices.is_empty() && !custom {
                    return Err("Select an option or enter an answer");
                }
            } else if choices.len() + usize::from(custom) != 1 {
                return Err("Select one option or enter an answer");
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn answers_are_complete_and_match_the_offered_questions() {
        let request: QuestionRequest = serde_json::from_value(serde_json::json!({
            "sessionId":"s", "toolCallId":"call", "questions":[
                {"question":"Language?","header":"Language","options":[{"label":"Go","description":"Harness"},{"label":"Rust","description":"Host"}]},
                {"question":"Platforms?","header":"Platforms","multiSelect":true,"options":[{"label":"Mac","description":"Desktop"},{"label":"Linux","description":"Server"}]}
            ]
        })).unwrap();
        request.validate().unwrap();
        let mut empty_description = request.clone();
        empty_description.questions[0].options[0]
            .description
            .clear();
        empty_description.validate().unwrap();
        let single = QuestionAnswer {
            question_index: 0,
            selected_options: vec![1],
            text: String::new(),
        };
        let multi = QuestionAnswer {
            question_index: 1,
            selected_options: vec![0, 1],
            text: "Windows".into(),
        };
        for (name, answers, valid) in [
            (
                "choices and custom",
                vec![single.clone(), multi.clone()],
                true,
            ),
            (
                "custom only",
                vec![
                    QuestionAnswer {
                        selected_options: vec![],
                        text: "Python".into(),
                        ..single.clone()
                    },
                    multi.clone(),
                ],
                true,
            ),
            ("incomplete", vec![single.clone()], false),
            (
                "duplicate question",
                vec![single.clone(), single.clone()],
                false,
            ),
            (
                "unknown choice",
                vec![
                    QuestionAnswer {
                        selected_options: vec![2],
                        ..single.clone()
                    },
                    multi.clone(),
                ],
                false,
            ),
            (
                "single and custom",
                vec![
                    QuestionAnswer {
                        text: "Python".into(),
                        ..single.clone()
                    },
                    multi.clone(),
                ],
                false,
            ),
            (
                "empty multiple",
                vec![
                    single.clone(),
                    QuestionAnswer {
                        selected_options: vec![],
                        text: " ".into(),
                        ..multi.clone()
                    },
                ],
                false,
            ),
        ] {
            assert_eq!(
                QuestionReply::Answered { answers }
                    .validate(&request)
                    .is_ok(),
                valid,
                "{name}"
            );
        }
        QuestionReply::Cancelled {}.validate(&request).unwrap();
        assert!(
            serde_json::from_value::<QuestionReply>(
                serde_json::json!({"outcome":"cancelled","answers":[]})
            )
            .is_err()
        );
    }
}
