//! Native first-run enrollment. The shell stores credentials; Host owns processes.
use crate::{
    native_cloud::{CloudAccount, CloudSession, EnrollmentFailure},
    native_secrets::SecretStore,
};
use pero_contracts::{
    HostEvent,
    local_worker::{LocalWorkerBinding, LocalWorkerConfig, LocalWorkerSummary},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::path::Path;

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct DeviceForm {
    name: String,
    project_id: String,
    workspace_key: String,
    path: String,
    agent_id: String,
}
impl DeviceForm {
    fn validate(&self) -> Result<(), String> {
        if self.name.trim().is_empty() || self.name.len() > 128 {
            return Err("Enter a device name up to 128 bytes.".into());
        }
        for value in [&self.project_id, &self.workspace_key, &self.agent_id] {
            if value.is_empty()
                || value.len() > 128
                || !value
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"-_".contains(&c))
            {
                return Err("Choose a valid project, workspace key and installed Agent.".into());
            }
        }
        let path =
            std::fs::canonicalize(&self.path).map_err(|_| "Choose an existing local directory.")?;
        if !path.is_dir() {
            return Err("Choose an existing local directory.".into());
        }
        Ok(())
    }
}
#[derive(Deserialize)]
#[serde(tag = "action", deny_unknown_fields)]
enum DeviceCommand {
    #[serde(rename = "local_worker_init")]
    Init,
    #[serde(rename = "local_worker_enroll")]
    Enroll {
        name: String,
        project_id: String,
        workspace_key: String,
        path: String,
        agent_id: String,
    },
    #[serde(rename = "local_worker_resume")]
    Resume,
    #[serde(rename = "local_worker_disable")]
    Disable,
    #[serde(rename = "local_worker_skip")]
    Skip,
}
#[derive(Deserialize, Serialize)]
struct DeviceRecord {
    device_id: String,
    onboarding_complete: bool,
    enabled: bool,
    account: Option<CloudAccount>,
    form: Option<DeviceForm>,
    request_id: String,
    enrollment_secret: String,
    worker: Option<LocalWorkerConfig>,
}
impl DeviceRecord {
    fn new(preconfigured: bool) -> Self {
        Self {
            device_id: random_id(),
            onboarding_complete: preconfigured,
            enabled: false,
            account: None,
            form: None,
            request_id: String::new(),
            enrollment_secret: String::new(),
            worker: None,
        }
    }
}
fn random_id() -> String {
    let mut data = [0u8; 16];
    getrandom::getrandom(&mut data).expect("OS randomness");
    data.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[derive(Debug)]
enum SetupFailure {
    Local(String),
    StorageUnavailable(String),
    StorageFailed(String),
    AccountChanged(String),
    StopRequired(String),
    InvalidConfiguration(String),
    Reauthenticate(String),
    Enrollment(EnrollmentFailure),
}
impl From<String> for SetupFailure {
    fn from(error: String) -> Self {
        Self::Local(error)
    }
}
impl From<&str> for SetupFailure {
    fn from(error: &str) -> Self {
        Self::Local(error.into())
    }
}
impl From<EnrollmentFailure> for SetupFailure {
    fn from(error: EnrollmentFailure) -> Self {
        Self::Enrollment(error)
    }
}
impl std::fmt::Display for SetupFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Local(error)
            | Self::StorageUnavailable(error)
            | Self::StorageFailed(error)
            | Self::AccountChanged(error)
            | Self::StopRequired(error)
            | Self::InvalidConfiguration(error)
            | Self::Reauthenticate(error) => f.write_str(error),
            Self::Enrollment(error) => std::fmt::Display::fmt(error, f),
        }
    }
}
impl SetupFailure {
    fn key(&self) -> Option<&'static str> {
        Some(match self {
            Self::Local(_) => "worker.local.error.setup_failed",
            Self::StorageUnavailable(_) => "worker.local.error.storage_unavailable",
            Self::StorageFailed(_) => "worker.local.error.storage_failed",
            Self::AccountChanged(_) => "worker.local.error.account_changed",
            Self::StopRequired(_) => "worker.local.error.stop_required",
            Self::InvalidConfiguration(_) => "worker.local.error.invalid_configuration",
            Self::Reauthenticate(_) => "worker.local.error.reauthenticate",
            Self::Enrollment(error) => error.key(),
        })
    }
    fn status(&self) -> Option<u16> {
        match self {
            Self::Enrollment(error) => error.status,
            _ => None,
        }
    }
}

pub(crate) struct NativeDevice {
    store: SecretStore,
    record: DeviceRecord,
    started: bool,
    error: Option<SetupFailure>,
    load_failed: bool,
}
pub(crate) struct DeviceOutcome {
    pub event: HostEvent,
    pub command: Option<Value>,
}
impl NativeDevice {
    pub fn new(data: &Path, preconfigured: bool, ephemeral: bool) -> Self {
        Self::load(
            SecretStore::open(data, "local-execution", ephemeral),
            preconfigured,
        )
    }
    fn load(store: SecretStore, preconfigured: bool) -> Self {
        let (record, error) = match store.load::<DeviceRecord>() {
            Ok(Some(record)) => (record, None),
            Ok(None) => (DeviceRecord::new(preconfigured), None),
            Err(error) => (DeviceRecord::new(preconfigured), Some(error)),
        };
        Self {
            store,
            record,
            started: false,
            load_failed: error.is_some(),
            error: error.map(SetupFailure::StorageUnavailable),
        }
    }
    fn save(&self) -> Result<(), SetupFailure> {
        self.store
            .save(&self.record)
            .map_err(SetupFailure::StorageFailed)
    }
    pub fn event(&self, cloud: &CloudSession) -> HostEvent {
        let mut event = HostEvent::new("local_worker_setup", None, String::new());
        event.data = json!({"onboarding_complete":self.record.onboarding_complete,"enabled":self.record.enabled,"has_connection":cloud.has_connection(),"error":self.error.as_ref().map(ToString::to_string),"error_key":self.error.as_ref().and_then(SetupFailure::key),"error_status":self.error.as_ref().and_then(SetupFailure::status),"configuration":self.summary()});
        event
    }
    fn summary(&self) -> Option<LocalWorkerSummary> {
        if let Some(worker) = &self.record.worker {
            return Some(LocalWorkerSummary::from(worker));
        }
        let form = self.record.form.as_ref()?;
        let account = self.record.account.as_ref()?;
        Some(LocalWorkerSummary {
            id: String::new(),
            name: form.name.clone(),
            url: account.url.clone(),
            bindings: vec![LocalWorkerBinding {
                project_id: form.project_id.clone(),
                workspace_key: form.workspace_key.clone(),
                path: form.path.clone(),
                agent_ids: vec![form.agent_id.clone()],
            }],
        })
    }
    pub fn needs_attention(&mut self, cloud: &CloudSession) -> HostEvent {
        self.record.enabled = false;
        self.started = false;
        self.error = self.save().err().map(Into::into);
        self.event(cloud)
    }
    pub fn command_failed(&mut self, cloud: &CloudSession) -> HostEvent {
        self.record.enabled = false;
        self.started = false;
        let message = "Local Host is unavailable. Restart Pero, then resume local execution.";
        self.error = Some(match self.save() {
            Ok(()) => SetupFailure::Local(message.into()),
            Err(error) => SetupFailure::Local(format!("{message} {error}")),
        });
        self.event(cloud)
    }
    fn start(&mut self, account: &CloudAccount) -> Result<Option<Value>, SetupFailure> {
        if self.record.account.as_ref() != Some(account) {
            return Err(SetupFailure::AccountChanged(
                "This local Worker belongs to another Cloud account. Configure this device again."
                    .into(),
            ));
        }
        if self.started {
            return Ok(None);
        }
        let worker = self.record.worker.as_ref().ok_or_else(|| {
            SetupFailure::InvalidConfiguration("Complete local execution setup first.".into())
        })?;
        worker
            .validate()
            .map_err(|error| SetupFailure::InvalidConfiguration(error.into()))?;
        self.started = true;
        Ok(Some(
            json!({"action":"local_worker_start","request_id":random_id(),"worker":worker}),
        ))
    }
    pub fn synchronize(&mut self, cloud: &CloudSession, disconnect: bool) -> DeviceOutcome {
        let account = cloud.device_account();
        let different_account = account.as_ref().is_some_and(|account| {
            self.record.enabled && self.record.account.as_ref() != Some(account)
        });
        let command = if disconnect || different_account {
            let stop = disconnect || self.started;
            self.started = false;
            self.error = if different_account {
                Some(SetupFailure::AccountChanged("This local Worker belongs to another Cloud account. Sign in to its original account or configure this device again.".into()))
            } else {
                None
            };
            // Logging out suspends execution; only Disable or attention changes saved intent.
            stop.then(|| json!({"action":"local_worker_stop","request_id":random_id()}))
        } else if self.record.enabled {
            account
                .as_ref()
                .and_then(|account| match self.start(account) {
                    Ok(command) => {
                        self.error = None;
                        command
                    }
                    Err(error) => {
                        self.error = Some(error.into());
                        None
                    }
                })
        } else {
            None
        };
        DeviceOutcome {
            event: self.event(cloud),
            command,
        }
    }
    pub fn command(&mut self, value: &Value, cloud: &CloudSession) -> DeviceOutcome {
        if self.load_failed {
            match self.store.load::<DeviceRecord>() {
                Ok(Some(record)) => {
                    self.record = record;
                    self.load_failed = false;
                }
                Ok(None) => self.load_failed = false,
                Err(error) => {
                    self.error = Some(SetupFailure::StorageUnavailable(error));
                    return DeviceOutcome {
                        event: self.event(cloud),
                        command: None,
                    };
                }
            }
        }
        self.error = None;
        let result = self.apply(value, cloud);
        let command = match result {
            Ok(command) => command,
            Err(error) => {
                self.error = Some(error.into());
                None
            }
        };
        DeviceOutcome {
            event: self.event(cloud),
            command,
        }
    }
    fn apply(
        &mut self,
        value: &Value,
        cloud: &CloudSession,
    ) -> Result<Option<Value>, SetupFailure> {
        let request: DeviceCommand = serde_json::from_value(value.clone())
            .map_err(|_| "Invalid local execution request.")?;
        match request {
            DeviceCommand::Init => {
                if self.record.enabled {
                    if let Some(account) = cloud.device_account() {
                        return self.start(&account).map_err(Into::into);
                    }
                }
                Ok(Some(
                    json!({"action":"local_worker_get","request_id":random_id()}),
                ))
            }
            DeviceCommand::Skip => {
                self.record.onboarding_complete = true;
                self.save()?;
                Ok(None)
            }
            DeviceCommand::Disable => {
                self.record.enabled = false;
                self.started = false;
                self.error = self.save().err().map(Into::into);
                Ok(Some(
                    json!({"action":"local_worker_stop","request_id":random_id()}),
                ))
            }
            DeviceCommand::Resume => {
                let account = cloud.device_account().ok_or_else(|| {
                    SetupFailure::Reauthenticate("Sign in before resuming local execution.".into())
                })?;
                // Validate account and the complete saved Worker before changing enabled state.
                let command = self.start(&account)?;
                self.record.enabled = true;
                self.record.onboarding_complete = true;
                if let Err(error) = self.save() {
                    self.record.enabled = false;
                    self.started = false;
                    return Err(error.into());
                }
                Ok(command)
            }
            DeviceCommand::Enroll {
                name,
                project_id,
                workspace_key,
                path,
                agent_id,
            } => {
                if self.record.enabled {
                    return Err(SetupFailure::StopRequired(
                        "Stop local execution before changing its scope.".into(),
                    ));
                }
                let mut form = DeviceForm {
                    name,
                    project_id,
                    workspace_key,
                    path,
                    agent_id,
                };
                form.validate()
                    .map_err(SetupFailure::InvalidConfiguration)?;
                form.path = std::fs::canonicalize(&form.path)
                    .map_err(|_| {
                        SetupFailure::InvalidConfiguration("Local directory is unavailable".into())
                    })?
                    .to_string_lossy()
                    .into();
                let account = cloud.device_account().ok_or_else(|| {
                    SetupFailure::Reauthenticate("Sign in before enabling local execution.".into())
                })?;
                if self.record.account.as_ref() != Some(&account)
                    || self.record.form.as_ref() != Some(&form)
                    || self.record.request_id.is_empty()
                {
                    self.record.account = Some(account.clone());
                    self.record.form = Some(form.clone());
                    self.record.request_id = random_id();
                    self.record.enrollment_secret = format!("{}{}", random_id(), random_id());
                    self.record.worker = None;
                }
                // The recoverable enrollment secret is durable BEFORE the Cloud mutation.
                self.save()?;
                let response=cloud.enroll_local_worker(&json!({"device_id":self.record.device_id,"request_id":self.record.request_id,"name":form.name,"projects":[form.project_id],"capabilities":[{"project_id":form.project_id,"workspace_key":form.workspace_key,"agent_id":form.agent_id}],"enrollment_secret":self.record.enrollment_secret}))?;
                let id = response.worker.id;
                let token = response.token;
                let worker = LocalWorkerConfig {
                    id,
                    name: form.name,
                    url: account.url.clone(),
                    token,
                    bindings: vec![LocalWorkerBinding {
                        project_id: form.project_id,
                        workspace_key: form.workspace_key,
                        path: form.path,
                        agent_ids: vec![form.agent_id],
                    }],
                };
                worker
                    .validate()
                    .map_err(|error| SetupFailure::InvalidConfiguration(error.into()))?;
                self.record.worker = Some(worker);
                self.record.enabled = true;
                self.record.onboarding_complete = true;
                self.started = false;
                self.save()?;
                self.start(&account).map_err(Into::into)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn first_run_skip_is_durable_and_public_setup_excludes_credentials() {
        let store = SecretStore::memory();
        let mut device = NativeDevice::load(store, false);
        let cloud = CloudSession::new();
        assert_eq!(device.event(&cloud).data["onboarding_complete"], false);
        device.record.enrollment_secret = "private-enrollment-secret".into();
        let result = device.command(&json!({"action":"local_worker_skip"}), &cloud);
        assert_eq!(result.event.data["onboarding_complete"], true);
        assert!(
            !result
                .event
                .data
                .to_string()
                .contains("private-enrollment-secret")
        );
        let restored = NativeDevice::load(device.store, false);
        assert_eq!(restored.event(&cloud).data["onboarding_complete"], true);
    }
    fn account(owner: &str) -> CloudAccount {
        CloudAccount {
            url: "https://app.openpero.com".into(),
            owner_id: owner.into(),
            client_mode: true,
        }
    }
    fn prepared(enabled: bool) -> NativeDevice {
        let mut device = NativeDevice::load(SecretStore::memory(), false);
        let form = DeviceForm {
            name: "Device".into(),
            project_id: "project".into(),
            workspace_key: "workspace".into(),
            path: std::env::temp_dir().to_string_lossy().into(),
            agent_id: "fixture".into(),
        };
        device.record.account = Some(account("owner"));
        device.record.form = Some(form.clone());
        device.record.worker = Some(LocalWorkerConfig {
            id: "worker-fixture".into(),
            name: form.name.clone(),
            url: account("owner").url,
            token: "worker-fixture-private".into(),
            bindings: vec![LocalWorkerBinding {
                project_id: form.project_id,
                workspace_key: form.workspace_key,
                path: form.path,
                agent_ids: vec![form.agent_id],
            }],
        });
        device.record.enabled = enabled;
        device.save().unwrap();
        device
    }
    #[test]
    fn local_execution_requires_enable_and_stays_bound_to_the_verified_account() {
        for (owner, worker_present, starts) in [
            ("owner", true, true),
            ("other", true, false),
            ("owner", false, false),
        ] {
            let mut device = prepared(false);
            if !worker_present {
                device.record.worker = None;
                device.save().unwrap();
            }
            let cloud = CloudSession::verified_fixture(account(owner));
            assert!(device.synchronize(&cloud, false).command.is_none());
            let result = device.command(&json!({"action":"local_worker_resume"}), &cloud);
            assert_eq!(result.command.is_some(), starts);
            assert_eq!(
                result.event.data["enabled"], starts,
                "failed resume must preserve disabled state"
            );
            assert!(
                !result
                    .event
                    .data
                    .to_string()
                    .contains("worker-fixture-private")
            );
        }
    }
    #[test]
    fn restart_restores_enabled_worker_once_and_attention_is_durably_disabled() {
        let device = prepared(true);
        let cloud = CloudSession::verified_fixture(account("owner"));
        let mut restored = NativeDevice::load(device.store, false);
        let started = restored.synchronize(&cloud, false);
        assert_eq!(
            started.command.as_ref().unwrap()["action"],
            "local_worker_start"
        );
        assert_eq!(
            started.command.as_ref().unwrap()["worker"]["token"],
            "worker-fixture-private"
        );
        assert!(restored.synchronize(&cloud, false).command.is_none());
        assert_eq!(restored.needs_attention(&cloud).data["enabled"], false);
        let mut blocked = NativeDevice::load(restored.store, false);
        assert!(blocked.synchronize(&cloud, false).command.is_none());
        assert_eq!(blocked.event(&cloud).data["enabled"], false);
        let mut different = prepared(true);
        different.started = true;
        assert_eq!(
            different
                .synchronize(&CloudSession::verified_fixture(account("other")), false)
                .command
                .unwrap()["action"],
            "local_worker_stop"
        );
        assert_eq!(different.event(&cloud).data["enabled"], true);
    }
    #[test]
    fn a_lost_enrollment_reply_recovers_the_same_durable_request_and_secret() {
        let (cloud, server) = CloudSession::http_fixture(2, |index, path| {
            assert_eq!(path, "/api/client/v1/workers");
            (index == 1)
                .then(|| json!({"worker":{"id":"worker-fixture"},"token":"worker-fixture-private"}))
        });
        let mut device = NativeDevice::load(SecretStore::memory(), false);
        let command = json!({"action":"local_worker_enroll","name":"Device","project_id":"project","workspace_key":"workspace","path":std::env::temp_dir(),"agent_id":"fixture"});
        let lost = device.command(&command, &cloud);
        assert!(lost.command.is_none());
        assert_eq!(lost.event.data["error_key"], "worker.local.error.network");
        assert!(lost.event.data["error_status"].is_null());
        let request = device.record.request_id.clone();
        let secret = device.record.enrollment_secret.clone();
        assert!(!request.is_empty());
        assert!(!secret.is_empty());
        let mut restored = NativeDevice::load(device.store, false);
        let result = restored.command(&command, &cloud);
        assert_eq!(result.command.unwrap()["action"], "local_worker_start");
        let bodies = server.join().unwrap();
        assert_eq!(bodies[0]["request_id"], request);
        assert_eq!(bodies[1]["request_id"], request);
        assert_eq!(bodies[0]["enrollment_secret"], secret);
        assert_eq!(bodies[1]["enrollment_secret"], secret);
        assert_eq!(result.event.data["enabled"], true);
        assert!(result.event.data["error_key"].is_null());
        assert!(result.event.data["error_status"].is_null());
        assert!(!result.event.data.to_string().contains(&secret));
        assert!(
            !result
                .event
                .data
                .to_string()
                .contains("worker-fixture-private")
        );
    }

    #[test]
    fn failed_host_delivery_persists_disabled_state_for_explicit_retry() {
        let mut device = prepared(true);
        let cloud = CloudSession::verified_fixture(account("owner"));
        device.started = true;
        let event = device.command_failed(&cloud);
        assert_eq!(event.data["enabled"], false);
        assert!(
            event.data["error"]
                .as_str()
                .unwrap()
                .contains("Restart Pero")
        );
        let mut restored = NativeDevice::load(device.store, false);
        assert!(restored.synchronize(&cloud, false).command.is_none());
        assert_eq!(
            restored
                .command(&json!({"action":"local_worker_resume"}), &cloud)
                .command
                .unwrap()["action"],
            "local_worker_start"
        );
    }
    #[test]
    fn logout_suspends_intake_but_only_the_original_account_resumes_saved_intent() {
        let cloud = CloudSession::verified_fixture(account("owner"));
        let other = CloudSession::verified_fixture(account("other"));
        let mut device = prepared(true);
        assert_eq!(
            device.synchronize(&cloud, false).command.unwrap()["action"],
            "local_worker_start"
        );
        assert_eq!(
            device
                .synchronize(&CloudSession::new(), true)
                .command
                .unwrap()["action"],
            "local_worker_stop"
        );
        assert_eq!(device.event(&cloud).data["enabled"], true);
        assert!(device.synchronize(&other, false).command.is_none());
        assert!(device.event(&other).data["error"].is_string());
        let resumed = device.synchronize(&cloud, false);
        assert_eq!(resumed.command.unwrap()["action"], "local_worker_start");
        assert!(resumed.event.data["error"].is_null());
        device.command(&json!({"action":"local_worker_disable"}), &cloud);
        let mut restored = NativeDevice::load(device.store, false);
        assert!(restored.synchronize(&cloud, false).command.is_none());
    }
    #[test]
    fn enrollment_failure_metadata_reaches_setup_without_exposing_the_response_body() {
        let (cloud, server) = CloudSession::http_raw_fixture(1, |_, _| {
            Some((
                403,
                "text/html",
                "<html>private-body worker-fixture-private</html>".into(),
            ))
        });
        let mut device = NativeDevice::load(SecretStore::memory(), false);
        let result=device.command(&json!({"action":"local_worker_enroll","name":"Device","project_id":"project","workspace_key":"workspace","path":std::env::temp_dir(),"agent_id":"fixture"}),&cloud);
        assert!(result.command.is_none());
        assert_eq!(
            result.event.data["error_key"],
            "worker.local.error.permission_denied"
        );
        assert_eq!(result.event.data["error_status"], 403);
        assert_eq!(result.event.data["enabled"], false);
        assert!(!result.event.data.to_string().contains("private-body"));
        assert!(
            !result
                .event
                .data
                .to_string()
                .contains("worker-fixture-private")
        );
        server.join().unwrap();
    }
}
