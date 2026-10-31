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
    fn package(&self, backend: Option<&str>) -> PathBuf {
        let source = self.0.join("source");
        fs::create_dir_all(source.join("dist")).unwrap();
        fs::write(source.join("dist/index.html"), "<h1>Cell atlas</h1>").unwrap();
        let mut manifest = serde_json::json!({"schemaVersion":1,"name":"virtual-cell","version":"0.1.0",
            "displayName":"Virtual Cell","contributes":{"panels":[{"id":"main","title":"Virtual Cell","entry":"dist/index.html"}]}});
        if let Some(kind) = backend {
            fs::create_dir(source.join("backend")).unwrap();
            fs::write(
                source.join("backend/server.py"),
                r#"
import json, os, signal
from http.server import BaseHTTPRequestHandler
from socketserver import TCPServer
from pathlib import Path
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_GET(self):
        if self.headers.get('X-Pero-App-Token') != os.environ['PERO_APP_TOKEN']:
            self.send_response(403); self.end_headers(); return
        Path(os.environ['PERO_APP_DATA'], 'observed').write_text('request')
        self.send_response(200); self.end_headers(); self.wfile.write(b'cell-result')
server = TCPServer(('127.0.0.1', 0), Handler)
print(json.dumps({'port':server.server_address[1]}), flush=True)
server.serve_forever()
"#,
            )
            .unwrap();
            let entry = if kind == "node" {
                fs::write(source.join("backend/server.mjs"), r#"
import {createServer} from 'node:http';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
const server = createServer((req, res) => {
  if (req.headers['x-pero-app-token'] !== process.env.PERO_APP_TOKEN) { res.writeHead(403); res.end(); return; }
  writeFileSync(join(process.env.PERO_APP_DATA, 'observed'), 'request');
  res.end('cell-result');
});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({port:server.address().port})));
"#).unwrap();
                "backend/server.mjs"
            } else {
                "backend/server.py"
            };
            manifest["backend"] = serde_json::json!({"type":kind,"entry":entry});
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
    let source = workspace.package(None);
    let root = workspace.0.join("managed/apps");
    let name = AppName::try_from("virtual-cell".to_string()).unwrap();
    let mut store = AppStore::open(root.clone(), PythonEnvironments::default()).unwrap();
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
    let mut store = AppStore::open(root, PythonEnvironments::default()).unwrap();
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
fn builtin_catalog_discovers_additions_without_overwriting_choices() {
    for legacy in [false, true] {
        let workspace = Workspace::new();
        let source = workspace.package(None);
        let catalog = workspace.0.join("builtin");
        fs::create_dir(&catalog).unwrap();
        fs::rename(&source, catalog.join("virtual-cell")).unwrap();
        let root = workspace.0.join("managed/apps");
        let name = AppName::try_from("virtual-cell".to_owned()).unwrap();
        let paper = AppName::try_from("paper-agent".to_owned()).unwrap();
        let mut store = AppStore::open(root.clone(), PythonEnvironments::default()).unwrap();
        if legacy {
            // This is the old on-disk format: no per-App discovery receipt.
            store.install(&catalog.join("virtual-cell")).unwrap();
            fs::write(root.join(".builtins-seeded"), "1\n").unwrap();
        } else {
            store.seed_builtins(&catalog).unwrap();
        }
        store.set_enabled(&name, false).unwrap();
        drop(store);
        let source = workspace.package(None);
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(source.join("app.json")).unwrap()).unwrap();
        manifest["name"] = serde_json::json!("paper-agent");
        fs::write(
            source.join("app.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        fs::rename(source, catalog.join("paper-agent")).unwrap();
        // A changed builtin replaces package bytes and keeps the enable choice.
        fs::write(
            catalog.join("virtual-cell/dist/index.html"),
            "changed upstream",
        )
        .unwrap();
        let data = root.parent().unwrap().join("app-data/virtual-cell");
        fs::create_dir_all(&data).unwrap();
        fs::write(data.join("draft.txt"), "user draft").unwrap();
        let mut store = AppStore::open(root.clone(), PythonEnvironments::default()).unwrap();
        store.seed_builtins(&catalog).unwrap();
        assert_eq!(store.list().len(), 2);
        assert!(
            !store
                .list()
                .iter()
                .find(|app| app.name == name)
                .unwrap()
                .enabled
        );
        assert_eq!(
            fs::read_to_string(data.join("draft.txt")).unwrap(),
            "user draft"
        );
        store.seed_builtins(&catalog).unwrap();
        assert!(
            !store
                .list()
                .iter()
                .find(|app| app.name == name)
                .unwrap()
                .enabled
        );
        assert!(
            store
                .list()
                .iter()
                .find(|app| app.name == paper)
                .unwrap()
                .enabled
        );
        assert_eq!(
            fs::read_to_string(root.join("virtual-cell/dist/index.html")).unwrap(),
            "changed upstream"
        );
        store.uninstall(&paper).unwrap();
        // Refresh and a new Host process both retain the removal.
        store.seed_builtins(&catalog).unwrap();
        drop(store);
        let mut store = AppStore::open(root, PythonEnvironments::default()).unwrap();
        store.seed_builtins(&catalog).unwrap();
        assert_eq!(store.list().len(), 1);
        assert_eq!(store.list()[0].name, name);
        assert!(!store.list()[0].enabled);
    }
}

#[test]
fn rejected_package_does_not_publish_partial_install() {
    let workspace = Workspace::new();
    let source = workspace.package(None);
    fs::remove_file(source.join("dist/index.html")).unwrap();
    let root = workspace.0.join("managed/apps");
    let mut store = AppStore::open(root.clone(), PythonEnvironments::default()).unwrap();
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
fn backend_lifecycle() {
    for kind in ["python", "node"] {
        let workspace = Workspace::new();
        let source = workspace.package(Some(kind));
        let name = AppName::try_from("virtual-cell".to_string()).unwrap();
        let mut store = AppStore::open(
            workspace.0.join("managed/apps"),
            PythonEnvironments::default(),
        )
        .unwrap();
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
}

#[test]
fn builtin_catalog_skips_an_unbuilt_app_and_honours_the_product_list() {
    let workspace = Workspace::new();
    let catalog = workspace.0.join("builtin");
    fs::create_dir(&catalog).unwrap();
    fs::rename(workspace.package(None), catalog.join("virtual-cell")).unwrap();
    // A second builtin whose dist/ was never built.
    let broken = workspace.package(None);
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(broken.join("app.json")).unwrap()).unwrap();
    manifest["name"] = serde_json::json!("data-agent");
    fs::write(
        broken.join("app.json"),
        serde_json::to_vec(&manifest).unwrap(),
    )
    .unwrap();
    fs::remove_dir_all(broken.join("dist")).unwrap();
    fs::rename(&broken, catalog.join("data-agent")).unwrap();
    let root = workspace.0.join("managed/apps");
    let data = AppName::try_from("data-agent".to_owned()).unwrap();

    let mut store = AppStore::open(root.clone(), PythonEnvironments::default()).unwrap();
    store.seed_builtins(&catalog).unwrap();
    assert_eq!(store.list().len(), 1);
    assert_eq!(
        store.list()[0].name,
        AppName::try_from("virtual-cell".to_owned()).unwrap()
    );

    // The skipped App was not recorded as discovered: once built, it is offered.
    fs::create_dir_all(catalog.join("data-agent/dist")).unwrap();
    fs::write(catalog.join("data-agent/dist/index.html"), "<h1>Data</h1>").unwrap();
    store
        .seed_builtins_only(&catalog, Some(&["virtual-cell".to_owned()]))
        .unwrap();
    assert!(store.list().iter().all(|app| app.name != data));
    store.seed_builtins(&catalog).unwrap();
    assert!(
        store
            .list()
            .iter()
            .any(|app| app.name == data && app.enabled)
    );
}

#[test]
fn required_tenure_rejects_disable_and_reinstalls_a_tampered_record() {
    for (required, action, enabled, installed, code) in [
        (false, "disable", Some(false), true, None),
        (false, "remove", None, false, None),
        (true, "disable", Some(true), true, Some(super::tenure::TenureFault::CODE)),
        (true, "remove", Some(true), true, Some(super::tenure::TenureFault::CODE)),
        (true, "reopen", Some(true), true, None),
    ] {
        let workspace = Workspace::new();
        let source = workspace.package(None);
        let root = workspace.0.join("managed/apps");
        let name = AppName::try_from("virtual-cell".to_string()).unwrap();
        let names = if required {
            std::collections::BTreeSet::from([name.clone()])
        } else {
            std::collections::BTreeSet::new()
        };
        let mut store = AppStore::open_required(root.clone(), PythonEnvironments::default(), names.clone()).unwrap();
        store.install(&source).unwrap();
        store.set_enabled(&name, true).unwrap();
        let result = match action {
            "disable" => store.set_enabled(&name, false).map(|_| ()),
            "remove" => store.uninstall(&name).map(|_| ()),
            "reopen" => {
                drop(store);
                fs::write(
                    root.join("virtual-cell/.installation.json"),
                    br#"{"enabled":false}"#,
                )
                .unwrap();
                store = AppStore::open_required(root.clone(), PythonEnvironments::default(), names).unwrap();
                Ok(())
            }
            _ => unreachable!(),
        };
        assert_eq!(result.as_ref().err().map(|error| error.to_string()).as_deref(), code, "{action}/{required}");
        let listed = store.list();
        assert_eq!(listed.iter().any(|app| app.name == name), installed, "{action}");
        if let Some(enabled) = enabled {
            assert_eq!(listed[0].enabled, enabled, "{action}");
            assert_eq!(listed[0].tenure == super::Tenure::Required, required, "{action}");
        }
        if action == "reopen" {
            let record: serde_json::Value = serde_json::from_slice(
                &fs::read(root.join("virtual-cell/.installation.json")).unwrap(),
            )
            .unwrap();
            assert_eq!(record["enabled"], true);
        }
    }
}


#[test]
fn point_config_uses_the_enabled_app_data_and_declared_storage_permission() {
    let workspace = Workspace::new();
    let source = workspace.package(None);
    fs::create_dir(source.join("point-source")).unwrap();
    let metadata = source.join("point-source/app.json");
    fs::write(&metadata, r#"{"permissions":{"storage":true,"api":["/api/apps/virtual-cell/config"]}}"#).unwrap();
    let mut store = AppStore::open(workspace.0.join("installed"), Default::default()).unwrap();
    let name = store.install(&source).unwrap()[0].name.clone();
    assert!(store.point_config(&name, None).is_err());
    store.set_enabled(&name, true).unwrap();
    assert_eq!(store.point_config(&name, None).unwrap(), serde_json::json!({}));
    let config = serde_json::json!({"pythonExecutable":"/explicit/python","nested":{"mode":"review"}});
    assert_eq!(store.point_config(&name, Some(config.clone())).unwrap(), config);
    assert!(store.point_config(&name, Some(serde_json::json!([]))).is_err());
    assert!(store.point_config(&name, Some(serde_json::json!({"large":"x".repeat(1048576)}))).is_err());
    drop(store);
    let mut store = AppStore::open(workspace.0.join("installed"), Default::default()).unwrap();
    assert_eq!(store.point_config(&name, None).unwrap(), config);
    fs::write(workspace.0.join("installed/virtual-cell/point-source/app.json"), r#"{"permissions":{"storage":false,"api":["/api/apps/virtual-cell/config"]}}"#).unwrap();
    assert!(store.point_config(&name, None).is_err());
}

#[test]
fn point_projects_require_enabled_declared_scope() {
    let workspace = Workspace::new();
    let source = workspace.package(None);
    fs::create_dir(source.join("point-source")).unwrap();
    fs::write(source.join("point-source/app.json"), r#"{"permissions":{"api":["/api/projects"]}}"#).unwrap();
    let mut store = AppStore::open(workspace.0.join("installed"), Default::default()).unwrap();
    let name = store.install(&source).unwrap()[0].name.clone();
    assert!(store.point_project_root(&name, "/api/projects").is_err());
    store.set_enabled(&name, true).unwrap();
    assert_eq!(store.point_project_root(&name, "/api/projects?view=local").unwrap(), dunce::canonicalize(&workspace.0).unwrap().join("point-projects"));
    assert!(store.point_project_root(&name, "/api/workspaces").is_err());
    fs::write(workspace.0.join("installed/virtual-cell/point-source/app.json"), r#"{"permissions":{"api":[]}}"#).unwrap();
    assert!(store.point_project_root(&name, "/api/projects").is_err());
}
