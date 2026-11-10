//! Read-only projections from fixed, enabled local App backends.
use pero_contracts::{project_resources::{ProjectResourceCatalog, ProjectResourceSummary}, research_project::ProjectResourceRef};
use pero_runtime::apps::{AppName, AppPreparation, AppStore, BackendAccess};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sha2::{Digest, Sha256};
use std::{io::Read, time::Duration};

const MAX_RESPONSE_BYTES: u64 = 4 * 1024 * 1024;

pub(crate) struct ProjectResources {
    app: String,
    backend: BackendAccess,
}

impl ProjectResources {
    pub(crate) fn resolve(store: &mut AppStore, name: &AppName, progress: &mut impl FnMut(AppPreparation)) -> Result<Self, String> {
        if !matches!(name.as_str(), "paper-agent" | "control-lab" | "lab" | "notebook") {
            return Err("This App has no project resource catalog".into());
        }
        // Resolving never installs or enables an App. Its existing backend may start.
        let backend = store.resolve_with_progress(name, progress)
            .map_err(|_| "App resources are unavailable; check the App in Apps and retry")?.backend
            .ok_or("This App has no resource backend")?;
        Ok(Self { app: name.as_str().into(), backend })
    }

    pub(crate) fn read(self) -> Result<ProjectResourceCatalog, String> {
        let client = reqwest::blocking::Client::builder().no_proxy()
            .redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(8))
            .build().map_err(|_| "App resource client is unavailable")?;
        let resources = match self.app.as_str() {
            "paper-agent" => get::<PaperLibrary>(&client, &self.backend, "/api/library")?.resources()?,
            "control-lab" => get::<ControlCatalog>(&client, &self.backend, "/api/experiments")?.resources()?,
            "notebook" => get::<NotebookCatalog>(&client, &self.backend, "/api/entries")?.resources()?,
            "lab" => get::<LabCatalog>(&client, &self.backend, "/api/state")?.resources()?,
            _ => unreachable!("App catalog was selected at the boundary"),
        };
        Ok(ProjectResourceCatalog { app: self.app, resources, error: None })
    }
}

fn get<T: DeserializeOwned>(client: &reqwest::blocking::Client, backend: &BackendAccess, path: &str) -> Result<T, String> {
    let response = client.get(format!("{}{path}", backend.url))
        .header("X-Pero-App-Token", &backend.token).send()
        .map_err(|_| "App resources are unavailable or timed out; retry")?;
    if !response.status().is_success() {
        return Err(format!("App resource request was refused (HTTP {})", response.status().as_u16()));
    }
    let mut bytes = Vec::new();
    response.take(MAX_RESPONSE_BYTES + 1).read_to_end(&mut bytes).map_err(|_| "App resources could not be read")?;
    if bytes.len() as u64 > MAX_RESPONSE_BYTES { return Err("App resource catalog exceeds 4 MiB".into()); }
    serde_json::from_slice(&bytes).map_err(|_| "App returned an invalid resource catalog".into())
}

fn observation_revision(value: &impl Serialize) -> String {
    format!("{:x}", Sha256::digest(serde_json::to_vec(value).expect("Typed catalog observation")))
}

fn resource(app: &str, kind: &str, id: String, revision: String, title: String, summary: String, status: String) -> Result<ProjectResourceSummary, String> {
    let length = if app == "paper-agent" { 64 } else { 32 };
    if id.len() != length || !id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
        return Err("App returned an invalid resource identity".into());
    }
    let location = format!("pero-app-location://{app}/main/{kind}/{id}");
    let reference = ProjectResourceRef::new(app.into(), kind.into(), id, revision).map_err(|error| error.to_string())?;
    Ok(ProjectResourceSummary { reference, title, summary, status, verification: None, location })
}

#[derive(Deserialize)]
struct PaperLibrary { papers: Vec<Paper>, #[serde(default)] studies: Vec<Study> }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Paper { id: String, title: String, source: String, content_digest: String, content_kind: String }
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Study {
    id: String, question: String, paper_ids: Vec<String>, intent_id: Option<String>,
    report_id: Option<String>, budget: StudyBudget,
}
#[derive(Deserialize, Serialize)]
struct StudyBudget { limit: u32, used: u32, remaining: u32 }

impl PaperLibrary {
    fn resources(self) -> Result<Vec<ProjectResourceSummary>, String> {
        let mut rows = self.papers.into_iter().map(|p| resource("paper-agent", "paper", p.id, p.content_digest, p.title, p.source, p.content_kind)).collect::<Result<Vec<_>, _>>()?;
        for study in self.studies {
            let revision = observation_revision(&study);
            let status = if study.report_id.is_some() { "report-saved" } else if study.budget.remaining == 0 { "budget-exhausted" } else { "study-saved" };
            rows.push(resource("paper-agent", "study", study.id, revision, study.question, String::new(), status.into())?);
        }
        Ok(rows)
    }
}

#[derive(Deserialize)]
struct ControlCatalog { experiments: Vec<ControlExperiment> }
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ControlExperiment {
    id: String, title: String, template_id: String, status: String,
    report: Option<RecordedReport>, locked_candidate_id: Option<String>, spec_hash: String,
}
#[derive(Deserialize, Serialize)]
struct RecordedReport { verdict: String }

impl ControlCatalog {
    fn resources(self) -> Result<Vec<ProjectResourceSummary>, String> {
        self.experiments.into_iter().map(|e| {
            let revision = observation_revision(&e);
            let verification = e.report.map(|report| report.verdict);
            let mut row = resource("control-lab", "experiment", e.id, revision, e.title, e.template_id, e.status)?;
            row.verification = verification;
            Ok(row)
        }).collect()
    }
}

#[derive(Deserialize)]
struct LabCatalog { experiments: Vec<LabExperiment> }
#[derive(Deserialize, Serialize)]
struct LabExperiment { id: String, objective: String, spec_hash: String, mode: String, trials: Vec<LabTrial>, decisions: Vec<LabDecision> }
#[derive(Deserialize, Serialize)]
struct LabTrial { id: String, status: String, protocol_hash: String, state_hash: String, verification: Option<RecordedReport>, observations: Vec<LabObservation> }
#[derive(Deserialize, Serialize)]
struct LabObservation { sha256: String }
#[derive(Deserialize, Serialize)]
struct LabDecision { trial_id: String, decision: String, rationale: String }

impl LabCatalog {
    fn resources(self) -> Result<Vec<ProjectResourceSummary>, String> {
        self.experiments.into_iter().map(|e| {
            let revision = observation_revision(&e);
            let status = e.trials.last().map(|trial| trial.status.clone()).unwrap_or("no-trials".into());
            let verification = e.trials.last().and_then(|trial| trial.verification.as_ref()).map(|report| report.verdict.clone());
            let mut row = resource("lab", "experiment", e.id, revision, e.objective, e.mode, status)?;
            row.verification = verification;
            Ok(row)
        }).collect()
    }
}

#[derive(Deserialize)]
struct NotebookCatalog { entries: Vec<NotebookEntry> }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NotebookEntry { id: String, title: String, revision: u64, updated_at: String }
impl NotebookCatalog {
    fn resources(self) -> Result<Vec<ProjectResourceSummary>, String> {
        self.entries.into_iter().map(|entry| {
            if entry.revision == 0 { return Err("Notebook returned an invalid saved revision".into()); }
            resource("notebook", "entry", entry.id, entry.revision.to_string(), entry.title, entry.updated_at, "saved".into())
        }).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::net::TcpListener;
    use std::io::{BufRead, BufReader, Write};

    #[test]
    fn notebook_catalog_retains_real_saved_revisions_and_owner_navigation() {
        let catalog:NotebookCatalog=serde_json::from_value(json!({"entries":[{"id":"a".repeat(32),"title":"Actual saved notebook","revision":7,"updatedAt":"2026-11-09T00:00:00Z"}]})).unwrap();
        let row=catalog.resources().unwrap().remove(0);
        assert_eq!(row.reference.app,"notebook");assert_eq!(row.reference.kind,"entry");assert_eq!(row.reference.revision,"7");
        assert_eq!(row.location,format!("pero-app-location://notebook/main/entry/{}","a".repeat(32)));
        assert_eq!(row.status,"saved");assert_eq!(row.verification,None);
        let invalid:NotebookCatalog=serde_json::from_value(json!({"entries":[{"id":"../file","title":"Invalid","revision":1,"updatedAt":""}]})).unwrap();
        assert!(invalid.resources().is_err());
    }

    #[test]
    fn catalog_observations_preserve_app_facts() {
        let paper_id = "a".repeat(64);
        let experiment_id = "b".repeat(32);
        let paper: PaperLibrary = serde_json::from_value(json!({"papers":[{"id":paper_id,"title":"A paper","source":"local","contentDigest":"c".repeat(64),"contentKind":"abstract"}],"studies":[{"id":"d".repeat(64),"question":"A question","paperIds":[paper_id],"intentId":null,"reportId":null,"budget":{"limit":10,"used":10,"remaining":0}}]})).unwrap();
        let control: ControlCatalog = serde_json::from_value(json!({"experiments":[{"id":experiment_id,"title":"Control","templateId":"feedback","status":"completed","report":{"verdict":"FAIL"},"lockedCandidateId":null,"specHash":"e".repeat(64)}]})).unwrap();
        let lab: LabCatalog = serde_json::from_value(json!({"experiments":[{"id":experiment_id,"objective":"Mix","spec_hash":"f".repeat(64),"mode":"simulation","trials":[],"decisions":[]}]})).unwrap();
        let checked_lab: LabCatalog = serde_json::from_value(json!({"experiments":[{"id":experiment_id,"objective":"Mix","spec_hash":"f".repeat(64),"mode":"simulation","trials":[{"id":"trial-1","status":"completed","protocol_hash":"a".repeat(64),"state_hash":"b".repeat(64),"verification":{"verdict":"FAIL"},"observations":[]}],"decisions":[]}]})).unwrap();
        for (rows, states, checks) in [(paper.resources().unwrap(), vec!["abstract", "budget-exhausted"], vec![None, None]), (control.resources().unwrap(), vec!["completed"], vec![Some("FAIL")]), (lab.resources().unwrap(), vec!["no-trials"], vec![None]), (checked_lab.resources().unwrap(), vec!["completed"], vec![Some("FAIL")])] {
            assert_eq!(rows.iter().map(|r| r.status.as_str()).collect::<Vec<_>>(), states);
            assert_eq!(rows.iter().map(|r| r.verification.as_deref()).collect::<Vec<_>>(), checks);
            for row in rows { assert!(row.location.ends_with(&format!("/{}/{}", row.reference.kind, row.reference.id))); assert!(row.reference.valid()); }
        }
        assert!(resource("paper-agent", "paper", "wrong-id".into(), "a".repeat(64), "Paper".into(), "".into(), "abstract".into()).is_err());
    }

    #[test]
    fn resource_read_uses_only_fixed_authenticated_get() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let worker = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(socket.try_clone().unwrap());
            let mut line = String::new(); reader.read_line(&mut line).unwrap();
            assert_eq!(line, "GET /api/library HTTP/1.1\r\n");
            let mut headers = String::new();
            loop { line.clear(); reader.read_line(&mut line).unwrap(); if line == "\r\n" { break; } headers.push_str(&line.to_ascii_lowercase()); }
            assert!(headers.contains("x-pero-app-token: private-token"));
            let body = "{\"papers\":[],\"studies\":[]}";
            write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        });
        let catalog = ProjectResources { app: "paper-agent".into(), backend: BackendAccess { url: format!("http://{address}"), token: "private-token".into(), reproduction_token: None } }.read().unwrap();
        worker.join().unwrap();
        assert!(catalog.resources.is_empty());
        let public = serde_json::to_string(&catalog).unwrap();
        assert!(!public.contains("private-token") && !public.contains(&address.to_string()));
    }
}
