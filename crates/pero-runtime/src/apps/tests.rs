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
        self.send_response(200); self.end_headers()
        body = json.dumps({key: os.environ.get(key) for key in ('PERO_VIRTUAL_CELL_MODEL_URL', 'PERO_VIRTUAL_CELL_MODEL_TOKEN', 'PERO_NOTEBOOK_TEX_CACHE')}).encode() if self.path == '/deployment' else b'cell-result'
        self.wfile.write(body)
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
fn static_panel_access_does_not_start_its_backend() {
    let workspace = Workspace::new();
    let source = workspace.package(Some("python"));
    let name = AppName::try_from("virtual-cell".to_owned()).unwrap();
    let mut store = AppStore::open(workspace.0.join("managed/apps"), PythonEnvironments::default()).unwrap();
    assert!(store.resolve_static(&name).is_err());
    store.install(&source).unwrap();
    assert!(store.resolve_static(&name).is_err());
    store.set_enabled(&name, true).unwrap();
    let access = store.resolve_static(&name).unwrap();
    assert_eq!(fs::read_to_string(access.root.join(access.entry)).unwrap(), "<h1>Cell atlas</h1>");
    assert!(access.backend.is_none());
    assert!(store.running_backend(&name).is_err());
    assert!(!workspace.0.join("managed/app-data/virtual-cell/observed").exists());
    store.set_enabled(&name, false).unwrap();
    assert!(store.resolve_static(&name).is_err());
}

#[test]
fn notebook_catalog_projects_installed_declarations_without_granting_access() {
    let workspace = Workspace::new();
    let source = workspace.package(Some("node"));
    let mut manifest: serde_json::Value = serde_json::from_slice(&fs::read(source.join("app.json")).unwrap()).unwrap();
    manifest["contributes"]["panels"] = serde_json::json!([
        {"id":"main","title":"Cell atlas","entry":"dist/index.html"},
        {"id":"comparison","title":"Comparison","entry":"dist/index.html"}
    ]);
    manifest["contributes"]["writes"] = serde_json::json!([
        {"name":"compare","description":"Compare selected observations","path":"/api/compare","schema":{"type":"object"}}
    ]);
    manifest["contributes"]["canvases"] = serde_json::json!([
        {"id":"comparison","title":"Comparison","read":"/internal/canvas/read",
         "status":"/internal/canvas/status","inputs":{"type":"object"},"actions":[]}
    ]);
    fs::write(source.join("app.json"), serde_json::to_vec(&manifest).unwrap()).unwrap();
    let root = workspace.0.join("managed/apps");
    let mut store = AppStore::open(root.clone(), PythonEnvironments::default()).unwrap();
    store.install(&source).unwrap();
    manifest["name"] = serde_json::json!("notebook");
    manifest["displayName"] = serde_json::json!("Notebook");
    manifest.as_object_mut().unwrap().remove("backend");
    manifest["contributes"].as_object_mut().unwrap().remove("writes");
    manifest["contributes"].as_object_mut().unwrap().remove("canvases");
    manifest["contributes"]["columnHeader"] = serde_json::json!({
        "actions":[{"id":"save","label":"Save revision","icon":"save"}]
    });
    fs::write(source.join("app.json"), serde_json::to_vec(&manifest).unwrap()).unwrap();
    store.install(&source).unwrap();
    let notebook = AppName::try_from("notebook".to_owned()).unwrap();
    let cell = AppName::try_from("virtual-cell".to_owned()).unwrap();
    assert!(store.sdk_context(&notebook).is_err());
    store.set_enabled(&notebook, true).unwrap();
    let catalog = |store: &AppStore| serde_json::to_value(store.sdk_context(&notebook).unwrap()).unwrap();
    let before = catalog(&store);
    assert_eq!(before["columnHeader"], manifest["contributes"]["columnHeader"]);
    let cell_record = before["appViews"].as_array().unwrap().iter().find(|app| app["app"] == "virtual-cell").unwrap();
    assert_eq!(cell_record["enabled"], false);
    assert_eq!(cell_record["panels"], serde_json::json!([{"id":"main","title":"Cell atlas"},{"id":"comparison","title":"Comparison"}]));
    assert_eq!(cell_record["actions"], serde_json::json!([{"name":"compare","description":"Compare selected observations"}]));
    assert_eq!(cell_record["canvases"], serde_json::json!([
        {"id":"comparison","title":"Comparison","inputs":{"type":"object"}}
    ]));
    let public_fields = cell_record.as_object().unwrap().keys().map(String::as_str).collect::<std::collections::BTreeSet<_>>();
    assert_eq!(public_fields, ["actions","app","canvases","enabled","panels","revision","title","version"].into_iter().collect());
    assert_eq!(before["permissions"]["host"], serde_json::json!([]));
    assert!(!serde_json::to_string(&before).unwrap().contains("/api/compare"));
    assert!(!serde_json::to_string(&before).unwrap().contains("/internal/canvas/"));
    assert!(!serde_json::to_string(&before).unwrap().contains("dist/index.html"));
    store.set_enabled(&cell, true).unwrap();
    let ordinary = serde_json::to_value(store.sdk_context(&cell).unwrap()).unwrap();
    assert!(ordinary.get("appViews").is_none(), "Only Notebook receives installed App discovery");
    assert!(ordinary.get("columnHeader").is_none(), "Undeclared column headers remain omitted");
    assert_eq!(catalog(&store)["appViews"][1]["enabled"], true);
    assert!(store.processes.is_empty(), "Discovery must not resolve or start an App backend");
    store.set_enabled(&cell, false).unwrap();
    assert_eq!(catalog(&store)["appViews"][1]["enabled"], false);
    store.uninstall(&cell).unwrap();
    assert_eq!(catalog(&store)["appViews"].as_array().unwrap().len(), 1);
    drop(store);
    let store = AppStore::open(root, PythonEnvironments::default()).unwrap();
    assert_eq!(catalog(&store)["appViews"].as_array().unwrap().len(), 1);
    assert!(store.processes.is_empty());
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
fn compute_execution_receipts_use_the_app_data_directory() {
    let workspace = Workspace::new();
    let store = AppStore::open(workspace.0.join("installed"), PythonEnvironments::default()).unwrap();
    let name = AppName::try_from("compute".to_owned()).unwrap();
    assert!(store.execution_receipts(&name).ends_with("app-data/compute/executions"));
}

#[test]
fn app_run_access_uses_enabled_pero_agent_grants() {
    for granted in [false, true] {
        let workspace = Workspace::new(); let source = workspace.package(None);
        let path = source.join("app.json");
        let mut declaration: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        if granted { declaration["permissions"] = serde_json::json!({"host":["agent"]}); }
        fs::write(path, serde_json::to_vec(&declaration).unwrap()).unwrap();
        let mut store = AppStore::open(workspace.0.join("installed"), PythonEnvironments::default()).unwrap();
        store.install(&source).unwrap();
        let name = AppName::try_from("virtual-cell".to_owned()).unwrap();
        store.set_enabled(&name, true).unwrap();
        assert_eq!(store.agent_panel(&name).is_ok(), granted);
        assert_eq!(store.agent_declaration_revision(&name).is_ok(), granted);
        for path in ["/api/workspaces", "/api/harnesses"] { assert_eq!(store.agent_catalog_permission(&name, path).is_ok(), granted); }
        assert!(store.agent_catalog_permission(&name, "/api/projects").is_err());
        store.set_enabled(&name, false).unwrap();
        assert!(store.agent_panel(&name).is_err());
        assert!(store.agent_declaration_revision(&name).is_err());
    }
}

#[test]
fn canvas_admission_rechecks_installation_revision_and_declared_inputs_without_starting_backend() {
    use super::canvas::CanvasBinding;
    let workspace=Workspace::new();
    let source=workspace.package(Some("python"));
    let manifest=include_bytes!("../../../../apps/data/app.json");
    let definition=AppDefinition::parse(manifest).unwrap();
    fs::write(source.join("app.json"),manifest).unwrap();
    let name=AppName::try_from("data".to_owned()).unwrap();
    let mut store=AppStore::open(workspace.0.join("managed/apps"),PythonEnvironments::default()).unwrap();
    store.install(&source).unwrap();
    let binding: CanvasBinding=serde_json::from_value(serde_json::json!({"id":"binding","app":"data","panel":"main",
        "view":"dataset-inspector","declaration":definition.revision(),"inputs":{"datasetId":format!("ds-{}","a".repeat(32))}})).unwrap();
    assert!(store.canvas_view(&binding).is_err());
    store.set_enabled(&name,true).unwrap();assert!(store.canvas_view(&binding).is_ok());
    let mut changed=binding.clone();changed.declaration="b".repeat(64);assert!(store.canvas_view(&changed).is_err());
    changed=binding.clone();changed.inputs=serde_json::json!({"datasetId":"../private"});assert!(store.canvas_view(&changed).is_err());
    let action=AppName::try_from("canvas-archive".to_owned()).unwrap();
    let document=serde_json::json!({"operationId":"operation","inputs":binding.inputs,"params":{"archived":true}});
    assert!(store.canvas_action(&binding,&action,&document).is_ok());
    assert!(store.canvas_action(&binding,&AppName::try_from("unrelated".to_owned()).unwrap(),&document).is_err());
    assert!(store.processes.is_empty());
    store.set_enabled(&name,false).unwrap();assert!(store.canvas_view(&binding).is_err());
    store.uninstall(&name).unwrap();assert!(store.canvas_view(&binding).is_err());
}


#[test]
fn declared_stdlib_python_is_prepared_before_the_real_virtual_cell_backend_starts() {
    let workspace = Workspace::new();
    let source = workspace.package(Some("python"));
    let mut manifest: serde_json::Value = serde_json::from_slice(&fs::read(source.join("app.json")).unwrap()).unwrap();
    manifest["backend"]["python"] = serde_json::json!("3.12");
    fs::write(source.join("app.json"), serde_json::to_vec(&manifest).unwrap()).unwrap();
    // Use the production backend with the existing package fixture's static panel.
    let backend = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/virtual-cell/backend");
    copy_package(&backend, &source.join("backend"), &mut (0, 0)).unwrap();
    let name = AppName::try_from("virtual-cell".to_owned()).unwrap();
    let mut store = AppStore::open(workspace.0.join("managed/apps"), PythonEnvironments::default()).unwrap();
    store.install(&source).unwrap();
    store.set_enabled(&name, true).unwrap();
    let mut phases = Vec::new();
    let error = store.resolve_with_progress(&name, &mut |p| phases.push(p.phase)).err().unwrap();
    assert!(error.contains("Prepare the App environment"), "{error}");
    assert!(store.processes.is_empty(), "Opening must not spawn an incompatible system Python");
    assert!(matches!(phases.last(), Some(preparation::PreparationPhase::Required)));

    let environment = store.managed_python_directory(&name).unwrap();
    fs::create_dir_all(environment.parent().unwrap()).unwrap();
    // An installed interpreter creates an offline stdlib venv; no pip/download.
    let created = std::process::Command::new(python::bundled_python_executable().unwrap())
        .args(["-m", "venv", "--without-pip"]).arg(&environment).status().unwrap();
    assert!(created.success());
    phases.clear();
    store.prepare(&name, &mut |p| phases.push(p.phase)).unwrap();
    assert!(matches!(phases.last(), Some(preparation::PreparationPhase::Ready)));
    assert!(!phases.iter().any(|p| matches!(p, preparation::PreparationPhase::Creating | preparation::PreparationPhase::Installing)));
    assert_eq!(store.python.select(&name).unwrap().root(), environment);
    let access = store.resolve(&name).unwrap().backend.unwrap();
    let client = reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(5)).build().unwrap();
    let package: serde_json::Value = serde_json::from_str(&client.get(format!("{}/api/task-package", access.url))
        .header("X-Pero-App-Token", &access.token).send().unwrap().error_for_status().unwrap().text().unwrap()).unwrap();
    assert_eq!(package["id"], "virtual-cell.comparison");
    let endpoint: serde_json::Value = serde_json::from_str(&client.get(format!("{}/api/model", access.url))
        .header("X-Pero-App-Token", &access.token).send().unwrap().error_for_status().unwrap().text().unwrap()).unwrap();
    assert_eq!(endpoint["status"], "stopped");
    store.set_enabled(&name, false).unwrap();
    assert!(TcpStream::connect(access.url.strip_prefix("http://").unwrap()).is_err());
}

#[test]
fn deployment_configuration_reaches_only_its_backend() {
    const CHILD: &str = "PERO_TEST_MODEL_CONFIG_CHILD";
    const URL: &str = "https://model.example.invalid";
    const TOKEN: &str = "test-model-capability";
    const CACHE: &str = "/tmp/pero-test-tex-cache";
    if std::env::var(CHILD).as_deref() != Ok("1") {
        // Configure only this isolated Host test process; never mutate the
        // parent test runner's ambient environment while other tests run.
        let result = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "apps::tests::deployment_configuration_reaches_only_its_backend", "--nocapture"])
            .env(CHILD, "1").env("PERO_VIRTUAL_CELL_MODEL_URL", URL)
            .env("PERO_VIRTUAL_CELL_MODEL_TOKEN", TOKEN)
            .env("PERO_NOTEBOOK_TEX_CACHE", CACHE).status().unwrap();
        assert!(result.success());
        return;
    }
    for app in ["virtual-cell", "notebook", "other-app"] {
        let workspace = Workspace::new();
        let source = workspace.package(Some("python"));
        let mut manifest: serde_json::Value = serde_json::from_slice(&fs::read(source.join("app.json")).unwrap()).unwrap();
        manifest["name"] = serde_json::json!(app);
        fs::write(source.join("app.json"), serde_json::to_vec(&manifest).unwrap()).unwrap();
        let name = AppName::try_from(app.to_owned()).unwrap();
        let mut store = AppStore::open(workspace.0.join("managed/apps"), PythonEnvironments::default()).unwrap();
        store.install(&source).unwrap();
        store.set_enabled(&name, true).unwrap();
        let access = store.resolve(&name).unwrap().backend.unwrap();
        let observed: serde_json::Value = serde_json::from_str(&reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(5)).build().unwrap()
            .get(format!("{}/deployment", access.url)).header("X-Pero-App-Token", &access.token)
            .send().unwrap().error_for_status().unwrap().text().unwrap()).unwrap();
        let expected = match app {
            "virtual-cell" => serde_json::json!({"PERO_VIRTUAL_CELL_MODEL_URL":URL,"PERO_VIRTUAL_CELL_MODEL_TOKEN":TOKEN,"PERO_NOTEBOOK_TEX_CACHE":null}),
            "notebook" => serde_json::json!({"PERO_VIRTUAL_CELL_MODEL_URL":null,"PERO_VIRTUAL_CELL_MODEL_TOKEN":null,"PERO_NOTEBOOK_TEX_CACHE":CACHE}),
            _ => serde_json::json!({"PERO_VIRTUAL_CELL_MODEL_URL":null,"PERO_VIRTUAL_CELL_MODEL_TOKEN":null,"PERO_NOTEBOOK_TEX_CACHE":null}),
        };
        assert_eq!(observed, expected, "{app}");
    }
}
