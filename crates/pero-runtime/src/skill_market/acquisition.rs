//! Owned acquisitions keyed by skill; cancellation never targets another skill.
use std::{
    collections::BTreeMap,
    io::Read,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    time::Duration,
};

#[derive(Clone, Default)]
pub struct AcquisitionControl(Arc<Mutex<Control>>);
#[derive(Default)]
struct Control {
    shutdown: bool,
    active: BTreeMap<String, Active>,
}
struct Active {
    cancelled: bool,
    child: Option<Child>,
}

impl AcquisitionControl {
    pub fn begin(&self, id: &str) -> Result<(), String> {
        let mut control = self.0.lock().map_err(|e| e.to_string())?;
        if control.shutdown {
            return Err("Host is shutting down".into());
        }
        if control.active.contains_key(id) {
            return Err("An acquisition is already running for this skill".into());
        }
        control.active.insert(
            id.into(),
            Active {
                cancelled: false,
                child: None,
            },
        );
        Ok(())
    }
    pub fn finish(&self, id: &str) {
        if let Ok(mut control) = self.0.lock() {
            control.active.remove(id);
        }
    }
    pub fn ensure_idle(&self, id: &str) -> Result<(), String> {
        if self
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .active
            .contains_key(id)
        {
            return Err("An acquisition is running for this skill; cancel it before changing its installed state".into());
        }
        Ok(())
    }
    pub fn cancel(&self, id: &str) -> Result<(), String> {
        let mut control = self.0.lock().map_err(|e| e.to_string())?;
        let active = control
            .active
            .get_mut(id)
            .ok_or("No acquisition is running for this skill")?;
        active.cancelled = true;
        if let Some(child) = &mut active.child {
            stop(child)?;
        }
        Ok(())
    }
    pub fn shutdown(&self) {
        if let Ok(mut control) = self.0.lock() {
            control.shutdown = true;
            for active in control.active.values_mut() {
                active.cancelled = true;
                if let Some(child) = &mut active.child {
                    let _ = stop(child);
                }
            }
        }
    }
    pub fn publish<T>(
        &self,
        id: &str,
        write: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let control = self.0.lock().map_err(|e| e.to_string())?;
        if control.shutdown || control.active.get(id).is_none_or(|v| v.cancelled) {
            return Err("Skill acquisition cancelled; installed version was kept".into());
        }
        write()
    }
    pub fn run(&self, id: &str, mut command: Command) -> Result<String, String> {
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let (stdout, stderr) = {
            let mut control = self.0.lock().map_err(|e| e.to_string())?;
            if control.shutdown {
                return Err("Host is shutting down".into());
            }
            let active = control
                .active
                .get_mut(id)
                .ok_or("No active skill acquisition")?;
            if active.cancelled {
                return Err("Skill acquisition cancelled".into());
            }
            let mut child=command.spawn().map_err(|_|"Default Pero Harness is unavailable; rebuild/install it before acquiring skills".to_string())?;
            let streams = (child.stdout.take().unwrap(), child.stderr.take().unwrap());
            active.child = Some(child);
            streams
        };
        let collect = |mut pipe: Box<dyn Read + Send>| {
            std::thread::spawn(move || {
                let mut bytes = Vec::new();
                let _ = pipe.by_ref().take(128 * 1024).read_to_end(&mut bytes);
                let _ = std::io::copy(&mut pipe, &mut std::io::sink());
                bytes
            })
        };
        let out = collect(Box::new(stdout));
        let err = collect(Box::new(stderr));
        let status = loop {
            let mut control = self.0.lock().map_err(|e| e.to_string())?;
            let active = control
                .active
                .get_mut(id)
                .ok_or("Acquisition ownership was lost")?;
            let child = active
                .child
                .as_mut()
                .ok_or("Acquisition process is missing")?;
            if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                active.child = None;
                break status;
            }
            drop(control);
            // This observes the owned external process; it does not synchronize goroutines.
            std::thread::sleep(Duration::from_millis(20));
        };
        let output = out.join().map_err(|_| "Cannot read acquisition output")?;
        let errors = err.join().map_err(|_| "Cannot read acquisition errors")?;
        let control = self.0.lock().map_err(|e| e.to_string())?;
        if control.shutdown || control.active.get(id).is_none_or(|v| v.cancelled) {
            return Err("Skill acquisition cancelled; installed version was kept".into());
        }
        if !status.success() {
            return Err(format!(
                "Skill acquisition failed: {}",
                String::from_utf8_lossy(&errors)
                    .chars()
                    .take(1200)
                    .collect::<String>()
            ));
        }
        String::from_utf8(output).map_err(|_| "Harness returned invalid text".into())
    }
}

fn stop(child: &mut Child) -> Result<(), String> {
    if child.try_wait().map_err(|e| e.to_string())?.is_some() {
        return Ok(());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let status = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(0x08000000)
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() && child.try_wait().map_err(|e| e.to_string())?.is_none() {
            return Err("Cannot stop the owned skill acquisition process".into());
        }
    }
    #[cfg(unix)]
    {
        if unsafe { libc::kill(child.id() as i32, libc::SIGTERM) } != 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
    }
    Ok(())
}
