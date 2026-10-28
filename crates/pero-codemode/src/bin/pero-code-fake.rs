//! Interpreter stand-in for code-run tests.
//!
//! `pero-codemode` clears the environment, so paths are not passed in.
//! Probe (`-I -c`) prints a fixed prefix. A program file is the next argument.

use std::io::Write;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("-I")
        && args.get(1).map(String::as_str) == Some("-c")
    {
        let prefix = if cfg!(windows) {
            r"C:\science"
        } else {
            "/opt/science"
        };
        println!("{prefix}");
        println!("deadbeef");
        return;
    }
    let program_path = args.get(1).map(String::as_str).unwrap_or("");
    let program = std::fs::read_to_string(program_path).unwrap_or_default();
    let cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    if let Ok(mut log) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(cwd.join("invocations.log"))
    {
        let _ = writeln!(log, "{program_path}");
    }
    if program.contains("SLEEP") {
        let _ = std::fs::write(cwd.join("ready"), b"");
        std::thread::sleep(std::time::Duration::from_secs(30));
        return;
    }
    if program.contains("FAIL") {
        eprintln!("boom");
        std::process::exit(3);
    }
    println!("ok");
}
