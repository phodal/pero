//! The Viewer reads a fixed Host-owned snapshot through its existing custom origin.
use crate::native_apps::NativeApps;
use pero_contracts::session_artifact::ArtifactSnapshot;
use serde_json::{Value,json};
use wry::http::{Request,Response};

impl NativeApps {
    pub(super) fn artifact_response(&self, name:&str, request:&Request<Vec<u8>>, uri:&url::Url)->anyhow::Result<Response<Vec<u8>>> {
        anyhow::ensure!(name=="scientific-viewer" && request.method()=="GET" && uri.query().is_none(),"Artifact preview request refused");
        self.request::<Value>("sdkcontext",json!({"name":name}))?;
        let parts=uri.path().trim_start_matches("/host/artifacts/").split('/').map(|part|percent_encoding::percent_decode_str(part).decode_utf8().map(|s|s.into_owned())).collect::<Result<Vec<_>,_>>()?;
        anyhow::ensure!(parts.len()==3,"Choose one saved artifact version");
        let version=parts[2].parse::<u64>()?;
        let reply=self.artifact_request("resolve_snapshot",json!({"thread_id":parts[0],"artifact_id":parts[1],"version":version}))?;
        let snapshot:ArtifactSnapshot=serde_json::from_value(reply)?;
        let bytes=std::fs::read(&snapshot.path)?;
        let media=serde_json::to_value(&snapshot.media)?;
        Ok(Response::builder().header("Content-Type",snapshot.media.mime_type())
            .header("Content-Length",bytes.len()).header("Cache-Control","no-store")
            .header("X-Content-Type-Options","nosniff")
            .header("Content-Security-Policy","sandbox; default-src 'none'; img-src data: blob:")
            .header("X-Pero-Artifact-Kind",media["kind"].as_str().unwrap_or("document"))
            .header("X-Pero-Artifact-Name",percent_encoding::utf8_percent_encode(&snapshot.filename,percent_encoding::NON_ALPHANUMERIC).to_string())
            .header("X-Pero-Artifact-Sha256",snapshot.sha256)
            .body(bytes)?)
    }
}
