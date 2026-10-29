#![cfg(unix)]
use serde_json::{Value, json};
use std::{
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    process::{Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

const AGENT: &str = r#"
import readline from 'node:readline';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
let active;
const send = value => process.stdout.write(JSON.stringify({jsonrpc:'2.0',...value})+'\n');
const result = (id,result) => send({id,result});
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 if(m.method==='initialize')result(m.id,{protocolVersion:1,agentCapabilities:{}});
 if(m.method==='session/new')result(m.id,{sessionId:'fixture'});
 if(m.method==='session/prompt'){
  fs.appendFileSync(process.env.WORKER_FIXTURE_MARKER,'prompt\n'); active=m.id;
  if(m.params.prompt[0].text==='wait'){
   const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
   fs.writeFileSync(process.env.WORKER_FIXTURE_DESCENDANT,String(child.pid));return;
  }
  send({method:'session/update',params:{sessionId:'fixture',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'worker_token_visible='+Boolean(process.env.PERO_WORKER_TOKEN||process.env.PERO_OPERATOR_TOKEN||process.env.PERO_DATABASE_URL||process.env.PERO_UNKNOWN_SECRET||process.env.PERO_RUNTIME_POD_UID)}}}});
  if(m.params.prompt[0].text==='permission'){
   send({id:900,method:'session/request_permission',params:{sessionId:'fixture',toolCall:{toolCallId:'tool',title:'fixture',status:'pending'},options:[{optionId:'allow',name:'Allow',kind:'allow_once'}]}});return;
  }
  result(active,{stopReason:'end_turn'});
 }
 if(m.id===900){
  if(m.result.outcome.outcome!=='cancelled')process.exit(2);
  result(active,{stopReason:'end_turn'});
 }
 if(m.method==='session/cancel')result(active,{stopReason:'cancelled'});
});
"#;

#[derive(Default)]
struct CloudState {
    run: Value,
    events: Vec<Value>,
    renewals: usize,
    claim_keys: Vec<(String, String)>,
    claim_pod_uids: Vec<Value>,
    completion: Option<Value>,
    channel_grants: Vec<Value>,
    lose_channel_response: bool,
    claim_failures: usize,
    claim_status: Option<&'static str>,
}

struct Fixture {
    root: PathBuf,
    url: String,
    state: Arc<Mutex<CloudState>>,
    stop: Arc<AtomicBool>,
}

fn read_request(stream: &mut TcpStream) -> Option<(String, Value)> {
    // BSD accept inherits the listener's nonblocking flag. Each connection is
    // handled on its own thread and must wait for headers/body within the timeout.
    stream.set_nonblocking(false).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    let mut input = BufReader::new(stream);
    let mut request = String::new();
    input.read_line(&mut request).ok()?;
    let path = request.split_whitespace().nth(1)?.to_owned();
    let mut length = 0;
    let mut authorized = false;
    loop {
        let mut line = String::new();
        input.read_line(&mut line).ok()?;
        if line == "\r\n" {
            break;
        }
        let (name, value) = line.trim().split_once(':')?;
        if name.eq_ignore_ascii_case("content-length") {
            length = value.trim().parse().unwrap();
        }
        if name.eq_ignore_ascii_case("authorization") {
            authorized = value.trim() == "Bearer cloud-secret";
        }
    }
    assert!(authorized, "Worker authorization missing");
    let mut body = vec![0; length];
    input.read_exact(&mut body).ok()?;
    Some((
        path,
        if body.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&body).unwrap()
        },
    ))
}

#[test]
fn cloud_request_waits_for_headers_on_an_inherited_nonblocking_socket() {
    use std::os::fd::AsRawFd;
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let mut client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
    let (mut server, _) = listener.accept().unwrap();
    // Reproduce BSD's inherited state on every Unix test host.
    server.set_nonblocking(true).unwrap();
    let observer = server.try_clone().unwrap();
    let reader = std::thread::spawn(move || read_request(&mut server));
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        let flags = unsafe { libc::fcntl(observer.as_raw_fd(), libc::F_GETFL) };
        assert_ne!(flags, -1);
        if flags & libc::O_NONBLOCK == 0 {
            break;
        }
        assert!(
            !reader.is_finished(),
            "request reader returned before headers arrived"
        );
        assert!(
            Instant::now() < deadline,
            "request reader did not enter blocking mode"
        );
        std::thread::yield_now();
    }
    client.write_all(b"POST /claims HTTP/1.1\r\nAuthorization: Bearer cloud-secret\r\nContent-Length: 2\r\n\r\n{}").unwrap();
    assert_eq!(reader.join().unwrap(), Some(("/claims".into(), json!({}))));
    assert_eq!(
        observer.read_timeout().unwrap(),
        Some(Duration::from_secs(2))
    );
}

fn expiry() -> String {
    (OffsetDateTime::now_utc() + time::Duration::seconds(3))
        .format(&Rfc3339)
        .unwrap()
}

impl Fixture {
    fn new(prompt: &str, cancel: bool, lose_lease: bool) -> Self {
        Self::new_under(prompt, cancel, lose_lease, std::env::temp_dir())
    }
    fn new_under(prompt: &str, cancel: bool, lose_lease: bool, parent: PathBuf) -> Self {
        let root = parent.join(format!("pero-remote-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("workspace")).unwrap();
        std::fs::write(root.join("agent.mjs"), AGENT).unwrap();
        let node = std::env::split_paths(&std::env::var_os("PATH").unwrap())
            .map(|p| p.join("node"))
            .find(|p| p.is_file())
            .unwrap();
        std::fs::write(root.join("agents.json"),json!([{"id":"fixture","name":"Fixture","command":node,"args":[root.join("agent.mjs")],"env":{"WORKER_FIXTURE_MARKER":root.join("marker"),"WORKER_FIXTURE_DESCENDANT":root.join("descendant")}}]).to_string()).unwrap();
        std::fs::write(root.join("config.json"),json!({"workspaces":{"fixture":root.join("workspace")},"agents_file":root.join("agents.json")}).to_string()).unwrap();
        let state = Arc::new(Mutex::new(CloudState {
            run: json!({"id":"run_1","generation":1,"instance_id":"","status":"running","lease_expires_at":expiry(),"spec":{"title":"Fixture","prompt":prompt,"workspace_key":"fixture","agent_id":"fixture","acceptance":""}}),
            ..Default::default()
        }));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let stop = Arc::new(AtomicBool::new(false));
        let stopping = stop.clone();
        let cloud = state.clone();
        let journal_path = root.join("state.json");
        std::thread::spawn(move || {
            while !stopping.load(Ordering::SeqCst) {
                let Ok((mut stream, _)) = listener.accept() else {
                    std::thread::sleep(Duration::from_millis(5));
                    continue;
                };
                let cloud = cloud.clone();
                let journal_path = journal_path.clone();
                std::thread::spawn(move || {
                    let Some((path, body)) = read_request(&mut stream) else {
                        return;
                    };
                    let mut state = cloud.lock().unwrap();
                    let mut status = "200 OK";
                    let response = if path.ends_with("/claims") {
                        state.claim_keys.push((
                            body["request_id"].as_str().unwrap().into(),
                            body["instance_id"].as_str().unwrap().into(),
                        ));
                        state.claim_pod_uids.push(body["runtime_pod_uid"].clone());
                        if state.claim_failures > 0 {
                            state.claim_failures -= 1;
                            status = state.claim_status.unwrap_or("503 Service Unavailable");
                            json!({"error":"unavailable"})
                        } else {
                            state.run["instance_id"] = body["instance_id"].clone();
                            state.run["lease_expires_at"] = json!(expiry());
                            json!({"run":state.run})
                        }
                    } else if path.ends_with("/channel") {
                        // At the externally observable issuance boundary the exact
                        // grant must already be durable, even if this reply is lost.
                        let journal: Value = serde_json::from_slice(&std::fs::read(&journal_path).unwrap()).unwrap();
                        assert_eq!(journal["active"]["remote_grant"]["secret"], body["secret"]);
                        assert_eq!(journal["active"]["remote_grant"]["session_id"], body["session_id"]);
                        assert_eq!(journal["active"]["run"]["instance_id"], body["instance_id"]);
                        state.channel_grants.push(body.clone());
                        if state.lose_channel_response { return; }
                        json!({"session_id":body["session_id"]})
                    } else if path.ends_with("/renew") {
                        state.renewals += 1;
                        if lose_lease && state.renewals > 1 {
                            status = "503 Service Unavailable";
                            json!({"error":"offline"})
                        } else {
                            state.run["lease_expires_at"] = json!(expiry());
                            json!({"cancel_requested":cancel&&state.renewals>=3,"lease_expires_at":state.run["lease_expires_at"]})
                        }
                    } else if path.ends_with("/events") {
                        for event in body["events"].as_array().unwrap() {
                            if !state.events.iter().any(|e| e["seq"] == event["seq"]) {
                                state.events.push(event.clone());
                            }
                        }
                        json!({"last_seq":state.events.last().map(|v|&v["seq"]).unwrap_or(&Value::Null)})
                    } else if path.ends_with("/complete") {
                        state.completion = Some(body.clone());
                        state.run["status"] = body["outcome"].clone();
                        state.run.clone()
                    } else {
                        state.run.clone()
                    };
                    let text = response.to_string();
                    let _ = write!(
                        stream,
                        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{text}",
                        text.len()
                    );
                });
            }
        });
        Self {
            root,
            url,
            state,
            stop,
        }
    }
    fn remote(&self, disconnect: bool) {
        use std::os::unix::fs::PermissionsExt;
        self.state.lock().unwrap().run["remote_execution"] = json!({"session_id":"run_1","working_directory":"/workspace/repo"});
        let node = std::env::split_paths(&std::env::var_os("PATH").unwrap()).map(|p| p.join("node")).find(|p| p.is_file()).unwrap();
        let script = self.root.join("bridge.mjs");
        let source = AGENT
            .replace("process.env.WORKER_FIXTURE_MARKER", &json!(self.root.join("remote-marker")).to_string())
            .replace("process.env.WORKER_FIXTURE_DESCENDANT", &json!(self.root.join("descendant")).to_string());
        let checks = format!("if(!/^[a-f0-9]{{64}}$/.test(process.env.PERO_REMOTE_CHANNEL_SECRET||'')||process.env.PERO_WORKER_TOKEN||process.env.AGENT_PROVIDER_API_KEY||process.env.UNTRUSTED_INHERITED)process.exit(4);fs.writeFileSync({},process.env.PERO_REMOTE_CHANNEL_SECRET);\n",json!(self.root.join("bridge-secret")));
        let source = if disconnect { source.replace("active=m.id;", "active=m.id;process.exit(3);") } else { source };
        std::fs::write(&script, format!("#!{}\n{}\n{}",node.display(),checks,source)).unwrap();
        std::fs::set_permissions(&script,std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::write(self.root.join("config.json"),json!({"remote_bridge":script}).to_string()).unwrap();
    }
    fn command(&self) -> Command {
        self.command_mode(true)
    }
    fn command_mode(&self, once: bool) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_pero-worker"));
        if once {
            command.arg("--once");
        }
        command
            .env("PERO_CLOUD_URL", &self.url)
            .env("PERO_WORKER_TOKEN", "cloud-secret")
            .env("PERO_OPERATOR_TOKEN", "operator-secret")
            .env("PERO_DATABASE_URL", "database-secret")
            .env("PERO_UNKNOWN_SECRET", "future-secret")
            .env_remove("PERO_RUNTIME_POD_UID")
            .env("PERO_WORKER_CONFIG", self.root.join("config.json"))
            .env("PERO_WORKER_STATE", self.root.join("state.json"))
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        command
    }
    fn run(&self) -> std::process::Output {
        self.command().output().unwrap()
    }
    fn descendant_gone(&self) {
        let pid = std::fs::read_to_string(self.root.join("descendant"))
            .unwrap()
            .parse::<i32>()
            .unwrap();
        assert_eq!(
            unsafe { libc::kill(pid, 0) },
            -1,
            "descendant still exists after cleanup"
        );
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[test]
fn executes_once_with_durable_events_and_no_cloud_token_in_agent() {
    let fixture = Fixture::new("hello", false, false);
    let output = fixture.run();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let state = fixture.state.lock().unwrap();
    assert_eq!(state.completion.as_ref().unwrap()["outcome"], "succeeded");
    assert!(
        state
            .events
            .iter()
            .any(|e| e["data"]["content"]["text"] == "worker_token_visible=false")
    );
    assert_eq!(
        std::fs::read_to_string(fixture.root.join("marker")).unwrap(),
        "prompt\n"
    );
}

#[test]
fn accepts_full_unicode_prompt_and_acceptance_input() {
    let fixture = Fixture::new(&"😀".repeat(64000), false, false);
    fixture.state.lock().unwrap().run["spec"]["acceptance"] = json!("😀".repeat(16000));
    let output = fixture.run();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        fixture.state.lock().unwrap().completion.as_ref().unwrap()["outcome"],
        "succeeded"
    );
    assert_eq!(
        std::fs::read_to_string(fixture.root.join("marker")).unwrap(),
        "prompt\n"
    );
}

#[test]
fn unattended_permissions_are_denied() {
    let fixture = Fixture::new("permission", false, false);
    let output = fixture.run();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        fixture
            .state
            .lock()
            .unwrap()
            .events
            .iter()
            .any(|e| e["kind"] == "permission_denied")
    );
}

#[test]
fn cancel_is_observed_without_agent_output_and_kills_descendants() {
    let fixture = Fixture::new("wait", true, false);
    let output = fixture.run();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        fixture.state.lock().unwrap().completion.as_ref().unwrap()["outcome"],
        "cancelled"
    );
    fixture.descendant_gone();
}

#[test]
fn lease_loss_stops_silent_agent_and_descendants() {
    let fixture = Fixture::new("wait", false, true);
    let started = Instant::now();
    let output = fixture.run();
    assert!(!output.status.success());
    assert!(started.elapsed() < Duration::from_secs(9));
    fixture.descendant_gone();
    let state = fixture.state.lock().unwrap();
    if let Some(completion) = state.completion.as_ref() {
        assert_eq!(completion["outcome"], "reconcile");
    } else {
        // If Cloud rejects renewal, the stopped result must remain durable locally.
        let journal: Value =
            serde_json::from_slice(&std::fs::read(fixture.root.join("state.json")).unwrap())
                .unwrap();
        assert_eq!(journal["active"]["result"]["outcome"], "reconcile");
    }
}

#[test]
fn interrupted_claim_is_reconciled_without_replaying_prompt() {
    let fixture = Fixture::new("hello", false, false);
    std::fs::write(fixture.root.join("state.json"),json!({"pending_claim":{"request_id":"lost-response","instance_id":"old-instance"},"active":null}).to_string()).unwrap();
    // Recovery records reconciliation and exits before accepting another task.
    let mut command = fixture.command();
    let mut child = command.spawn().unwrap();
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        if fixture.state.lock().unwrap().completion.is_some() {
            break;
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
    let _ = child.kill();
    let _ = child.wait();
    let state = fixture.state.lock().unwrap();
    assert_eq!(
        state.claim_keys[0],
        ("lost-response".into(), "old-instance".into())
    );
    assert_eq!(state.completion.as_ref().unwrap()["outcome"], "reconcile");
    assert!(!fixture.root.join("marker").exists());
}


// Native protocol fixture, never executes tools or makes model/network calls.
#[test]
fn pinned_operator_policy_admits_only_one_native_shell_permission() {
    let fixture = Fixture::new_under("hello", false, false, std::env::current_dir().unwrap());
    let source = fixture.root.join("fixture.c");
    let binary = fixture.root.join("native-fixture");
    std::fs::write(&source, r#"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void) {
 if(getenv("LD_PRELOAD") || getenv("UNTRUSTED_INHERITED") || getenv("PERO_WORKER_TOKEN")) return 4;
 char line[65536], prompt[128]="0";
 while(fgets(line,sizeof(line),stdin)) {
  char *id=strstr(line,"\"id\":"); char n[128]="0";
  if(id) { id+=5; size_t count=strcspn(id,",}"); if(count>=sizeof(n)) return 3; memcpy(n,id,count); n[count]=0; }
  if(strstr(line,"\"initialize\"")) printf("{\"jsonrpc\":\"2.0\",\"id\":%s,\"result\":{\"protocolVersion\":1,\"agentCapabilities\":{}}}\n",n);
  else if(strstr(line,"session/new")) printf("{\"jsonrpc\":\"2.0\",\"id\":%s,\"result\":{\"sessionId\":\"fixture\"}}\n",n);
  else if(strstr(line,"session/prompt")) { strcpy(prompt,n); puts(getenv("FIXTURE_PERMISSION")); }
  else if(strcmp(n,"900")==0) {
   if(!strstr(line,"selected")) return 2;
   printf("{\"jsonrpc\":\"2.0\",\"id\":%s,\"result\":{\"stopReason\":\"end_turn\"}}\n",prompt);
  }
  fflush(stdout);
 }
 return 0;
}
"#).unwrap();
    assert!(Command::new("cc").arg(&source).arg("-o").arg(&binary).status().unwrap().success());
    let sha256: String = ring::digest::digest(&ring::digest::SHA256, &std::fs::read(&binary).unwrap()).as_ref().iter().map(|b| format!("{b:02x}")).collect();
    let workspace = fixture.root.join("workspace");
    let permission = json!({"jsonrpc":"2.0","id":900,"method":"session/request_permission","params":{"sessionId":"fixture","toolCall":{"toolCallId":"native-shell"},"options":[{"optionId":"once","kind":"allow_once","name":"Once"}],"_meta":{"pero.dev/native-approval":{"version":1,"operation":"shell","workspace":workspace,"sandbox_mode":"workspace-write","enforcement":"required","network":"deny"}}}});
    let env = json!({"FIXTURE_PERMISSION":permission.to_string()});
    std::fs::write(fixture.root.join("agents.json"), json!([{"id":"fixture","name":"Native fixture","command":binary,"args":[],"env":env}]).to_string()).unwrap();
    std::fs::write(fixture.root.join("config.json"), json!({"workspaces":{"fixture":workspace},"agents_file":fixture.root.join("agents.json"),"native_approvals":{"fixture":{"agent_id":"fixture","executable":binary,"sha256":sha256,"args":[],"env":env,"operations":["shell"],"sandbox_mode":"workspace-write"}}}).to_string()).unwrap();
    let output = fixture.command().env("LD_PRELOAD", "").env("UNTRUSTED_INHERITED", "present").output().unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    let state=fixture.state.lock().unwrap();
    assert_eq!(state.completion.as_ref().unwrap()["outcome"], "succeeded");
    assert_eq!(state.events.iter().filter(|e| e["kind"] == "permission_approved").count(),1);
}

#[test]
fn idle_network_reconnect_keeps_the_original_claim_and_executes_once() {
    let fixture = Fixture::new("hello", false, false);
    fixture.state.lock().unwrap().claim_failures = 1;
    let mut child = fixture
        .command_mode(false)
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let output = child.stdout.take().unwrap();
    let (progress, reported) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(output).lines().map_while(Result::ok) {
            let _ = progress.send(serde_json::from_str::<Value>(&line).unwrap());
        }
    });
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut offline = false;
    loop {
        let state = reported
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .expect("Worker progress");
        if state["status"] == "offline" {
            offline = true;
        }
        if state["status"] == "running" {
            break;
        }
    }
    while fixture.state.lock().unwrap().completion.is_none() {
        assert!(
            Instant::now() < deadline,
            "Worker never completed after reconnect"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    child.kill().unwrap();
    child.wait().unwrap();
    let state = fixture.state.lock().unwrap();
    assert!(offline);
    assert_eq!(
        state.claim_keys[0], state.claim_keys[1],
        "network errors must keep the original idempotent claim"
    );
    assert_eq!(
        std::fs::read_to_string(fixture.root.join("marker")).unwrap(),
        "prompt\n"
    );
}

#[test]
fn revoked_worker_credential_stops_before_any_execution() {
    let fixture = Fixture::new("hello", false, false);
    {
        let mut state = fixture.state.lock().unwrap();
        state.claim_failures = 1;
        state.claim_status = Some("401 Unauthorized");
    }
    let output = fixture
        .command_mode(false)
        .stdout(Stdio::piped())
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert_eq!(fixture.state.lock().unwrap().claim_keys.len(), 1);
    assert!(!fixture.root.join("marker").exists());
    let states = String::from_utf8(output.stdout)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .collect::<Vec<_>>();
    assert_eq!(states.last().unwrap()["status"], "needs_attention");
}

#[test]
fn runtime_claim_identity_survives_lost_response_and_changed_pod_environment() {
    let fixture = Fixture::new("hello", false, false);
    fixture.state.lock().unwrap().claim_failures = 1;
    let first = fixture.command().env("PERO_RUNTIME_POD_UID", "pod-original").output().unwrap();
    assert!(!first.status.success());
    let journal: Value = serde_json::from_slice(&std::fs::read(fixture.root.join("state.json")).unwrap()).unwrap();
    assert_eq!(journal["pending_claim"]["runtime_pod_uid"], "pod-original");
    assert!(!fixture.root.join("marker").exists());
    let recovered = fixture.command().env("PERO_RUNTIME_POD_UID", "pod-replacement").output().unwrap();
    assert!(recovered.status.success(), "{}", String::from_utf8_lossy(&recovered.stderr));
    let state = fixture.state.lock().unwrap();
    assert_eq!(state.claim_pod_uids, vec![json!("pod-original"), json!("pod-original")]);
    assert_eq!(state.claim_keys[0], state.claim_keys[1]);
    assert_eq!(state.completion.as_ref().unwrap()["outcome"], "reconcile");
    assert!(!fixture.root.join("marker").exists(), "restart must not replay the prompt");
}

#[test]
fn runtime_claim_executes_through_local_acp_without_runtime_identity_in_agent() {
    let fixture = Fixture::new("hello", false, false);
    let output = fixture.command().env("PERO_RUNTIME_POD_UID", "pod-original").output().unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    let state = fixture.state.lock().unwrap();
    assert_eq!(state.claim_pod_uids, vec![json!("pod-original")]);
    assert_eq!(state.completion.as_ref().unwrap()["outcome"], "succeeded");
    assert!(state.events.iter().any(|e| e["data"]["content"]["text"] == "worker_token_visible=false"));
    assert_eq!(std::fs::read_to_string(fixture.root.join("marker")).unwrap(), "prompt\n");
}


#[test]
fn isolated_run_uses_only_durable_grant_and_denies_permissions() {
    let fixture = Fixture::new("permission", false, false);
    fixture.remote(false);
    let output = fixture.command().env("UNTRUSTED_INHERITED", "host-secret").env("AGENT_PROVIDER_API_KEY", "provider-secret").output().unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    let state = fixture.state.lock().unwrap();
    assert_eq!(state.completion.as_ref().unwrap()["outcome"], "succeeded");
    assert_eq!(state.channel_grants.len(), 1);
    let secret = std::fs::read_to_string(fixture.root.join("bridge-secret")).unwrap();
    assert_eq!(state.channel_grants[0]["secret"], secret);
    assert_eq!(state.channel_grants[0]["session_id"], "run_1");
    assert!(state.events.iter().any(|e| e["kind"] == "permission_denied"));
    assert!(!serde_json::to_string(&state.events).unwrap().contains(&secret));
    assert!(!String::from_utf8_lossy(&output.stderr).contains(&secret));
    assert_eq!(std::fs::read_to_string(fixture.root.join("remote-marker")).unwrap(), "prompt\n");
    assert!(!fixture.root.join("marker").exists(), "local Agent must not execute");
}

#[test]
fn isolated_run_never_falls_back_or_replays_after_uncertain_channel() {
    for mode in ["missing-bridge", "lost-issuance", "accepted-eof"] {
        let fixture = Fixture::new("hello", false, false);
        fixture.remote(mode == "accepted-eof");
        if mode == "missing-bridge" {
            std::fs::write(fixture.root.join("config.json"),json!({"workspaces":{"fixture":fixture.root.join("workspace")},"agents_file":fixture.root.join("agents.json")}).to_string()).unwrap();
        }
        fixture.state.lock().unwrap().lose_channel_response = mode == "lost-issuance";
        let output = fixture.run();
        assert!(!output.status.success(), "{mode} unexpectedly succeeded");
        let state = fixture.state.lock().unwrap();
        assert_eq!(state.completion.as_ref().unwrap()["outcome"], "reconcile", "{mode}");
        assert_eq!(state.channel_grants.len(), usize::from(mode != "missing-bridge"));
        assert!(!fixture.root.join("marker").exists());
        if mode != "accepted-eof" { assert!(!fixture.root.join("remote-marker").exists()); }
    }
}

#[test]
fn isolated_restart_reconciles_original_secret_without_opening_or_prompting() {
    let fixture = Fixture::new("hello", false, false);
    fixture.remote(false);
    let run = fixture.state.lock().unwrap().run.clone();
    let secret = "a".repeat(64);
    std::fs::write(fixture.root.join("state.json"),json!({"pending_claim":null,"active":{"run":run,"request_id":"original-claim","events":[],"acknowledged":0,"result":null,"remote_grant":{"session_id":"run_1","secret":secret}}}).to_string()).unwrap();
    let output = fixture.run();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    let state = fixture.state.lock().unwrap();
    assert_eq!(state.completion.as_ref().unwrap()["outcome"], "reconcile");
    assert!(state.claim_keys.is_empty());
    assert_eq!(state.channel_grants.len(), 1);
    assert_eq!(state.channel_grants[0]["secret"], secret);
    assert!(!fixture.root.join("bridge-secret").exists());
    assert!(!fixture.root.join("remote-marker").exists());
}
