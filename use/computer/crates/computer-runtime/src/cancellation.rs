//! Connection cancellation: wakes native holds so their scoped button guard can release.
use pero_contracts::computer_use::{ComputerError, ComputerErrorCode};
use std::{
    sync::{Arc, Condvar, Mutex},
    time::Duration,
};

#[derive(Clone, Default)]
pub struct Cancellation(Arc<(Mutex<bool>, Condvar)>);
impl Cancellation {
    pub fn cancel(&self) {
        let (flag, signal) = &*self.0;
        *flag.lock().unwrap() = true;
        signal.notify_all();
    }
    pub fn wait(&self, duration: Duration) -> Result<(), ComputerError> {
        let (flag, signal) = &*self.0;
        let (cancelled, _) = signal
            .wait_timeout_while(flag.lock().unwrap(), duration, |cancelled| !*cancelled)
            .unwrap();
        if *cancelled {
            Err(crate::error(
                ComputerErrorCode::Cancelled,
                "The desktop connection closed; held input was released",
            ))
        } else {
            Ok(())
        }
    }
}
