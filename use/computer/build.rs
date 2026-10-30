fn main() {
    // The executable owns its deployment target; library link arguments do not propagate.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-mmacosx-version-min=13.0");
    }
}
