//! Executable composition root; platform selection lives only here.
#[cfg(target_os = "linux")]
use computer_linux::Desktop;
#[cfg(target_os = "macos")]
use computer_macos::Desktop;
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
use computer_runtime::UnsupportedDesktop as Desktop;
#[cfg(target_os = "windows")]
use computer_windows::Desktop;

fn main() -> std::io::Result<()> {
    computer_runtime::serve(Desktop::connect())
}
