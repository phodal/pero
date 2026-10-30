//! Bundle identity selection; launching reuses Point's verified installed-app catalog.
use computer_core::Window;
use computer_runtime::{DesktopDriver, error};
use pero_contracts::computer_use::*;
use point_computer_macos::{apps, launch};
unsafe extern "C" {
    fn pero_application_bundle_id(pid: i32, buffer: *mut std::ffi::c_char, capacity: usize)
    -> bool;
}
pub fn identity(pid: i32) -> String {
    let mut buffer = [0; 1024];
    if !unsafe { pero_application_bundle_id(pid, buffer.as_mut_ptr(), buffer.len()) } {
        return String::new();
    }
    unsafe { std::ffi::CStr::from_ptr(buffer.as_ptr()) }
        .to_string_lossy()
        .into_owned()
}

pub fn open(
    desktop: &crate::Desktop,
    bundle_id: &str,
) -> Result<(Option<Window>, String), ComputerError> {
    if let Some(window) = desktop
        .targets()?
        .into_iter()
        .find(|w| w.application_id == bundle_id)
    {
        return Ok((
            Some(window),
            format!("Selected running application {bundle_id}"),
        ));
    }
    let matches: Vec<_> = launch::installed_apps()
        .into_iter()
        .filter(|app| apps::bundle_identity_at(&app.path).0 == bundle_id)
        .collect();
    if matches.len() != 1 {
        return Err(error(
            ComputerErrorCode::TargetUnavailable,
            "The bundle ID must match exactly one installed application",
        ));
    }
    let app = &matches[0];
    let (path, _) = launch::resolve_target(&app.name)
        .map_err(|e| error(ComputerErrorCode::Unsupported, e.to_string()))?;
    if std::path::Path::new(&path) != app.path {
        return Err(error(
            ComputerErrorCode::TargetUnavailable,
            "This application name is ambiguous in the installed catalog",
        ));
    }
    launch::spawn_detached(&path).map_err(|e| error(ComputerErrorCode::Failed, e))?;
    Ok((
        None,
        format!("Started {bundle_id}; list targets after its window appears"),
    ))
}

unsafe extern "C" {
    fn pero_activate_application(pid: i32) -> bool;
}
pub fn activate(pid: i32) -> Result<(), ComputerError> {
    if unsafe { pero_activate_application(pid) } {
        Ok(())
    } else {
        Err(error(
            ComputerErrorCode::TargetUnavailable,
            "Cannot activate the selected application",
        ))
    }
}
