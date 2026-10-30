//! Composition only: existing sessions admit a source; one Node provider owns MCP IO.
use pero_contracts::{HostEvent, mcp_source::McpSourceRequest};
use std::{
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
};
struct Provider {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
}
impl Provider {
    fn start(config: &Path) -> Result<Self, String> {
        let script = std::env::var_os("PERO_MCP_PROVIDER_SCRIPT")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                Path::new(env!("CARGO_MANIFEST_DIR")).join("../../desktop/dist/mcp-provider.cjs")
            });
        if !script.is_file() {
            return Err("MCP Apps is unavailable: build the Node provider (node scripts/build/desktop.mjs), or configure PERO_MCP_PROVIDER_SCRIPT.".into());
        }
        let node = std::env::var_os("PERO_NODE_BINARY").unwrap_or_else(|| "node".into());
        let mut child = Command::new(node)
            .arg(script)
            .args(["--stdio", "--config"])
            .arg(config)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|error| {
                format!("MCP Apps is unavailable: Node runtime could not start ({error})")
            })?;
        let input = child.stdin.take().expect("piped provider input");
        let output = BufReader::new(child.stdout.take().expect("piped provider output"));
        let mut provider = Self {
            child,
            input,
            output,
        };
        let ready = provider.read()?;
        if ready["kind"] != "mcp_ready" {
            return Err("MCP Apps provider did not become ready".into());
        }
        Ok(provider)
    }
    fn read(&mut self) -> Result<serde_json::Value, String> {
        let mut line = String::new();
        if self
            .output
            .read_line(&mut line)
            .map_err(|error| error.to_string())?
            == 0
        {
            return Err("MCP Apps provider stopped".into());
        }
        serde_json::from_str(&line).map_err(|error| error.to_string())
    }
    fn open(&mut self, request: &McpSourceRequest, locale: &str) -> Result<HostEvent, String> {
        writeln!(self.input,"{}",serde_json::json!({"action":"open","thread_id":request.thread_id,"request_id":request.request_id,"locale":locale})).map_err(|error|error.to_string())?;
        self.input.flush().map_err(|error| error.to_string())?;
        serde_json::from_value(self.read()?).map_err(|error| error.to_string())
    }
}
impl Drop for Provider {
    fn drop(&mut self) {
        let _ = writeln!(self.input, "{{\"action\":\"shutdown\"}}");
        let _ = self.input.flush();
        let _ = self.child.wait();
    }
}
pub struct Mcp {
    provider: Option<Provider>,
    config: PathBuf,
}
impl Mcp {
    pub fn new(settings: Option<&Path>) -> Self {
        Self {
            provider: None,
            config: settings
                .and_then(Path::parent)
                .unwrap_or_else(|| Path::new("."))
                .join("mcp-servers.json"),
        }
    }
    pub fn dispatch(
        &mut self,
        value: serde_json::Value,
        agents: &super::agents::Manager,
        locale: &str,
    ) -> HostEvent {
        let request = match serde_json::from_value::<McpSourceRequest>(value) {
            Ok(request) if !request.request_id.is_empty() && request.request_id.len() <= 128 => {
                request
            }
            _ => return HostEvent::new("mcp_error", None, "Invalid MCP source request".into()),
        };
        let mut event =
            HostEvent::new("mcp_error", Some(request.request_id.clone()), String::new());
        if request
            .thread_id
            .as_ref()
            .is_some_and(|thread| !agents.has_thread(thread))
        {
            event.text = "This conversation is unavailable".into();
            return event;
        }
        if std::env::var_os("PERO_MCP_EXTERNAL").is_some() {
            event.kind = "mcp_permitted".into();
            event.thread_id = request.thread_id;
            event.data = serde_json::json!({"locale":locale});
            return event;
        }
        let result = (|| {
            if self.provider.is_none() {
                self.provider = Some(Provider::start(&self.config)?);
            }
            self.provider
                .as_mut()
                .expect("provider started")
                .open(&request, locale)
        })();
        match result {
            Ok(event) => event,
            Err(error) => {
                self.provider = None;
                event.text = error;
                event
            }
        }
    }
}
