//! Native composition-root credential storage. No plaintext fallback.
use serde::{Serialize, de::DeserializeOwned};
use sha2::{Digest, Sha256};
use std::path::Path;

pub(crate) struct SecretStore {
    service: String,
    account: String,
    memory: Option<std::sync::Arc<std::sync::Mutex<Option<Vec<u8>>>>>,
}
impl SecretStore {
    pub fn new(data: &Path, kind: &str) -> Self {
        Self {
            service: format!("com.openpero.native.{kind}"),
            account: format!("{:x}", Sha256::digest(data.to_string_lossy().as_bytes())),
            memory: None,
        }
    }
    /// Process-local credentials. The developer preview is ad-hoc signed again
    /// on every rebuild, so a login-keychain item cannot stay authorized.
    pub fn ephemeral() -> Self {
        Self {
            service: String::new(),
            account: String::new(),
            memory: Some(Default::default()),
        }
    }
    pub fn open(data: &Path, kind: &str, ephemeral: bool) -> Self {
        if ephemeral {
            Self::ephemeral()
        } else {
            Self::new(data, kind)
        }
    }
    pub fn load<T: DeserializeOwned>(&self) -> Result<Option<T>, String> {
        if let Some(memory) = &self.memory {
            return memory
                .lock()
                .unwrap()
                .as_ref()
                .map(|bytes| {
                    serde_json::from_slice(bytes)
                        .map_err(|_| "Saved credentials are invalid".into())
                })
                .transpose();
        }
        #[cfg(target_os = "macos")]
        {
            match security_framework::passwords::get_generic_password(&self.service, &self.account)
            {
                Ok(bytes) if bytes.len() <= 65536 => serde_json::from_slice(&bytes)
                    .map(Some)
                    .map_err(|_| "Saved credentials are invalid. Reconnect this device.".into()),
                Ok(_) => Err("Saved credentials exceed the supported size".into()),
                Err(error) if error.code() == -25300 => Ok(None),
                Err(_) => {
                    Err("Unlock the system keychain and retry saving or reconnecting.".into())
                }
            }
        }
        #[cfg(not(target_os="macos"))]
        Err("Native secure credential storage is unavailable on this platform; use Electron Desktop.".into())
    }
    pub fn save(&self, value: &impl Serialize) -> Result<(), String> {
        let bytes = serde_json::to_vec(value).map_err(|_| "Could not encode device credentials")?;
        if let Some(memory) = &self.memory {
            *memory.lock().unwrap() = Some(bytes);
            return Ok(());
        }
        #[cfg(target_os = "macos")]
        return security_framework::passwords::set_generic_password(
            &self.service,
            &self.account,
            &bytes,
        )
        .map_err(|_| "Could not save credentials. Unlock the system keychain and retry.".into());
        #[cfg(not(target_os="macos"))]
        Err("Native secure credential storage is unavailable on this platform; use Electron Desktop.".into())
    }
    pub fn clear(&self) -> Result<(), String> {
        if let Some(memory) = &self.memory {
            *memory.lock().unwrap() = None;
            return Ok(());
        }
        #[cfg(target_os = "macos")]
        return match security_framework::passwords::delete_generic_password(
            &self.service,
            &self.account,
        ) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == -25300 => Ok(()),
            Err(_) => {
                Err("Could not remove saved credentials. Unlock the keychain and retry.".into())
            }
        };
        #[cfg(not(target_os = "macos"))]
        Err("Native secure credential storage is unavailable".into())
    }
    #[cfg(test)]
    pub fn memory() -> Self {
        Self::ephemeral()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Deserialize, Serialize};

    #[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
    struct Sample {
        token: String,
    }

    #[test]
    fn the_developer_preview_keeps_secrets_out_of_the_keychain() {
        let data = Path::new("/tmp/pero-native-preview");
        let cloud = SecretStore::open(data, "cloud", true);
        let device = SecretStore::open(data, "local-execution", true);
        cloud
            .save(&Sample {
                token: "local-only".into(),
            })
            .unwrap();
        assert_eq!(
            cloud.load::<Sample>().unwrap(),
            Some(Sample {
                token: "local-only".into()
            })
        );
        assert_eq!(device.load::<Sample>().unwrap(), None);
        cloud.clear().unwrap();
        assert_eq!(cloud.load::<Sample>().unwrap(), None);
    }
}
