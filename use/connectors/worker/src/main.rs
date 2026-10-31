use serde::Deserialize;
mod credentials;
mod github;
mod gitlab;
mod gmail;
mod linear;
mod m365;
mod platform;
mod session;
use serde_json::{json, Value};
use std::io::{self, BufRead, BufReader, Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

const VERSION: &str = "2025-03-26";
const INPUT_LIMIT: usize = 131072;
const FRAME_LIMIT: usize = 1048576;
const TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug)]
struct Failure(&'static str, String);
type Result<T> = std::result::Result<T, Failure>;
fn fail(code: &'static str, message: &str) -> Failure {
    Failure(code, message.into())
}
fn io_error(_: io::Error) -> Failure {
    fail("MCP_TRANSPORT", "MCP pipe failed")
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    #[serde(rename = "requestId")]
    request_id: String,
    #[serde(rename = "connectorId")]
    connector_id: String,
    method: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    arguments: Option<Value>,
}

fn validate(request: &Request) -> Result<()> {
    if request.request_id.is_empty()
        || request.request_id.len() > 128
        || request.connector_id != "point.table"
    {
        return Err(fail(
            "MCP_CAPABILITY_DENIED",
            "Unknown connector or invalid request identity",
        ));
    }
    match request.method.as_str() {
        "mcp.tools.list" if request.name.is_none() && request.arguments.is_none() => Ok(()),
        "mcp.tools.call" if request.name.as_deref() == Some("table_summary") => {
            summary(request.arguments.as_ref().unwrap_or(&Value::Null))?;
            Ok(())
        }
        _ => Err(fail("MCP_CAPABILITY_DENIED", "Unsupported operation")),
    }
}

fn catalog() -> Value {
    json!({"tools": [{"name": "table_summary", "description": "Summarize up to 1000 finite numeric values. No files or network.",
        "inputSchema": {"type":"object", "properties":{"values":{"type":"array","items":{"type":"number"},"maxItems":1000}},
        "required":["values"],"additionalProperties":false}}]})
}

fn summary(args: &Value) -> Result<Value> {
    let object = args
        .as_object()
        .ok_or_else(|| fail("MCP_INVALID_ARGUMENT", "Expected values object"))?;
    let values = object
        .get("values")
        .and_then(Value::as_array)
        .ok_or_else(|| fail("MCP_INVALID_ARGUMENT", "Expected numeric values"))?;
    if object.len() != 1 || values.len() > 1000 {
        return Err(fail("MCP_INVALID_ARGUMENT", "Invalid table input"));
    }
    let mut sum = 0.0;
    for v in values {
        sum += v
            .as_f64()
            .filter(|n| n.is_finite())
            .ok_or_else(|| fail("MCP_INVALID_ARGUMENT", "Expected finite numbers"))?;
        if !sum.is_finite() {
            return Err(fail("MCP_INVALID_ARGUMENT", "Numeric overflow"));
        }
    }
    Ok(
        json!({"content":[{"type":"text","text":json!({"count":values.len(),"sum":sum,
        "mean":if values.is_empty() {Value::Null} else {json!(sum / values.len() as f64)}}).to_string()}]}),
    )
}

fn read_frame(reader: &mut impl BufRead) -> Result<Value> {
    let mut bytes = Vec::new();
    reader
        .take((FRAME_LIMIT + 1) as u64)
        .read_until(b'\n', &mut bytes)
        .map_err(io_error)?;
    if bytes.len() > FRAME_LIMIT {
        return Err(fail("MCP_FRAME_LIMIT", "MCP frame too large"));
    }
    if bytes.last() != Some(&b'\n') {
        return Err(fail("MCP_PROTOCOL", "Incomplete MCP frame"));
    }
    serde_json::from_slice(&bytes).map_err(|_| fail("MCP_PROTOCOL", "Invalid MCP JSON"))
}
fn send(writer: &mut impl Write, value: Value) -> Result<()> {
    let bytes = serde_json::to_vec(&value)
        .map_err(|_| fail("MCP_SERIALIZE", "Cannot serialize MCP message"))?;
    if bytes.len() + 1 > FRAME_LIMIT {
        return Err(fail("MCP_FRAME_LIMIT", "MCP frame too large"));
    }
    writer.write_all(&bytes).map_err(io_error)?;
    writer.write_all(b"\n").map_err(io_error)?;
    writer.flush().map_err(io_error)
}
fn response(reader: &mut impl BufRead, id: u64) -> Result<Value> {
    // A bounded notification allowance prevents a peer from starving its response.
    for _ in 0..64 {
        let message = read_frame(reader)?;
        if message["jsonrpc"] != "2.0" {
            return Err(fail("MCP_PROTOCOL", "Invalid JSON-RPC version"));
        }
        if message.get("id").is_none()
            && message["method"]
                .as_str()
                .is_some_and(|s| s.starts_with("notifications/"))
        {
            continue;
        }
        if message["id"] != id || message.get("result").is_some() == message.get("error").is_some()
        {
            return Err(fail("MCP_PROTOCOL", "Mismatched MCP response"));
        }
        if message.get("error").is_some() {
            return Err(fail("MCP_SERVER_ERROR", "MCP server rejected request"));
        }
        return Ok(message["result"].clone());
    }
    Err(fail("MCP_PROTOCOL", "Too many MCP notifications"))
}

// Every transaction owns its child process group. No cross-call session state is assumed.
struct ServerProcess(Child);
impl Drop for ServerProcess {
    fn drop(&mut self) {
        platform::kill_owned_group(self.0.id());
        let _ = self.0.wait();
    }
}
fn transact(
    request: Request,
    mut server: ServerProcess,
    deadline: Duration,
    owner: platform::Owner,
) -> Result<Value> {
    let server_pid = server.0.id();
    let mut stdin = server
        .0
        .stdin
        .take()
        .ok_or_else(|| fail("MCP_TRANSPORT", "Missing stdin"))?;
    let mut stdout = BufReader::new(
        server
            .0
            .stdout
            .take()
            .ok_or_else(|| fail("MCP_TRANSPORT", "Missing stdout"))?,
    );
    let request_id = request.request_id.clone();
    let (tx, rx) = mpsc::sync_channel(1);
    let io = std::thread::spawn(move || {
        let result = (|| {
            send(
                &mut stdin,
                json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{
                "protocolVersion":VERSION,"capabilities":{},"clientInfo":{"name":"point-mcp-worker","version":"0.1.0"}}}),
            )?;
            let init = response(&mut stdout, 1)?;
            if init["protocolVersion"] != VERSION || !init["capabilities"]["tools"].is_object() {
                return Err(fail(
                    "MCP_PROTOCOL",
                    "Unsupported protocol or missing tools capability",
                ));
            }
            send(
                &mut stdin,
                json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
            )?;
            send(
                &mut stdin,
                json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
            )?;
            let tools = response(&mut stdout, 2)?;
            if tools != catalog() {
                return Err(fail("MCP_CATALOG", "Unexpected built-in connector catalog"));
            }
            if request.method == "mcp.tools.list" {
                return Ok(tools);
            }
            send(
                &mut stdin,
                json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{
                "name":request.name,"arguments":request.arguments}}),
            )?;
            let result = response(&mut stdout, 3)?;
            if !result["content"].is_array() {
                return Err(fail("MCP_PROTOCOL", "Invalid CallToolResult"));
            }
            Ok(result)
        })();
        let _ = tx.send(result);
    });
    let started = Instant::now();
    let result = loop {
        if platform::cancellation_requested() || owner.disconnected() {
            break Err(fail("MCP_CANCELLED", "MCP owner disconnected"));
        }
        if started.elapsed() >= deadline {
            break Err(fail("MCP_TIMEOUT", "MCP transaction deadline exceeded"));
        }
        match rx.recv_timeout(Duration::from_millis(10)) {
            Ok(result) => break result,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                break Err(fail("MCP_TRANSPORT", "MCP IO worker exited"))
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    };
    drop(server); // close child pipes before joining blocked IO
    let _ = io.join();
    result.map(|result| {
        json!({"requestId":request_id,"connectorId":"point.table","result":result,
        "workerPid":std::process::id(),"serverPid":server_pid,"protocolVersion":VERSION})
    })
}

fn run_worker() -> Result<Value> {
    let owner = platform::Owner::capture();
    if owner.disconnected() {
        return Err(fail("MCP_CANCELLED", "MCP owner disconnected"));
    }
    let mut input = Vec::new();
    io::stdin()
        .take((INPUT_LIMIT + 1) as u64)
        .read_to_end(&mut input)
        .map_err(io_error)?;
    if input.len() > INPUT_LIMIT {
        return Err(fail("MCP_INPUT_LIMIT", "Request too large"));
    }
    let request: Request = serde_json::from_slice(&input)
        .map_err(|_| fail("MCP_INVALID_ARGUMENT", "Invalid worker request"))?;
    validate(&request)?;
    let executable = std::env::current_exe().map_err(io_error)?;
    let mut command = Command::new(executable);
    command
        .arg("--server")
        .env_clear()
        .current_dir(platform::default_working_directory().map_err(io_error)?)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    platform::prepare_command(&mut command).map_err(io_error)?;
    let child = command.spawn().map_err(io_error)?;
    transact(request, ServerProcess(child), TIMEOUT, owner)
}

// Fixed built-in MCP server. No command, environment, URL or path is caller-selected.
fn serve() -> Result<()> {
    let owner = platform::Owner::capture();
    if owner.disconnected() {
        return Ok(());
    }
    // Also cover SIGKILL of this built-in server's owner. This watchdog is not
    // a substitute for a supervisor when third-party servers are introduced.
    std::thread::spawn(move || loop {
        if platform::cancellation_requested() || owner.disconnected() {
            std::process::exit(0);
        }
        std::thread::sleep(Duration::from_millis(25));
    });
    let mut reader = BufReader::new(io::stdin());
    let mut writer = io::stdout();
    let mut initialized = false;
    let mut negotiated = false;
    loop {
        let message = match read_frame(&mut reader) {
            Ok(v) => v,
            Err(_) => return Ok(()),
        };
        if message["jsonrpc"] != "2.0" {
            return Err(fail("MCP_PROTOCOL", "Invalid JSON-RPC version"));
        }
        if message["method"] == "notifications/initialized" && negotiated {
            initialized = true;
            continue;
        }
        let result = match message["method"].as_str() {
            Some("initialize")
                if !negotiated && message["params"]["protocolVersion"].is_string() =>
            {
                negotiated = true;
                Ok(
                    json!({"protocolVersion":VERSION,"capabilities":{"tools":{}},"serverInfo":{"name":"point-table-mcp","version":"0.1.0"}}),
                )
            }
            Some("tools/list") if initialized => Ok(catalog()),
            Some("tools/call") if initialized && message["params"]["name"] == "table_summary" => {
                summary(&message["params"]["arguments"])
            }
            _ => Err(fail("MCP_CAPABILITY_DENIED", "Unsupported request")),
        };
        let reply = match result {
            Ok(v) => json!({"jsonrpc":"2.0","id":message["id"],"result":v}),
            Err(e) => {
                json!({"jsonrpc":"2.0","id":message["id"],"error":{"code":-32602,"message":e.1}})
            }
        };
        send(&mut writer, reply)?;
    }
}

fn main() {
    if !platform::supported() {
        println!(
            "{}",
            json!({"ok":false,"error":{"code":platform::UNSUPPORTED,"message":platform::UNSUPPORTED}})
        );
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("--session") {
        session::run();
        return;
    }
    platform::install_cancellation_handler();
    if std::env::args().nth(1).as_deref() == Some("--server") {
        let _ = serve();
        return;
    }
    let reply = match run_worker() {
        Ok(value) => json!({"ok":true,"value":value}),
        Err(e) => json!({"ok":false,"error":{"code":e.0,"message":e.1}}),
    };
    let _ = serde_json::to_writer(io::stdout(), &reply);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_capability_escalation_and_invalid_inputs() {
        for value in [
            json!({"values":[1],"command":"sh"}),
            json!({"values":["1"]}),
            json!({"values":[1e308,1e308]}),
            json!({"values":vec![1;1001]}),
        ] {
            assert!(summary(&value).is_err());
        }
        assert!(serde_json::from_value::<Request>(json!({"requestId":"a","connectorId":"point.table","method":"mcp.tools.list","command":"sh"})).is_err());
        assert_eq!(
            summary(&json!({"values":[]})).unwrap()["content"][0]["text"],
            "{\"count\":0,\"mean\":null,\"sum\":0.0}"
        );
    }
    #[test]
    fn bounds_and_correlates_frames() {
        assert_eq!(
            read_frame(&mut &vec![b'x'; FRAME_LIMIT + 1][..])
                .unwrap_err()
                .0,
            "MCP_FRAME_LIMIT"
        );
        assert!(read_frame(&mut &b"{}"[..]).is_err());
        assert!(response(
            &mut &b"{\"jsonrpc\":\"2.0\",\"id\":8,\"result\":{}}\n"[..],
            1
        )
        .is_err());
        assert!(response(
            &mut &b"{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{},\"error\":{}}\n"[..],
            1
        )
        .is_err());
    }
    #[test]
    #[cfg(unix)]
    fn deadline_reaps_unresponsive_server_group() {
        use std::os::unix::process::CommandExt;
        let child = Command::new("/bin/sleep")
            .arg("30")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .process_group(0)
            .spawn()
            .unwrap();
        let pid = child.id();
        let request: Request = serde_json::from_value(
            json!({"requestId":"test","connectorId":"point.table","method":"mcp.tools.list"}),
        )
        .unwrap();
        let result = transact(
            request,
            ServerProcess(child),
            Duration::from_millis(50),
            platform::Owner::capture(),
        );
        assert_eq!(result.unwrap_err().0, "MCP_TIMEOUT");
        assert_eq!(unsafe { libc::kill(pid as i32, 0) }, -1);
    }
    #[test]
    #[cfg(unix)]
    fn owner_disconnect_reaps_server() {
        use std::os::unix::process::CommandExt;
        let child = Command::new("/bin/sleep")
            .arg("30")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .process_group(0)
            .spawn()
            .unwrap();
        let pid = child.id();
        let request = serde_json::from_value(
            json!({"requestId":"owner","connectorId":"point.table","method":"mcp.tools.list"}),
        )
        .unwrap();
        assert_eq!(
            transact(
                request,
                ServerProcess(child),
                TIMEOUT,
                platform::Owner::missing()
            )
            .unwrap_err()
            .0,
            "MCP_CANCELLED"
        );
        assert_eq!(unsafe { libc::kill(pid as i32, 0) }, -1);
    }
}
