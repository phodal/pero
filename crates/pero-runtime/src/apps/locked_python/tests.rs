use super::*;
use crate::apps::{
    AppName, AppStore, PythonEnvironments,
    local_environment::{EnvironmentState, Request},
};
use std::path::PathBuf;

/// Explicit opt-in: downloads official uv, managed Python and PyPI wheels. Retains evidence.
#[test]
#[ignore = "set PERO_UV_LIVE_HOME and run explicitly; uses network"]
fn locked_control_rebuild_and_recovery() {
    let root = PathBuf::from(std::env::var_os("PERO_UV_LIVE_HOME").expect("PERO_UV_LIVE_HOME"));
    assert!(!root.exists(), "Use a fresh absolute evidence directory");
    let repository = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    let method = if std::env::var("PERO_UV_LIVE_METHOD").as_deref() == Ok("pcgym") { ScientificMethod::Pcgym } else { ScientificMethod::Control };
    let app_name = method.target().0;
    for name in [app_name, "environments"] {
        let app = root.join("apps").join(name);
        fs::create_dir_all(&app).unwrap();
        fs::copy(
            repository.join("apps").join(name).join("app.json"),
            app.join("app.json"),
        )
        .unwrap();
        fs::write(app.join(".installation.json"), br#"{"enabled":true}"#).unwrap();
        if name == app_name {
            #[cfg(unix)]
            std::os::unix::fs::symlink(
                repository.join("apps").join(app_name).join("backend"),
                app.join("backend"),
            )
            .unwrap();
        }
    }
    let caller = AppName::try_from("environments".to_owned()).unwrap();
    let store = AppStore::open(root.join("apps"), PythonEnvironments::default()).unwrap();
    let first = store
        .local_environments(
            &caller,
            Request::CreateLocked {
                target: method,
                label: "first".to_owned().try_into().unwrap(),
            },
        )
        .unwrap()
        .pop()
        .unwrap();
    assert!(
        store
            .local_environments(&caller, Request::List { compute: false })
            .unwrap()
            .is_empty(),
        "compute profiles stay out of legacy App binding UI"
    );
    let start = std::time::Instant::now();
    store
        .environment_preparation(&caller, &first.id)
        .unwrap()
        .run(&mut |p| println!("{}", p.message))
        .unwrap();
    println!("First preparation: {:?}", start.elapsed());
    let first = store
        .local_environments(&caller, Request::List { compute: true })
        .unwrap()
        .pop()
        .unwrap();
    assert_eq!(first.state, EnvironmentState::Ready, "{:?}", first.error);
    assert!(
        store.environment_preparation(&caller, &first.id).is_err(),
        "published profile cannot be modified"
    );
    let first_profile = first.prepared.clone().unwrap();
    store
        .local_environments(
            &caller,
            Request::BindCompute {
                id: first.id.clone(),
            },
        )
        .unwrap();
    let rebuilt = store
        .local_environments(
            &caller,
            Request::Rebuild {
                id: first.id.clone(),
                label: "rebuild".to_owned().try_into().unwrap(),
            },
        )
        .unwrap()
        .into_iter()
        .find(|v| v.id != first.id)
        .unwrap();
    let start = std::time::Instant::now();
    store
        .environment_preparation(&caller, &rebuilt.id)
        .unwrap()
        .run(&mut |p| println!("{}", p.message))
        .unwrap();
    println!("Cached rebuild: {:?}", start.elapsed());
    let rebuilt = store
        .local_environments(&caller, Request::List { compute: true })
        .unwrap()
        .into_iter()
        .find(|v| v.id == rebuilt.id)
        .unwrap();
    assert_eq!(
        rebuilt.state,
        EnvironmentState::Ready,
        "{:?}",
        rebuilt.error
    );
    let second = rebuilt.prepared.as_ref().unwrap();
    assert_eq!(first_profile.lock_sha256, second.lock_sha256);
    assert_eq!(first_profile.observation, second.observation);
    assert_ne!(first_profile.root, second.root);
    let broken = store
        .local_environments(
            &caller,
            Request::Rebuild {
                id: first.id.clone(),
                label: "recover".to_owned().try_into().unwrap(),
            },
        )
        .unwrap()
        .into_iter()
        .find(|v| v.prepared.is_none())
        .unwrap();
    let recipe = root
        .join("environment/profiles")
        .join(format!("{}.recipe", broken.id.as_str()));
    let lock = fs::read(recipe.join("uv.lock")).unwrap();
    fs::write(recipe.join("uv.lock"), b"broken lock").unwrap();
    store
        .environment_preparation(&caller, &broken.id)
        .unwrap()
        .run(&mut |_| {})
        .unwrap();
    let failed = store
        .local_environments(&caller, Request::List { compute: true })
        .unwrap()
        .into_iter()
        .find(|v| v.id == broken.id)
        .unwrap();
    assert_eq!(failed.state, EnvironmentState::Failed);
    assert!(failed.error.unwrap().contains("digest changed"));
    fs::write(recipe.join("uv.lock"), lock).unwrap();
    // A prepared job interrupted before execution is recovered by existing AppStore startup.
    drop(store.environment_preparation(&caller, &broken.id).unwrap());
    let orphan = root
        .join("environment/profiles")
        .join(format!("{}-interrupted", broken.id.as_str()));
    fs::create_dir(&orphan).unwrap();
    fs::write(orphan.join("partial"), "interrupted installation").unwrap();
    drop(store);
    let store = AppStore::open(root.join("apps"), PythonEnvironments::default()).unwrap();
    let failed = store
        .local_environments(&caller, Request::List { compute: true })
        .unwrap()
        .into_iter()
        .find(|v| v.id == broken.id)
        .unwrap();
    assert_eq!(failed.state, EnvironmentState::Failed);
    assert!(failed.error.unwrap().contains("interrupted"));
    store
        .environment_preparation(&caller, &broken.id)
        .unwrap()
        .run(&mut |_| {})
        .unwrap();
    assert_eq!(
        store
            .local_environments(&caller, Request::List { compute: true })
            .unwrap()
            .into_iter()
            .find(|v| v.id == broken.id)
            .unwrap()
            .state,
        EnvironmentState::Ready
    );
    assert!(
        !orphan.exists(),
        "explicit retry cleans unpublished partial prefixes"
    );
    assert!(
        store.processes.is_empty(),
        "preparation/binding never starts an App backend"
    );
    let profiles = store
        .local_environments(&caller, Request::List { compute: true })
        .unwrap();
    fs::write(
        root.join("profiles.json"),
        serde_json::to_vec_pretty(&profiles).unwrap(),
    )
    .unwrap();
    println!("Evidence retained at {}", root.display());
}
