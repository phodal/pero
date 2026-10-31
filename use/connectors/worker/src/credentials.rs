use rmcp::transport::auth::{AuthError, CredentialStore, StoredCredentials};
use std::sync::{Arc, Mutex};

// The native supervisor owns persistence. This mirror stays off the public reply
// value and is transferred only on the private worker pipe after a dispatch.
#[derive(Clone, Default)]
pub struct Mirror(pub Arc<Mutex<Option<StoredCredentials>>>);
#[async_trait::async_trait]
impl CredentialStore for Mirror {
    async fn load(&self) -> Result<Option<StoredCredentials>, AuthError> {
        Ok(self.0.lock().unwrap().clone())
    }
    async fn save(&self, value: StoredCredentials) -> Result<(), AuthError> {
        *self.0.lock().unwrap() = Some(value);
        Ok(())
    }
    async fn clear(&self) -> Result<(), AuthError> {
        *self.0.lock().unwrap() = None;
        Ok(())
    }
}
