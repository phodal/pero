//! macOS global emergency stop. Registration needs no input-monitoring grant.
use std::{ffi::c_void, ptr};

use pero_contracts::computer_runtime::ComputerControl;

#[repr(C)]
struct EventType {
    class: u32,
    kind: u32,
}

#[repr(C)]
#[derive(PartialEq, Eq)]
struct HotKeyId {
    signature: u32,
    id: u32,
}

const STOP: HotKeyId = HotKeyId {
    signature: u32::from_be_bytes(*b"Pero"),
    id: 1,
};
type EventRef = *mut c_void;

#[link(name = "Carbon", kind = "framework")]
unsafe extern "C" {
    fn GetApplicationEventTarget() -> EventRef;
    fn InstallEventHandler(
        target: EventRef,
        callback: extern "C" fn(EventRef, EventRef, EventRef) -> i32,
        count: u32,
        types: *const EventType,
        context: EventRef,
        handler: *mut EventRef,
    ) -> i32;
    fn RegisterEventHotKey(
        code: u32,
        modifiers: u32,
        id: HotKeyId,
        target: EventRef,
        options: u32,
        hotkey: *mut EventRef,
    ) -> i32;
    fn GetEventParameter(
        event: EventRef,
        name: u32,
        kind: u32,
        actual_type: *mut u32,
        size: usize,
        actual_size: *mut usize,
        data: EventRef,
    ) -> i32;
    fn UnregisterEventHotKey(hotkey: EventRef) -> i32;
    fn RemoveEventHandler(handler: EventRef) -> i32;
}

extern "C" fn stop(_: EventRef, event: EventRef, _: EventRef) -> i32 {
    let mut id = HotKeyId {
        signature: 0,
        id: 0,
    };
    let result = unsafe {
        GetEventParameter(
            event,
            u32::from_be_bytes(*b"----"),
            u32::from_be_bytes(*b"hkid"),
            ptr::null_mut(),
            std::mem::size_of::<HotKeyId>(),
            ptr::null_mut(),
            (&raw mut id).cast(),
        )
    };
    if result != 0 || id != STOP {
        return -9874; // eventNotHandledErr
    }
    if let Err(error) = crate::native::computer_control(ComputerControl::Stop {}) {
        eprintln!("Computer Use emergency stop: {error}");
    }
    0
}

pub(super) struct ComputerStopHotKey {
    handler: EventRef,
    hotkey: EventRef,
}

impl ComputerStopHotKey {
    pub(super) fn register() -> anyhow::Result<Self> {
        let mut registration = Self {
            handler: ptr::null_mut(),
            hotkey: ptr::null_mut(),
        };
        let event = EventType {
            class: u32::from_be_bytes(*b"keyb"),
            kind: 5,
        }; // kEventHotKeyPressed
        unsafe {
            let target = GetApplicationEventTarget();
            let result = InstallEventHandler(
                target,
                stop,
                1,
                &event,
                ptr::null_mut(),
                &mut registration.handler,
            );
            anyhow::ensure!(
                result == 0,
                "Could not install emergency stop handler ({result})"
            );
            let result = RegisterEventHotKey(
                53,
                (1 << 8) | (1 << 9),
                STOP,
                target,
                0,
                &mut registration.hotkey,
            );
            anyhow::ensure!(
                result == 0,
                "Could not register Command+Shift+Escape ({result})"
            );
        }
        Ok(registration)
    }
}

impl Drop for ComputerStopHotKey {
    fn drop(&mut self) {
        unsafe {
            if !self.hotkey.is_null() {
                UnregisterEventHotKey(self.hotkey);
            }
            if !self.handler.is_null() {
                RemoveEventHandler(self.handler);
            }
        }
    }
}
