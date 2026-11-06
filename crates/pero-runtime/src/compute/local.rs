use super::*;
use crate::environments::*;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

/// An explicitly chosen executable; ambient PATH cannot select a replacement.
pub struct LocalOwner {
    program: PathBuf,
    expected: ContentDigest,
    resource: ResourceRef,
    runtime: Identity,
    launched: bool,
}
impl LocalOwner {
    /// Host supplies its boot incarnation and resource identity. A PID/path alone
    /// is not a durable execution identity.
    pub fn adopt(
        program: PathBuf,
        resource: ResourceRef,
        runtime: Identity,
    ) -> Result<Self, String> {
        let program = program.canonicalize().map_err(|e| e.to_string())?;
        let expected = digest(&program)?;
        Ok(Self {
            program,
            expected,
            resource,
            runtime,
            launched: false,
        })
    }
    pub fn program(&self) -> &Path {
        &self.program
    }
}
fn digest(path: &Path) -> Result<ContentDigest, String> {
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    std::io::copy(&mut file, &mut hash).map_err(|e| e.to_string())?;
    format!("{:x}", hash.finalize())
        .try_into()
        .map_err(|e: EnvironmentError| e.to_string())
}
impl ProcessOwner for LocalOwner {
    fn observe(&self, now_ms: u64) -> Result<ResourceBinding, String> {
        if digest(&self.program)? != self.expected {
            return Err("Selected executable changed; resolve the environment again".into());
        }
        let name: Identity = "program".to_owned().try_into().unwrap();
        let profile = SoftwareProfile::observed(
            ComponentObservation::new(
                name.clone(),
                std::env::consts::OS.to_owned().try_into().unwrap(),
                std::env::consts::ARCH.to_owned().try_into().unwrap(),
                BTreeMap::from([(
                    name,
                    SoftwareComponent::Native {
                        program: NativeProgram {
                            version: None,
                            sha256: Some(self.expected.clone()),
                            status: NativeStatus::Observed,
                        },
                    },
                )]),
            )
            .map_err(|e| e.to_string())?,
        );
        Ok(ResourceBinding {
            resource: self.resource.clone(),
            runtime: self.runtime.clone(),
            observed_at_ms: now_ms,
            readiness: Readiness::Ready,
            profile,
            capabilities: BTreeSet::from([Capability::Process]),
        })
    }
    fn launch(
        &mut self,
        _use_id: &Identity,
        invocation: &MethodInvocation,
    ) -> Result<ProcessHandle, String> {
        if self.launched {
            return Err("This execution target was already dispatched".into());
        }
        if invocation.program != self.program {
            return Err("Invocation does not use the selected executable".into());
        }
        self.observe(0)?;
        let mut command = Command::new(&self.program);
        command
            .args(&invocation.arguments)
            .current_dir(&invocation.directory);
        super::logs(&mut command, &invocation.directory)?;
        self.launched = true;
        Ok(ProcessHandle {
            process: OwnedProcess::spawn(&mut command).map_err(|e| e.to_string())?,
            cleanup: None,
        })
    }
}
