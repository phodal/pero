//! Saved Cloud identity belongs to the native shell, outside renderer state.
use super::*;
use crate::native_secrets::SecretStore;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct CloudAccount {
    pub url: String,
    pub owner_id: String,
    pub client_mode: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum EnrollmentFailureKind {
    ServerUnsupported,
    Reauthenticate,
    PermissionDenied,
    EnrollmentConflict,
    InvalidConfiguration,
    ServerUnavailable,
    Network,
    InvalidResponse,
    SetupFailed,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct EnrollmentFailure {
    pub kind: EnrollmentFailureKind,
    pub status: Option<u16>,
}
impl EnrollmentFailure {
    fn new(kind: EnrollmentFailureKind, status: Option<u16>) -> Self {
        Self { kind, status }
    }
    fn http(status: u16) -> Self {
        use EnrollmentFailureKind::*;
        let kind = match status {
            404 | 405 => ServerUnsupported,
            401 => Reauthenticate,
            403 => PermissionDenied,
            409 => EnrollmentConflict,
            400 | 422 => InvalidConfiguration,
            408 | 429 | 500..=599 => ServerUnavailable,
            _ => SetupFailed,
        };
        Self {
            kind,
            status: Some(status),
        }
    }
    pub fn key(&self) -> &'static str {
        use EnrollmentFailureKind::*;
        match self.kind {
            ServerUnsupported => "worker.local.error.server_unsupported",
            Reauthenticate => "worker.local.error.reauthenticate",
            PermissionDenied => "worker.local.error.permission_denied",
            EnrollmentConflict => "worker.local.error.enrollment_conflict",
            InvalidConfiguration => "worker.local.error.invalid_configuration",
            ServerUnavailable => "worker.local.error.server_unavailable",
            Network => "worker.local.error.network",
            InvalidResponse => "worker.local.error.invalid_response",
            SetupFailed => "worker.local.error.setup_failed",
        }
    }
}
impl std::fmt::Display for EnrollmentFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        use EnrollmentFailureKind::*;
        f.write_str(match self.kind {
            ServerUnsupported=>"This Cloud server does not support local Worker enrollment. Update the server or connect to a compatible server.",
            Reauthenticate=>"Your Cloud sign-in has expired. Sign in again, then retry local execution setup.",
            PermissionDenied=>"This account cannot enroll a Worker for the selected project. Check project access.",
            EnrollmentConflict=>"This device enrollment conflicts with the saved request. Review the device configuration and retry.",
            InvalidConfiguration=>"The server rejected this device configuration. Check the project, workspace and Agent.",
            ServerUnavailable=>"The Cloud server is temporarily unavailable. Retry local execution setup.",
            Network=>"Could not reach the Cloud server. Check the connection and retry.",
            InvalidResponse=>"The Cloud server returned an invalid enrollment response. Retry or update the server.",
            SetupFailed=>"Local execution setup could not complete. Retry or check the Cloud server.",
        })
    }
}
#[derive(Deserialize)]
pub(crate) struct WorkerEnrollment {
    pub worker: EnrolledWorker,
    pub token: String,
}
#[derive(Deserialize)]
pub(crate) struct EnrolledWorker {
    pub id: String,
}

#[derive(Deserialize, Serialize)]
struct SavedConnection {
    url: String,
    token: String,
    client_mode: bool,
}

impl CloudSession {
    pub(crate) fn with_store(data: &Path, ephemeral: bool) -> Self {
        Self::load_vault(SecretStore::open(data, "cloud", ephemeral))
    }
    fn load_vault(vault: SecretStore) -> Self {
        let mut session = Self::new();
        match vault.load::<SavedConnection>() {
            Ok(Some(saved)) => match desktop_login::service_origin(&saved.url) {
                Ok(url)
                    if !saved.token.is_empty()
                        && saved.token.len() <= 512
                        && !saved.token.chars().any(char::is_control) =>
                {
                    session.base = url;
                    session.token = saved.token;
                    session.client_mode = saved.client_mode;
                    session.reload();
                }
                _ => {
                    session.error = Some("Saved Cloud connection is invalid. Sign in again.".into())
                }
            },
            Ok(None) => {}
            Err(error) => session.error = Some(error),
        }
        session.vault = Some(vault);
        session
    }
    pub(super) fn persist_connection(&mut self) {
        if let Some(vault) = &self.vault {
            if let Err(error) = vault.save(&SavedConnection {
                url: self.base.clone(),
                token: self.token.clone(),
                client_mode: self.client_mode,
            }) {
                self.error = Some(error);
            }
        }
    }
    pub(super) fn forget_connection(&mut self) {
        if let Some(vault) = &self.vault {
            if let Err(error) = vault.clear() {
                self.error = Some(error);
            }
        }
    }
    pub(crate) fn device_account(&self) -> Option<CloudAccount> {
        self.configured().then_some(())?;
        let owner_id = self.identity["id"].as_str().filter(|id| !id.is_empty())?;
        Some(CloudAccount {
            url: self.base.clone(),
            owner_id: owner_id.into(),
            client_mode: self.client_mode,
        })
    }
    pub(crate) fn has_connection(&self) -> bool {
        self.configured()
    }
    pub(crate) fn enroll_local_worker(
        &self,
        body: &Value,
    ) -> Result<WorkerEnrollment, EnrollmentFailure> {
        if self.device_account().is_none() {
            return Err(EnrollmentFailure::new(
                EnrollmentFailureKind::Reauthenticate,
                None,
            ));
        }
        let path = if self.client_mode {
            "/api/client/v1/workers"
        } else {
            "/api/v1/workers/enroll"
        };
        let response = self
            .http
            .post(format!("{}{path}", self.base))
            .bearer_auth(&self.token)
            .header("Idempotency-Key", idempotency_key())
            .json(body)
            .send()
            .map_err(|_| EnrollmentFailure::new(EnrollmentFailureKind::Network, None))?;
        let status = response.status().as_u16();
        if !(200..300).contains(&status) {
            return Err(EnrollmentFailure::http(status));
        }
        let invalid =
            || EnrollmentFailure::new(EnrollmentFailureKind::InvalidResponse, Some(status));
        let bytes = read_body(response, 65536).map_err(|_| invalid())?;
        let receipt: WorkerEnrollment = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
        if receipt.worker.id.is_empty()
            || receipt.worker.id.len() > 128
            || !receipt
                .worker
                .id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
            || receipt.token.is_empty()
            || receipt.token.len() > 512
            || receipt.token.chars().any(char::is_control)
        {
            return Err(invalid());
        }
        Ok(receipt)
    }
}

#[cfg(test)]
impl CloudSession {
    pub(crate) fn verified_fixture(account: CloudAccount) -> Self {
        let mut session = Self::new();
        session.base = account.url;
        session.token = "client-fixture-token".into();
        session.client_mode = account.client_mode;
        session.identity = json!({"id":account.owner_id});
        session
    }
}

#[cfg(test)]
impl CloudSession {
    pub(crate) fn http_fixture(
        requests: usize,
        mut response: impl FnMut(usize, &str) -> Option<Value> + Send + 'static,
    ) -> (Self, std::thread::JoinHandle<Vec<Value>>) {
        Self::http_raw_fixture(requests, move |index, path| {
            response(index, path).map(|body| (200, "application/json", body.to_string()))
        })
    }
    pub(crate) fn http_raw_fixture(
        requests: usize,
        mut response: impl FnMut(usize, &str) -> Option<(u16, &'static str, String)> + Send + 'static,
    ) -> (Self, std::thread::JoinHandle<Vec<Value>>) {
        use std::{
            io::{BufRead, BufReader, Read, Write},
            net::TcpListener,
            time::{Duration, Instant},
        };
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(8);
            let mut bodies = Vec::new();
            while bodies.len() < requests {
                let (mut stream, _) = match listener.accept() {
                    Ok(connection) => connection,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(Instant::now() < deadline, "Cloud fixture requests missing");
                        std::thread::sleep(Duration::from_millis(10));
                        continue;
                    }
                    Err(error) => panic!("{error}"),
                };
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut input = BufReader::new(&mut stream);
                let mut line = String::new();
                input.read_line(&mut line).unwrap();
                let route = line.split_whitespace().nth(1).unwrap().to_string();
                let mut length = 0;
                let mut authorized = false;
                loop {
                    line.clear();
                    input.read_line(&mut line).unwrap();
                    if line == "\r\n" {
                        break;
                    }
                    if let Some((name, value)) = line.split_once(':') {
                        if name.eq_ignore_ascii_case("content-length") {
                            length = value.trim().parse::<usize>().unwrap();
                        }
                        if name.eq_ignore_ascii_case("authorization") {
                            authorized = value.trim() == "Bearer client-fixture-token";
                        }
                    }
                }
                assert!(authorized);
                let mut body = vec![0; length];
                input.read_exact(&mut body).unwrap();
                drop(input);
                bodies.push(if body.is_empty() {
                    Value::Null
                } else {
                    serde_json::from_slice::<Value>(&body).unwrap()
                });
                if let Some((status, content_type, body)) = response(bodies.len() - 1, &route) {
                    write!(stream,"HTTP/1.1 {status} Fixture\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
                }
            }
            bodies
        });
        (
            Self::verified_fixture(CloudAccount {
                url,
                owner_id: "owner".into(),
                client_mode: true,
            }),
            server,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn saved_connection_reauthenticates_after_restart_and_disconnect_forgets_it() {
        let (connection, server) = CloudSession::http_fixture(4, |_, path| {
            Some(match path {
                "/api/client/v1/me" => json!({"id":"owner"}),
                "/api/client/v1/github/status" => json!({}),
                "/api/client/v1/workers" => json!({"workers":[]}),
                "/api/client/v1/tasks?limit=50" => json!({"tasks":[],"has_more":false}),
                path => panic!("Unexpected Cloud route {path}"),
            })
        });
        let vault = SecretStore::memory();
        vault
            .save(&SavedConnection {
                url: connection.base,
                token: connection.token,
                client_mode: true,
            })
            .unwrap();
        let mut restored = CloudSession::load_vault(vault);
        server.join().unwrap();
        assert_eq!(restored.device_account().unwrap().owner_id, "owner");
        assert_eq!(restored.token, "client-fixture-token");
        assert!(
            !restored
                .remote_event()
                .data
                .to_string()
                .contains("client-fixture-token")
        );
        restored.command(&json!({"action":"remote_disconnect"}));
        assert!(restored.device_account().is_none());
        let vault = restored.vault.take().unwrap();
        assert!(vault.load::<SavedConnection>().unwrap().is_none());
        assert!(!CloudSession::load_vault(vault).has_connection());
    }
    #[test]
    fn enrollment_http_failures_have_safe_typed_recovery_reasons() {
        use EnrollmentFailureKind::*;
        for (status, kind) in [
            (404, ServerUnsupported),
            (405, ServerUnsupported),
            (401, Reauthenticate),
            (403, PermissionDenied),
            (409, EnrollmentConflict),
            (400, InvalidConfiguration),
            (422, InvalidConfiguration),
            (408, ServerUnavailable),
            (429, ServerUnavailable),
            (500, ServerUnavailable),
            (503, ServerUnavailable),
            (418, SetupFailed),
        ] {
            let error = EnrollmentFailure::http(status);
            assert_eq!(error.kind, kind);
            assert_eq!(error.status, Some(status));
            assert!(error.key().starts_with("worker.local.error."));
        }
    }
    #[test]
    fn enrollment_status_is_preserved_before_parsing_an_html_or_plain_error_body() {
        let (cloud, server) = CloudSession::http_raw_fixture(2, |index, path| {
            assert_eq!(path, "/api/client/v1/workers");
            Some(if index == 0 {
                (
                    404,
                    "text/html",
                    "<html>private-server-body client-fixture-token</html>".into(),
                )
            } else {
                (
                    405,
                    "text/plain",
                    "private-server-body worker-fixture-private".into(),
                )
            })
        });
        for status in [404, 405] {
            let error = cloud.enroll_local_worker(&json!({})).err().unwrap();
            assert_eq!(error.key(), "worker.local.error.server_unsupported");
            assert_eq!(error.status, Some(status));
            assert!(!error.to_string().contains("private-server-body"));
            assert!(!error.to_string().contains("fixture-token"));
            assert!(!error.to_string().contains("worker-fixture-private"));
        }
        server.join().unwrap();
    }
    #[test]
    fn successful_http_with_invalid_enrollment_data_is_a_protocol_failure() {
        let (cloud, server) = CloudSession::http_raw_fixture(2, |index, _| {
            Some((
                200,
                "application/json",
                if index == 0 {
                    "not-json private-server-body".into()
                } else {
                    json!({"worker":{"id":"valid-id"},"token":"bad\ncredential"}).to_string()
                },
            ))
        });
        for _ in 0..2 {
            let error = cloud.enroll_local_worker(&json!({})).err().unwrap();
            assert_eq!(error.key(), "worker.local.error.invalid_response");
            assert_eq!(error.status, Some(200));
            assert!(!error.to_string().contains("private-server-body"));
        }
        server.join().unwrap();
    }
}
