use std::{env, path::PathBuf, process::Command};

fn main() {
    println!("cargo:rerun-if-changed=capture.m");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    let output = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    let architecture = match env::var("CARGO_CFG_TARGET_ARCH").unwrap().as_str() {
        "aarch64" => "arm64",
        "x86_64" => "x86_64",
        _ => panic!("Unsupported macOS architecture"),
    };
    assert!(
        Command::new("xcrun")
            .args([
                "clang",
                "-arch",
                architecture,
                "-fobjc-arc",
                "-fblocks",
                "-mmacosx-version-min=13.0",
                "-Werror",
                "-c",
                "capture.m",
                "-o"
            ])
            .arg(output.join("capture.o"))
            .status()
            .unwrap()
            .success(),
        "Could not compile ScreenCaptureKit bridge"
    );
    assert!(
        Command::new("ar")
            .arg("crs")
            .arg(output.join("libpero_capture.a"))
            .arg(output.join("capture.o"))
            .status()
            .unwrap()
            .success()
    );
    println!("cargo:rustc-link-search=native={}", output.display());
    println!("cargo:rustc-link-lib=static=pero_capture");
    for framework in [
        "ScreenCaptureKit",
        "Foundation",
        "ImageIO",
        "CoreGraphics",
        "CoreFoundation",
    ] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
}
