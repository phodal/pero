use super::*;
use std::io::{Read, Write};
use std::net::TcpStream;

struct Workspace(PathBuf);
impl Workspace {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("pero-apps-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
    fn package(&self, backend: bool) -> PathBuf {
        let source = self.0.join("source");
        fs::create_dir_all(source.join("dist")).unwrap();
        fs::write(source.join("dist/index.html"), "<h1>Cell atlas</h1>").unwrap();
        let mut manifest = serde_json::json!({"schemaVersion":1,"name":"virtual-cell","version":"0.1.0",
            "displayName":"Virtual Cell","contributes":{"panels":[{"id":"main","title":"Virtual Cell","entry":"dist/index.html"}]}});
        if backend {
            fs::create_dir(source.join("backend")).unwrap();
            fs::write(
                source.join("backend/server.py"),
                r#"
import json, os, signal
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_GET(self):
        if self.headers.get('X-Pero-App-Token') != os.environ['PERO_APP_TOKEN']:
            self.send_response(403); self.end_headers(); return
        Path(os.environ['PERO_APP_DATA'], 'observed').write_text('request')
        self.send_response(200); self.end_headers(); self.wfile.write(b'cell-result')
class Server(HTTPServer):
    def server_bind(self):
        # Reverse DNS of 127.0.0.1 can exceed the Host readiness wait on macOS.
        self.socket.bind(self.server_address)
        self.server_address = self.socket.getsockname()
        self.server_name, self.server_port = '127.0.0.1', self.server_address[1]
server = Server(('127.0.0.1', 0), Handler)
print(json.dumps({'port':server.server_port}), flush=True)
server.serve_forever()
"#,
            )
            .unwrap();
            manifest["backend"] = serde_json::json!({"type":"python","entry":"backend/server.py"});
        }
        fs::write(
            source.join("app.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        source
    }
}
impl Drop for Workspace {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn installation_and_retained_data_lifecycle() {
    let workspace = Workspace::new();
    let source = workspace.package(false);
    let root = workspace.0.join("managed/apps");
    let name = AppName::try_from("virtual-cell".to_string()).unwrap();
    let mut store = AppStore::open(root.clone()).unwrap();
    assert!(store.list().is_empty());
    assert!(!store.install(&source).unwrap()[0].enabled);
    assert!(store.resolve(&name).is_err());
    assert!(store.install(&source).is_err());
    store.set_enabled(&name, true).unwrap();
    assert!(
        store
            .resolve(&name)
            .unwrap()
            .root
            .join("dist/index.html")
            .exists()
    );
    let data = workspace.0.join("managed/app-data/virtual-cell");
    fs::create_dir_all(&data).unwrap();
    fs::write(data.join("draft.json"), "user draft").unwrap();
    drop(store);
    let mut store = AppStore::open(root).unwrap();
    assert!(store.list()[0].enabled);
    store.set_enabled(&name, false).unwrap();
    assert!(store.resolve(&name).is_err());
    store.uninstall(&name).unwrap();
    assert!(store.list().is_empty());
    assert_eq!(
        fs::read_to_string(data.join("draft.json")).unwrap(),
        "user draft"
    );
    store.install(&source).unwrap();
    assert!(!store.list()[0].enabled);
}

#[test]
fn builtin_uninstall_is_not_reversed_on_restart() {
    let workspace = Workspace::new();
    let source = workspace.package(false);
    let catalog = workspace.0.join("builtin");
    fs::create_dir(&catalog).unwrap();
    fs::rename(&source, catalog.join("virtual-cell")).unwrap();
    let root = workspace.0.join("managed/apps");
    let mut store = AppStore::open(root.clone()).unwrap();
    store.seed_builtins(&catalog).unwrap();
    assert!(store.list()[0].enabled);
    store
        .uninstall(&AppName::try_from("virtual-cell".to_string()).unwrap())
        .unwrap();
    drop(store);
    let mut store = AppStore::open(root).unwrap();
    store.seed_builtins(&catalog).unwrap();
    assert!(store.list().is_empty());
}

#[test]
fn rejected_package_does_not_publish_partial_install() {
    let workspace = Workspace::new();
    let source = workspace.package(false);
    fs::remove_file(source.join("dist/index.html")).unwrap();
    let root = workspace.0.join("managed/apps");
    let mut store = AppStore::open(root.clone()).unwrap();
    assert!(store.install(&source).is_err());
    assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
    #[cfg(unix)]
    {
        fs::write(source.join("dist/index.html"), "hello").unwrap();
        std::os::unix::fs::symlink("/etc/passwd", source.join("leak")).unwrap();
        assert!(store.install(&source).is_err());
        assert_eq!(fs::read_dir(root).unwrap().count(), 0);
    }
}

#[test]
fn real_python_backend_is_authenticated_and_stops_on_disable() {
    let workspace = Workspace::new();
    let source = workspace.package(true);
    let name = AppName::try_from("virtual-cell".to_string()).unwrap();
    let mut store = AppStore::open(workspace.0.join("managed/apps")).unwrap();
    store.install(&source).unwrap();
    store.set_enabled(&name, true).unwrap();
    let access = store.resolve(&name).unwrap().backend.unwrap();
    let address = access.url.strip_prefix("http://").unwrap();
    let request = |token: &str| {
        let mut stream = TcpStream::connect(address).unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(2)))
            .unwrap();
        write!(
            stream,
            "GET / HTTP/1.0\r\nX-Pero-App-Token: {token}\r\n\r\n"
        )
        .unwrap();
        let mut reply = String::new();
        stream.read_to_string(&mut reply).unwrap();
        reply
    };
    assert!(request("wrong").contains("403"));
    assert!(request(&access.token).contains("cell-result"));
    assert!(
        workspace
            .0
            .join("managed/app-data/virtual-cell/observed")
            .is_file()
    );
    store.set_enabled(&name, false).unwrap();
    assert!(TcpStream::connect(address).is_err());
    store.set_enabled(&name, true).unwrap();
    assert_ne!(
        store.resolve(&name).unwrap().backend.unwrap().token,
        access.token
    );
    drop(store);
}
