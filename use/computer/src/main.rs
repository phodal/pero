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
    #[cfg(target_os = "macos")]
    {
        use std::{
            io::{self, BufReader, Write},
            os::unix::net::UnixStream,
        };

        let args: Vec<_> = std::env::args_os().skip(1).collect();
        if let [mode, path, host_pid] = args.as_slice()
            && mode == "--socket"
        {
            let host_pid = host_pid
                .to_str()
                .and_then(|s| s.parse::<i32>().ok())
                .filter(|pid| *pid > 1)
                .ok_or_else(|| io::Error::other("Invalid Computer Use Host PID"))?;
            let mut socket = UnixStream::connect(path)?;
            writeln!(socket, "{}", std::process::id())?;
            return computer_runtime::serve_stream(
                Desktop::connect(),
                host_pid,
                BufReader::new(socket.try_clone()?),
                socket,
            );
        }
    }
    computer_runtime::serve(Desktop::connect())
}
